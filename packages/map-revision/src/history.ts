import { addEdit, effectiveState, type RevisionClientState } from "./client-log";
import type { ObjectRef } from "./contract";
import { sameState, type ObjectKey, type ObjectState, type RevisionEdit } from "./state";

/**
 * ADR-0219 beslut 5: Ångra och Gör om för den egna sessionen. Ett steg är en ändring av ett objekt (läget före och efter).
 * Ångra är en ny ändring som sätter tillbaka läget före, så att den synkas som allt annat. Har någon annan ändrat objektet
 * sedan (läget är inte längre det egna "efter") går steget inte att ångra: det tas bort med besked i stället för att skriva
 * över den andras ändring.
 */
export interface HistoryStep {
  readonly key: ObjectKey;
  readonly ref: ObjectRef | null;
  readonly before: ObjectState;
  readonly after: ObjectState;
  /** Steg med samma grupp hör ihop (flera markerade objekt flyttade på en gång) och ångras och görs om tillsammans. */
  readonly group?: string | undefined;
}

export interface RevisionHistory {
  readonly undo: readonly HistoryStep[];
  readonly redo: readonly HistoryStep[];
}

export const emptyHistory = (): RevisionHistory => ({ undo: [], redo: [] });

/** Högst så många steg sparas; steg i samma grupp (flera objekt ändrade på en gång) räknas som ett. */
export const HISTORY_LIMIT = 200;
/** Taket för antalet enskilda steg, så att en mycket stor grupp (en inläst grundkarta) inte växer utan gräns. */
export const HISTORY_STEP_CAP = 40_000;

/** De senaste `HISTORY_LIMIT` stegen, med grupper hela: en grupp kapas aldrig mitt i (då kunde den bara ångras till hälften). */
function trimmed(steps: readonly HistoryStep[]): HistoryStep[] {
  let units = 0, from = steps.length;
  while (from > 0) {
    const group = steps[from - 1]!.group;
    let start = from - 1;
    while (group && start > 0 && steps[start - 1]!.group === group) start -= 1;
    if (units + 1 > HISTORY_LIMIT || steps.length - start > HISTORY_STEP_CAP) break;
    units += 1; from = start;
  }
  return steps.slice(from);
}

/** Ett nytt eget steg: Gör om töms. */
export function recordStep(history: RevisionHistory, step: HistoryStep): RevisionHistory {
  return { undo: trimmed([...history.undo, step]), redo: [] };
}

/** Flera steg på en gång (samma grupp): Gör om töms. */
export function recordSteps(history: RevisionHistory, steps: readonly HistoryStep[]): RevisionHistory {
  return steps.length ? { undo: trimmed([...history.undo, ...steps]), redo: [] } : history;
}

export type HistoryOutcome =
  | { readonly kind: "done"; readonly state: RevisionClientState; readonly history: RevisionHistory; readonly edit: RevisionEdit }
  | { readonly kind: "empty" }
  /** Någon annan har ändrat objektet sedan, eller det väntar på ett val efter en krock: steget togs bort. */
  | { readonly kind: "changed"; readonly history: RevisionHistory };

function step(state: RevisionClientState, history: RevisionHistory, direction: "undo" | "redo", editId: string, at: string): HistoryOutcome {
  const from = direction === "undo" ? history.undo : history.redo;
  const top = from[from.length - 1];
  if (!top) return { kind: "empty" };
  const rest = from.slice(0, -1);
  const expected = direction === "undo" ? top.after : top.before;
  const target = direction === "undo" ? top.before : top.after;
  const dropped = direction === "undo" ? { undo: rest, redo: history.redo } : { undo: history.undo, redo: rest };
  if (!sameState(effectiveState(state, top.key), expected)) return { kind: "changed", history: dropped };
  const added = addEdit(state, { editId, key: top.key, ref: top.ref, state: target, kind: direction === "undo" ? "UNDO" : "REDO", at });
  if (!added) return { kind: "changed", history: dropped };
  const next = direction === "undo" ? { undo: rest, redo: [...history.redo, top] } : { undo: [...history.undo, top], redo: rest };
  return { kind: "done", state: added.state, history: next, edit: added.edit };
}

export const undoStep = (state: RevisionClientState, history: RevisionHistory, editId: string, at: string) => step(state, history, "undo", editId, at);
export const redoStep = (state: RevisionClientState, history: RevisionHistory, editId: string, at: string) => step(state, history, "redo", editId, at);
