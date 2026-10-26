import { array, IofValidationError, record, rejectUnexpectedKeys, requireText, text, type XmlRecord } from "./xml";

/**
 * IOF XML 3.0 CourseData → O-Tids banmodell (ADR-0169 beslut 2).
 *
 * - En `Course` utan `CourseFamily` blir en bana.
 * - `Course`-element med samma `CourseFamily` (gafflingar från OCAD, Purple Pen eller
 *   Condes) blir en bana med familjens namn och en variant per `Course`. Variantens kod
 *   är banans namn utan familjenamnet ("Lång-AC" i familjen "Lång" ger "AC").
 * - `ClassCourseAssignment` pekar klassen på banan via `CourseFamily` eller `CourseName`
 *   (en variants namn ger hela den gafflade banan: klassen pekar på banan).
 * - `PersonCourseAssignment` ger en löpare (`EntryId`, annars `PersonName` + `ClassName`)
 *   varianten som `CourseName` anger.
 * - `TeamCourseAssignment` ger ett stafettlag (`BibNumber`, annars `TeamName` + `ClassName`)
 *   en variant per sträcka (`TeamMemberCourseAssignment` med `Leg` och `CourseName`).
 * - Steg 47: `ClassCourseAssignment` med `AllowedOnLeg` ger stafettsträckans bana (`legAssignments`). Klassens bana
 *   (`assignments`, en per klass) är tilldelningen utan `AllowedOnLeg`, annars den som gäller den lägsta sträckan.
 */
export interface CourseVariantImport {
  readonly code: string;
  readonly controlCodes: readonly number[];
  /** Variantens längd i hela meter (IOF Length på variantens Course), steg 49. */
  readonly lengthMeters?: number;
}

/** Steg 49: ett läge i WGS 84 (IOF `Position lat/lng`). */
export interface GeoPosition {
  readonly latitude: number;
  readonly longitude: number;
}

export interface CourseImport {
  /** Steg 49: startens och målets lägen när banfilen har dem. */
  readonly startPosition?: GeoPosition;
  readonly finishPosition?: GeoPosition;
  readonly externalId: string;
  readonly name: string;
  /** Tom för en gafflad bana; kontrollerna finns då i varianterna. */
  readonly controlCodes: readonly number[];
  readonly variants?: readonly CourseVariantImport[];
  /** Banans längd och stigning i hela meter (IOF Length/Climb). En gafflad bana får den längsta variantens värden. */
  readonly lengthMeters?: number;
  readonly climbMeters?: number;
}

export interface ClassCourseImport {
  readonly classExternalId: string;
  readonly className: string;
  readonly courseExternalId: string;
  readonly startRule: "FIXED" | "PUNCH";
}

/** Steg 47: stafettsträckans bana (`ClassCourseAssignment` med `AllowedOnLeg`). */
export interface LegCourseAssignmentImport {
  readonly classExternalId: string;
  readonly className: string;
  readonly leg: number;
  readonly courseExternalId: string;
}

export interface PersonCourseAssignmentImport {
  readonly entryExternalId?: string;
  readonly personName?: string;
  readonly className?: string;
  readonly courseExternalId: string;
  readonly variantCode: string;
}

/** Stafett: lagets variant per sträcka (`TeamCourseAssignment` med `TeamMemberCourseAssignment`). */
export interface TeamCourseAssignmentImport {
  readonly bibNumber?: number;
  readonly teamName?: string;
  readonly className?: string;
  readonly legs: readonly { readonly leg: number; readonly courseExternalId: string; readonly variantCode: string }[];
}

export interface CourseDataImport {
  readonly kind: "CourseData";
  readonly courses: readonly CourseImport[];
  readonly assignments: readonly ClassCourseImport[];
  readonly legAssignments: readonly LegCourseAssignmentImport[];
  readonly personAssignments: readonly PersonCourseAssignmentImport[];
  readonly teamAssignments: readonly TeamCourseAssignmentImport[];
  /** Steg 49: kontrollernas lägen (IOF `Control/Position`) när banfilen har dem. */
  readonly controlPositions: readonly ({ readonly code: number } & GeoPosition)[];
  readonly warnings: readonly string[];
}

const FAMILY_PREFIX = "family:";
const MAX_VARIANTS = 100;

/** "Lång-AC", "Lång AC", "Lång.AC" eller "Lång:AC" i familjen "Lång" ger "AC"; annars hela namnet. */
export function courseVariantCode(familyName: string, courseName: string): string {
  if (courseName.length > familyName.length && courseName.toLocaleLowerCase("sv-SE").startsWith(familyName.toLocaleLowerCase("sv-SE"))) {
    const rest = courseName.slice(familyName.length).replace(/^[\s\-._:/]+/, "").trim();
    if (rest) return rest;
  }
  return courseName.trim();
}

interface ParsedCourse {
  readonly computedMeters?: number;
  readonly startPosition?: GeoPosition;
  readonly finishPosition?: GeoPosition;
  readonly externalId: string;
  readonly name: string;
  readonly family: string;
  readonly controlCodes: number[];
  readonly lengthMeters?: number;
  readonly climbMeters?: number;
}

/** Längd eller stigning i meter: ett icke-negativt tal, avrundat till hela meter. Tomt eller ogiltigt = saknas. */
function meters(value: unknown, path: string, warnings: string[], minimum: number): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > 1_000_000) {
    warnings.push(`${path} är ogiltig och hoppas över`);
    return undefined;
  }
  return Math.round(parsed);
}

/** IOF `Position` (lat/lng i WGS 84); ett ogiltigt läge räknas som saknat. */
function geoPosition(value: unknown): GeoPosition | undefined {
  const position = record(value);
  const latitude = Number(text(position["@_lat"])), longitude = Number(text(position["@_lng"]));
  if (!text(position["@_lat"]) || !text(position["@_lng"]) || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { latitude, longitude };
}

/** IOF `MapPosition` i millimeter på kartan (`unit` mm, standard). */
function mapPosition(value: unknown): { x: number; y: number } | undefined {
  const position = record(value);
  const x = Number(text(position["@_x"])), y = Number(text(position["@_y"]));
  const unit = text(position["@_unit"]) || "mm";
  if (!text(position["@_x"]) || !Number.isFinite(x) || !Number.isFinite(y) || unit !== "mm") return undefined;
  return { x, y };
}

/** Avstånd i meter mellan två lägen (storcirkel). */
function geoDistance(from: GeoPosition, to: GeoPosition): number {
  const rad = Math.PI / 180, earth = 6_371_008.8;
  const dLat = (to.latitude - from.latitude) * rad, dLng = (to.longitude - from.longitude) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.latitude * rad) * Math.cos(to.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Steg 49: banans längd ur lägena när filen saknar Length: start, kontroller och mål i WGS 84, annars kartlägena med
 * kartans skala. Undefined när något läge saknas.
 */
function lengthFromPositions(points: readonly (GeoPosition | undefined)[], mapPoints: readonly ({ x: number; y: number } | undefined)[],
  scale: number | undefined): number | undefined {
  const sum = <T>(list: readonly (T | undefined)[], distance: (a: T, b: T) => number) => {
    if (list.length < 2 || list.some((point) => point === undefined)) return undefined;
    let total = 0;
    for (let index = 1; index < list.length; index += 1) total += distance(list[index - 1]!, list[index]!);
    return total;
  };
  const geo = sum(points, geoDistance);
  const map = scale === undefined ? undefined : sum(mapPoints, (a, b) => Math.hypot(b.x - a.x, b.y - a.y) * scale / 1000);
  const meters = geo ?? map;
  return meters === undefined || meters < 1 ? undefined : Math.round(meters);
}

/** Variantens längd: filens Length, annars räknad ur lägena (steg 49). */
const variantLength = (course: ParsedCourse) => {
  const value = course.lengthMeters !== undefined && course.lengthMeters > 0 ? course.lengthMeters : course.computedMeters;
  return value === undefined ? {} : { lengthMeters: value };
};
const placed = (course: ParsedCourse) => ({ ...(course.startPosition ? { startPosition: course.startPosition } : {}),
  ...(course.finishPosition ? { finishPosition: course.finishPosition } : {}) });

function measured(lengthMeters: number | undefined, climbMeters: number | undefined) {
  return { ...(lengthMeters !== undefined && lengthMeters > 0 ? { lengthMeters } : {}), ...(climbMeters !== undefined ? { climbMeters } : {}) };
}

export function readCourseData(root: XmlRecord): CourseDataImport {
  const issues: string[] = [];
  const warnings: string[] = [];
  const courses: CourseImport[] = [];
  const assignments: ClassCourseImport[] = [];
  const legAssignments: LegCourseAssignmentImport[] = [];
  /** Lägsta sträckan för klassens tilldelning (0 = utan AllowedOnLeg). */
  const classAssignmentLeg = new Map<string, number>();
  const personAssignments: PersonCourseAssignmentImport[] = [];
  const teamAssignments: TeamCourseAssignmentImport[] = [];
  const controlPositions: ({ code: number } & GeoPosition)[] = [];

  for (const [raceIndex, rawRaceData] of array(root.RaceCourseData).entries()) {
    const raceData = record(rawRaceData);
    rejectUnexpectedKeys(
      raceData,
      ["Map", "Control", "Course", "ClassCourseAssignment", "PersonCourseAssignment", "TeamCourseAssignment", "Extensions", "@_raceNumber"],
      `RaceCourseData[${raceIndex}]`,
      issues
    );
    const controls = new Map<string, number>();
    // Steg 49: lägen per kontroll-id (även start och mål) och kartans skala.
    const positions = new Map<string, GeoPosition>();
    const mapPositions = new Map<string, { x: number; y: number }>();
    const scaleText = text(record(array(raceData.Map)[0]).Scale);
    const scale = scaleText && Number.isFinite(Number(scaleText)) && Number(scaleText) > 0 ? Number(scaleText) : undefined;
    for (const [index, rawControl] of array(raceData.Control).entries()) {
      const control = record(rawControl);
      const externalId = requireText(control.Id, `RaceCourseData[${raceIndex}].Control[${index}].Id`, issues);
      const controlType = text(control["@_type"] || "Control");
      const code = Number(externalId);
      const position = geoPosition(control.Position);
      if (position) positions.set(externalId, position);
      const onMap = mapPosition(control.MapPosition);
      if (onMap) mapPositions.set(externalId, onMap);
      if (controlType === "Control" && (!Number.isInteger(code) || code <= 0)) {
        issues.push(`RaceCourseData[${raceIndex}].Control[${index}].Id måste vara en positiv kontrollkod`);
      } else if (controlType === "Control") {
        controls.set(externalId, code);
      }
    }

    const parsed: ParsedCourse[] = array(raceData.Course).map((rawCourse, index) => {
      const course = record(rawCourse);
      const path = `RaceCourseData[${raceIndex}].Course[${index}]`;
      rejectUnexpectedKeys(
        course,
        ["Id", "Name", "CourseFamily", "Length", "Climb", "CourseControl", "MapId", "Extensions", "@_numberOfCompetitors", "@_modifyTime"],
        path,
        issues
      );
      const family = text(course.CourseFamily);
      const name = requireText(course.Name, `${path}.Name`, issues);
      // Banan identifieras av sitt Id; OCAD skriver ofta inget Id och då gäller namnet (en variant i en familj
      // identifieras av familjen).
      const externalId = text(course.Id) || name;
      const controlCodes = array(course.CourseControl)
        .map(record)
        .filter((courseControl) => text(courseControl["@_type"] || "Control") === "Control")
        .map((courseControl, controlIndex) => {
          const controlId = requireText(courseControl.Control, `${path}.CourseControl[${controlIndex}].Control`, issues);
          const code = controls.get(controlId);
          if (code === undefined) {
            issues.push(`${path} refererar okänd kontroll ${controlId}`);
            return 0;
          }
          return code;
        });
      if (controlCodes.length === 0) issues.push(`${path} saknar vanliga kontroller`);
      if (array(course.CourseControl).length < 2) issues.push(`${path} måste ha minst två CourseControl enligt IOF XML 3.0`);
      const ids = array(course.CourseControl).map(record).map((courseControl) => ({ type: text(courseControl["@_type"] || "Control"),
        id: text(courseControl.Control) }));
      const startId = ids.find((entry) => entry.type === "Start")?.id, finishId = [...ids].reverse().find((entry) => entry.type === "Finish")?.id;
      const startPosition = startId ? positions.get(startId) : undefined, finishPosition = finishId ? positions.get(finishId) : undefined;
      const routeIds = ids.filter((entry) => entry.type === "Start" || entry.type === "Control" || entry.type === "Finish").map((entry) => entry.id);
      // Längden ur lägena används bara för att jämföra varianter; banans längd är filens Length.
      const computedMeters = lengthFromPositions(routeIds.map((id) => positions.get(id)), routeIds.map((id) => mapPositions.get(id)), scale);
      return { externalId, name, family, controlCodes, ...(startPosition ? { startPosition } : {}), ...(finishPosition ? { finishPosition } : {}),
        ...(computedMeters === undefined ? {} : { computedMeters }),
        ...measured(meters(course.Length, `${path}.Length`, warnings, 0), meters(course.Climb, `${path}.Climb`, warnings, 0)) };
    });

    const raceCourses: CourseImport[] = [];
    const courseByName = new Map<string, { externalId: string; variantCode?: string }>();
    const families = new Map<string, ParsedCourse[]>();
    for (const course of parsed) {
      if (!course.family) {
        raceCourses.push({ externalId: course.externalId, name: course.name, controlCodes: course.controlCodes,
          ...placed(course), ...measured(course.lengthMeters, course.climbMeters) });
        courseByName.set(course.name, { externalId: course.externalId });
      } else {
        families.set(course.family, [...families.get(course.family) ?? [], course]);
      }
    }
    for (const [family, members] of families) {
      const externalId = `${FAMILY_PREFIX}${family}`;
      const variants = members.map((member) => ({ code: courseVariantCode(family, member.name), controlCodes: member.controlCodes,
        ...variantLength(member) }));
      const codes = new Set(variants.map((variant) => variant.code));
      if (codes.size !== variants.length) issues.push(`CourseFamily ${family} har varianter med samma kod`);
      if (variants.length > MAX_VARIANTS) issues.push(`CourseFamily ${family} får ha högst ${MAX_VARIANTS} varianter`);
      for (const variant of variants) if (variant.code.length > 32) issues.push(`Variantkoden ${variant.code} är för lång`);
      if (family.length > 160) issues.push(`CourseFamily ${family} är för långt`);
      const longest = [...members].sort((left, right) => (right.lengthMeters ?? 0) - (left.lengthMeters ?? 0))[0];
      raceCourses.push({ externalId, name: family, controlCodes: [], variants, ...(members[0] ? placed(members[0]) : {}),
        ...measured(longest?.lengthMeters, longest?.climbMeters) });
      courseByName.set(family, { externalId });
      for (const [index, member] of members.entries()) courseByName.set(member.name, { externalId, variantCode: variants[index]!.code });
    }
    courses.push(...raceCourses);
    for (const [externalId, code] of controls) {
      const position = positions.get(externalId);
      if (position && !controlPositions.some((known) => known.code === code)) controlPositions.push({ code, ...position });
    }

    for (const [index, rawAssignment] of array(raceData.ClassCourseAssignment).entries()) {
      const assignment = record(rawAssignment);
      const path = `RaceCourseData[${raceIndex}].ClassCourseAssignment[${index}]`;
      rejectUnexpectedKeys(
        assignment,
        ["ClassId", "ClassName", "AllowedOnLeg", "CourseName", "CourseFamily", "TeamMemberCourseAssignment", "Extensions"],
        path,
        issues
      );
      const className = requireText(assignment.ClassName, `${path}.ClassName`, issues);
      const classExternalId = text(assignment.ClassId) || className;
      const family = text(assignment.CourseFamily);
      const courseName = text(assignment.CourseName);
      const matched = family ? (families.has(family) ? courseByName.get(family) : undefined) : courseName ? courseByName.get(courseName) : undefined;
      if (!family && !courseName) issues.push(`${path}.CourseName eller CourseFamily saknas`);
      else if (!matched) issues.push(`${path} refererar okänd bana ${family || courseName}`);
      const courseExternalId = matched?.externalId ?? (family || courseName);
      const allowed = array(assignment.AllowedOnLeg).map(value => text(value)).filter(value => value !== "");
      const legs = allowed.flatMap(value => /^[1-9][0-9]?$/.test(value) ? [Number(value)] : []);
      if (legs.length !== allowed.length) issues.push(`${path}.AllowedOnLeg är ogiltig`);
      for (const leg of legs) legAssignments.push({ classExternalId, className, leg, courseExternalId });
      // En klass får en bana: utan AllowedOnLeg den, annars banan för den lägsta sträckan.
      const order = legs.length === 0 ? 0 : Math.min(...legs);
      const previous = classAssignmentLeg.get(classExternalId);
      if (previous !== undefined && previous <= order) continue;
      if (previous !== undefined) assignments.splice(assignments.findIndex(row => row.classExternalId === classExternalId), 1);
      classAssignmentLeg.set(classExternalId, order);
      assignments.push({ classExternalId, className, courseExternalId, startRule: "PUNCH" });
    }

    // Utan Course-element i filen (bara tilldelningar) ger familjen och namnet varianten.
    const variantOf = (courseName: string, family: string | undefined) => {
      const matched = courseByName.get(courseName) ??
        (family ? { externalId: `${FAMILY_PREFIX}${family}`, variantCode: courseVariantCode(family, courseName) } : undefined);
      return matched?.variantCode && !(family && matched.externalId !== `${FAMILY_PREFIX}${family}`)
        ? { courseExternalId: matched.externalId, variantCode: matched.variantCode } : undefined;
    };
    for (const [index, rawAssignment] of array(raceData.PersonCourseAssignment).entries()) {
      const assignment = record(rawAssignment);
      const path = `RaceCourseData[${raceIndex}].PersonCourseAssignment[${index}]`;
      rejectUnexpectedKeys(assignment, ["EntryId", "BibNumber", "PersonName", "ClassName", "CourseName", "CourseFamily", "Extensions"], path, issues);
      const entryExternalId = text(assignment.EntryId);
      const personName = text(assignment.PersonName);
      const className = text(assignment.ClassName);
      const courseName = requireText(assignment.CourseName, `${path}.CourseName`, issues);
      if (!entryExternalId && !(personName && className)) issues.push(`${path} behöver EntryId eller PersonName och ClassName`);
      const matched = variantOf(courseName, text(assignment.CourseFamily));
      if (!matched) {
        issues.push(`${path} refererar okänd variant ${courseName}`);
        continue;
      }
      personAssignments.push({
        ...(entryExternalId ? { entryExternalId } : {}),
        ...(personName ? { personName } : {}),
        ...(className ? { className } : {}),
        ...matched
      });
    }
    for (const [index, rawTeam] of array(raceData.TeamCourseAssignment).entries()) {
      const team = record(rawTeam);
      const path = `RaceCourseData[${raceIndex}].TeamCourseAssignment[${index}]`;
      rejectUnexpectedKeys(team, ["EntryId", "BibNumber", "TeamName", "ClassName", "TeamMemberCourseAssignment", "Extensions"], path, issues);
      const bib = text(team.BibNumber);
      const bibNumber = bib && /^[1-9][0-9]{0,4}$/.test(bib) ? Number(bib) : undefined;
      const teamName = text(team.TeamName);
      const className = text(team.ClassName);
      if (bibNumber === undefined && !teamName) issues.push(`${path} behöver BibNumber eller TeamName`);
      const legs: { leg: number; courseExternalId: string; variantCode: string }[] = [];
      for (const [memberIndex, rawMember] of array(team.TeamMemberCourseAssignment).entries()) {
        const member = record(rawMember);
        const memberPath = `${path}.TeamMemberCourseAssignment[${memberIndex}]`;
        rejectUnexpectedKeys(member, ["EntryId", "BibNumber", "Leg", "LegOrder", "TeamMemberName", "CourseName", "CourseFamily", "Extensions"],
          memberPath, issues);
        const legText = text(member.Leg);
        const leg = legText && /^[1-9][0-9]?$/.test(legText) ? Number(legText) : undefined;
        const courseName = requireText(member.CourseName, `${memberPath}.CourseName`, issues);
        const variant = courseName ? variantOf(courseName, text(member.CourseFamily)) : undefined;
        if (leg === undefined) { issues.push(`${memberPath}.Leg saknas`); continue; }
        if (!variant) { issues.push(`${memberPath} refererar okänd variant ${courseName}`); continue; }
        legs.push({ leg, ...variant });
      }
      teamAssignments.push({ ...(bibNumber === undefined ? {} : { bibNumber }), ...(teamName ? { teamName } : {}),
        ...(className ? { className } : {}), legs });
    }
  }

  if (assignments.length > 0) {
    warnings.push("Startregel saknas i IOF CourseData 3.0; PUNCH används tills en separat StartList importeras");
  }

  // En fil med bara Person-/TeamCourseAssignment (varianter till redan importerade banor) är tillåten.
  if (courses.length === 0 && personAssignments.length === 0 && teamAssignments.length === 0) issues.push("RaceCourseData.Course saknas");
  if (courses.length > 0 && assignments.length === 0) warnings.push("Inga ClassCourseAssignment hittades");
  if (issues.length > 0) throw new IofValidationError(issues);
  return { kind: "CourseData", courses, assignments, legAssignments, personAssignments, teamAssignments, controlPositions, warnings };
}
