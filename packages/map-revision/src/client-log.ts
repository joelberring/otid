import type { Point } from "@o-tid/map-file";
import type { ObjectRef } from "./contract";
import { isNewKey, sameState, type EditKind, type ObjectKey, type ObjectState, type RevisionEdit, type ServerObject } from "./state";

/**
 * ADR-0219 beslut 3–4: revideringen i telefonen eller datorn. Allt som inte är kvitterat av servern ligger i `pending` (och i
 * telefonens lager, ADR-0181 beslut 7) tills servern har svarat; först då flyttas det till `server`. En krock tas ur kön och
 * väntar på att den som ändrade senast väljer (`resolveConflict`). En ändring som servern gjort till ett förslag (K1, `editRoute`)
 * tas ur kön och ligger i `proposed` tills förslaget är avgjort (`keepOpenProposals`); den syns inte i `effectiveState`.
 * Ren logik utan webbläsare och nät.
 */
export interface Conflict {
  readonly key: ObjectKey;
  readonly ref: ObjectRef | null;
  /** Det egna läget (den sista egna ändringen på objektet). */
  readonly mine: ObjectState;
  /** Det som gäller på servern (den andras ändring). */
  readonly theirs: ServerObject;
}

/** En egen ändring som blev ett förslag (ritas streckad ovanpå kartan). */
export interface ProposedEdit {
  readonly proposalId: string;
  readonly state: ObjectState;
  readonly ref: ObjectRef | null;
}

export interface RevisionClientState {
  /** Högsta löpnumret som hämtats från servern. */
  readonly seq: number;
  /** Objekten som servern har ändrade (bara ändrade objekt; resten är som i grundfilen). */
  readonly server: Readonly<Record<ObjectKey, ServerObject>>;
  /** Egna ändringar som inte är kvitterade, i ordning. */
  readonly pending: readonly RevisionEdit[];
  readonly conflicts: Readonly<Record<ObjectKey, Conflict>>;
  /** Egna ändringar som blev förslag och väntar på en ägare. Saknas i lagrade lägen från före K1 (= tomt). */
  readonly proposed?: Readonly<Record<ObjectKey, ProposedEdit>>;
}

/** Serverns svar på en ändring. */
export type EditResult =
  | { readonly editId: string; readonly status: "APPLIED" | "DUPLICATE"; readonly object: ServerObject }
  | { readonly editId: string; readonly status: "CONFLICT"; readonly current: ServerObject | null }
  | { readonly editId: string; readonly status: "REJECTED"; readonly reason: string }
  /** Ändringen gjordes inte utan blev (eller var redan) en del av förslaget `proposalId`. */
  | { readonly editId: string; readonly status: "PROPOSED"; readonly proposalId: string };

export const emptyClientState = (): RevisionClientState => ({ seq: 0, server: {}, pending: [], conflicts: {}, proposed: {} });

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
  /** Var ändringen gjordes (kartans mm), för en borttagning av grundfilens objekt (delområdena, ADR-0219). */
  readonly point?: Point | undefined;
}

export interface AddedEdit {
  readonly edit: RevisionEdit;
  /** Objektets läge precis före den här ändringen (för historikens `before`). */
  readonly before: ObjectState;
}

export interface AddEditsOutcome {
  readonly state: RevisionClientState;
  readonly edits: readonly RevisionEdit[];
  /** De tillagda ändringarna med läget före varje ändring, i samma ordning som `edits`. */
  readonly entries: readonly AddedEdit[];
}

/**
 * En egen ändring läggs i kön, byggd på objektets senaste kända ändring. Ett objekt som väntar på ett val efter en krock
 * ändras inte (undefined); valet görs först.
 */
export function addEdit(state: RevisionClientState, input: NewEdit): { state: RevisionClientState; edit: RevisionEdit } | undefined {
  if (state.conflicts[input.key]) return undefined;
  const { point, ...rest } = input;
  const edit: RevisionEdit = { ...rest, ...(point ? { point } : {}), base: lastEditId(state, input.key) };
  return { state: { ...state, pending: [...state.pending, edit] }, edit };
}

/**
 * Många egna ändringar i ett svep (O(P + M) i stället för O(M²)): varje ändring bygger på objektets senaste kända ändring
 * (inklusive tidigare ändringar i samma bunt) och objekt i krock hoppas över. Returnerar oförändrad `state` när inget lades till.
 */
export function addEdits(state: RevisionClientState, inputs: readonly NewEdit[]): AddEditsOutcome {
  if (inputs.length === 0) return { state, edits: [], entries: [] };
  const latest = new Map<ObjectKey, RevisionEdit>();
  for (const row of state.pending) latest.set(row.key, row);
  const edits: RevisionEdit[] = [];
  const entries: AddedEdit[] = [];
  for (const input of inputs) {
    if (state.conflicts[input.key]) continue;
    const prev = latest.get(input.key);
    const serverObject = prev ? undefined : state.server[input.key];
    const base = prev ? prev.editId : (serverObject?.lastEditId ?? null);
    const before = prev ? prev.state : (serverObject?.state ?? (isNewKey(input.key) ? DELETED : UNCHANGED));
    const { point, ...rest } = input;
    const edit: RevisionEdit = { ...rest, ...(point ? { point } : {}), base };
    latest.set(input.key, edit);
    edits.push(edit);
    entries.push({ edit, before });
  }
  if (edits.length === 0) return { state, edits, entries };
  return { state: { ...state, pending: state.pending.concat(edits) }, edits, entries };
}


export interface AcknowledgeOutcome {
  readonly state: RevisionClientState;
  /** Objekten som fick en krock i den här omgången. */
  readonly conflicted: readonly ObjectKey[];
  /** Ändringar som servern inte tog emot (fel i sig), med skälet. */
  readonly rejected: readonly { readonly edit: RevisionEdit; readonly reason: string }[];
  /** Objekten vars ändring blev ett förslag i den här omgången. */
  readonly proposed: readonly ObjectKey[];
}

/**
 * Serverns svar på en omgång. Gjorda (och redan gjorda) ändringar flyttas till `server`. Vid en krock tas objektets alla egna
 * ändringar ur kön (de byggde på varandra) och den sista blir "mitt läge" i krocken. Ändringar utan svar ligger kvar.
 */
export function acknowledge(state: RevisionClientState, results: readonly EditResult[]): AcknowledgeOutcome {
  if (results.length === 0) {
    return { state: state.proposed ? state : { ...state, proposed: {} }, conflicted: [], rejected: [], proposed: [] };
  }
  const byId = new Map<string, RevisionEdit>();
  for (const row of state.pending) if (!byId.has(row.editId)) byId.set(row.editId, row);
  let byKey: Map<ObjectKey, RevisionEdit[]> | undefined;
  let server: Record<ObjectKey, ServerObject> | undefined;
  let conflicts: Record<ObjectKey, Conflict> | undefined;
  let proposed: Record<ObjectKey, ProposedEdit> | undefined;
  const removedIds = new Set<string>();
  const removedKeys = new Set<ObjectKey>();
  const conflicted: ObjectKey[] = [], rejected: { edit: RevisionEdit; reason: string }[] = [], suggested: ObjectKey[] = [];
  for (const result of results) {
    const edit = byId.get(result.editId);
    if (!edit || removedIds.has(result.editId) || removedKeys.has(edit.key)) continue;
    if (result.status === "APPLIED" || result.status === "DUPLICATE") {
      removedIds.add(result.editId);
      const known = (server ?? state.server)[edit.key];
      if (!known || known.seq <= result.object.seq) {
        if (!server) server = { ...state.server };
        server[edit.key] = result.object;
      }
      continue;
    }
    if (result.status === "PROPOSED") {
      removedIds.add(result.editId);
      if (!proposed) proposed = { ...state.proposed };
      proposed[edit.key] = { proposalId: result.proposalId, state: edit.state, ref: edit.ref };
      suggested.push(edit.key);
      continue;
    }
    if (result.status === "REJECTED") {
      removedIds.add(result.editId);
      rejected.push({ edit, reason: result.reason });
      continue;
    }
    if (!byKey) {
      byKey = new Map();
      for (const row of state.pending) {
        let list = byKey.get(row.key);
        if (!list) { list = []; byKey.set(row.key, list); }
        list.push(row);
      }
    }
    const keyEdits = byKey.get(edit.key)!;
    let mine: ObjectState = edit.state;
    for (let index = keyEdits.length - 1; index >= 0; index -= 1) {
      const row = keyEdits[index]!;
      if (!removedIds.has(row.editId)) { mine = row.state; break; }
    }
    removedKeys.add(edit.key);
    if (result.status === "CONFLICT" && result.current) {
      if (!server) server = { ...state.server };
      if (!conflicts) conflicts = { ...state.conflicts };
      server[edit.key] = result.current;
      conflicts[edit.key] = { key: edit.key, ref: edit.ref, mine, theirs: result.current };
    }
    conflicted.push(edit.key);
  }
  if (removedIds.size === 0 && removedKeys.size === 0) {
    return { state: state.proposed ? state : { ...state, proposed: {} }, conflicted, rejected, proposed: suggested };
  }
  const pending = state.pending.filter(row => !removedIds.has(row.editId) && !removedKeys.has(row.key));
  return {
    state: {
      ...state,
      server: server ?? state.server,
      pending,
      conflicts: conflicts ?? state.conflicts,
      proposed: proposed ?? state.proposed ?? {}
    },
    conflicted,
    rejected,
    proposed: suggested
  };
}

/**
 * Det som hämtats från servern sedan `seq`. Ett objekt vars senaste ändring är en av de egna i kön har kommit fram (svaret
 * gick förlorat): de egna ändringarna till och med den tas ur kön. Ett objekt i en krock får det nya "deras läge".
 */
export function mergePulled(state: RevisionClientState, objects: readonly ServerObject[], seq: number): RevisionClientState {
  const nextSeq = Math.max(state.seq, seq);
  if (objects.length === 0) return nextSeq === state.seq ? state : { ...state, seq: nextSeq };
  let server: Record<ObjectKey, ServerObject> | undefined;
  let conflicts: Record<ObjectKey, Conflict> | undefined;
  let pendingIndex: Map<string, number> | undefined;
  if (state.pending.length > 0) {
    pendingIndex = new Map();
    for (let index = 0; index < state.pending.length; index += 1) {
      const editId = state.pending[index]!.editId;
      if (!pendingIndex.has(editId)) pendingIndex.set(editId, index);
    }
  }
  let dropUpTo: Map<ObjectKey, number> | undefined;
  for (const object of objects) {
    const known = (server ?? state.server)[object.key];
    if (known && known.seq >= object.seq) continue;
    if (!server) server = { ...state.server };
    server[object.key] = object;
    const own = pendingIndex?.get(object.lastEditId);
    if (own !== undefined) {
      const prev = dropUpTo?.get(object.key);
      if (prev === undefined || own > prev) {
        if (!dropUpTo) dropUpTo = new Map();
        dropUpTo.set(object.key, own);
      }
    }
    const conflict = (conflicts ?? state.conflicts)[object.key];
    if (conflict) {
      if (!conflicts) conflicts = { ...state.conflicts };
      conflicts[object.key] = { ...conflict, theirs: object };
    }
  }
  if (!server && nextSeq === state.seq) return state;
  const pending = dropUpTo
    ? state.pending.filter((edit, index) => {
        const cut = dropUpTo.get(edit.key);
        return cut === undefined || index > cut;
      })
    : state.pending;
  return { ...state, seq: nextSeq, server: server ?? state.server, pending, conflicts: conflicts ?? state.conflicts };
}

/**
 * Synkens svar har de egna förslagen som fortfarande är öppna (`openProposals`): de andra är avgjorda (godkända ändringar
 * kommer som vanliga objekt i hämtningen) och tas bort ur `proposed`.
 */
export function keepOpenProposals(state: RevisionClientState, openProposalIds: readonly string[]): RevisionClientState {
  const open = new Set(openProposalIds);
  const entries = Object.entries(state.proposed ?? {});
  const kept = entries.filter(([, value]) => open.has(value.proposalId));
  return kept.length === entries.length && state.proposed ? state : { ...state, proposed: Object.fromEntries(kept) };
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
