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

/** Högst så många steg sparas. */
export const HISTORY_LIMIT = 200;

/** Ett nytt eget steg: Gör om töms. */
export function recordStep(history: RevisionHistory, step: HistoryStep): RevisionHistory {
  return { undo: [...history.undo, step].slice(-HISTORY_LIMIT), redo: [] };
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
