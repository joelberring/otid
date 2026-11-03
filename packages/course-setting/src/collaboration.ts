/**
 * Steg 66 (ADR-0181 beslut 3–4): flera som arbetar samtidigt. Ändringarna skickas som åtgärder (`CourseSettingEdit`) och
 * spelas upp på den senaste versionen. Det som behövs i både webbläsaren och servern finns här:
 *
 * - `createdIdsBetween`: id som en ändring skapade (kontroller, banornas kontroller, banor), i den ordning de skapades.
 * - `replayEdits`: spela upp åtgärder gjorda mot en äldre version på en nyare. Id som författaren fick när åtgärden gjordes
 *   (`created`) översätts till de id som uppspelningen ger, så att senare åtgärder pekar på rätt objekt. En åtgärd som inte
 *   går (kontrollen borttagen, någon annan hann ändra samma sak) hoppas över och rapporteras, liksom åtgärder som bygger på
 *   den.
 * - `editTouches` och `documentChanges`/`touchedConflict`: vad en åtgärd ändrar ("control:12:at") och om någon annan har
 *   ändrat samma sak sedan författarens version (den första vinner, ADR-0181 beslut 4).
 * - `objectPatch`: objekten som skiljer två dokument, som en `PUT_OBJECTS` (ångra och gör om). Händelsens inställningar
 *   per fält (`eventFields`), så att ångra av en inställning inte skriver över andras profiler, mallar eller logotyper.
 * - `diffTouches`: det som en åtgärd faktiskt ändrade (fält för fält ur skillnaden mellan dokumenten före och efter). Ger
 *   också banornas struktur (lägga in, ta bort, gafflingar), så att en kontroll inte tyst försvinner när två arbetar
 *   samtidigt (översynen 2026-11-02).
 */
import { appearanceOf } from "./appearance";
import { applyDocumentEdit } from "./edit";
import { legKey } from "./ppen-common";
import type {
  ControlPoint, Course, CourseControl, CourseSettingDocument, CourseSettingEdit, Leg, PutObjectsEdit, SpecialObject
} from "./types";
import { CourseSettingEditError } from "./types";
import { remapTrainingPatch, trainingPatch, trainingRefs, trainingTouches, trainingTouchValue } from "./training-edit";

/** Id som en ändring skapade, i den ordning de skapades. */
export interface CreatedIds {
  readonly controls: readonly string[];
  readonly courseControls: readonly string[];
  readonly courses: readonly string[];
  /** Steg 64: specialobjekt (saknas = inga). */
  readonly specialObjects?: readonly string[] | undefined;
}

/** Författarens id → id i dokumentet som åtgärderna spelades upp på. */
export interface IdMap {
  readonly controls: Readonly<Record<string, string>>;
  readonly courseControls: Readonly<Record<string, string>>;
  readonly courses: Readonly<Record<string, string>>;
  readonly specialObjects?: Readonly<Record<string, string>> | undefined;
}

export const NO_CREATED_IDS: CreatedIds = { controls: [], courseControls: [], courses: [] };
export const EMPTY_ID_MAP: IdMap = { controls: {}, courseControls: {}, courses: {} };

type Kind = keyof IdMap;
const KINDS: readonly Kind[] = ["controls", "courseControls", "courses", "specialObjects"];

const creationOrder = (a: string, b: string) => (Number(a) - Number(b)) || a.localeCompare(b);

/** Id som finns i `after` men inte i `before`. */
export function createdIdsBetween(before: CourseSettingDocument, after: CourseSettingDocument): CreatedIds {
  const courseIds = new Set(before.courses.map(course => course.id));
  const specialIds = new Set(before.specialObjects.map(special => special.id));
  const specialObjects = after.specialObjects.map(special => special.id).filter(id => !specialIds.has(id)).sort(creationOrder);
  return {
    controls: Object.keys(after.controls).filter(id => !(id in before.controls)).sort(creationOrder),
    courseControls: Object.keys(after.courseControls).filter(id => !(id in before.courseControls)).sort(creationOrder),
    courses: after.courses.map(course => course.id).filter(id => !courseIds.has(id)).sort(creationOrder),
    ...(specialObjects.length > 0 ? { specialObjects } : {})
  };
}

/** JSON med nycklarna i bokstavsordning (PostgreSQL:s jsonb byter ordning på nycklarna). */
function canonical(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

const same = (a: unknown, b: unknown) => a === b || canonical(a) === canonical(b);

function diffRecord<T>(from: Readonly<Record<string, T>>, to: Readonly<Record<string, T>>): Record<string, T | null> | undefined {
  const out: Record<string, T | null> = {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (!same(from[key], to[key])) out[key] = to[key] ?? null;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const byId = <T extends { readonly id: string }>(items: readonly T[]): Record<string, T> => Object.fromEntries(items.map(item => [item.id, item]));

/**
 * ADR-0190: banorna som skiljer. En bana som bara bytt plats i listan ger bara `courseOrder` (inte hela banan), och en bana
 * som finns i båda behåller sin plats när hela banan sätts (`putObjects`), så platsen står i `courseOrder` när den ändrats.
 */
function coursePatch(from: readonly Course[], to: readonly Course[]): { courses?: Record<string, Course | null>; courseOrder?: Record<string, number> } {
  const before = byId(from), after = byId(to);
  const courses: Record<string, Course | null> = {}, courseOrder: Record<string, number> = {};
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[id], b = after[id];
    if (!b) { courses[id] = null; continue; }
    if (!a) { courses[id] = b; continue; }
    if (a.order !== b.order) courseOrder[id] = b.order;
    if (!same({ ...a, order: 0 }, { ...b, order: 0 })) courses[id] = b;
  }
  return { ...(Object.keys(courses).length > 0 ? { courses } : {}), ...(Object.keys(courseOrder).length > 0 ? { courseOrder } : {}) };
}

/** Objekten som skiljer `from` från `to`, som en ändring som gör `from` till `to` (undefined = inga skillnader). */
export function objectPatch(from: CourseSettingDocument, to: CourseSettingDocument): PutObjectsEdit | undefined {
  const controls = diffRecord(from.controls, to.controls);
  const courseControls = diffRecord(from.courseControls, to.courseControls);
  const { courses, courseOrder } = coursePatch(from.courses, to.courses);
  const legs = diffRecord(from.legs, to.legs);
  const specialObjects = diffRecord(byId(from.specialObjects), byId(to.specialObjects));
  // Händelsen per fält (null = fältet tas bort): ångra av t.ex. ringklippen rör inte profilerna och mallarna.
  const eventFields = same(from.event, to.event) ? undefined
    : diffRecord(from.event as unknown as Record<string, unknown>, to.event as unknown as Record<string, unknown>);
  // Träningen per del (ADR-0192 beslut 11).
  const training = trainingPatch(from, to, same);
  if (!controls && !courseControls && !courses && !courseOrder && !legs && !specialObjects && !eventFields && !training) return undefined;
  return { type: "PUT_OBJECTS", ...(controls ? { controls } : {}), ...(courseControls ? { courseControls } : {}),
    ...(courses ? { courses } : {}), ...(courseOrder ? { courseOrder } : {}), ...(legs ? { legs } : {}),
    ...(specialObjects ? { specialObjects } : {}), ...(eventFields ? { eventFields } : {}), ...(training ? { training } : {}) };
}

function diffFields(kind: string, from: Readonly<Record<string, unknown>>, to: Readonly<Record<string, unknown>>,
  skip: ReadonlySet<string>, out: Set<string>, ignore: readonly string[] = []) {
  for (const id of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const a = from[id], b = to[id];
    if (a === b || skip.has(id)) continue;
    if (a === undefined || b === undefined) { out.add(`${kind}:${id}`); continue; }
    const before = a as Record<string, unknown>, after = b as Record<string, unknown>;
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!ignore.includes(field) && !same(before[field], after[field])) out.add(`${kind}:${id}:${field}`);
    }
  }
}

/**
 * Det som skiljer `before` från `after` som "touches": ett nytt eller borttaget objekt helt ("courseControl:7"), ett ändrat
 * per fält ("courseControl:5:next"). Händelsen ingår inte (dess åtgärder har exakta touches i `editTouches`, och utseendet
 * står i händelsens råa XML). `created` = id som åtgärden själv skapade (ett id som återanvänds krockar inte). Banornas
 * ordning (`order`, som flyttas när en bana kopieras in efter en annan) räknas inte.
 */
export function diffTouches(before: CourseSettingDocument, after: CourseSettingDocument, created: CreatedIds = NO_CREATED_IDS): string[] {
  if (before === after) return [];
  const out = new Set<string>();
  diffFields("control", before.controls, after.controls, new Set(created.controls), out);
  diffFields("courseControl", before.courseControls, after.courseControls, new Set(created.courseControls), out);
  if (before.courses !== after.courses) diffFields("course", byId(before.courses), byId(after.courses), new Set(created.courses), out, ["order"]);
  diffFields("leg", before.legs, after.legs, new Set(), out);
  if (before.specialObjects !== after.specialObjects) {
    diffFields("specialObject", byId(before.specialObjects), byId(after.specialObjects), new Set(created.specialObjects ?? []), out);
  }
  if (before.training !== after.training) for (const touch of trainingTouches(trainingPatch(before, after, same) ?? {})) out.add(touch);
  return [...out].sort();
}

/**
 * Det som åtgärden ändrar och som någon annan kan ha hunnit ändra: "control:12:at", "course:3:name", "leg:1-2:bends",
 * "event:title", hela objekt ("control:12") för borttagning och `PUT_OBJECTS`. Ändringar av banornas struktur (lägga in,
 * ta bort, gafflingar) har inga: de prövas av `applyEdit` mot det som finns.
 */
export function editTouches(edit: CourseSettingEdit): string[] {
  switch (edit.type) {
    case "MOVE_CONTROL": return [`control:${edit.control}:at`];
    case "DELETE_CONTROL": return [`control:${edit.control}`];
    case "SET_CONTROL_CODE": return [`control:${edit.control}:code`];
    case "SET_CONTROL_ORIENTATION": return [`control:${edit.control}:orientation`];
    case "UPDATE_COURSE": return Object.keys(edit.changes).sort().map(key => `course:${edit.course}:${key}`);
    case "SET_POINTS": return [`courseControl:${edit.courseControl}:points`];
    case "DELETE_COURSE": return [`course:${edit.course}`];
    case "MOVE_NUMBER": return [`courseControl:${edit.courseControl}:numberAt`];
    case "SET_LEG_BENDS": return [`leg:${legKey(edit.from, edit.to)}:bends`];
    case "SET_LEG_GAPS": return [`leg:${legKey(edit.from, edit.to)}:gaps`];
    case "SET_CIRCLE_GAPS": return [`control:${edit.control}:circleGaps`];
    case "SET_EVENT": return Object.keys(edit.changes).sort().map(key => `event:${key}`);
    // Utseendet per fält: två som ändrar ringstorlek respektive nummerstorlek samtidigt krockar inte.
    case "SET_APPEARANCE": return Object.keys(edit.changes).sort().map(key => `event:appearance:${key}`);
    case "SET_DESCRIPTION": return [`control:${edit.control}:descriptions`];
    case "SET_DESCRIPTION_TEXT_LINE":
      return [`control:${edit.control}:${edit.location === "before" ? "descriptionTextBefore" : "descriptionTextAfter"}`];
    case "MOVE_SPECIAL": return [`specialObject:${edit.special}:points`];
    case "UPDATE_SPECIAL": return Object.keys(edit.changes).sort().map(key => `specialObject:${edit.special}:${key}`);
    case "DELETE_SPECIAL": return [`specialObject:${edit.special}`];
    case "SET_PRINT_AREA": return [edit.course === "ALL_CONTROLS" ? "event:printArea" : `course:${edit.course}:printArea`];
    case "PUT_PRINT_PROFILE": case "DELETE_PRINT_PROFILE": return ["event:printProfiles"];
    case "PUT_LAYOUT_TEMPLATE": case "DELETE_LAYOUT_TEMPLATE": return ["event:layoutTemplates"];
    case "SET_PAPER_LAYOUT": return [`event:paperLayouts:${edit.course}`];
    // ADR-0199: per varning, så att två som godtar olika varningar samtidigt inte krockar.
    case "SET_ACCEPTED_CHECKS": return Object.keys(edit.checks).sort().map(key => `event:acceptedChecks:${key}`);
    case "PUT_PAPER_TEMPLATE": return [`event:paperTemplates:${edit.template.id}`];
    case "DELETE_PAPER_TEMPLATE": return [`event:paperTemplates:${edit.id}`, "event:paperLayouts"];
    case "PUT_OBJECTS": return [
      ...Object.keys(edit.controls ?? {}).map(id => `control:${id}`),
      ...Object.keys(edit.courseControls ?? {}).map(id => `courseControl:${id}`),
      ...Object.keys(edit.courses ?? {}).map(id => `course:${id}`),
      ...Object.keys(edit.courseOrder ?? {}).map(id => `course:${id}:order`),
      ...Object.keys(edit.legs ?? {}).map(key => `leg:${key}`),
      ...Object.keys(edit.specialObjects ?? {}).map(id => `specialObject:${id}`),
      ...Object.keys(edit.eventFields ?? {}).sort().map(key => `event:${key}`),
      ...(edit.event ? ["event"] : []),
      ...trainingTouches(edit.training ?? {})
    ];
    case "PUT_TRAINING": return trainingTouches(edit);
    default: return [];
  }
}

/** Två "touches" gäller samma sak (lika, eller den ena är ett helt objekt som den andra är ett fält i). */
export function touchesOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`);
}

function touchValue(document: CourseSettingDocument, touch: string): unknown {
  const [kind, id, field] = touch.split(":");
  if (kind === "event" && id === "appearance") {
    // Utseendet står i händelsens råa <course-appearance>; jämför värdena som Purple Pen läser dem.
    const appearance = appearanceOf(document);
    return field === undefined ? appearance : (appearance as unknown as Record<string, unknown>)[field];
  }
  if (kind === "event" && id === "acceptedChecks" && field !== undefined) return document.event.acceptedChecks?.[touch.slice("event:acceptedChecks:".length)];
  if (kind === "event") return id === undefined ? document.event : (document.event as unknown as Record<string, unknown>)[id];
  if (kind === "training") return trainingTouchValue(document, touch);
  let object: unknown;
  if (kind === "control") object = document.controls[id!];
  else if (kind === "courseControl") object = document.courseControls[id!];
  else if (kind === "course") object = document.courses.find(course => course.id === id);
  else if (kind === "leg") object = document.legs[id!];
  else if (kind === "specialObject") object = document.specialObjects.find(special => special.id === id);
  return field === undefined || object === undefined ? object : (object as Record<string, unknown>)[field];
}

/** Konflikt = det som åtgärden ändrar är inte detsamma i `current` som i `base` (författarens version). */
export function documentChanges(base: CourseSettingDocument, current: CourseSettingDocument): (authorTouch: string, actualTouch: string) => boolean {
  return (authorTouch, actualTouch) => !same(touchValue(base, authorTouch), touchValue(current, actualTouch));
}

/** Konflikt = någon av versionerna efter författarens ändrade samma sak ("ALL": en version ersatte hela dokumentet). */
export function touchedConflict(touched: readonly string[] | "ALL"): (authorTouch: string, actualTouch: string) => boolean {
  if (touched === "ALL") return () => true;
  return (_author, actual) => touched.some(touch => touchesOverlap(touch, actual));
}

type Lookup = (kind: Kind, id: string) => string;

/** Banorna ett specialobjekt pekar på ("0" = Alla kontroller finns alltid). */
const courseRefs = (courses: readonly string[] | undefined): [Kind, string][] =>
  (courses ?? []).filter(course => course !== "0").map(course => ["courses", course]);

/** Id som åtgärden pekar på (kontroller, banornas kontroller, banor). */
function editRefs(edit: CourseSettingEdit): [Kind, string][] {
  switch (edit.type) {
    case "ADD_CONTROL": case "ADD_COURSE": return [];
    case "MOVE_CONTROL": case "DELETE_CONTROL": case "SET_CONTROL_CODE": case "SET_CIRCLE_GAPS": case "SET_DESCRIPTION":
    case "SET_DESCRIPTION_TEXT_LINE": case "SET_CONTROL_ORIENTATION": return [["controls", edit.control]];
    case "UPDATE_COURSE": case "DELETE_COURSE": case "DUPLICATE_COURSE": return [["courses", edit.course]];
    case "INSERT_COURSE_CONTROL": return [["courses", edit.course], ["controls", edit.control],
      ...(typeof edit.after === "string" ? [["courseControls", edit.after] as [Kind, string]] : [])];
    case "REMOVE_COURSE_CONTROL": return [["courses", edit.course], ["courseControls", edit.courseControl]];
    case "ADD_SPLIT": case "REMOVE_SPLIT": return [["courses", edit.course], ["courseControls", edit.at]];
    case "MOVE_NUMBER": case "SET_POINTS": return [["courses", edit.course], ["courseControls", edit.courseControl]];
    case "SET_LEG_BENDS": case "SET_LEG_GAPS": return [["controls", edit.from], ["controls", edit.to]];
    case "SET_EVENT": case "SET_APPEARANCE": return [];
    case "ADD_SPECIAL": return courseRefs(edit.special.courses);
    case "MOVE_SPECIAL": case "DELETE_SPECIAL": return [["specialObjects", edit.special]];
    case "UPDATE_SPECIAL": return [["specialObjects", edit.special], ...courseRefs(edit.changes.courses)];
    case "SET_PRINT_AREA": case "SET_PAPER_LAYOUT": return edit.course === "ALL_CONTROLS" ? [] : [["courses", edit.course]];
    case "PUT_OBJECTS": {
      const refs: [Kind, string][] = [];
      for (const [id, control] of Object.entries(edit.controls ?? {})) { refs.push(["controls", id]); if (control) refs.push(["controls", control.id]); }
      for (const [id, item] of Object.entries(edit.courseControls ?? {})) {
        refs.push(["courseControls", id]);
        if (!item) continue;
        refs.push(["controls", item.control]);
        if (item.next !== undefined) refs.push(["courseControls", item.next]);
        if (item.split) for (const branch of [...item.split.branches, item.split.end]) refs.push(["courseControls", branch]);
      }
      for (const [id, course] of Object.entries(edit.courses ?? {})) {
        refs.push(["courses", id]);
        if (course?.first !== undefined) refs.push(["courseControls", course.first]);
      }
      for (const id of Object.keys(edit.courseOrder ?? {})) refs.push(["courses", id]);
      for (const leg of Object.values(edit.legs ?? {})) if (leg) refs.push(["controls", leg.from], ["controls", leg.to]);
      for (const [id, special] of Object.entries(edit.specialObjects ?? {})) {
        refs.push(["specialObjects", id]);
        if (special) refs.push(...courseRefs(special.courses));
      }
      if (edit.training) refs.push(...trainingKindRefs(edit.training));
      return refs;
    }
    case "PUT_TRAINING": return trainingKindRefs(edit);
    default: return [];
  }
}

function trainingKindRefs(patch: Parameters<typeof trainingRefs>[0]): [Kind, string][] {
  const refs = trainingRefs(patch);
  return [...refs.courses.map((id): [Kind, string] => ["courses", id]), ...refs.controls.map((id): [Kind, string] => ["controls", id])];
}

function remapRecord<T>(record: Readonly<Record<string, T | null>> | undefined, key: (id: string) => string, value: (item: T) => T)
  : Record<string, T | null> | undefined {
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).map(([id, item]) => [key(id), item === null ? null : value(item)]));
}

function remapPut(edit: PutObjectsEdit, map: Lookup): PutObjectsEdit {
  const c = (id: string) => map("controls", id), cc = (id: string) => map("courseControls", id), co = (id: string) => map("courses", id);
  const controls = remapRecord<ControlPoint>(edit.controls, c, control => ({ ...control, id: c(control.id) }));
  const courseControls = remapRecord<CourseControl>(edit.courseControls, cc, item => ({ ...item, id: cc(item.id), control: c(item.control),
    ...(item.next !== undefined ? { next: cc(item.next) } : {}),
    ...(item.split ? { split: { ...item.split, branches: item.split.branches.map(cc), end: cc(item.split.end) } } : {}) }));
  const courses = remapRecord<Course>(edit.courses, co, course => ({ ...course, id: co(course.id),
    ...(course.first !== undefined ? { first: cc(course.first) } : {}) }));
  const legs = edit.legs ? Object.fromEntries(Object.entries(edit.legs).map(([key, leg]): [string, Leg | null] => {
    if (leg === null) {
      const [from, to] = key.split("-");
      return [from !== undefined && to !== undefined ? legKey(c(from), c(to)) : key, null];
    }
    return [legKey(c(leg.from), c(leg.to)), { ...leg, from: c(leg.from), to: c(leg.to) }];
  })) : undefined;
  const so = (id: string) => map("specialObjects", id);
  const specialObjects = remapRecord<SpecialObject>(edit.specialObjects, so, special => ({ ...special, id: so(special.id), courses: special.courses.map(co) }));
  const courseOrder = edit.courseOrder ? Object.fromEntries(Object.entries(edit.courseOrder).map(([id, order]) => [co(id), order])) : undefined;
  const training = edit.training ? remapTrainingPatch(edit.training, { control: c, courseControl: cc, course: co }) : undefined;
  return { ...edit, ...(controls ? { controls } : {}), ...(courseControls ? { courseControls } : {}), ...(courses ? { courses } : {}),
    ...(courseOrder ? { courseOrder } : {}),
    ...(legs ? { legs } : {}), ...(specialObjects ? { specialObjects } : {}), ...(training ? { training } : {}) };
}

/** Åtgärden med id översatta (författarens id → dokumentets id). */
export function remapEdit(edit: CourseSettingEdit, idMap: IdMap): CourseSettingEdit {
  return remapWith(edit, (kind, id) => idMap[kind]?.[id] ?? id);
}

function remapWith(edit: CourseSettingEdit, map: Lookup): CourseSettingEdit {
  const c = (id: string) => map("controls", id), cc = (id: string) => map("courseControls", id), co = (id: string) => map("courses", id);
  switch (edit.type) {
    case "ADD_CONTROL": case "ADD_COURSE": case "SET_EVENT": case "SET_APPEARANCE": return edit;
    case "MOVE_CONTROL": case "DELETE_CONTROL": case "SET_CONTROL_CODE": case "SET_CIRCLE_GAPS": case "SET_DESCRIPTION":
    case "SET_DESCRIPTION_TEXT_LINE": case "SET_CONTROL_ORIENTATION": return { ...edit, control: c(edit.control) };
    case "UPDATE_COURSE": case "DELETE_COURSE": case "DUPLICATE_COURSE": return { ...edit, course: co(edit.course) };
    case "INSERT_COURSE_CONTROL": return { ...edit, course: co(edit.course), control: c(edit.control),
      ...(typeof edit.after === "string" ? { after: cc(edit.after) } : {}) };
    case "REMOVE_COURSE_CONTROL": return { ...edit, course: co(edit.course), courseControl: cc(edit.courseControl) };
    case "ADD_SPLIT": case "REMOVE_SPLIT": return { ...edit, course: co(edit.course), at: cc(edit.at) };
    case "MOVE_NUMBER": case "SET_POINTS": return { ...edit, course: co(edit.course), courseControl: cc(edit.courseControl) };
    case "SET_LEG_BENDS": case "SET_LEG_GAPS": return { ...edit, from: c(edit.from), to: c(edit.to) };
    case "PUT_OBJECTS": return remapPut(edit, map);
    case "ADD_SPECIAL": return edit.special.courses ? { ...edit, special: { ...edit.special, courses: edit.special.courses.map(co) } } : edit;
    case "MOVE_SPECIAL": case "DELETE_SPECIAL": return { ...edit, special: map("specialObjects", edit.special) };
    case "UPDATE_SPECIAL": return { ...edit, special: map("specialObjects", edit.special),
      changes: edit.changes.courses ? { ...edit.changes, courses: edit.changes.courses.map(co) } : edit.changes };
    case "SET_PRINT_AREA": case "SET_PAPER_LAYOUT": return edit.course === "ALL_CONTROLS" ? edit : { ...edit, course: co(edit.course) };
    case "PUT_TRAINING": return { ...remapTrainingPatch(edit, { control: c, courseControl: cc, course: co }), type: "PUT_TRAINING" };
    default: return edit;
  }
}

export interface ReplayedEdit {
  /** Åtgärdens plats i listan som spelades upp. */
  readonly index: number;
  /** Åtgärden som den gjordes (med dokumentets id). */
  readonly edit: CourseSettingEdit;
  /** Id som den skapade i dokumentet. */
  readonly created: CreatedIds;
  /** Det som den ändrade (`editTouches` och `diffTouches`), för serverns konfliktlogg. */
  readonly touches: readonly string[];
}

export interface ReplayRejection {
  readonly index: number;
  readonly edit: CourseSettingEdit;
  /** CONFLICT = någon annan har ändrat samma sak; DEPENDS = bygger på en åtgärd som inte gjordes. */
  readonly code: CourseSettingEditError["code"] | "CONFLICT" | "DEPENDS";
  readonly message: string;
}

export interface ReplayResult {
  readonly document: CourseSettingDocument;
  readonly applied: readonly ReplayedEdit[];
  readonly rejected: readonly ReplayRejection[];
  /** Författarens id → dokumentets id, för åtgärder som görs efter dessa. */
  readonly idMap: IdMap;
}

export interface ReplayOptions {
  /** Id som varje åtgärd skapade när författaren gjorde den (saknas = samma som vid uppspelningen). */
  readonly created?: readonly (CreatedIds | undefined)[] | undefined;
  /** Översättning från tidigare uppspelade åtgärder (t.ex. det som just sparades). */
  readonly idMap?: IdMap | undefined;
  /** Har någon annan ändrat det som åtgärden ändrar? (`documentChanges`, `touchedConflict`) */
  readonly conflict?: ((authorTouch: string, actualTouch: string) => boolean) | undefined;
  /** Åtgärder som inte ska göras (ett förslag godkänt delvis); det som bygger på dem görs inte heller. */
  readonly skip?: ReadonlySet<number> | undefined;
}

/** Spela upp åtgärderna i ordning på `document`. Det som inte går hoppas över och står i `rejected`. */
export function replayEdits(document: CourseSettingDocument, edits: readonly CourseSettingEdit[], options: ReplayOptions = {}): ReplayResult {
  const map: Record<Kind, Record<string, string>> = { controls: { ...options.idMap?.controls }, courseControls: { ...options.idMap?.courseControls },
    courses: { ...options.idMap?.courses }, specialObjects: { ...options.idMap?.specialObjects } };
  const sets = () => ({ controls: new Set<string>(), courseControls: new Set<string>(), courses: new Set<string>(), specialObjects: new Set<string>() });
  const dead: Record<Kind, Set<string>> = sets();
  const fresh: Record<Kind, Set<string>> = sets();
  /** Författarens id för det som skapats i uppspelningen (övriga id som träffar något nyskapat pekar på något borttaget). */
  const ownFresh: Record<Kind, Set<string>> = sets();
  const lookup: Lookup = (kind, id) => map[kind][id] ?? id;
  /** Dokumentets id → författarens (för att jämföra författarens version med den aktuella per "touch"). */
  const inverse: Record<Kind, Record<string, string>> = { controls: {}, courseControls: {}, courses: {}, specialObjects: {} };
  for (const kind of KINDS) for (const [authorId, id] of Object.entries(map[kind])) inverse[kind][id] = authorId;
  const TOUCH_KINDS: Record<string, Kind> = { control: "controls", courseControl: "courseControls", course: "courses", specialObject: "specialObjects" };
  const authorTouch = (touch: string) => {
    const [kind, id, ...rest] = touch.split(":");
    if (kind === "leg") {
      const [from, to] = (id ?? "").split("-");
      return [kind, `${inverse.controls[from!] ?? from}-${inverse.controls[to!] ?? to}`, ...rest].join(":");
    }
    const mapped = TOUCH_KINDS[kind!];
    return mapped ? [kind, inverse[mapped][id!] ?? id, ...rest].join(":") : touch;
  };
  const applied: ReplayedEdit[] = [];
  const rejected: ReplayRejection[] = [];
  let current = document;
  const kill = (author: CreatedIds | undefined) => { for (const kind of KINDS) for (const id of author?.[kind] ?? []) dead[kind].add(id); };
  edits.forEach((edit, index) => {
    const author = options.created?.[index];
    if (options.skip?.has(index)) { kill(author); return; }
    if (editRefs(edit).some(([kind, id]) => dead[kind].has(id))) {
      rejected.push({ index, edit, code: "DEPENDS", message: "Bygger på en ändring som inte gjordes" });
      kill(author);
      return;
    }
    if (editRefs(edit).some(([kind, id]) => !ownFresh[kind].has(id) && fresh[kind].has(lookup(kind, id)))) {
      rejected.push({ index, edit, code: "NOT_FOUND", message: "Det som ändringen gäller finns inte längre" });
      kill(author);
      return;
    }
    let mapped = remapWith(edit, lookup);
    const isFresh = (touch: string) => {
      const [kind, id] = touch.split(":");
      return (kind === "control" && fresh.controls.has(id!)) || (kind === "courseControl" && fresh.courseControls.has(id!)) ||
        (kind === "course" && fresh.courses.has(id!)) || (kind === "specialObject" && fresh.specialObjects.has(id!));
    };
    const conflictMessage = "Någon annan hann ändra samma sak";
    if (options.conflict) {
      const authorTouches = editTouches(edit), actualTouches = editTouches(mapped);
      if (actualTouches.some((touch, i) => !isFresh(touch) && options.conflict!(authorTouches[i] ?? touch, touch))) {
        rejected.push({ index, edit, code: "CONFLICT", message: conflictMessage });
        kill(author);
        return;
      }
    }
    let next: CourseSettingDocument;
    try {
      next = applyDocumentEdit(current, mapped).document;
    } catch (error) {
      if (!(error instanceof CourseSettingEditError)) throw error;
      // En ny kontroll fick nästa lediga kod hos författaren; har någon annan tagit koden får den nästa lediga här.
      if (error.code === "IN_USE" && mapped.type === "ADD_CONTROL" && mapped.code !== undefined) {
        const rest: CourseSettingEdit = { type: "ADD_CONTROL", kind: mapped.kind, at: mapped.at };
        try {
          next = applyDocumentEdit(current, rest).document;
          const created = createdIdsBetween(current, next).controls[0];
          mapped = created !== undefined && next.controls[created]?.code !== undefined ? { ...rest, code: next.controls[created].code } : rest;
        } catch (retry) {
          if (!(retry instanceof CourseSettingEditError)) throw retry;
          rejected.push({ index, edit, code: retry.code, message: retry.message });
          kill(author);
          return;
        }
      } else {
        rejected.push({ index, edit, code: error.code, message: error.message });
        kill(author);
        return;
      }
    }
    const created = createdIdsBetween(current, next);
    // Det som åtgärden faktiskt ändrade (också banornas struktur): har någon annan ändrat det sedan författarens version
    // vinner den första (t.ex. en gaffling som tas bort medan någon annan lägger in en kontroll i en gren).
    const changed = diffTouches(current, next, created);
    if (options.conflict && changed.some(touch => !isFresh(touch) && options.conflict!(authorTouch(touch), touch))) {
      rejected.push({ index, edit, code: "CONFLICT", message: conflictMessage });
      kill(author);
      return;
    }
    for (const kind of KINDS) {
      (created[kind] ?? []).forEach((id, i) => {
        fresh[kind].add(id);
        const authorId = author ? author[kind]?.[i] : id;
        if (authorId === undefined) return;
        ownFresh[kind].add(authorId);
        if (author) { map[kind][authorId] = id; inverse[kind][id] = authorId; }
      });
    }
    current = next;
    applied.push({ index, edit: mapped, created, touches: [...new Set([...editTouches(mapped), ...changed])] });
  });
  return { document: current, applied, rejected, idMap: map };
}
