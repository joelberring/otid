import {
  CourseSettingEditError, type ControlKind, type CourseSettingDocument, type CourseSettingEdit, type EditResult
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { ALL_CONTROLS, bendInsertIndex, type HitTarget } from "./course-setting-hit";

/**
 * Steg 62 (ADR-0180): banläggningens editor utan React. Varje ändring ger ett nytt dokument via paketets `applyEdit`;
 * ångra och gör om är listor av tidigare dokument. En dragning ändrar dokumentet medan musen rör sig men blir ett enda
 * steg i historiken. Verktyget avgör vad ett klick på kartan gör.
 */
export type Tool = "SELECT" | "ADD_CONTROL" | "ADD_START" | "ADD_FINISH" | "ADD_CROSSING" | "INSERT_EXISTING" | "ADD_BEND";

export type Selection =
  | { readonly kind: "control"; readonly control: string; readonly courseControl?: string | undefined }
  | { readonly kind: "leg"; readonly from: string; readonly to: string; readonly fromCourseControl?: string | undefined;
      readonly toCourseControl?: string | undefined };

export interface EditorState {
  readonly document: CourseSettingDocument;
  readonly past: readonly CourseSettingDocument[];
  readonly future: readonly CourseSettingDocument[];
  /** `ALL_CONTROLS` eller banans id. */
  readonly view: string;
  /** Variantkod för en gafflad bana; saknas = alla grenar. */
  readonly variant?: string | undefined;
  readonly tool: Tool;
  readonly selection?: Selection | undefined;
  /** Dokumentet när en dragning började. */
  readonly dragBase?: CourseSettingDocument | undefined;
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
  return { document, past: [], future: [], view: known ? view : ALL_CONTROLS, tool: "SELECT", revision: 0 };
}

/** Ett nytt dokument utifrån (inläst .ppen, återställd version, omladdat efter konflikt): historiken börjar om. */
export function replaceDocument(state: EditorState, document: CourseSettingDocument): EditorState {
  const next = createEditor(document, state.view);
  return { ...next, tool: state.tool, revision: state.revision + 1 };
}

/** Kontrollen eller sträckan finns fortfarande i dokumentet (efter ångra eller borttagning). */
function stillThere(document: CourseSettingDocument, selection: Selection | undefined): Selection | undefined {
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
  let document = state.document, created: string | undefined;
  try {
    for (const step of steps) {
      const edit = typeof step === "function" ? step(created, document) : step;
      if (!edit) continue;
      const result = apply(document, edit);
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
  return { ...state, document, past: [...state.past, state.document].slice(-HISTORY), future: [], selection, view,
    variant: view === state.view ? state.variant : undefined, revision: state.revision + 1, error: undefined };
}

export const canUndo = (state: EditorState) => state.past.length > 0 && !state.dragBase;
export const canRedo = (state: EditorState) => state.future.length > 0 && !state.dragBase;

export function undo(state: EditorState): EditorState {
  const previous = state.past.at(-1);
  if (!previous || state.dragBase) return state;
  return { ...state, document: previous, past: state.past.slice(0, -1), future: [state.document, ...state.future].slice(0, HISTORY),
    selection: stillThere(previous, state.selection), revision: state.revision + 1, error: undefined };
}

export function redo(state: EditorState): EditorState {
  const next = state.future[0];
  if (!next || state.dragBase) return state;
  return { ...state, document: next, past: [...state.past, state.document].slice(-HISTORY), future: state.future.slice(1),
    selection: stillThere(next, state.selection), revision: state.revision + 1, error: undefined };
}

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

/** Var en ny kontroll läggs in på banan: start först, mål sist, annars efter vald kontroll (utan val: före målet). */
function insertAfter(state: EditorState, kind: ControlKind): string | null | undefined {
  if (kind === "START") return null;
  if (kind === "FINISH") return courseChain(state.document, state.view).at(-1) ?? null;
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
  const kind = state.document.controls[control]!.kind;
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
  return state.dragBase ? state : { ...state, dragBase: state.document };
}

/** Under dragningen: ändringen görs på dokumentet från dragningens början, utan historik. */
export function dragTo(state: EditorState, edit: CourseSettingEdit, apply: Apply): EditorState {
  if (!state.dragBase) return state;
  try {
    return { ...state, document: apply(state.dragBase, edit).document, error: undefined };
  } catch (error) {
    if (error instanceof CourseSettingEditError) return { ...state, error: error.message };
    throw error;
  }
}

/** Dragningen klar: ett steg i historiken (inget om inget ändrades). */
export function endDrag(state: EditorState): EditorState {
  const base = state.dragBase;
  if (!base) return state;
  if (base === state.document) return { ...state, dragBase: undefined };
  return { ...state, dragBase: undefined, past: [...state.past, base].slice(-HISTORY), future: [], revision: state.revision + 1 };
}

export function cancelDrag(state: EditorState): EditorState {
  return state.dragBase ? { ...state, document: state.dragBase, dragBase: undefined } : state;
}
