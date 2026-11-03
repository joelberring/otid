import { XMLParser } from "fast-xml-parser";
import { courseVariantCode, type GeoPosition, type MapPositionImport } from "./course-data";
import { array, IofValidationError, record, text, type XmlRecord } from "./xml";

/**
 * Banfilens kontroller och banor som de ligger på kartan, för banläggningen (en banfil utan .ppen blir ett
 * banläggningsdokument). Till skillnad från `CourseDataImport` (tävlingens banor) behålls allt som behövs för att rita
 * banan: alla kontroller med slag och läge, varje banas kontroller i ordning med start, mål och passager, poäng, och
 * banorna i filens ordning. Filen ska först ha godkänts av `parseIofXml` (samma regler, samma fel).
 *
 * - IOF XML 3.0: `Control` (Start, Control, Finish, CrossingPoint) med `MapPosition` (mm, y uppåt som kartfilen) och
 *   `Position` (WGS 84); `Course` med `CourseControl` (typ, `Score`, `specialInstruction`), `CourseFamily`, `Length`, `Climb`.
 *   En start som inte står först på banan är ett kartbyte. Bara den första `RaceCourseData` läses.
 * - IOF XML 2.0.3: `StartPoint`, `Control` och `FinishPoint` med `MapPosition`; en `Course` med flera `CourseVariation`
 *   blir en familj (som en 3.0-fil med `CourseFamily`), en variation blir en vanlig bana.
 */
export type CourseLayoutKind = "START" | "CONTROL" | "FINISH" | "CROSSING_POINT";

export interface CourseLayoutControl {
  /** Filens id ("31", "STA1"); i 2.0.3 med slaget före ("S:STA1", "C:31", "F:FIN1") så att de inte krockar. */
  readonly id: string;
  readonly kind: CourseLayoutKind;
  /** Kodsiffran för vanliga kontroller. */
  readonly code?: string;
  readonly mapPosition?: MapPositionImport;
  readonly position?: GeoPosition;
}

export interface CourseLayoutCourseControl {
  readonly control: string;
  /** Slaget på banan; en start som inte står först är ett kartbyte. */
  readonly kind: CourseLayoutKind | "MAP_EXCHANGE";
  /** Poäng på en poängbana (`Score`). */
  readonly score?: number;
  /** IOF `specialInstruction` (TapedRoute, FunnelTapedRoute, MandatoryCrossingPoint, MandatoryOutOfBoundsAreaPassage). */
  readonly specialInstruction?: string;
}

export interface CourseLayoutCourse {
  /** Banans namn i filen ("Lång", "Lång AC"). */
  readonly name: string;
  /** Familjen när banan är en variant av en gafflad bana. */
  readonly family?: string;
  /** Variantens kod ur namnet ("AC"), som tävlingens inläsning. */
  readonly variantCode?: string;
  readonly lengthMeters?: number;
  readonly climbMeters?: number;
  /** Poängbana: någon kontroll har `Score` eller `randomOrder`. */
  readonly score: boolean;
  readonly controls: readonly CourseLayoutCourseControl[];
}

export interface CourseLayoutClass {
  readonly className: string;
  /** Banans namn eller familjens namn. */
  readonly courseName: string;
}

export interface CourseLayoutImport {
  readonly version: "3.0" | "2.0.3";
  readonly eventName?: string;
  readonly mapScale?: number;
  readonly controls: readonly CourseLayoutControl[];
  readonly courses: readonly CourseLayoutCourse[];
  readonly classes: readonly CourseLayoutClass[];
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, processEntities: false, trimValues: true });

function mapPosition(value: unknown): MapPositionImport | undefined {
  const position = record(value);
  const x = Number(text(position["@_x"])), y = Number(text(position["@_y"]));
  const unit = text(position["@_unit"]) || "mm";
  if (!text(position["@_x"]) || !text(position["@_y"]) || !Number.isFinite(x) || !Number.isFinite(y) || unit !== "mm"
    || Math.abs(x) > 100_000 || Math.abs(y) > 100_000) return undefined;
  return { x, y };
}

function geoPosition(value: unknown): GeoPosition | undefined {
  const position = record(value);
  const latitude = Number(text(position["@_lat"])), longitude = Number(text(position["@_lng"]));
  if (!text(position["@_lat"]) || !text(position["@_lng"]) || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { latitude, longitude };
}

function meters(value: unknown): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000_000 ? Math.round(parsed) : undefined;
}

function scaleOf(value: unknown): number | undefined {
  const parsed = Number(text(value));
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 1_000_000 ? Math.round(parsed) : undefined;
}

const KINDS: Readonly<Record<string, CourseLayoutKind>> = { Start: "START", Control: "CONTROL", Finish: "FINISH", CrossingPoint: "CROSSING_POINT" };

function readV3(root: XmlRecord): CourseLayoutImport {
  const race = record(array(root.RaceCourseData)[0]);
  const controls: CourseLayoutControl[] = [];
  const seen = new Set<string>();
  for (const raw of array(race.Control)) {
    const control = record(raw);
    const id = text(control.Id);
    const kind = KINDS[text(control["@_type"]) || "Control"];
    if (!id || !kind || seen.has(id)) continue;
    seen.add(id);
    const at = mapPosition(control.MapPosition), position = geoPosition(control.Position);
    controls.push({ id, kind, ...(kind === "CONTROL" ? { code: id } : {}), ...(at ? { mapPosition: at } : {}), ...(position ? { position } : {}) });
  }
  const courses: CourseLayoutCourse[] = array(race.Course).map(raw => {
    const course = record(raw);
    const name = text(course.Name);
    const family = text(course.CourseFamily);
    const list = array(course.CourseControl).map(record);
    const score = list.some(item => text(item.Score) !== "" || text(item["@_randomOrder"]) === "true");
    const courseControls = list.flatMap((item, index): CourseLayoutCourseControl[] => {
      const control = text(item.Control);
      const kind = KINDS[text(item["@_type"]) || "Control"];
      if (!control || !kind) return [];
      const points = Number(text(item.Score));
      const instruction = text(item["@_specialInstruction"]);
      return [{ control, kind: kind === "START" && index > 0 ? "MAP_EXCHANGE" : kind,
        ...(text(item.Score) !== "" && Number.isFinite(points) && points > 0 ? { score: points } : {}),
        ...(instruction ? { specialInstruction: instruction } : {}) }];
    });
    const length = meters(course.Length), climb = meters(course.Climb);
    return { name, ...(family ? { family, variantCode: courseVariantCode(family, name) } : {}), ...(length !== undefined ? { lengthMeters: length } : {}),
      ...(climb !== undefined ? { climbMeters: climb } : {}), score, controls: courseControls };
  });
  const classes = array(race.ClassCourseAssignment).map(record).flatMap(assignment => {
    const className = text(assignment.ClassName);
    const courseName = text(assignment.CourseFamily) || text(assignment.CourseName);
    return className && courseName ? [{ className, courseName }] : [];
  });
  const eventName = text(record(root.Event).Name);
  const mapScale = scaleOf(record(array(race.Map)[0]).Scale);
  return { version: "3.0", ...(eventName ? { eventName } : {}), ...(mapScale !== undefined ? { mapScale } : {}), controls, courses, classes };
}

function readV2(root: XmlRecord): CourseLayoutImport {
  const controls: CourseLayoutControl[] = [];
  const add = (kind: CourseLayoutKind, prefix: string, raw: unknown, codeField: string) => {
    const point = record(raw);
    const code = text(point[codeField]);
    const id = `${prefix}:${code}`;
    if (!code || controls.some(control => control.id === id)) return;
    const at = mapPosition(point.MapPosition);
    controls.push({ id, kind, ...(kind === "CONTROL" ? { code } : {}), ...(at ? { mapPosition: at } : {}) });
  };
  for (const raw of array(root.StartPoint)) add("START", "S", raw, "StartPointCode");
  for (const raw of array(root.Control)) add("CONTROL", "C", raw, "ControlCode");
  for (const raw of array(root.FinishPoint)) add("FINISH", "F", raw, "FinishPointCode");
  const starts = controls.filter(control => control.kind === "START"), finishes = controls.filter(control => control.kind === "FINISH");
  const courses: CourseLayoutCourse[] = [];
  const classes: CourseLayoutClass[] = [];
  for (const raw of array(root.Course)) {
    const course = record(raw);
    const name = text(course.CourseName) || text(course.CourseId);
    const variations = array(course.CourseVariation).map(record);
    for (const [index, variation] of variations.entries()) {
      const startCode = text(variation.StartPointCode), finishCode = text(variation.FinishPointCode);
      // Utan kod: den enda starten (målet) i filen, som tävlingens inläsning.
      const start = startCode ? `S:${startCode}` : starts.length === 1 ? starts[0]!.id : undefined;
      const finish = finishCode ? `F:${finishCode}` : finishes.length === 1 ? finishes[0]!.id : undefined;
      const ordered = array(variation.CourseControl).map(record)
        .map((item, position) => ({ sequence: Number(text(item.Sequence)), position, code: text(item.ControlCode) }))
        .sort((a, b) => (Number.isFinite(a.sequence) ? a.sequence : a.position) - (Number.isFinite(b.sequence) ? b.sequence : b.position) || a.position - b.position);
      const courseControls: CourseLayoutCourseControl[] = [
        ...(start ? [{ control: start, kind: "START" as const }] : []),
        ...ordered.filter(item => item.code).map(item => ({ control: `C:${item.code}`, kind: "CONTROL" as const })),
        ...(finish ? [{ control: finish, kind: "FINISH" as const }] : [])
      ];
      const forked = variations.length > 1;
      const variantCode = forked ? courseVariantCode(name, text(variation.Name) || text(variation.CourseVariationId) || String(index + 1)) : undefined;
      const length = meters(variation.CourseLength), climb = meters(variation.CourseClimb);
      courses.push({ name: variantCode === undefined ? name : `${name} ${variantCode}`, ...(variantCode !== undefined ? { family: name, variantCode } : {}),
        ...(length !== undefined ? { lengthMeters: length } : {}), ...(climb !== undefined ? { climbMeters: climb } : {}), score: false,
        controls: courseControls });
    }
    for (const className of array(course.ClassShortName).map(value => text(value)).filter(Boolean)) classes.push({ className, courseName: name });
  }
  for (const raw of array(root.ClassCourseAssignment)) {
    const assignment = record(raw);
    const className = text(assignment.ClassShortName) || text(assignment.ClassName), courseName = text(assignment.CourseName);
    if (className && courseName && !classes.some(row => row.className === className && row.courseName === courseName)) classes.push({ className, courseName });
  }
  const mapScale = scaleOf(record(root.Map).Scale);
  return { version: "2.0.3", ...(mapScale !== undefined ? { mapScale } : {}), controls, courses, classes };
}

/**
 * Banfilens kontroller och banor på kartan. Anropas efter att `parseIofXml` godkänt filen som CourseData; kastar
 * `IofValidationError` om roten inte är CourseData.
 */
export function readCourseLayoutXml(xml: string): CourseLayoutImport {
  const document = record(parser.parse(xml));
  if (!document.CourseData) throw new IofValidationError(["Roten måste vara CourseData"]);
  const root = record(document.CourseData);
  return text(root["@_xmlns"]) ? readV3(root) : readV2(root);
}
