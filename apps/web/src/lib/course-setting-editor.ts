import {
  applyEdit, courseControlOrder, CourseSettingEditError, createdIdsBetween, objectPatch, type ControlKind, type CourseSettingDocument, type CourseSettingEdit,
  type CreatedIds, type EditResult, type PutObjectsEdit, type SpecialKind
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { allBranches, branchOf, courseTree } from "./course-setting-forks";
import { ALL_CONTROLS, bendInsertIndex, type HitTarget } from "./course-setting-hit";
import { legOrientation } from "./course-setting-rotate";
import { inLanguage } from "./in-language";

/**
 * Steg 62 (ADR-0180): banläggningens editor utan React. Varje ändring ger ett nytt dokument via paketets `applyEdit`.
 * En dragning ändrar dokumentet medan musen rör sig men blir ett enda steg i historiken. Verktyget avgör vad ett klick på
 * kartan gör.
 *
 * Steg 66 (ADR-0181 beslut 3–4): varje ändring loggas som åtgärd (`log`, med id som den skapade) för att sparas eller bli
 * ett förslag. Ångra sätter tillbaka bara objekten som steget ändrade (`PUT_OBJECTS` ur `objectPatch`), så att andras
 * ändringar står kvar; i förslagsläget (`suggesting`) tar ångra i stället bort stegets åtgärder ur förslaget.
 */
export type Tool = "SELECT" | "ADD_CONTROL" | "ADD_START" | "ADD_FINISH" | "ADD_CROSSING" | "INSERT_EXISTING" | "ADD_BEND" | "NOTE" | "SPECIAL"
  /** ADR-0180 beslut 14: kartbyte från paletten. */
  | "ADD_MAP_EXCHANGE";

/** En gjord åtgärd som inte är sparad (eller ingår i förslaget), med id som den skapade. */
export interface LoggedEdit {
  readonly seq: number;
  readonly edit: CourseSettingEdit;
  readonly created: CreatedIds;
}

/** Ett steg i historiken: åtgärderna och (vid direkt ändring) det som sätter tillbaka objekten. */
export interface HistoryStep {
  readonly undo?: PutObjectsEdit | undefined;
  readonly entries: readonly LoggedEdit[];
}

export type Selection =
  | { readonly kind: "control"; readonly control: string; readonly courseControl?: string | undefined }
  /** Steg 64: ett specialobjekt. */
  | { readonly kind: "special"; readonly special: string }
  | { readonly kind: "leg"; readonly from: string; readonly to: string; readonly fromCourseControl?: string | undefined;
      readonly toCourseControl?: string | undefined };

export interface EditorState {
  readonly document: CourseSettingDocument;
  readonly past: readonly HistoryStep[];
  readonly future: readonly HistoryStep[];
  /** Gjorda åtgärder som inte är sparade (direkt) eller som är förslaget (förslagsläget). */
  readonly log: readonly LoggedEdit[];
  readonly nextSeq: number;
  /** Förslagsläget: dokumentet som förslaget bygger på och dess version. */
  readonly suggesting?: { readonly base: CourseSettingDocument; readonly baseVersion: number } | undefined;
  /** `ALL_CONTROLS` eller banans id. */
  readonly view: string;
  /** Variantkod för en gafflad bana; saknas = alla grenar. */
  readonly variant?: string | undefined;
  /** ADR-0180 beslut 14: grenen man arbetar i (banans kontroll som börjar den); nya kontroller läggs in i grenen. */
  readonly branch?: string | undefined;
  readonly tool: Tool;
  /** Steg 64: slaget som verktyget SPECIAL skapar och punkterna som är utsatta (yta eller linje som ritas). */
  readonly specialKind?: SpecialKind | undefined;
  readonly drawing?: readonly Point[] | undefined;
  /** ADR-0180 beslut 14: bilden som läggs ut med nästa klick (verktyget SPECIAL med slaget "image"). */
  readonly specialImage?: { readonly format: string; readonly data: string; readonly aspect: number } | undefined;
  readonly selection?: Selection | undefined;
  /** Dokumentet när en dragning började och dragningens senaste åtgärd. */
  readonly dragBase?: CourseSettingDocument | undefined;
  readonly dragEdit?: CourseSettingEdit | undefined;
  /** Räknas upp vid varje ändring av dokumentet (autosparandet sparar när den ändrats). */
  readonly revision: number;
  /** Varför senaste ändringen inte gick. */
  readonly error?: string | undefined;
}

export type Apply = (document: CourseSettingDocument, edit: CourseSettingEdit) => EditResult;
/** En ändring, eller en som bygger på det förra stegets nya id. */
export type EditStep = CourseSettingEdit | ((created: string | undefined, document: CourseSettingDocument) => CourseSettingEdit | undefined);

const HISTORY = 200;

export function createEditor(document: CourseSettingDocument, view = ALL_CONTROLS): EditorState {
  const known = view === ALL_CONTROLS || document.courses.some(course => course.id === view);
  return { document, past: [], future: [], log: [], nextSeq: 1, view: known ? view : ALL_CONTROLS, tool: "SELECT", revision: 0 };
}

/** Ett nytt dokument utifrån (inläst .ppen, återställd version): historiken och de osparade åtgärderna börjar om. */
export function replaceDocument(state: EditorState, document: CourseSettingDocument, version?: number): EditorState {
  const next = createEditor(document, state.view);
  return { ...next, tool: state.tool, nextSeq: state.nextSeq, revision: state.revision + 1,
    ...(state.suggesting ? { suggesting: { base: document, baseVersion: version ?? state.suggesting.baseVersion } } : {}) };
}

/** Förslaget skickat eller kastat: tillbaka till dokumentet det byggde på (som förslagsläge, eller direkt). */
export function endSuggestion(state: EditorState, keepSuggesting: boolean, base?: { document: CourseSettingDocument; version: number }): EditorState {
  const current = state.suggesting;
  if (!current) return state;
  const document = base?.document ?? current.base;
  return { ...state, document, past: [], future: [], log: [], selection: stillThere(document, state.selection), revision: state.revision + 1,
    suggesting: keepSuggesting ? { base: document, baseVersion: base?.version ?? current.baseVersion } : undefined, error: undefined };
}

/** Åtgärden som den går över nätet (utan `undefined`), så att webbläsaren och servern gör exakt samma sak. */
export const wireEdit = (edit: CourseSettingEdit): CourseSettingEdit => JSON.parse(JSON.stringify(edit)) as CourseSettingEdit;

/** Id som åtgärden skapade som de går över nätet (`courseSettingCreatedIdsSchema`), också specialobjekten (steg 64). */
export const wireCreated = (created: CreatedIds) => ({ controls: [...created.controls], courseControls: [...created.courseControls],
  courses: [...created.courses], ...(created.specialObjects?.length ? { specialObjects: [...created.specialObjects] } : {}) });

/** Kontrollen eller sträckan finns fortfarande i dokumentet (efter ångra eller borttagning). */
export function stillThere(document: CourseSettingDocument, selection: Selection | undefined): Selection | undefined {
  if (!selection) return undefined;
  if (selection.kind === "special") return document.specialObjects.some(special => special.id === selection.special) ? selection : undefined;
  if (selection.kind === "control") {
    if (!document.controls[selection.control]) return undefined;
    return selection.courseControl && !document.courseControls[selection.courseControl] ? { kind: "control", control: selection.control } : selection;
  }
  return document.controls[selection.from] && document.controls[selection.to] ? selection : undefined;
}

/** Gör ändringarna i ordning som ett steg i historiken. Går en inte blir inget gjort och `error` säger varför. */
export function applySteps(state: EditorState, steps: readonly EditStep[], apply: Apply,
  select?: (created: string | undefined, document: CourseSettingDocument) => Selection | undefined): EditorState {
  let document = state.document, created: string | undefined, seq = state.nextSeq;
  const entries: LoggedEdit[] = [];
  try {
    for (const step of steps) {
      const raw = typeof step === "function" ? step(created, document) : step;
      if (!raw) continue;
      const edit = wireEdit(raw);
      const result = apply(document, edit);
      if (result.document !== document) entries.push({ seq: seq++, edit, created: createdIdsBetween(document, result.document) });
      document = result.document;
      created = result.created ?? created;
    }
  } catch (error) {
    if (error instanceof CourseSettingEditError) return { ...state, error: error.message };
    throw error;
  }
  if (document === state.document) return { ...state, error: undefined };
  const selection = select ? select(created, document) : stillThere(document, state.selection);
  const view = state.view === ALL_CONTROLS || document.courses.some(course => course.id === state.view) ? state.view : ALL_CONTROLS;
  const step: HistoryStep = { undo: state.suggesting ? undefined : objectPatch(document, state.document), entries };
  return { ...state, document, past: [...state.past, step].slice(-HISTORY), future: [], log: [...state.log, ...entries], nextSeq: seq,
    selection, view, variant: view === state.view ? state.variant : undefined, revision: state.revision + 1, error: undefined };
}

/**
 * En ändring som inte är användarens egen (vägvalens vägar nära kontrollerna, ägaren 2026-11-08): den loggas och synkas
 * som andra men hamnar inte i ångra-historiken. Inget görs i förslagsläget, under en dragning eller om ändringen inte går.
 */
export function applyBackground(state: EditorState, edit: CourseSettingEdit, apply: Apply): EditorState {
  if (state.suggesting || state.dragBase) return state;
  const wired = wireEdit(edit);
  try {
    const result = apply(state.document, wired);
    if (result.document === state.document) return state;
    const entry: LoggedEdit = { seq: state.nextSeq, edit: wired, created: createdIdsBetween(state.document, result.document) };
    return { ...state, document: result.document, log: [...state.log, entry], nextSeq: state.nextSeq + 1, revision: state.revision + 1 };
  } catch (error) {
    if (error instanceof CourseSettingEditError) return state;
    throw error;
  }
}

export const canUndo = (state: EditorState) => state.past.length > 0 && !state.dragBase;
export const canRedo = (state: EditorState) => state.future.length > 0 && !state.dragBase;

/** Ångra går inte när någon annan har ändrat samma sak (eller tagit bort det som steget bygger på). */
export const UNDO_FAILED = inLanguage("Det går inte att ångra: någon annan har ändrat samma sak.", "Can't undo: someone else has changed the same thing.");

/** Förslagsläget: dokumentet = förslagets grund med åtgärderna. */
function replayLog(base: CourseSettingDocument, log: readonly LoggedEdit[]): CourseSettingDocument {
  let document = base;
  for (const entry of log) {
    try { document = applyEdit(document, entry.edit).document; } catch (error) { if (!(error instanceof CourseSettingEditError)) throw error; }
  }
  return document;
}

/** Direkt ändring: sätt objekten som steget ändrade; ger det nya läget och steget som gör tvärtom. */
function putBack(state: EditorState, patch: PutObjectsEdit | undefined, entries: readonly LoggedEdit[]):
  { document: CourseSettingDocument; entry?: LoggedEdit; step: HistoryStep } | undefined {
  if (!patch) return { document: state.document, step: { entries } };
  try {
    const document = applyEdit(state.document, patch).document;
    const entry: LoggedEdit = { seq: state.nextSeq, edit: patch, created: createdIdsBetween(state.document, document) };
    return { document, entry, step: { undo: objectPatch(document, state.document), entries: [entry] } };
  } catch (error) {
    if (error instanceof CourseSettingEditError) return undefined;
    throw error;
  }
}

function travel(state: EditorState, direction: "undo" | "redo"): EditorState {
  const step = direction === "undo" ? state.past.at(-1) : state.future[0];
  if (!step || state.dragBase) return state;
  const past = direction === "undo" ? state.past.slice(0, -1) : state.past;
  const future = direction === "undo" ? state.future : state.future.slice(1);
  let document: CourseSettingDocument, log = state.log, nextSeq = state.nextSeq, moved: HistoryStep;
  if (state.suggesting) {
    const seqs = new Set(step.entries.map(entry => entry.seq));
    log = direction === "undo" ? state.log.filter(entry => !seqs.has(entry.seq)) : [...state.log, ...step.entries];
    document = replayLog(state.suggesting.base, log);
    moved = step;
  } else {
    const result = putBack(state, step.undo, step.entries);
    if (!result) return { ...state, past, future, error: UNDO_FAILED };
    document = result.document;
    if (result.entry) { log = [...state.log, result.entry]; nextSeq = state.nextSeq + 1; }
    moved = result.step;
  }
  return { ...state, document, log, nextSeq,
    past: direction === "undo" ? past : [...past, moved].slice(-HISTORY),
    future: direction === "undo" ? [moved, ...future].slice(0, HISTORY) : future,
    selection: stillThere(document, state.selection), revision: state.revision + 1, error: undefined };
}

export function undo(state: EditorState): EditorState { return travel(state, "undo"); }
export function redo(state: EditorState): EditorState { return travel(state, "redo"); }

export function setView(state: EditorState, view: string, variant?: string): EditorState {
  return { ...state, view, variant, branch: undefined, selection: undefined, error: undefined };
}

/** Arbeta i grenen som börjar med `start`: nya kontroller läggs in efter `last` (grenens sista banans kontroll). */
export function workInBranch(state: EditorState, start: string | undefined, last?: string): EditorState {
  if (!start) return { ...state, branch: undefined };
  const at = last && state.document.courseControls[last] ? last : start;
  const item = state.document.courseControls[at];
  if (!item) return state;
  return { ...state, branch: start, variant: undefined, selection: { kind: "control", control: item.control, courseControl: at }, error: undefined };
}

export function setTool(state: EditorState, tool: Tool, specialKind?: SpecialKind): EditorState {
  return { ...state, tool, drawing: undefined, error: undefined, ...(specialKind ? { specialKind } : {}) };
}

export function select(state: EditorState, target: HitTarget | Selection | undefined): EditorState {
  if (!target) return { ...state, selection: undefined };
  const selection: Selection = target.kind === "special" ? { kind: "special", special: target.special }
    : target.kind === "leg" ? { kind: "leg", from: target.from, to: target.to,
      fromCourseControl: target.fromCourseControl, toCourseControl: target.toCourseControl }
      : { kind: "control", control: target.control, courseControl: target.courseControl };
  return { ...state, selection, error: undefined };
}

/** Escape: tillbaka till Välj och ingen markering. */
export function cancelTool(state: EditorState): EditorState {
  return { ...state, tool: "SELECT", selection: undefined, drawing: undefined, error: undefined };
}

/** Banans kontroller från första till sista (första grenen i en gaffling). */
export function courseChain(document: CourseSettingDocument, courseId: string): string[] {
  const course = document.courses.find(row => row.id === courseId);
  const chain: string[] = [];
  const seen = new Set<string>();
  for (let id = course?.first; id && !seen.has(id); id = document.courseControls[id]?.next) {
    seen.add(id);
    chain.push(id);
  }
  return chain;
}

const KIND_OF_TOOL: Partial<Record<Tool, ControlKind>> = { ADD_CONTROL: "NORMAL", ADD_START: "START", ADD_FINISH: "FINISH", ADD_CROSSING: "CROSSING_POINT",
  ADD_MAP_EXCHANGE: "MAP_EXCHANGE" };
export const toolControlKind = (tool: Tool) => KIND_OF_TOOL[tool];

/** Sträckan finns i flera grenar och ingen gren eller variant är vald (ägaren 2026-11-21, A6). */
export const LEG_IN_SEVERAL_BRANCHES = inLanguage("Sträckan finns i flera grenar. Välj grenen (Arbeta i gren) eller en variant först.",
  "The leg is in several branches. Choose the branch (Work in branch) or a variation first.");

/** `branch` om den fortfarande börjar en gren på banan (en borttagen gren, eller en gaffling som försvann, ger undefined). */
export function branchStart(document: CourseSettingDocument, branch: string | undefined): string | undefined {
  return branch !== undefined && document.courseControls[branch]?.split?.branches.includes(branch) ? branch : undefined;
}

/** Sista banans kontroll i grenen (där nästa kontroll läggs in), ur banans träd; en tom gren: grenens början. */
export function branchLast(document: CourseSettingDocument, course: string, branch: string): string | undefined {
  try { return allBranches(courseTree(document, course)).find(row => row.start === branch)?.last; } catch { return undefined; }
}

/** Banans kontroller i grenen som börjar med `start` (början, grenens kontroller och gafflingar i den), fram till mötespunkten. */
function branchMembers(document: CourseSettingDocument, start: string): Set<string> {
  const end = document.courseControls[start]?.split?.end;
  const members = new Set([start]);
  const queue = [document.courseControls[start]?.next];
  while (queue.length) {
    const id = queue.pop();
    if (id === undefined || id === end || members.has(id)) continue;
    const item = document.courseControls[id];
    if (!item) continue;
    members.add(id);
    queue.push(item.next);
    if (item.split) queue.push(...item.split.branches);
  }
  return members;
}

type Place = { readonly after: string | null | undefined; readonly error?: undefined } | { readonly error: string };

/**
 * Var en ny kontroll läggs in på banan: start och mål utan `after` (paketet ersätter en befintlig start eller ett
 * befintligt mål, som Purple Pen), annars efter vald kontroll. Utan val: efter sista kontrollen i grenen man arbetar i
 * (ägaren 2026-11-21, A3), annars före målet.
 */
function insertPlace(state: EditorState, kind: ControlKind): Place {
  if (kind === "START" || kind === "FINISH") return { after: undefined };
  // Ägaren 2026-11-17: med en vald sträcka läggs kontrollen in på den sträckan, också i en gren av en gaffling (förut hamnade
  // den före målet, så en befintlig kontroll gick inte att lägga in i grenen).
  if (state.selection?.kind === "leg") {
    const place = legPlace(state.document, state.view, state.selection, state.branch, state.variant);
    return place.ambiguous ? { error: LEG_IN_SEVERAL_BRANCHES } : { after: place.at };
  }
  const selected = state.selection?.kind === "control" ? state.selection.courseControl : undefined;
  if (selected && state.document.courseControls[selected]) return { after: selected };
  const branch = branchStart(state.document, state.branch);
  if (branch && state.view !== ALL_CONTROLS) return { after: branchLast(state.document, state.view, branch) ?? branch };
  return { after: undefined };
}

/**
 * Banans kontroll där sträckan `from`–`to` börjar. Har flera grenar samma sträcka (en ny gaffling har tomma grenar) väljs
 * den i grenen man arbetar i (`branch`) eller i vald variant; annars är sträckan tvetydig (`ambiguous`, ägaren 2026-11-21:
 * besked i stället för att tyst ta den första). `fromCourseControl` används när den finns.
 */
export function legPlace(document: CourseSettingDocument, courseId: string,
  leg: { readonly from: string; readonly to: string; readonly fromCourseControl?: string | undefined }, branch?: string, variant?: string)
  : { readonly at?: string | undefined; readonly ambiguous: boolean } {
  if (leg.fromCourseControl && document.courseControls[leg.fromCourseControl]) return { at: leg.fromCourseControl, ambiguous: false };
  const course = document.courses.find(row => row.id === courseId);
  const seen = new Set<string>(), queue = course?.first ? [course.first] : [], found: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const item = document.courseControls[id];
    if (!item) continue;
    if (item.control === leg.from && item.next && document.courseControls[item.next]?.control === leg.to) found.push(id);
    if (item.split) queue.push(...item.split.branches);
    if (item.next) queue.push(item.next);
  }
  if (found.length <= 1) return { at: found[0], ambiguous: false };
  const working = branchStart(document, branch);
  if (working) {
    const members = branchMembers(document, working);
    const inBranch = found.filter(id => members.has(id));
    if (inBranch.length === 1) return { at: inBranch[0], ambiguous: false };
  }
  if (variant !== undefined) {
    try {
      const inVariant = new Set(courseControlOrder(document, courseId, variant));
      const hits = found.filter(id => inVariant.has(id));
      if (hits.length === 1) return { at: hits[0], ambiguous: false };
    } catch { /* en bana som inte går att gå igenom: tvetydig */ }
  }
  return { ambiguous: true };
}

/** Banans kontroll där sträckan börjar (`legPlace`); undefined när den inte finns eller är tvetydig. */
export function legCourseControl(document: CourseSettingDocument, courseId: string,
  leg: { readonly from: string; readonly to: string; readonly fromCourseControl?: string | undefined }, branch?: string, variant?: string): string | undefined {
  return legPlace(document, courseId, leg, branch, variant).at;
}

/**
 * Klick med ett lägg-till-verktyg: ny kontroll (vanlig får `nextFreeCode`), i en bana inlagd direkt. Den nya blir vald,
 * så att nästa klick lägger nästa kontroll efter den.
 */
export function addPoint(state: EditorState, tool: Tool, at: Point, apply: Apply, nextCode: (document: CourseSettingDocument) => string,
  snap?: string): EditorState {
  const kind = toolControlKind(tool);
  if (!kind) return state;
  // ADR-0180 beslut 14: ett klick i ringen på en befintlig kontroll lägger in den (som Purple Pens AddControlMode).
  if (snap !== undefined && state.view !== ALL_CONTROLS && state.document.controls[snap]) return insertExisting(state, snap, apply);
  const inCourse = state.view !== ALL_CONTROLS;
  const place = inCourse ? insertPlace(state, kind) : { after: undefined };
  if (place.error !== undefined) return { ...state, error: place.error };
  const after = place.after;
  let control: string | undefined, courseControl: string | undefined;
  return applySteps(state, [
    { type: "ADD_CONTROL", kind, at, ...(kind === "NORMAL" ? { code: nextCode(state.document) } : {}) },
    created => { control = created; return inCourse && created ? { type: "INSERT_COURSE_CONTROL", course: state.view, control: created, after } : undefined; },
    // En ny obligatorisk passage ställs rätt mot sträckan genom den (Purple Pen ger vinkeln 0, ADR-0180 beslut 14).
    (created, document) => {
      courseControl = inCourse && control ? created : undefined;
      if (kind !== "CROSSING_POINT" || !control || !courseControl) return undefined;
      const orientation = legOrientation(document, state.view, courseControl);
      return orientation === undefined ? undefined : { type: "SET_CONTROL_ORIENTATION", control, orientation };
    }
  ], apply, (_created, document) => control && document.controls[control]
    ? { kind: "control", control, courseControl: courseControl && document.courseControls[courseControl] ? courseControl : undefined } : undefined);
}

/** Klick på en befintlig kontroll med "Lägg in på banan": in efter vald kontroll. */
export function insertExisting(state: EditorState, control: string, apply: Apply): EditorState {
  if (state.view === ALL_CONTROLS || !state.document.controls[control]) return state;
  const kind = state.document.controls[control].kind;
  const place = insertPlace(state, kind);
  if (place.error !== undefined) return { ...state, error: place.error };
  return applySteps(state, [{ type: "INSERT_COURSE_CONTROL", course: state.view, control, after: place.after }], apply,
    (created, document) => ({ kind: "control", control, courseControl: created && document.courseControls[created] ? created : undefined }));
}

/** Delete: i en bana tas vald kontroll bort från banan, i Alla kontroller tas den bort helt; en vald sträcka blir rak. */
export function removeSelected(state: EditorState, apply: Apply, everywhere = state.view === ALL_CONTROLS): EditorState {
  const selection = state.selection;
  if (!selection) return state;
  if (selection.kind === "special") return applySteps(state, [{ type: "DELETE_SPECIAL", special: selection.special }], apply, () => undefined);
  if (selection.kind === "leg") {
    return state.document.legs[`${selection.from}-${selection.to}`]?.bends.length
      ? applySteps(state, [{ type: "SET_LEG_BENDS", from: selection.from, to: selection.to, bends: [] }], apply) : state;
  }
  if (!everywhere && selection.courseControl && state.view !== ALL_CONTROLS) {
    // Ägaren 2026-11-21 (A3): kontrollen före den borttagna blir vald, så att nästa kontroll läggs in där (i samma gren).
    const before = selectAfterRemove(state, selection.courseControl);
    const next = applySteps(state, [{ type: "REMOVE_COURSE_CONTROL", course: state.view, courseControl: selection.courseControl }], apply,
      (_created, document) => {
        const at = before.find(id => document.courseControls[id] && courseHas(document, state.view, id));
        return at ? { kind: "control", control: document.courseControls[at]!.control, courseControl: at } : undefined;
      });
    return next.document === state.document ? next : { ...next, branch: branchStart(next.document, next.branch) };
  }
  return applySteps(state, [{ type: "DELETE_CONTROL", control: selection.control }], apply, () => undefined);
}

/** Banans kontroll finns på banan (inte bara kvar i dokumentet). */
function courseHas(document: CourseSettingDocument, course: string, id: string): boolean {
  try { return courseControlOrder(document, course).includes(id); } catch { return false; }
}

/**
 * Kandidaterna att välja efter att banans kontroll `removed` tagits bort, i ordning: kontrollen före den (helst i grenen
 * man arbetar i, annars i grundföljden), och för en grens början gafflingens första gren (gaffelkontrollen).
 */
function selectAfterRemove(state: EditorState, removed: string): string[] {
  const { document } = state;
  let order: string[];
  try { order = [...courseControlOrder(document, state.view)]; } catch { return []; }
  const before = order.filter(id => document.courseControls[id]?.next === removed);
  const branch = branchStart(document, state.branch);
  const members = branch ? branchMembers(document, branch) : new Set<string>();
  const main = new Set(courseChain(document, state.view));
  const rank = (id: string) => members.has(id) ? 0 : main.has(id) ? 1 : 2;
  const split = document.courseControls[removed]?.split;
  return [...before.sort((a, b) => rank(a) - rank(b)), ...(split ? split.branches.filter(id => id !== removed) : [])];
}

/**
 * Ägaren 2026-11-21 (A2): «Klar» i grenraden. Kontrollen där grenarna möts blir vald (slingan: gaffelkontrollen i följden),
 * så att nästa kontroll läggs in efter gafflingen. Ligger gafflingen i en gren arbetar man sedan i den grenen.
 */
export function finishBranch(state: EditorState): EditorState {
  const branch = branchStart(state.document, state.branch);
  const split = branch ? state.document.courseControls[branch]!.split! : undefined;
  if (!split || state.view === ALL_CONTROLS) return { ...state, branch: undefined, error: undefined };
  const at = split.kind === "LOOP" ? split.branches[0]! : split.end;
  const item = state.document.courseControls[at];
  if (!item) return { ...state, branch: undefined, error: undefined };
  let outer: string | undefined;
  try { outer = branchOf(courseTree(state.document, state.view), at)?.start; } catch { outer = undefined; }
  return { ...state, branch: outer, selection: { kind: "control", control: item.control, courseControl: at }, error: undefined };
}

/**
 * Ägaren 2026-11-21 (A5): vald kontroll är en gaffelkontroll (banans kontroll som börjar en gren i en gaffling, inte en
 * slinga). Delete frågar då om grenen eller hela gafflingen ska tas bort.
 */
export function selectedForkStart(state: EditorState): { readonly courseControl: string; readonly control: string } | undefined {
  if (state.view === ALL_CONTROLS || state.selection?.kind !== "control" || !state.selection.courseControl) return undefined;
  const id = state.selection.courseControl;
  const item = state.document.courseControls[id];
  return item?.split?.kind === "FORK" && item.split.branches.includes(id) ? { courseControl: id, control: item.control } : undefined;
}

/**
 * Gaffling eller slinga vid vald kontroll på banan. ADR-0180 beslut 14: editorn står sedan i första grenen (A), så att
 * nästa kontroll läggs in där (gaffling: efter gaffelkontrollen, slinga: i första slingan).
 */
export function addSplit(state: EditorState, kind: "FORK" | "LOOP", branches: number, apply: Apply): EditorState {
  const at = splitPlace(state);
  if (!at || state.view === ALL_CONTROLS) return { ...state, error: undefined };
  const next = applySteps(state, [{ type: "ADD_SPLIT", course: state.view, at, kind, branches }], apply);
  const split = next.document.courseControls[at]?.split;
  if (next.error || !split) return next;
  return workInBranch(next, kind === "LOOP" ? split.branches[1] : split.branches[0]);
}

/**
 * Var en gaffling börjar: vald kontroll på banan, eller (ägaren 2026-11-17, «gafflingar på delsträckor») början av vald sträcka
 * i den gren där sträckan finns, så att sträckan gafflas.
 */
export function splitPlace(state: EditorState): string | undefined {
  if (state.view === ALL_CONTROLS) return undefined;
  if (state.selection?.kind === "leg") return legCourseControl(state.document, state.view, state.selection, state.branch, state.variant);
  return state.selection?.kind === "control" ? state.selection.courseControl : undefined;
}

/** Den valda sträckan finns i flera grenar och ingen gren eller variant pekar ut en (beskedet `LEG_IN_SEVERAL_BRANCHES`). */
export function selectedLegAmbiguous(state: EditorState): boolean {
  return state.view !== ALL_CONTROLS && state.selection?.kind === "leg"
    && legPlace(state.document, state.view, state.selection, state.branch, state.variant).ambiguous;
}

/** Ta bort gafflingen vid vald kontroll: gren A blir kvar (paketet) och dess gaffelkontroll blir vald. */
export function removeSplit(state: EditorState, apply: Apply): EditorState {
  const at = state.selection?.kind === "control" ? state.selection.courseControl : undefined;
  if (!at || state.view === ALL_CONTROLS) return state;
  const keep = state.document.courseControls[at]?.split?.branches[0];
  const next = applySteps(state, [{ type: "REMOVE_SPLIT", course: state.view, at }], apply, (_created, document) => {
    const item = keep ? document.courseControls[keep] : undefined;
    return item ? { kind: "control", control: item.control, courseControl: keep } : stillThere(document, state.selection);
  });
  return next.document === state.document ? next : { ...next, branch: branchStart(next.document, next.branch) };
}

/** Brytpunkt på vald sträcka där man klickade (i ordning längs linjen). */
export function addBend(state: EditorState, at: Point, apply: Apply): EditorState {
  if (state.selection?.kind !== "leg") return state;
  const { from, to } = state.selection;
  const start = state.document.controls[from]?.at, end = state.document.controls[to]?.at;
  if (!start || !end) return state;
  const bends = state.document.legs[`${from}-${to}`]?.bends ?? [];
  const index = bendInsertIndex(start, end, bends, at);
  return applySteps(state, [{ type: "SET_LEG_BENDS", from, to, bends: [...bends.slice(0, index), at, ...bends.slice(index)] }], apply);
}

/** En dragning börjar: dokumentet nu är det som ångra går tillbaka till. */
export function beginDrag(state: EditorState): EditorState {
  return state.dragBase ? state : { ...state, dragBase: state.document, dragEdit: undefined };
}

/** Under dragningen: ändringen görs på dokumentet från dragningens början, utan historik. */
export function dragTo(state: EditorState, edit: CourseSettingEdit, apply: Apply): EditorState {
  if (!state.dragBase) return state;
  try {
    const wired = wireEdit(edit);
    return { ...state, document: apply(state.dragBase, wired).document, dragEdit: wired, error: undefined };
  } catch (error) {
    if (error instanceof CourseSettingEditError) return { ...state, error: error.message };
    throw error;
  }
}

/** Dragningen klar: ett steg i historiken (inget om inget ändrades). */
export function endDrag(state: EditorState): EditorState {
  const base = state.dragBase;
  if (!base) return state;
  if (base === state.document || !state.dragEdit) return { ...state, document: base, dragBase: undefined, dragEdit: undefined };
  const entry: LoggedEdit = { seq: state.nextSeq, edit: state.dragEdit, created: createdIdsBetween(base, state.document) };
  const step: HistoryStep = { undo: state.suggesting ? undefined : objectPatch(state.document, base), entries: [entry] };
  return { ...state, dragBase: undefined, dragEdit: undefined, past: [...state.past, step].slice(-HISTORY), future: [],
    log: [...state.log, entry], nextSeq: state.nextSeq + 1, revision: state.revision + 1 };
}

export function cancelDrag(state: EditorState): EditorState {
  return state.dragBase ? { ...state, document: state.dragBase, dragBase: undefined, dragEdit: undefined } : state;
}
