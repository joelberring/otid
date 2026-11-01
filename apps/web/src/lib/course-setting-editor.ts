import {
  applyEdit, CourseSettingEditError, createdIdsBetween, objectPatch, type ControlKind, type CourseSettingDocument, type CourseSettingEdit,
  type CreatedIds, type EditResult, type PutObjectsEdit
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { ALL_CONTROLS, bendInsertIndex, type HitTarget } from "./course-setting-hit";

/**
 * Steg 62 (ADR-0180): banläggningens editor utan React. Varje ändring ger ett nytt dokument via paketets `applyEdit`.
 * En dragning ändrar dokumentet medan musen rör sig men blir ett enda steg i historiken. Verktyget avgör vad ett klick på
 * kartan gör.
 *
 * Steg 66 (ADR-0181 beslut 3–4): varje ändring loggas som åtgärd (`log`, med id som den skapade) för att sparas eller bli
 * ett förslag. Ångra sätter tillbaka bara objekten som steget ändrade (`PUT_OBJECTS` ur `objectPatch`), så att andras
 * ändringar står kvar; i förslagsläget (`suggesting`) tar ångra i stället bort stegets åtgärder ur förslaget.
 */
export type Tool = "SELECT" | "ADD_CONTROL" | "ADD_START" | "ADD_FINISH" | "ADD_CROSSING" | "INSERT_EXISTING" | "ADD_BEND" | "NOTE";

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
  readonly tool: Tool;
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

/** Förslagsläget börjar på dokumentet som det är (inga osparade åtgärder får finnas). */
export function startSuggesting(state: EditorState, baseVersion: number): EditorState {
  return { ...state, suggesting: { base: state.document, baseVersion }, past: [], future: [], log: [], error: undefined };
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

export const canUndo = (state: EditorState) => state.past.length > 0 && !state.dragBase;
export const canRedo = (state: EditorState) => state.future.length > 0 && !state.dragBase;

/** Ångra går inte när någon annan har ändrat samma sak (eller tagit bort det som steget bygger på). */
export const UNDO_FAILED = "Det går inte att ångra: någon annan har ändrat samma sak.";

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
  return { ...state, view, variant, selection: undefined, error: undefined };
}

export function setTool(state: EditorState, tool: Tool): EditorState {
  return { ...state, tool, error: undefined };
}

export function select(state: EditorState, target: HitTarget | Selection | undefined): EditorState {
  if (!target) return { ...state, selection: undefined };
  const selection: Selection = target.kind === "leg" ? { kind: "leg", from: target.from, to: target.to,
    fromCourseControl: target.fromCourseControl, toCourseControl: target.toCourseControl }
    : { kind: "control", control: target.control, courseControl: target.courseControl };
  return { ...state, selection, error: undefined };
}

/** Escape: tillbaka till Välj och ingen markering. */
export function cancelTool(state: EditorState): EditorState {
  return { ...state, tool: "SELECT", selection: undefined, error: undefined };
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

const KIND_OF_TOOL: Partial<Record<Tool, ControlKind>> = { ADD_CONTROL: "NORMAL", ADD_START: "START", ADD_FINISH: "FINISH", ADD_CROSSING: "CROSSING_POINT" };
export const toolControlKind = (tool: Tool) => KIND_OF_TOOL[tool];

/**
 * Var en ny kontroll läggs in på banan: start och mål utan `after` (paketet ersätter en befintlig start eller ett
 * befintligt mål, som Purple Pen), annars efter vald kontroll (utan val: före målet).
 */
function insertAfter(state: EditorState, kind: ControlKind): string | null | undefined {
  if (kind === "START" || kind === "FINISH") return undefined;
  const selected = state.selection?.kind === "control" ? state.selection.courseControl : undefined;
  return selected && state.document.courseControls[selected] ? selected : undefined;
}

/**
 * Klick med ett lägg-till-verktyg: ny kontroll (vanlig får `nextFreeCode`), i en bana inlagd direkt. Den nya blir vald,
 * så att nästa klick lägger nästa kontroll efter den.
 */
export function addPoint(state: EditorState, tool: Tool, at: Point, apply: Apply, nextCode: (document: CourseSettingDocument) => string): EditorState {
  const kind = toolControlKind(tool);
  if (!kind) return state;
  const inCourse = state.view !== ALL_CONTROLS;
  const after = inCourse ? insertAfter(state, kind) : undefined;
  let control: string | undefined;
  return applySteps(state, [
    { type: "ADD_CONTROL", kind, at, ...(kind === "NORMAL" ? { code: nextCode(state.document) } : {}) },
    created => { control = created; return inCourse && created ? { type: "INSERT_COURSE_CONTROL", course: state.view, control: created, after } : undefined; }
  ], apply, (created, document) => control && document.controls[control]
    ? { kind: "control", control, courseControl: inCourse && created !== control ? created : undefined } : undefined);
}

/** Klick på en befintlig kontroll med "Lägg in på banan": in efter vald kontroll. */
export function insertExisting(state: EditorState, control: string, apply: Apply): EditorState {
  if (state.view === ALL_CONTROLS || !state.document.controls[control]) return state;
  const kind = state.document.controls[control].kind;
  const after = insertAfter(state, kind);
  return applySteps(state, [{ type: "INSERT_COURSE_CONTROL", course: state.view, control, after }], apply,
    (created, document) => ({ kind: "control", control, courseControl: created && document.courseControls[created] ? created : undefined }));
}

/** Delete: i en bana tas vald kontroll bort från banan, i Alla kontroller tas den bort helt; en vald sträcka blir rak. */
export function removeSelected(state: EditorState, apply: Apply, everywhere = state.view === ALL_CONTROLS): EditorState {
  const selection = state.selection;
  if (!selection) return state;
  if (selection.kind === "leg") {
    return state.document.legs[`${selection.from}-${selection.to}`]?.bends.length
      ? applySteps(state, [{ type: "SET_LEG_BENDS", from: selection.from, to: selection.to, bends: [] }], apply) : state;
  }
  if (!everywhere && selection.courseControl && state.view !== ALL_CONTROLS) {
    return applySteps(state, [{ type: "REMOVE_COURSE_CONTROL", course: state.view, courseControl: selection.courseControl }], apply, () => undefined);
  }
  return applySteps(state, [{ type: "DELETE_CONTROL", control: selection.control }], apply, () => undefined);
}

/** Gaffling eller slinga vid vald kontroll på banan. */
export function addSplit(state: EditorState, kind: "FORK" | "LOOP", branches: number, apply: Apply): EditorState {
  const at = state.selection?.kind === "control" ? state.selection.courseControl : undefined;
  if (!at || state.view === ALL_CONTROLS) return { ...state, error: undefined };
  return applySteps(state, [{ type: "ADD_SPLIT", course: state.view, at, kind, branches }], apply);
}

export function removeSplit(state: EditorState, apply: Apply): EditorState {
  const at = state.selection?.kind === "control" ? state.selection.courseControl : undefined;
  if (!at || state.view === ALL_CONTROLS) return state;
  return applySteps(state, [{ type: "REMOVE_SPLIT", course: state.view, at }], apply);
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
