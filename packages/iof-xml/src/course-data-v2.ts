import type { ClassCourseImport, CourseDataImport, CourseImport, MapPositionImport } from "./course-data";
import { courseVariantCode } from "./course-data";
import { array, IofValidationError, record, text, type XmlRecord } from "./xml";

/**
 * ADR-0196: IOF XML 2.0.3 CourseData (utan namnrymd, `<IOFVersion version="2.0.3"/>`), som äldre OCAD och Condes skrev.
 * Mappas vid adaptergränsen till samma interna modell som 3.0 (`CourseDataImport`). Egen kod efter IOF:s DTD för 2.0.3.
 *
 * - `StartPoint`, `Control` och `FinishPoint` har koder (`StartPointCode`, `ControlCode`, `FinishPointCode`) och lägen på
 *   kartan (`MapPosition x/y`, mm). `ControlPosition` är kartans rutnät (inte WGS 84) och används inte.
 * - En `Course` med en `CourseVariation` blir en bana; flera varianter blir en gafflad bana med en variant per
 *   `CourseVariation` (koden ur variantens `Name`, annars dess id).
 * - `CourseLength`/`CourseClimb` per variant i meter. `ClassShortName` i `Course` och `ClassCourseAssignment` ger klasserna.
 */
const MAX_VARIANTS = 100;

function mapPosition(value: unknown): MapPositionImport | undefined {
  const position = record(value);
  const x = Number(text(position["@_x"])), y = Number(text(position["@_y"]));
  const unit = text(position["@_unit"]) || "mm";
  if (!text(position["@_x"]) || !text(position["@_y"]) || !Number.isFinite(x) || !Number.isFinite(y) || unit !== "mm"
    || Math.abs(x) > 100_000 || Math.abs(y) > 100_000) return undefined;
  return { x, y };
}

function meters(value: unknown): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000_000 ? Math.round(parsed) : undefined;
}

/** Längden i hela meter längs punkterna på kartan; undefined när ett läge eller skalan saknas. */
function lengthOnMap(points: readonly (MapPositionImport | undefined)[], scale: number | undefined): number | undefined {
  if (scale === undefined || points.length < 2 || points.some(point => point === undefined)) return undefined;
  let millimeters = 0;
  for (let index = 1; index < points.length; index++) millimeters += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
  const result = Math.round(millimeters * scale / 1000);
  return result > 0 ? result : undefined;
}

/** Sant för en CourseData utan IOF 3.0:s namnrymd som säger version 2 (`IOFVersion`), eller saknar version men har 2.0.3:s form. */
export function isCourseDataV2(root: XmlRecord): boolean {
  if (text(root["@_xmlns"])) return false;
  const version = text(record(root.IOFVersion)["@_version"]);
  if (version) return version.startsWith("2.");
  return root.Course !== undefined && root.RaceCourseData === undefined;
}

export function readCourseDataV2(root: XmlRecord): CourseDataImport {
  const issues: string[] = [];
  const warnings: string[] = [];
  const scaleText = text(record(root.Map).Scale);
  const scaleNumber = Number(scaleText);
  const mapScale = scaleText && Number.isFinite(scaleNumber) && scaleNumber >= 100 && scaleNumber <= 1_000_000 ? Math.round(scaleNumber) : undefined;

  const starts = new Map<string, MapPositionImport | undefined>();
  const finishes = new Map<string, MapPositionImport | undefined>();
  for (const raw of array(root.StartPoint)) {
    const point = record(raw);
    const code = text(point.StartPointCode);
    if (code) starts.set(code, mapPosition(point.MapPosition));
  }
  for (const raw of array(root.FinishPoint)) {
    const point = record(raw);
    const code = text(point.FinishPointCode);
    if (code) finishes.set(code, mapPosition(point.MapPosition));
  }
  const controlMapPositions: ({ code: number } & MapPositionImport)[] = [];
  const known = new Set<number>();
  for (const [index, raw] of array(root.Control).entries()) {
    const control = record(raw);
    const codeText = text(control.ControlCode);
    const code = Number(codeText);
    if (!Number.isInteger(code) || code <= 0) { issues.push(`Control[${index}].ControlCode måste vara en positiv kontrollkod`); continue; }
    known.add(code);
    const at = mapPosition(control.MapPosition);
    if (at && !controlMapPositions.some(position => position.code === code)) controlMapPositions.push({ code, ...at });
  }

  const positionOf = new Map(controlMapPositions.map(position => [position.code, position]));
  const courses: CourseImport[] = [];
  const assignments: ClassCourseImport[] = [];
  const courseIdByName = new Map<string, string>();
  for (const [index, raw] of array(root.Course).entries()) {
    const course = record(raw);
    const path = `Course[${index}]`;
    const name = text(course.CourseName) || text(course.CourseId);
    if (!name) { issues.push(`${path}.CourseName saknas`); continue; }
    // Banans namn är dess id (som för OCAD:s 3.0-filer utan Course.Id); CourseId är ofta 0 för alla banor.
    const externalId = name;
    const variations = array(course.CourseVariation).map(record);
    if (variations.length === 0) { issues.push(`${path}.CourseVariation saknas`); continue; }
    if (variations.length > MAX_VARIANTS) { issues.push(`${path} får ha högst ${MAX_VARIANTS} varianter`); continue; }
    const parsed = variations.map((variation, variationIndex) => {
      const controls = array(variation.CourseControl).map(record)
        .map(control => ({ sequence: Number(text(control.Sequence)), code: Number(text(control.ControlCode)) }));
      const controlCodes = [...controls].sort((a, b) => (Number.isFinite(a.sequence) ? a.sequence : 0) - (Number.isFinite(b.sequence) ? b.sequence : 0))
        .map(control => control.code);
      for (const code of controlCodes) {
        if (!Number.isInteger(code) || code <= 0) issues.push(`${path}.CourseVariation[${variationIndex}] har en ogiltig kontrollkod`);
        else if (!known.has(code)) issues.push(`${path}.CourseVariation[${variationIndex}] refererar okänd kontroll ${code}`);
      }
      const startCode = text(variation.StartPointCode), finishCode = text(variation.FinishPointCode);
      const startMapPosition = startCode ? starts.get(startCode) : starts.size === 1 ? [...starts.values()][0] : undefined;
      const finishMapPosition = finishCode ? finishes.get(finishCode) : finishes.size === 1 ? [...finishes.values()][0] : undefined;
      return {
        code: courseVariantCode(name, text(variation.Name) || text(variation.CourseVariationId) || String(variationIndex + 1)),
        controlCodes,
        // Utan CourseLength räknas längden ur lägena på kartan (start, kontroller, mål) och skalan.
        lengthMeters: meters(variation.CourseLength) ?? lengthOnMap([startMapPosition, ...controlCodes.map(code => positionOf.get(code)), finishMapPosition], mapScale),
        climbMeters: meters(variation.CourseClimb),
        startMapPosition,
        finishMapPosition
      };
    });
    const first = parsed[0]!;
    const longest = [...parsed].sort((a, b) => (b.lengthMeters ?? 0) - (a.lengthMeters ?? 0))[0]!;
    const placed = { ...(first.startMapPosition ? { startMapPosition: first.startMapPosition } : {}),
      ...(first.finishMapPosition ? { finishMapPosition: first.finishMapPosition } : {}) };
    const measured = { ...(longest.lengthMeters !== undefined ? { lengthMeters: longest.lengthMeters } : {}),
      ...(longest.climbMeters !== undefined ? { climbMeters: longest.climbMeters } : {}) };
    if (parsed.length === 1) {
      if (first.controlCodes.length === 0) issues.push(`${path} saknar kontroller`);
      courses.push({ externalId, name, controlCodes: first.controlCodes, ...placed, ...measured });
    } else {
      const codes = new Set(parsed.map(variant => variant.code));
      if (codes.size !== parsed.length) issues.push(`${path} har varianter med samma kod`);
      courses.push({ externalId: `family:${name}`, name, controlCodes: [], ...placed, ...measured,
        variants: parsed.map(variant => ({ code: variant.code, controlCodes: variant.controlCodes,
          ...(variant.lengthMeters !== undefined ? { lengthMeters: variant.lengthMeters } : {}) })) });
    }
    courseIdByName.set(name, courses[courses.length - 1]!.externalId);
    for (const className of array(course.ClassShortName).map(value => text(value)).filter(Boolean)) {
      assignments.push({ classExternalId: className, className, courseExternalId: courses[courses.length - 1]!.externalId, startRule: "PUNCH" });
    }
  }
  for (const raw of array(root.ClassCourseAssignment)) {
    const assignment = record(raw);
    const className = text(assignment.ClassShortName) || text(assignment.ClassName);
    const courseExternalId = courseIdByName.get(text(assignment.CourseName));
    if (!className || !courseExternalId || assignments.some(row => row.classExternalId === className)) continue;
    assignments.push({ classExternalId: className, className, courseExternalId, startRule: "PUNCH" });
  }

  if (courses.length === 0) issues.push("CourseData.Course saknas");
  if (issues.length > 0) throw new IofValidationError(issues);
  warnings.push("Filen är IOF XML 2.0.3; den har lästs som CourseData 3.0.");
  if (assignments.length > 0) warnings.push("Startregel saknas i IOF CourseData; PUNCH används tills en separat StartList importeras");
  else warnings.push("Inga klasser är kopplade till banorna i filen");
  return { kind: "CourseData", courses, assignments, legAssignments: [], personAssignments: [], teamAssignments: [], controlPositions: [],
    ...(controlMapPositions.length > 0 ? { controlMapPositions } : {}), ...(mapScale !== undefined ? { mapScale } : {}), warnings };
}
