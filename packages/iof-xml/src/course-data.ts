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
 */
export interface CourseVariantImport {
  readonly code: string;
  readonly controlCodes: readonly number[];
}

export interface CourseImport {
  readonly externalId: string;
  readonly name: string;
  /** Tom för en gafflad bana; kontrollerna finns då i varianterna. */
  readonly controlCodes: readonly number[];
  readonly variants?: readonly CourseVariantImport[];
}

export interface ClassCourseImport {
  readonly classExternalId: string;
  readonly className: string;
  readonly courseExternalId: string;
  readonly startRule: "FIXED" | "PUNCH";
}

export interface PersonCourseAssignmentImport {
  readonly entryExternalId?: string;
  readonly personName?: string;
  readonly className?: string;
  readonly courseExternalId: string;
  readonly variantCode: string;
}

export interface CourseDataImport {
  readonly kind: "CourseData";
  readonly courses: readonly CourseImport[];
  readonly assignments: readonly ClassCourseImport[];
  readonly personAssignments: readonly PersonCourseAssignmentImport[];
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
  readonly externalId: string;
  readonly name: string;
  readonly family: string;
  readonly controlCodes: number[];
}

export function readCourseData(root: XmlRecord): CourseDataImport {
  const issues: string[] = [];
  const warnings: string[] = [];
  const courses: CourseImport[] = [];
  const assignments: ClassCourseImport[] = [];
  const personAssignments: PersonCourseAssignmentImport[] = [];

  for (const [raceIndex, rawRaceData] of array(root.RaceCourseData).entries()) {
    const raceData = record(rawRaceData);
    rejectUnexpectedKeys(
      raceData,
      ["Map", "Control", "Course", "ClassCourseAssignment", "PersonCourseAssignment", "TeamCourseAssignment", "Extensions", "@_raceNumber"],
      `RaceCourseData[${raceIndex}]`,
      issues
    );
    const controls = new Map<string, number>();
    for (const [index, rawControl] of array(raceData.Control).entries()) {
      const control = record(rawControl);
      const externalId = requireText(control.Id, `RaceCourseData[${raceIndex}].Control[${index}].Id`, issues);
      const controlType = text(control["@_type"] || "Control");
      const code = Number(externalId);
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
      // En variant i en familj behöver inget eget Id: banan identifieras av familjen.
      const externalId = family ? text(course.Id) || name : requireText(course.Id, `${path}.Id`, issues);
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
      return { externalId, name, family, controlCodes };
    });

    const raceCourses: CourseImport[] = [];
    const courseByName = new Map<string, { externalId: string; variantCode?: string }>();
    const families = new Map<string, ParsedCourse[]>();
    for (const course of parsed) {
      if (!course.family) {
        raceCourses.push({ externalId: course.externalId, name: course.name, controlCodes: course.controlCodes });
        courseByName.set(course.name, { externalId: course.externalId });
      } else {
        families.set(course.family, [...families.get(course.family) ?? [], course]);
      }
    }
    for (const [family, members] of families) {
      const externalId = `${FAMILY_PREFIX}${family}`;
      const variants = members.map((member) => ({ code: courseVariantCode(family, member.name), controlCodes: member.controlCodes }));
      const codes = new Set(variants.map((variant) => variant.code));
      if (codes.size !== variants.length) issues.push(`CourseFamily ${family} har varianter med samma kod`);
      if (variants.length > MAX_VARIANTS) issues.push(`CourseFamily ${family} får ha högst ${MAX_VARIANTS} varianter`);
      for (const variant of variants) if (variant.code.length > 32) issues.push(`Variantkoden ${variant.code} är för lång`);
      if (family.length > 160) issues.push(`CourseFamily ${family} är för långt`);
      raceCourses.push({ externalId, name: family, controlCodes: [], variants });
      courseByName.set(family, { externalId });
      for (const [index, member] of members.entries()) courseByName.set(member.name, { externalId, variantCode: variants[index]!.code });
    }
    courses.push(...raceCourses);

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
      assignments.push({
        classExternalId,
        className,
        courseExternalId: matched?.externalId ?? (family || courseName),
        startRule: "PUNCH"
      });
    }

    for (const [index, rawAssignment] of array(raceData.PersonCourseAssignment).entries()) {
      const assignment = record(rawAssignment);
      const path = `RaceCourseData[${raceIndex}].PersonCourseAssignment[${index}]`;
      rejectUnexpectedKeys(assignment, ["EntryId", "BibNumber", "PersonName", "ClassName", "CourseName", "CourseFamily", "Extensions"], path, issues);
      const entryExternalId = text(assignment.EntryId);
      const personName = text(assignment.PersonName);
      const className = text(assignment.ClassName);
      const courseName = requireText(assignment.CourseName, `${path}.CourseName`, issues);
      if (!entryExternalId && !(personName && className)) issues.push(`${path} behöver EntryId eller PersonName och ClassName`);
      const family = text(assignment.CourseFamily);
      // Utan Course-element i filen (bara tilldelningar) ger familjen och namnet varianten.
      const matched = courseByName.get(courseName) ??
        (family ? { externalId: `${FAMILY_PREFIX}${family}`, variantCode: courseVariantCode(family, courseName) } : undefined);
      if (!matched?.variantCode || (family && matched.externalId !== `${FAMILY_PREFIX}${family}`)) {
        issues.push(`${path} refererar okänd variant ${courseName}`);
        continue;
      }
      personAssignments.push({
        ...(entryExternalId ? { entryExternalId } : {}),
        ...(personName ? { personName } : {}),
        ...(className ? { className } : {}),
        courseExternalId: matched.externalId,
        variantCode: matched.variantCode
      });
    }
    if (array(raceData.TeamCourseAssignment).length > 0) warnings.push("TeamCourseAssignment (stafett) importeras inte ännu");
  }

  if (assignments.length > 0) {
    warnings.push("Startregel saknas i IOF CourseData 3.0; PUNCH används tills en separat StartList importeras");
  }

  // En fil med bara PersonCourseAssignment (varianter till redan importerade banor) är tillåten.
  if (courses.length === 0 && personAssignments.length === 0) issues.push("RaceCourseData.Course saknas");
  if (courses.length > 0 && assignments.length === 0) warnings.push("Inga ClassCourseAssignment hittades");
  if (issues.length > 0) throw new IofValidationError(issues);
  return { kind: "CourseData", courses, assignments, personAssignments, warnings };
}
