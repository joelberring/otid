import type { ObjectRef } from "./contract";
import { isNewKey, sameState, type EditKind, type ObjectKey, type ObjectState, type RevisionEdit, type ServerObject } from "./state";

/**
 * ADR-0219 beslut 3–4: revideringen i telefonen eller datorn. Allt som inte är kvitterat av servern ligger i `pending` (och i
 * telefonens lager, ADR-0181 beslut 7) tills servern har svarat; först då flyttas det till `server`. En krock tas ur kön och
 * väntar på att den som ändrade senast väljer (`resolveConflict`). Ren logik utan webbläsare och nät.
 */
export interface Conflict {
  readonly key: ObjectKey;
  readonly ref: ObjectRef | null;
  /** Det egna läget (den sista egna ändringen på objektet). */
  readonly mine: ObjectState;
  /** Det som gäller på servern (den andras ändring). */
  readonly theirs: ServerObject;
}

export interface RevisionClientState {
  /** Högsta löpnumret som hämtats från servern. */
  readonly seq: number;
  /** Objekten som servern har ändrade (bara ändrade objekt; resten är som i grundfilen). */
  readonly server: Readonly<Record<ObjectKey, ServerObject>>;
  /** Egna ändringar som inte är kvitterade, i ordning. */
  readonly pending: readonly RevisionEdit[];
  readonly conflicts: Readonly<Record<ObjectKey, Conflict>>;
}

/** Serverns svar på en ändring. */
export type EditResult =
  | { readonly editId: string; readonly status: "APPLIED" | "DUPLICATE"; readonly object: ServerObject }
  | { readonly editId: string; readonly status: "CONFLICT"; readonly current: ServerObject | null }
  | { readonly editId: string; readonly status: "REJECTED"; readonly reason: string };

export const emptyClientState = (): RevisionClientState => ({ seq: 0, server: {}, pending: [], conflicts: {} });

const UNCHANGED: ObjectState = { kind: "UNCHANGED" };
const DELETED: ObjectState = { kind: "DELETED" };

/** Objektets läge som det syns: den sista egna ändringen, annars serverns, annars grundfilens (ett okänt nytt objekt finns inte). */
export function effectiveState(state: RevisionClientState, key: ObjectKey): ObjectState {
  for (let index = state.pending.length - 1; index >= 0; index -= 1) {
    const edit = state.pending[index]!;
    if (edit.key === key) return edit.state;
  }
  return state.server[key]?.state ?? (isNewKey(key) ? DELETED : UNCHANGED);
}

/** Alla objekt som inte är som i grundfilen, med sina lägen (kartan ritas med dem). */
export function effectiveObjects(state: RevisionClientState): Map<ObjectKey, { ref: ObjectRef | null; state: ObjectState }> {
  const out = new Map<ObjectKey, { ref: ObjectRef | null; state: ObjectState }>();
  for (const object of Object.values(state.server)) out.set(object.key, { ref: object.ref, state: object.state });
  for (const edit of state.pending) out.set(edit.key, { ref: edit.ref, state: edit.state });
  return out;
}

/** Id:t för objektets senaste kända ändring (egen i kön eller serverns). */
function lastEditId(state: RevisionClientState, key: ObjectKey): string | null {
  for (let index = state.pending.length - 1; index >= 0; index -= 1) {
    const edit = state.pending[index]!;
    if (edit.key === key) return edit.editId;
  }
  return state.server[key]?.lastEditId ?? null;
}

export interface NewEdit {
  readonly editId: string;
  readonly key: ObjectKey;
  readonly ref: ObjectRef | null;
  readonly state: ObjectState;
  readonly kind: EditKind;
  readonly at: string;
}

/**
 * En egen ändring läggs i kön, byggd på objektets senaste kända ändring. Ett objekt som väntar på ett val efter en krock
 * ändras inte (undefined); valet görs först.
 */
export function addEdit(state: RevisionClientState, input: NewEdit): { state: RevisionClientState; edit: RevisionEdit } | undefined {
  if (state.conflicts[input.key]) return undefined;
  const edit: RevisionEdit = { ...input, base: lastEditId(state, input.key) };
  return { state: { ...state, pending: [...state.pending, edit] }, edit };
}


export interface AcknowledgeOutcome {
  readonly state: RevisionClientState;
  /** Objekten som fick en krock i den här omgången. */
  readonly conflicted: readonly ObjectKey[];
  /** Ändringar som servern inte tog emot (fel i sig), med skälet. */
  readonly rejected: readonly { readonly edit: RevisionEdit; readonly reason: string }[];
}

/**
 * Serverns svar på en omgång. Gjorda (och redan gjorda) ändringar flyttas till `server`. Vid en krock tas objektets alla egna
 * ändringar ur kön (de byggde på varandra) och den sista blir "mitt läge" i krocken. Ändringar utan svar ligger kvar.
 */
export function acknowledge(state: RevisionClientState, results: readonly EditResult[]): AcknowledgeOutcome {
  let pending = [...state.pending];
  const server = { ...state.server };
  const conflicts = { ...state.conflicts };
  const conflicted: ObjectKey[] = [], rejected: { edit: RevisionEdit; reason: string }[] = [];
  for (const result of results) {
    const edit = pending.find(row => row.editId === result.editId);
    if (!edit) continue;
    if (result.status === "APPLIED" || result.status === "DUPLICATE") {
      pending = pending.filter(row => row.editId !== result.editId);
      const known = server[edit.key];
      if (!known || known.seq <= result.object.seq) server[edit.key] = result.object;
      continue;
    }
    if (result.status === "REJECTED") {
      pending = pending.filter(row => row.editId !== result.editId);
      rejected.push({ edit, reason: result.reason });
      continue;
    }
    const mine = effectiveState({ ...state, pending }, edit.key);
    pending = pending.filter(row => row.key !== edit.key);
    if (result.status === "CONFLICT" && result.current) {
      server[edit.key] = result.current;
      conflicts[edit.key] = { key: edit.key, ref: edit.ref, mine, theirs: result.current };
    }
    conflicted.push(edit.key);
  }
  return { state: { seq: state.seq, server, pending, conflicts }, conflicted, rejected };
}

/**
 * Det som hämtats från servern sedan `seq`. Ett objekt vars senaste ändring är en av de egna i kön har kommit fram (svaret
 * gick förlorat): de egna ändringarna till och med den tas ur kön. Ett objekt i en krock får det nya "deras läge".
 */
export function mergePulled(state: RevisionClientState, objects: readonly ServerObject[], seq: number): RevisionClientState {
  const server = { ...state.server };
  const conflicts = { ...state.conflicts };
  let pending = state.pending;
  for (const object of objects) {
    const known = server[object.key];
    if (known && known.seq >= object.seq) continue;
    server[object.key] = object;
    const own = pending.findIndex(edit => edit.editId === object.lastEditId);
    if (own >= 0) {
      const done = new Set(pending.slice(0, own + 1).filter(edit => edit.key === object.key).map(edit => edit.editId));
      pending = pending.filter(edit => !done.has(edit.editId));
    }
    const conflict = conflicts[object.key];
    if (conflict) conflicts[object.key] = { ...conflict, theirs: object };
  }
  return { seq: Math.max(state.seq, seq), server, pending, conflicts };
}

/**
 * Den som ändrade senast väljer efter en krock: "THEIRS" behåller det som gäller på servern, "MINE" skickar det egna läget
 * byggt på den andras ändring (en vanlig ändring, `RESOLVE`, som kan krocka igen om någon hinner före).
 */
export function resolveConflict(state: RevisionClientState, key: ObjectKey, keep: "MINE" | "THEIRS", editId: string, at: string)
  : { state: RevisionClientState; edit?: RevisionEdit } {
  const conflict = state.conflicts[key];
  if (!conflict) return { state };
  const conflicts = { ...state.conflicts };
  delete conflicts[key];
  const next = { ...state, conflicts };
  if (keep === "THEIRS" || sameState(conflict.mine, conflict.theirs.state)) return { state: next };
  const edit: RevisionEdit = { editId, key, ref: conflict.ref, base: conflict.theirs.lastEditId, state: conflict.mine, kind: "RESOLVE", at };
  return { state: { ...next, pending: [...next.pending, edit] }, edit };
}
