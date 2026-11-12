/**
 * Ändringarna i editorn. Varje ändring ger ett nytt dokument; inget av det gamla ändras. Banornas kontroller, gafflingar
 * och borttagningar följer Purple Pens ChangeEvent.cs (RemoveCourseControl, RemoveControl, AddCourseControl,
 * AddVariation, AddStartOrMapIssueToCourse, AddFinishToCourse, DeleteCourse, CreateCourse; BSD, Peter Golde).
 */
import { keepForkLetters } from "./fork-letters";
import type { Point } from "@o-tid/map-file";
import { setAppearance } from "./appearance-edit";
import { LEG_CIRCLE_GAP_LIMITS } from "./appearance";
import { BOX_KINDS, hasImage, symbolDb } from "./description-symbols";
import { encodeCircleGaps, encodeOldCircleGaps, fromRaw, legKey, nextId, toRaw } from "./ppen-common";
import { allCourseVariantList, isLegalCode, nextUnusedCode } from "./summary";
import type {
  CircleGap, ControlPoint, Course, CourseControl, CourseSettingDocument, CourseSettingEdit, DescriptionBox, EditResult, Leg, RawXml
} from "./types";
import { CourseSettingEditError } from "./types";
import { putObjects } from "./put-objects";
import { applySpecialEdit } from "./special-edit";
import { duplicateCourse } from "./course-duplicate";
import { setPoints, updateCourse } from "./course-properties";
import { applyTrainingPatch } from "./training-edit";
import { setAcceptedChecks } from "./check-accept";
import { setRouteHints } from "./route-hints";
import { enumerateCourseControls, findCourse } from "./walk";
import { el } from "./xml";
import { applyLayoutEdit, setLayoutSheetArea, setLayoutSheetNumber, setLayoutSheetPaper, type LayoutEdit } from "./print-layout-edit";
import { MAIN_LAYOUT } from "./print-layouts";

const LAYOUT_EDIT_TYPES: ReadonlySet<string> = new Set(["ADD_LAYOUT", "UPDATE_LAYOUT", "DELETE_LAYOUT", "PUT_LAYOUT_SHEET", "SET_LAYOUT_CIRCLE_GAPS",
  "SET_LAYOUT_LEG_GAPS", "CLEAR_LAYOUT_ADJUSTMENTS", "SET_CLASS_LAYOUTS", "SAVE_LAYOUT_STATE", "RESTORE_LAYOUT_STATE", "DELETE_LAYOUT_STATE"]);
export const isLayoutEdit = (edit: CourseSettingEdit): edit is LayoutEdit => LAYOUT_EDIT_TYPES.has(edit.type);

interface Draft {
  event: CourseSettingDocument["event"];
  controls: Record<string, ControlPoint>;
  courseControls: Record<string, CourseControl>;
  courses: Course[];
  legs: Record<string, Leg>;
  specialObjects: CourseSettingDocument["specialObjects"];
  raw: CourseSettingDocument["raw"];
  /** Träningsläget (ADR-0192) följer med orört genom banornas och kontrollernas ändringar. */
  training: CourseSettingDocument["training"];
}

const notFound = (what: string) => new CourseSettingEditError("NOT_FOUND", `${what} finns inte`);
const invalidEdit = (message: string) => new CourseSettingEditError("INVALID", message);

function draftOf(document: CourseSettingDocument): Draft {
  return {
    event: document.event, controls: { ...document.controls }, courseControls: { ...document.courseControls },
    courses: [...document.courses], legs: { ...document.legs }, specialObjects: [...document.specialObjects], raw: document.raw,
    training: document.training
  };
}

/** Dokumentet ur utkastet; en borttagen banas träning tas bort med banan (ADR-0192 beslut 1). */
function asDocument(draft: Draft): CourseSettingDocument {
  const { training, ...rest } = draft;
  if (!training) return { version: 1, ...rest };
  const ids = new Set(rest.courses.map(course => course.id));
  const gone = Object.keys(training.courses).filter(id => !ids.has(id));
  if (gone.length === 0) return { version: 1, ...rest, training };
  return { version: 1, ...rest, training: { ...training, courses: Object.fromEntries(Object.entries(training.courses).filter(([id]) => ids.has(id))) } };
}

function control(draft: Draft, id: string): ControlPoint {
  const found = draft.controls[id];
  if (!found) throw notFound(`Kontrollen ${id}`);
  return found;
}

function cc(draft: Draft, id: string): CourseControl {
  const found = draft.courseControls[id];
  if (!found) throw notFound(`Banans kontroll ${id}`);
  return found;
}

function replaceCourse(draft: Draft, course: Course): void {
  draft.courses = draft.courses.map(existing => existing.id === course.id ? course : existing);
}

/** Objektet utan ett valfritt fält (modellen använder frånvaro, inte `undefined`). */
function without<T extends object, K extends keyof T>(object: T, key: K): T {
  const copy = { ...object };
  delete copy[key];
  return copy;
}

const finite = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);

function assertPoint(p: Point, what: string): void {
  if (!finite(p)) throw invalidEdit(`${what} är inte en punkt`);
}

const ordered = (draft: Draft, courseId: string) => enumerateCourseControls(asDocument(draft), courseId);
const kindOf = (draft: Draft, ccId: string) => control(draft, cc(draft, ccId).control).kind;

/** Sista banans kontroll, eller sista före målet (QueryEvent.LastCourseControl). */
function lastCourseControl(draft: Draft, courseId: string, beforeFinish: boolean): string | undefined {
  let last: string | undefined;
  for (const id of ordered(draft, courseId)) if (!beforeFinish || kindOf(draft, id) !== "FINISH") last = id;
  return last;
}

function newCourseControl(draft: Draft, controlId: string, next: string | undefined): string {
  const id = nextId(Object.keys(draft.courseControls));
  draft.courseControls[id] = { id, control: controlId, ...(next !== undefined ? { next } : {}) };
  return id;
}

/** Lägg in efter banans kontroll `after` i dess gren; `undefined` = först på banan. */
function insertAfter(draft: Draft, course: Course, controlId: string, after: string | undefined): string {
  if (after === undefined) {
    const id = newCourseControl(draft, controlId, course.first);
    replaceCourse(draft, { ...course, first: id });
    return id;
  }
  const before = cc(draft, after);
  const id = newCourseControl(draft, controlId, before.next);
  draft.courseControls[after] = { ...before, next: id };
  return id;
}

function insertCourseControl(draft: Draft, courseId: string, controlId: string, after: string | null | undefined): string {
  const course = findCourse(asDocument(draft), courseId);
  const kind = control(draft, controlId).kind;
  const inCourse = ordered(draft, courseId);
  if (after === undefined && (kind === "START" || kind === "MAP_ISSUE")) return addStartOrMapIssue(draft, course, controlId);
  if (after === undefined && kind === "FINISH") return addFinish(draft, course, controlId);
  if (after === null) return insertAfter(draft, course, controlId, undefined);
  let place = after;
  if (place !== undefined && !inCourse.includes(place)) throw notFound(`Banans kontroll ${place} på banan`);
  // Efter målet eller utan plats: före målet (eller sist), som Purple Pens FindControlInsertionPoint.
  if (place === undefined || kindOf(draft, place) === "FINISH") place = lastCourseControl(draft, courseId, true);
  if (place === undefined) {
    // Bara mål (eller tom bana): först.
    return insertAfter(draft, findCourse(asDocument(draft), courseId), controlId, undefined);
  }
  // Inte mellan kartutdelning och start.
  const next = cc(draft, place).next;
  if (kindOf(draft, place) === "MAP_ISSUE" && next !== undefined && kindOf(draft, next) === "START") place = next;
  return insertAfter(draft, findCourse(asDocument(draft), courseId), controlId, place);
}

function findOfKind(draft: Draft, courseId: string, kind: ControlPoint["kind"]): string | undefined {
  return ordered(draft, courseId).find(id => kindOf(draft, id) === kind);
}

function addStartOrMapIssue(draft: Draft, course: Course, controlId: string): string {
  const kind = control(draft, controlId).kind;
  const existing = findOfKind(draft, course.id, kind);
  if (existing !== undefined) {
    draft.courseControls[existing] = { ...cc(draft, existing), control: controlId };
    return existing;
  }
  const mapIssue = kind === "START" ? findOfKind(draft, course.id, "MAP_ISSUE") : undefined;
  return insertAfter(draft, course, controlId, mapIssue);
}

function addFinish(draft: Draft, course: Course, controlId: string): string {
  const last = lastCourseControl(draft, course.id, false);
  if (last === undefined) {
    const id = newCourseControl(draft, controlId, undefined);
    replaceCourse(draft, { ...course, first: id });
    return id;
  }
  if (kindOf(draft, last) === "FINISH") {
    draft.courseControls[last] = { ...cc(draft, last), control: controlId };
    return last;
  }
  return insertAfter(draft, course, controlId, last);
}

/** Ta bort banans kontroll; grenar som inte längre nås tas också bort (ChangeEvent.RemoveCourseControl). */
function removeCourseControl(draft: Draft, courseId: string, removeId: string): Set<string> {
  const all = ordered(draft, courseId);
  if (!all.includes(removeId)) throw notFound(`Banans kontroll ${removeId} på banan`);
  const removing = cc(draft, removeId);
  const kindToRemove = kindOf(draft, removeId);
  let afterRemove = removing.next;
  if (removing.split && removing.split.kind === "FORK") {
    afterRemove = removing.split.branches[0] === removeId ? removing.split.branches[1] : removing.split.branches[0];
  }
  for (const id of all) {
    const current = cc(draft, id);
    let updated: CourseControl = current;
    if (current.next === removeId) updated = afterRemove === undefined ? without(updated, "next") : { ...updated, next: afterRemove };
    if (current.split && current.split.end === removeId) {
      updated = afterRemove === undefined ? without(updated, "split") : { ...updated, split: { ...current.split, end: afterRemove } };
    }
    if (updated.split && updated.split.branches.includes(removeId)) {
      const branches = updated.split.branches.filter(branch => branch !== removeId);
      updated = branches.length < 2 ? without(updated, "split") : { ...updated, split: { ...updated.split, branches } };
    }
    if (updated !== current) draft.courseControls[id] = updated;
  }
  let course = findCourse(asDocument(draft), courseId);
  if (course.first === removeId) {
    course = afterRemove === undefined ? without(course, "first") : { ...course, first: afterRemove };
    replaceCourse(draft, course);
  }
  const still = new Set(ordered(draft, courseId));
  const removedControls = new Set<string>();
  for (const id of all) {
    if (still.has(id)) continue;
    removedControls.add(cc(draft, id).control);
    delete draft.courseControls[id];
  }
  if (kindToRemove === "START" && course.first !== undefined && draft.courseControls[course.first] && kindOf(draft, course.first) === "MAP_ISSUE") {
    for (const id of removeCourseControl(draft, courseId, course.first)) removedControls.add(id);
  }
  return removedControls;
}

/** Ta bort kontrollen från alla banor och sträckor (ChangeEvent.RemoveControl). */
function removeControl(draft: Draft, controlId: string): void {
  control(draft, controlId);
  for (const course of draft.courses) {
    for (;;) {
      const first = ordered(draft, course.id).find(id => cc(draft, id).control === controlId);
      if (first === undefined) break;
      removeCourseControl(draft, course.id, first);
    }
  }
  for (const [key, leg] of Object.entries(draft.legs)) if (leg.from === controlId || leg.to === controlId) delete draft.legs[key];
  delete draft.controls[controlId];
}

/** Gaffling eller slinga vid banans kontroll (QueryEvent.CanAddVariation, ChangeEvent.AddVariation). */
function addSplit(draft: Draft, courseId: string, at: string, kind: "FORK" | "LOOP", count: number): void {
  const course = findCourse(asDocument(draft), courseId);
  if (course.kind === "SCORE") throw invalidEdit("En poängbana kan inte ha gafflingar");
  if (!ordered(draft, courseId).includes(at)) throw notFound(`Banans kontroll ${at} på banan`);
  if (!Number.isInteger(count) || count < (kind === "LOOP" ? 1 : 2) || count > 20) throw invalidEdit("Fel antal grenar");
  const start = cc(draft, at);
  if (kindOf(draft, at) === "FINISH" || lastCourseControl(draft, courseId, false) === at) throw invalidEdit("Ingen gaffling vid målet eller sista kontrollen");
  if (start.split) throw invalidEdit("Här finns redan en gaffling");
  const end = kind === "LOOP" ? at : start.next!;
  const ids = [at];
  const extra = kind === "LOOP" ? count : count - 1;
  for (let i = 0; i < extra; i++) {
    const id = nextId(Object.keys(draft.courseControls));
    const clone: CourseControl = { ...start, id };
    draft.courseControls[id] = kind === "LOOP" ? { ...clone, next: at } : clone;
    ids.push(id);
  }
  for (const id of ids) draft.courseControls[id] = { ...cc(draft, id), split: { kind, branches: ids, end } };
}

/** Ta bort gafflingen: grenen som börjar vid `at` blir kvar (slinga: utgången), de andra grenarna tas bort. */
function removeSplit(draft: Draft, courseId: string, at: string): void {
  const split = cc(draft, at).split;
  if (!split) throw invalidEdit("Här finns ingen gaffling");
  const keep = split.kind === "LOOP" ? split.branches[0]! : at;
  for (const branch of split.branches) {
    if (branch !== keep && draft.courseControls[branch] && ordered(draft, courseId).includes(branch)) removeCourseControl(draft, courseId, branch);
  }
}

function deleteCourse(draft: Draft, courseId: string): void {
  const removed = ordered(draft, courseId);
  draft.courses = draft.courses.filter(course => course.id !== courseId);
  for (const id of removed) delete draft.courseControls[id];
  draft.specialObjects = draft.specialObjects.flatMap(special => {
    if (special.courses.length === 0 || !special.courses.includes(courseId)) return [special];
    const courses = special.courses.filter(id => id !== courseId);
    return courses.length === 0 ? [] : [{ ...special, courses }];
  });
}

function addCourse(draft: Draft, name: string, kind: "NORMAL" | "SCORE"): string {
  if (name.trim() === "") throw invalidEdit("Banan behöver ett namn");
  const id = nextId(draft.courses.map(course => course.id));
  const order = Math.max(0, ...draft.courses.map(course => course.order)) + 1;
  // Ingen skala: saknad skala är kartans (`printScaleOf`, ADR-0211 beslut 5), och följer med om kartans skala ändras.
  draft.courses = [...draft.courses, { id, name, kind, order, labelKind: kind === "SCORE" ? "CODE" : "SEQUENCE" }];
  // En ensam start, kartutdelning och ett ensamt mål läggs in direkt, som i Purple Pen.
  for (const kindToAdd of ["START", "MAP_ISSUE", "FINISH"] as const) {
    const candidates = Object.values(draft.controls).filter(candidate => candidate.kind === kindToAdd);
    if (candidates.length === 1) insertCourseControl(draft, id, candidates[0]!.id, undefined);
  }
  return id;
}

function isVacuous(leg: Leg): boolean {
  return leg.bends.length === 0 && leg.gaps.length === 0 && (leg.flagging === undefined || leg.flagging === "NONE");
}

/** Sträckorna har sitt id i den råa `<leg>`-stubben (nyckeln i `legs` är kontrollerna). */
function nextLegId(draft: Draft): string {
  const ids = Object.values(draft.legs).flatMap(leg => (leg.raw ?? []).map(fromRaw).filter(e => e.name === "leg").map(e => e.attrs.find(([k]) => k === "id")?.[1] ?? "0"));
  return nextId(ids);
}

function setLeg(draft: Draft, from: string, to: string, change: (leg: Leg) => Leg): void {
  control(draft, from);
  control(draft, to);
  const key = legKey(from, to);
  const leg = change(draft.legs[key] ?? { from, to, bends: [], gaps: [], raw: [toRaw(el("leg", [["id", nextLegId(draft)]]))] });
  if (isVacuous(leg)) delete draft.legs[key];
  else draft.legs[key] = leg;
}

/** Nya brytpunkter; snitslingens brytpunkt flyttas till närmaste nya (eller blir hela sträckan), som RemoveLegBend. */
function withBends(leg: Leg, bends: readonly Point[]): Leg {
  const partial = leg.flagging === "BEGINNING" || leg.flagging === "END" || leg.flagging === "MIDDLE";
  if (!partial || !leg.flaggingAt || bends.some(b => b.x === leg.flaggingAt!.x && b.y === leg.flaggingAt!.y)) return { ...leg, bends };
  if (bends.length === 0) return { ...without(leg, "flaggingAt"), bends, flagging: "ALL" };
  const at = leg.flaggingAt;
  const nearest = bends.reduce((best, b) => Math.hypot(b.x - at.x, b.y - at.y) < Math.hypot(best.x - at.x, best.y - at.y) ? b : best);
  return { ...leg, bends, flaggingAt: nearest };
}

/** Nya ringavbrott; de råa avbrotten byts mot nya i Purple Pens form (gamla bitar och nya vinklar per skala). */
function setCircleGaps(draft: Draft, controlId: string, gaps: readonly CircleGap[]): void {
  const current = control(draft, controlId);
  for (const gap of gaps) {
    if (!Number.isFinite(gap.startDegrees) || !Number.isFinite(gap.endDegrees)) throw invalidEdit("Ringavbrottet har fel vinklar");
    if (gap.scale !== null && !(Number.isInteger(gap.scale) && gap.scale > 0)) throw invalidEdit("Ringavbrottet har fel skala");
  }
  const raw: RawXml[] = [];
  for (const entry of current.raw ?? []) {
    const element = fromRaw(entry);
    if (element.name === "gaps" || element.name === "circle-gaps") continue;
    if (element.name === "control") {
      const attrs = element.attrs.filter(([name]) => name !== "gaps");
      if (attrs.length > 0) raw.push(toRaw(el("control", attrs)));
      continue;
    }
    raw.push(entry);
  }
  const scales = [...new Set(gaps.map(gap => gap.scale))];
  for (const scale of scales) {
    const group = gaps.filter(gap => gap.scale === scale);
    raw.push(toRaw(el("gaps", [["scale", String(scale ?? 0)]], [encodeOldCircleGaps(group)])));
    raw.push(toRaw(el("circle-gaps", [["scale", String(scale ?? 0)]], [encodeCircleGaps(group)])));
  }
  let updated: ControlPoint = gaps.length > 0 ? { ...current, circleGaps: [...gaps] } : without(current, "circleGaps");
  updated = raw.length > 0 ? { ...updated, raw } : without(updated, "raw");
  draft.controls[controlId] = updated;
}

function setCode(draft: Draft, controlId: string, code: string, allowSame: boolean): void {
  const current = control(draft, controlId);
  if (current.kind !== "NORMAL") throw invalidEdit("Bara vanliga kontroller har kod");
  if (!isLegalCode(code)) throw invalidEdit("Koden ska vara 1–3 tecken utan blanksteg");
  const other = Object.values(draft.controls).find(candidate => candidate.code === code && candidate.id !== controlId);
  if (other && !allowSame) throw new CourseSettingEditError("IN_USE", `Koden ${code} används redan`);
  draft.controls[controlId] = { ...current, code };
}

/**
 * En delad kontroll flyttad bara i en bana (Purple Pens AddControlPoint + ReplaceControlInCourse): ny vanlig kontroll vid
 * läget med nästa lediga kod (eller författarens, om den är ledig), insatt i de angivna banans kontroller. Beskrivningen
 * följer inte med (ett nytt läge är ett nytt objekt; den tomma beskrivningen syns i kontrollerna), och numret får sitt
 * förvalda läge. Gafflingar, poäng och resten av banans kontroll står kvar.
 */
function newControlInCourse(draft: Draft, edit: Extract<CourseSettingEdit, { type: "NEW_CONTROL_IN_COURSE" }>): string {
  assertPoint(edit.at, "Läget");
  const current = control(draft, edit.control);
  if (current.kind !== "NORMAL") throw invalidEdit("Bara vanliga kontroller kan bli en ny kontroll i en bana");
  if (edit.courseControls.length === 0) throw invalidEdit("Ingen av banans kontroller är vald");
  const inCourse = new Set(ordered(draft, edit.course));
  for (const id of edit.courseControls) {
    if (!inCourse.has(id) || cc(draft, id).control !== edit.control) throw notFound(`Kontrollen ${current.code ?? edit.control} på banan`);
  }
  const id = nextId(Object.keys(draft.controls));
  draft.controls[id] = { id, kind: "NORMAL", at: edit.at, descriptions: [] };
  const wanted = edit.code !== undefined && isLegalCode(edit.code) && !Object.values(draft.controls).some(other => other.code === edit.code);
  setCode(draft, id, wanted ? edit.code : nextUnusedCode(asDocument(draft)), false);
  const before = findCourse(asDocument(draft), edit.course).excludedVariants?.length ? allCourseVariantList(asDocument(draft), edit.course) : [];
  for (const ccId of new Set(edit.courseControls)) draft.courseControls[ccId] = without({ ...cc(draft, ccId), control: id }, "numberAt");
  keepExclusions(draft, edit.course, before);
  return id;
}

/**
 * ADR-0198: en bortvald variant känns igen på kontrollkoderna. När en kontroll byts mot en ny kod i banan följer bortvalen
 * med (samma variantkod, de nya koderna), så att en bortvald variant inte tyst kommer tillbaka.
 */
function keepExclusions(draft: Draft, courseId: string, before: readonly { code: string; controlCodes: readonly string[]; excluded?: boolean | undefined }[]): void {
  const course = findCourse(asDocument(draft), courseId);
  if (!course.excludedVariants?.length || before.length === 0) return;
  const after = new Map(allCourseVariantList(asDocument(draft), courseId).map(row => [row.code, row.controlCodes]));
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((code, index) => code === b[index]);
  const excludedVariants = course.excludedVariants.map(row => {
    const active = before.some(old => old.excluded && old.code === row.code && same(old.controlCodes, row.controls));
    const controls = active ? after.get(row.code) : undefined;
    return controls ? { code: row.code, controls: [...controls] } : row;
  });
  replaceCourse(draft, { ...course, excludedVariants });
}

/** Symbolen som en ny kontroll av slaget får, som i Purple Pens AddControlMode (navigera till mål, passage, kartutdelning). */
const DEFAULT_DIRECTIVE: Partial<Record<ControlPoint["kind"], string>> = { FINISH: "14.3", CROSSING_POINT: "13.3", MAP_ISSUE: "13.6" };

/** Riktningsradernas symboler per kontrollslag (Purple Pens symbolslag Z, X, V). */
const DIRECTIVE_KINDS: Partial<Record<ControlPoint["kind"], string>> = { FINISH: "Z", CROSSING_POINT: "X", MAP_ISSUE: "V" };

/**
 * Rutorna kontrolleras mot standarden: start, kartbyte och vanliga kontroller har C–H med symboler av rätt slag (E får
 * även ett objekt ur D), text bara i F och då ingen symbol där; mål, passage och kartutdelning har en ruta "all".
 */
function validDescription(current: ControlPoint, boxes: readonly DescriptionBox[], standard: string): DescriptionBox[] {
  const directiveKind = DIRECTIVE_KINDS[current.kind];
  const allowed = directiveKind ? ["all"] : ["C", "D", "E", "F", "G", "H"];
  const seen = new Set<string>();
  const out: DescriptionBox[] = [];
  for (const box of boxes) {
    if (!allowed.includes(box.box)) throw invalidEdit(`Rutan ${box.box} finns inte för den här kontrollen`);
    if (seen.has(box.box)) throw invalidEdit(`Rutan ${box.box} finns två gånger`);
    seen.add(box.box);
    const text = box.text === "" ? undefined : box.text;
    if (box.ref === undefined && text === undefined) continue;
    if (text !== undefined && box.box !== "F") throw invalidEdit("Text får bara stå i ruta F");
    if (text !== undefined && box.ref !== undefined) throw invalidEdit("Ruta F har antingen en symbol eller ett mått");
    if (box.ref !== undefined) {
      const symbol = symbolDb().find(box.ref, standard);
      if (!symbol || !hasImage(symbol)) throw invalidEdit(`Symbolen ${box.ref} finns inte i standarden ${standard}`);
      const kinds = directiveKind ? [directiveKind] : BOX_KINDS[box.box]!;
      if (!kinds.includes(symbol.kind)) throw invalidEdit(`Symbolen ${box.ref} hör inte till ruta ${box.box}`);
    }
    out.push({ box: box.box, ...(box.ref !== undefined ? { ref: box.ref } : {}), ...(text !== undefined ? { text } : {}) });
  }
  // Purple Pens ordning i filen: C–H.
  return out.sort((a, b) => allowed.indexOf(a.box) - allowed.indexOf(b.box));
}

/** Vinkeln i [0, 360) med en tiondels grad (Purple Pen lagrar float). */
export function normalizeDegrees(degrees: number): number {
  const value = Math.round((((degrees % 360) + 360) % 360) * 10) / 10;
  return value === 360 ? 0 : value;
}

/** Ändringar som aldrig ändrar en banas grenar (tas bort ur bokstavskontrollen, så att dragningar går fort). */
const NO_BRANCH_EDITS: ReadonlySet<CourseSettingEdit["type"]> = new Set<CourseSettingEdit["type"]>(["ADD_CONTROL", "MOVE_CONTROL",
  "SET_CONTROL_CODE", "SET_CONTROL_ORIENTATION", "ADD_COURSE", "MOVE_NUMBER", "SET_LEG_BENDS", "SET_LEG_GAPS", "SET_CIRCLE_GAPS", "SET_EVENT",
  "SET_DESCRIPTION", "SET_DESCRIPTION_TEXT_LINE", "SET_POINTS", "SET_ACCEPTED_CHECKS", "SET_ROUTE_HINTS", "SET_APPEARANCE"]);

/**
 * Gör en ändring. ADR-0175, tillägg 2026-11-12 (c): ändras en banas grenar står de gamla bokstäverna kvar (`keepForkLetters`).
 */
export function applyDocumentEdit(document: CourseSettingDocument, edit: CourseSettingEdit): EditResult {
  const result = applyDocumentEditOnly(document, edit);
  // Bara när banornas kontroller ändrats kan grenarna ha ändrats (dragningar och utseende rör dem inte).
  if (isLayoutEdit(edit) || NO_BRANCH_EDITS.has(edit.type) || result.document.courseControls === document.courseControls) return result;
  const kept = keepForkLetters(document, result.document);
  return kept === result.document ? result : { ...result, document: kept };
}

function applyDocumentEditOnly(document: CourseSettingDocument, edit: CourseSettingEdit): EditResult {
  if (isLayoutEdit(edit)) return applyLayoutEdit(document, edit);
  // ADR-0217: ett ark i en annan layout än huvudlayouten (huvudlayoutens ark är banans fält som förut).
  if ((edit.type === "SET_PRINT_AREA" || edit.type === "SET_PAPER_LAYOUT" || edit.type === "MOVE_NUMBER") && edit.printLayout !== undefined && edit.printLayout !== MAIN_LAYOUT) {
    if (edit.type === "SET_PRINT_AREA") return { document: setLayoutSheetArea(document, edit.printLayout, edit.course, edit.area, edit.part) };
    if (edit.type === "SET_PAPER_LAYOUT") return { document: setLayoutSheetPaper(document, edit.printLayout, edit.course, edit.layout, edit.part) };
    return { document: setLayoutSheetNumber(document, edit.printLayout, edit.course, edit.courseControl, edit.at) };
  }
  if (edit.type === "PUT_OBJECTS") return { document: putObjects(document, edit) };
  if (edit.type === "SET_APPEARANCE") return { document: setAppearance(document, edit.changes) };
  if (edit.type === "ADD_SPECIAL" || edit.type === "MOVE_SPECIAL" || edit.type === "UPDATE_SPECIAL" || edit.type === "DELETE_SPECIAL" ||
    edit.type === "SET_PRINT_AREA" || edit.type === "PUT_PRINT_PROFILE" || edit.type === "DELETE_PRINT_PROFILE" || edit.type === "PUT_LAYOUT_TEMPLATE" ||
    edit.type === "DELETE_LAYOUT_TEMPLATE" || edit.type === "SET_PAPER_LAYOUT" || edit.type === "SET_RUNNER_BACK" ||
    edit.type === "PUT_PAPER_TEMPLATE" || edit.type === "DELETE_PAPER_TEMPLATE") return applySpecialEdit(document, edit);
  if (edit.type === "DUPLICATE_COURSE") return duplicateCourse(document, edit.course, edit.name);
  if (edit.type === "UPDATE_COURSE") return { document: updateCourse(document, edit.course, edit.changes) };
  if (edit.type === "SET_POINTS") return { document: setPoints(document, edit.course, edit.courseControl, edit.points) };
  if (edit.type === "PUT_TRAINING") return { document: applyTrainingPatch(document, edit) };
  if (edit.type === "SET_ACCEPTED_CHECKS") return { document: setAcceptedChecks(document, edit.checks) };
  if (edit.type === "SET_ROUTE_HINTS") return { document: setRouteHints(document, edit.hints) };
  const draft = draftOf(document);
  let created: string | undefined;
  switch (edit.type) {
    case "ADD_CONTROL": {
      assertPoint(edit.at, "Läget");
      const id = nextId(Object.keys(draft.controls));
      if (edit.kind !== "NORMAL" && edit.code !== undefined) throw invalidEdit("Bara vanliga kontroller har kod");
      const directive = DEFAULT_DIRECTIVE[edit.kind];
      draft.controls[id] = {
        id, kind: edit.kind, at: edit.at, descriptions: directive ? [{ box: "all", ref: directive }] : [],
        ...(edit.kind === "CROSSING_POINT" ? { orientation: 0 } : {})
      };
      if (edit.kind === "NORMAL") setCode(draft, id, edit.code ?? nextUnusedCode(asDocument(draft)), false);
      created = id;
      break;
    }
    case "MOVE_CONTROL": {
      assertPoint(edit.at, "Läget");
      const current = control(draft, edit.control);
      const dx = edit.at.x - current.at.x;
      const dy = edit.at.y - current.at.y;
      draft.controls[edit.control] = { ...current, at: edit.at };
      for (const [id, item] of Object.entries(draft.courseControls)) {
        if (item.control === edit.control && item.numberAt) draft.courseControls[id] = { ...item, numberAt: { x: item.numberAt.x + dx, y: item.numberAt.y + dy } };
      }
      break;
    }
    case "NEW_CONTROL_IN_COURSE": created = newControlInCourse(draft, edit); break;
    case "DELETE_CONTROL": removeControl(draft, edit.control); break;
    case "SET_CONTROL_CODE": setCode(draft, edit.control, edit.code, false); break;
    case "SET_CONTROL_ORIENTATION": {
      const current = control(draft, edit.control);
      if (current.kind !== "CROSSING_POINT") throw invalidEdit("Bara passager kan vridas");
      if (!Number.isFinite(edit.orientation)) throw invalidEdit("Vinkeln är inte ett tal");
      draft.controls[edit.control] = { ...current, orientation: normalizeDegrees(edit.orientation) };
      break;
    }
    case "ADD_COURSE": created = addCourse(draft, edit.name, edit.kind ?? "NORMAL"); break;
    case "DELETE_COURSE": findCourse(asDocument(draft), edit.course); deleteCourse(draft, edit.course); break;
    case "INSERT_COURSE_CONTROL": created = insertCourseControl(draft, edit.course, edit.control, edit.after); break;
    case "REMOVE_COURSE_CONTROL": removeCourseControl(draft, edit.course, edit.courseControl); break;
    case "ADD_SPLIT": addSplit(draft, edit.course, edit.at, edit.kind, edit.branches); created = edit.at; break;
    case "REMOVE_SPLIT":
      if (!ordered(draft, edit.course).includes(edit.at)) throw notFound(`Banans kontroll ${edit.at} på banan`);
      removeSplit(draft, edit.course, edit.at);
      break;
    case "MOVE_NUMBER": {
      if (!ordered(draft, edit.course).includes(edit.courseControl)) throw notFound(`Banans kontroll ${edit.courseControl} på banan`);
      const current = cc(draft, edit.courseControl);
      if (edit.at !== null) assertPoint(edit.at, "Numrets läge");
      draft.courseControls[edit.courseControl] = edit.at === null ? without(current, "numberAt") : { ...current, numberAt: edit.at };
      break;
    }
    case "SET_LEG_BENDS":
      for (const bend of edit.bends) assertPoint(bend, "Brytpunkten");
      setLeg(draft, edit.from, edit.to, leg => withBends(leg, [...edit.bends]));
      break;
    case "SET_LEG_GAPS":
      for (const gap of edit.gaps) {
        if (!(Number.isFinite(gap.start) && gap.start >= 0 && Number.isFinite(gap.length) && gap.length > 0)) throw invalidEdit("Fel avbrott på sträckan");
      }
      setLeg(draft, edit.from, edit.to, leg => ({ ...leg, gaps: [...edit.gaps] }));
      break;
    case "SET_CIRCLE_GAPS": setCircleGaps(draft, edit.control, edit.gaps); break;
    case "SET_EVENT": {
      const changes = edit.changes;
      if (changes.mapScale !== undefined && !(Number.isFinite(changes.mapScale) && changes.mapScale > 0)) throw invalidEdit("Kartans skala måste vara positiv");
      if (changes.numbering && !(Number.isInteger(changes.numbering.start) && changes.numbering.start > 0 && changes.numbering.start < 1000)) {
        throw invalidEdit("Numreringen börjar på 1–999");
      }
      if (changes.descriptionLanguage !== undefined && !/^[a-z]{2}(-[A-Z]{2})?$/.test(changes.descriptionLanguage)) {
        throw invalidEdit("Språket anges som t.ex. sv eller nb-NO");
      }
      if (changes.circleCutting !== undefined && !(typeof changes.circleCutting.overlap === "boolean" && typeof changes.circleCutting.details === "boolean")) {
        throw invalidEdit("Ringklippen anges som två val (överlapp och detaljer)");
      }
      if (changes.legCircleGapMm !== undefined && !(typeof changes.legCircleGapMm === "number" && Number.isFinite(changes.legCircleGapMm)
        && changes.legCircleGapMm >= LEG_CIRCLE_GAP_LIMITS.min && changes.legCircleGapMm <= LEG_CIRCLE_GAP_LIMITS.max)) {
        throw invalidEdit(`Mellanrummet vid ringen ska vara ${LEG_CIRCLE_GAP_LIMITS.min}–${LEG_CIRCLE_GAP_LIMITS.max} mm`);
      }
      if (changes.levelNotices !== undefined && typeof changes.levelNotices !== "boolean") throw invalidEdit("Avvikelserna mot nivån är på eller av");
      if (changes.numbersPerVariant !== undefined && typeof changes.numbersPerVariant !== "boolean") throw invalidEdit("Numren per variant är på eller av");
      if (changes.printFileTitle !== undefined && typeof changes.printFileTitle !== "boolean") throw invalidEdit("Filens titel på kartorna är på eller av");
      if (changes.paperValues !== undefined) {
        const values = changes.paperValues;
        const ok = (value: unknown, max: number) => value === undefined || (typeof value === "string" && value.length <= max);
        if (typeof values !== "object" || values === null || !ok(values.date, 40) || !ok(values.contourInterval, 20)) {
          throw invalidEdit("Datum (högst 40 tecken) och ekvidistans (högst 20 tecken) för papperet");
        }
      }
      const defined: Record<string, unknown> = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
      if (changes.paperValues) {
        const values = { ...(changes.paperValues.date ? { date: changes.paperValues.date } : {}),
          ...(changes.paperValues.contourInterval ? { contourInterval: changes.paperValues.contourInterval } : {}) };
        if (Object.keys(values).length > 0) defined.paperValues = values;
        else delete defined.paperValues;
      }
      if (changes.circleCutting) defined.circleCutting = { overlap: changes.circleCutting.overlap, details: changes.circleCutting.details };
      draft.event = { ...draft.event, ...defined };
      if (changes.paperValues && !defined.paperValues) delete (draft.event as { paperValues?: unknown }).paperValues;
      break;
    }
    case "SET_DESCRIPTION": {
      const current = control(draft, edit.control);
      draft.controls[edit.control] = { ...current, descriptions: validDescription(current, edit.boxes, draft.event.descriptionStandard) };
      break;
    }
    case "SET_DESCRIPTION_TEXT_LINE": {
      const current = control(draft, edit.control);
      const key = edit.location === "before" ? "descriptionTextBefore" : edit.location === "after" ? "descriptionTextAfter" : undefined;
      if (key === undefined) throw invalidEdit("Textraden ska stå före eller efter");
      draft.controls[edit.control] = edit.text === null || edit.text === "" ? without(current, key) : { ...current, [key]: edit.text };
      break;
    }
    default: {
      const never: never = edit;
      throw invalidEdit(`Okänd ändring ${(never as { type: string }).type}`);
    }
  }
  return { document: asDocument(draft), ...(created !== undefined ? { created } : {}) };
}
