import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import {
  acknowledge, addEdit, addEdits, baseKey, decideEdit, effectiveObjects, effectiveState, emptyClientState, emptyHistory, mergePulled, newKey, recordStep, recordSteps,
  redoGroup, redoStep, resolveConflict, undoGroup, undoStep, type EditResult, type NewEdit, type ObjectRef, type ObjectState, type RevisionClientState, type RevisionEdit, type ServerObject
} from "../src";

let counter = 0;
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const AT = "2026-11-03T10:00:00.000Z";
const point = (x: number, y = 0): MapObject => ({ kind: "point", symbol: "7", at: { x, y }, angle: 0 });
const moved = (x: number): ObjectState => ({ kind: "OBJECT", object: point(x) });
/** En referens till objekt nummer `ordinal` i en tänkt Mapper-fil. */
const refAt = (ordinal: number): ObjectRef => ({ fileSha256: "a".repeat(64), objectHash: "b".repeat(64),
  locator: { format: "OMAP", part: 0, ordinal, start: ordinal * 100, end: ordinal * 100 + 50 } });
const ref = refAt(4);
const KEY = baseKey(ref);

/** Servern i minnet: samma regel som tjänsten (`decideEdit`), objekt per nyckel och löpnummer. */
function server() {
  const objects = new Map<string, ServerObject>();
  const applied = new Set<string>();
  let seq = 0;
  return {
    objects,
    push(edits: readonly RevisionEdit[], author: string): EditResult[] {
      return edits.map(edit => {
        const current = objects.get(edit.key);
        const decision = decideEdit(current, edit, applied.has(edit.editId));
        if (decision === "DUPLICATE") return { editId: edit.editId, status: "DUPLICATE", object: current! };
        if (decision === "CONFLICT") return { editId: edit.editId, status: "CONFLICT", current: current ?? null };
        seq += 1;
        applied.add(edit.editId);
        const object: ServerObject = { key: edit.key, ref: edit.ref, state: edit.state, lastEditId: edit.editId, version: (current?.version ?? 0) + 1, seq,
          authorId: author, at: edit.at };
        objects.set(edit.key, object);
        return { editId: edit.editId, status: "APPLIED", object };
      });
    },
    pull(since: number) { return { seq, objects: [...objects.values()].filter(object => object.seq > since) }; }
  };
}

function edit(state: RevisionClientState, key: string, next: ObjectState, kind: RevisionEdit["kind"] = "MOVE", objectRef = key.startsWith("b:") ? ref : null) {
  const result = addEdit(state, { editId: id(), key, ref: objectRef, state: next, kind, at: AT });
  if (!result) throw new Error("väntar på val");
  return result.state;
}

function sync(state: RevisionClientState, remote: ReturnType<typeof server>, author: string) {
  const outcome = acknowledge(state, remote.push(state.pending, author));
  const pulled = remote.pull(outcome.state.seq);
  return { ...outcome, state: mergePulled(outcome.state, pulled.objects, pulled.seq) };
}

describe("serverns regel", () => {
  it("gör en ändring som bygger på objektets senaste, och krockar annars", () => {
    expect(decideEdit(undefined, { base: null }, false)).toBe("APPLY");
    expect(decideEdit(undefined, { base: id() }, false)).toBe("CONFLICT");
    const last = id();
    expect(decideEdit({ lastEditId: last }, { base: last }, false)).toBe("APPLY");
    expect(decideEdit({ lastEditId: last }, { base: null }, false)).toBe("CONFLICT");
    expect(decideEdit({ lastEditId: last }, { base: id() }, true)).toBe("DUPLICATE");
  });
});

describe("ändringsloggen", () => {
  it("synkar egna ändringar i ordning och bygger varje ändring på den förra", () => {
    const remote = server();
    let anna = edit(emptyClientState(), KEY, moved(1));
    anna = edit(anna, KEY, moved(2));
    expect(anna.pending[1]!.base).toBe(anna.pending[0]!.editId);
    const result = sync(anna, remote, "anna");
    expect(result.conflicted).toEqual([]);
    expect(result.state.pending).toEqual([]);
    expect(remote.objects.get(KEY)!.version).toBe(2);
    expect(effectiveState(result.state, KEY)).toEqual(moved(2));
  });

  it("krockar bara när två ändrar samma objekt; nya objekt krockar aldrig", () => {
    const remote = server();
    let anna = edit(emptyClientState(), KEY, moved(1));
    let bo = edit(emptyClientState(), KEY, moved(5));
    const other = baseKey(refAt(9));
    bo = edit(bo, other, moved(9), "MOVE", refAt(9));
    const added = newKey(id());
    anna = edit(anna, added, moved(3), "ADD");
    bo = edit(bo, newKey(id()), moved(4), "ADD");
    anna = sync(anna, remote, "anna").state;
    const result = sync(bo, remote, "bo");
    expect(result.conflicted).toEqual([KEY]);
    // Bos andra objekt och hans nya objekt gick igenom.
    expect(remote.objects.get(other)!.authorId).toBe("bo");
    expect([...remote.objects.values()].filter(object => object.key.startsWith("n:"))).toHaveLength(2);
    // Annas läge gäller tills Bo väljer; Bos läge finns i krocken.
    expect(result.state.conflicts[KEY]!.mine).toEqual(moved(5));
    expect(result.state.conflicts[KEY]!.theirs.state).toEqual(moved(1));
    expect(effectiveState(result.state, KEY)).toEqual(moved(1));
    expect(effectiveState(anna, added)).toEqual(moved(3));
  });

  it("den senare väljer: behåll mitt skriver över, behåll deras ändrar inget", () => {
    const remote = server();
    sync(edit(emptyClientState(), KEY, moved(1)), remote, "anna");
    const bo = sync(edit(emptyClientState(), KEY, moved(5)), remote, "bo").state;
    // Ett objekt i en krock ändras inte förrän valet är gjort.
    expect(addEdit(bo, { editId: id(), key: KEY, ref, state: moved(6), kind: "MOVE", at: AT })).toBeUndefined();

    const theirs = resolveConflict(bo, KEY, "THEIRS", id(), AT);
    expect(theirs.edit).toBeUndefined();
    expect(theirs.state.conflicts[KEY]).toBeUndefined();
    expect(effectiveState(theirs.state, KEY)).toEqual(moved(1));

    const mine = resolveConflict(bo, KEY, "MINE", id(), AT);
    expect(mine.edit?.kind).toBe("RESOLVE");
    const after = sync(mine.state, remote, "bo");
    expect(after.conflicted).toEqual([]);
    expect(remote.objects.get(KEY)!.state).toEqual(moved(5));
    expect(remote.objects.get(KEY)!.version).toBe(2);
  });

  it("en kedja av egna ändringar på ett objekt i krock blir en krock med den sista som mitt läge", () => {
    const remote = server();
    sync(edit(emptyClientState(), KEY, moved(1)), remote, "anna");
    let bo = edit(emptyClientState(), KEY, moved(5));
    bo = edit(bo, KEY, moved(6));
    bo = edit(bo, KEY, moved(7));
    const result = sync(bo, remote, "bo");
    expect(result.conflicted).toEqual([KEY]);
    expect(result.state.pending).toEqual([]);
    expect(result.state.conflicts[KEY]!.mine).toEqual(moved(7));
    expect(remote.objects.get(KEY)!.state).toEqual(moved(1));
  });

  it("samma ändring två gånger görs en gång (svaret kom aldrig fram)", () => {
    const remote = server();
    const anna = edit(emptyClientState(), KEY, moved(1));
    remote.push(anna.pending, "anna");
    // Svaret försvann: telefonen skickar igen.
    const again = acknowledge(anna, remote.push(anna.pending, "anna"));
    expect(again.state.pending).toEqual([]);
    expect(remote.objects.get(KEY)!.version).toBe(1);
  });

  it("en hämtning som visar en egen ändring tar den ur kön", () => {
    const remote = server();
    let anna = edit(emptyClientState(), KEY, moved(1));
    anna = edit(anna, baseKey(refAt(8)), moved(8), "MOVE", refAt(8));
    remote.push(anna.pending.slice(0, 1), "anna");
    const pulled = remote.pull(0);
    const merged = mergePulled(anna, pulled.objects, pulled.seq);
    expect(merged.pending.map(row => row.key)).toEqual([baseKey(refAt(8))]);
    expect(merged.seq).toBe(1);
  });

  it("andras ändringar syns efter hämtningen och de egna ändringarna bygger sedan på dem", () => {
    const remote = server();
    sync(edit(emptyClientState(), KEY, moved(1)), remote, "anna");
    let bo = sync(emptyClientState(), remote, "bo").state;
    expect(effectiveState(bo, KEY)).toEqual(moved(1));
    bo = edit(bo, KEY, moved(2));
    expect(sync(bo, remote, "bo").conflicted).toEqual([]);
    expect(effectiveObjects(bo).get(KEY)?.state).toEqual(moved(2));
  });

  it("en ändring som servern avvisar tas ur kön med skälet", () => {
    const anna = edit(emptyClientState(), KEY, moved(1));
    const outcome = acknowledge(anna, [{ editId: anna.pending[0]!.editId, status: "REJECTED", reason: "state" }]);
    expect(outcome.state.pending).toEqual([]);
    expect(outcome.rejected[0]!.reason).toBe("state");
  });
});

describe("Ångra och Gör om", () => {
  it("ångrar och gör om som nya ändringar", () => {
    let state = edit(emptyClientState(), KEY, moved(1));
    let history = recordStep(emptyHistory(), { key: KEY, ref, before: { kind: "UNCHANGED" }, after: moved(1) });
    const undone = undoStep(state, history, id(), AT);
    if (undone.kind !== "done") throw new Error(undone.kind);
    expect(undone.edit.kind).toBe("UNDO");
    expect(effectiveState(undone.state, KEY)).toEqual({ kind: "UNCHANGED" });
    state = undone.state; history = undone.history;
    const redone = redoStep(state, history, id(), AT);
    if (redone.kind !== "done") throw new Error(redone.kind);
    expect(effectiveState(redone.state, KEY)).toEqual(moved(1));
    expect(redoStep(redone.state, redone.history, id(), AT).kind).toBe("empty");
  });

  it("skriver inte över någon annans ändring", () => {
    const remote = server();
    let anna = sync(edit(emptyClientState(), KEY, moved(1)), remote, "anna").state;
    const history = recordStep(emptyHistory(), { key: KEY, ref, before: { kind: "UNCHANGED" }, after: moved(1) });
    const bo = sync(emptyClientState(), remote, "bo").state;
    sync(edit(bo, KEY, moved(9)), remote, "bo");
    anna = sync(anna, remote, "anna").state;
    const outcome = undoStep(anna, history, id(), AT);
    expect(outcome.kind).toBe("changed");
    expect(outcome.kind === "changed" && outcome.history.undo).toEqual([]);
  });
});

describe("historikens gräns", () => {
  const stepOf = (index: number, group?: string) => ({ key: newKey(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`), ref: null,
    before: { kind: "UNCHANGED" as const }, after: { kind: "DELETED" as const }, ...(group ? { group } : {}) });

  it("en grupp räknas som ett steg och kapas aldrig mitt i", () => {
    // En inläst grundkarta på 1 000 objekt, och sedan 150 egna steg: allt är kvar.
    let history = recordSteps(emptyHistory(), Array.from({ length: 1000 }, (_, index) => stepOf(index, "import")));
    expect(history.undo).toHaveLength(1000);
    for (let index = 0; index < 150; index += 1) history = recordStep(history, stepOf(2000 + index));
    expect(history.undo).toHaveLength(1150);
    // Efter 200 egna steg faller hela gruppen bort på en gång, inte en bit av den.
    for (let index = 0; index < 50; index += 1) history = recordStep(history, stepOf(3000 + index));
    expect(history.undo).toHaveLength(200);
    expect(history.undo.every(row => row.group === undefined)).toBe(true);
    expect(recordSteps(history, [])).toBe(history);
  });
});

describe("referensbevarande och batch-API (Etapp P3)", () => {
  it("acknowledge och mergePulled returnerar exakt samma state-referens vid 0 ändringar", () => {
    const remote = server();
    const state = sync(edit(emptyClientState(), KEY, moved(1)), remote, "anna").state;
    const ackEmpty = acknowledge(state, []);
    expect(ackEmpty.state).toBe(state);
    expect(ackEmpty).toEqual({ state, conflicted: [], rejected: [], proposed: [] });

    const ackUnknown = acknowledge(state, [{ editId: id(), status: "REJECTED", reason: "missing" }]);
    expect(ackUnknown.state).toBe(state);

    expect(mergePulled(state, [], state.seq)).toBe(state);
    expect(mergePulled(state, [], state.seq - 1)).toBe(state);

    // Äldre/redan känt objekt med oförändrad seq ger också samma state-referens.
    const sameServerObj = remote.objects.get(KEY)!;
    expect(mergePulled(state, [sameServerObj], state.seq)).toBe(state);

    // Ny högre seq utan objekt uppdaterar bara seq.
    const bumped = mergePulled(state, [], state.seq + 5);
    expect(bumped).not.toBe(state);
    expect(bumped.seq).toBe(state.seq + 5);
    expect(bumped.server).toBe(state.server);
    expect(bumped.pending).toBe(state.pending);
  });

  it("addEdits ger identiskt resultat som sekventiell effectiveState + addEdit i O(P + M)", () => {
    const remote = server();
    // Skapa en krock på KEY så vi verifierar att krockade nycklar hoppas över.
    sync(edit(emptyClientState(), KEY, moved(1)), remote, "anna");
    const baseState = sync(edit(emptyClientState(), KEY, moved(5)), remote, "bo").state;
    const key2 = baseKey(refAt(2));
    const key3 = newKey(id());
    const seedState = edit(baseState, key2, moved(10), "MOVE", refAt(2));

    const inputs: NewEdit[] = [
      { editId: id(), key: KEY, ref, state: moved(99), kind: "MOVE", at: AT }, // i krock -> hoppas över
      { editId: id(), key: key2, ref: refAt(2), state: moved(11), kind: "MOVE", at: AT },
      { editId: id(), key: key2, ref: refAt(2), state: moved(12), kind: "MOVE", at: AT, point: { x: 1, y: 2 } },
      { editId: id(), key: key3, ref: null, state: moved(20), kind: "ADD", at: AT },
      ...Array.from({ length: 200 }, (_, i): NewEdit => ({
        editId: id(), key: newKey(`00000000-0000-4000-8000-${String(5000 + i).padStart(12, "0")}`),
        ref: null, state: moved(i), kind: "ADD", at: AT
      }))
    ];

    // Referens: sekventiell effectiveState + addEdit
    let seqState = seedState;
    const seqEntries: { edit: RevisionEdit; before: ObjectState }[] = [];
    for (const input of inputs) {
      const before = effectiveState(seqState, input.key);
      const added = addEdit(seqState, input);
      if (!added) continue;
      seqState = added.state;
      seqEntries.push({ edit: added.edit, before });
    }

    const batched = addEdits(seedState, inputs);
    expect(batched.state).toEqual(seqState);
    expect(batched.edits).toEqual(seqEntries.map(row => row.edit));
    expect(batched.entries).toEqual(seqEntries);

    // Tom eller bara krockade nycklar returnerar oförändrad state-referens.
    expect(addEdits(seedState, []).state).toBe(seedState);
    expect(addEdits(seedState, [{ editId: id(), key: KEY, ref, state: moved(77), kind: "MOVE", at: AT }]).state).toBe(seedState);
  });

  it("undoGroup och redoGroup ger identiskt resultat som loopad undoStep/redoStep för hel grupp", () => {
    const keys = Array.from({ length: 50 }, (_, i) => newKey(`00000000-0000-4000-8000-${String(8000 + i).padStart(12, "0")}`));
    const inputs: NewEdit[] = [
      ...keys.map((key, i): NewEdit => ({ editId: id(), key, ref: null, state: moved(i), kind: "ADD", at: AT })),
      // Upprepad ändring av samma objekt i samma grupp
      { editId: id(), key: keys[0]!, ref: null, state: moved(999), kind: "MOVE", at: AT }
    ];
    const added = addEdits(emptyClientState(), inputs);
    const history = recordSteps(emptyHistory(), added.entries.map(({ edit: e, before }) => ({
      key: e.key, ref: e.ref, before, after: e.state, group: "batch-1"
    })));
    // Simulera att ett objekt (keys[5]) ändrats av någon annan på servern så det steget får kind === "changed".
    const changedState: RevisionClientState = {
      ...added.state,
      pending: added.state.pending.filter(e => e.key !== keys[5]),
      server: { ...added.state.server, [keys[5]!]: { key: keys[5]!, ref: null, state: moved(555), lastEditId: id(), version: 2, seq: 10, authorId: "other", at: AT } }
    };

    // Referens: loopad undoStep + redoStep med deterministiska edit-id:n
    let n1 = 0;
    const next1 = () => `u-${++n1}`;
    let refState = changedState, refHistory = history, refChanged = false;
    const refUndoEdits: RevisionEdit[] = [];
    while (refHistory.undo.at(-1)?.group === "batch-1") {
      const outcome = undoStep(refState, refHistory, next1(), AT);
      if (outcome.kind === "empty") break;
      refHistory = outcome.history;
      if (outcome.kind === "changed") refChanged = true;
      else { refState = outcome.state; refUndoEdits.push(outcome.edit); }
    }

    // Batchad undoGroup med samma id-generator (notera att changed-steg inte konsumerar id i undoGroup, så jämför bortsett från id)
    let n2 = 0;
    const next2 = () => `b-${++n2}`;
    const grpUndo = undoGroup(changedState, history, next2, AT);
    expect(grpUndo.changed).toBe(refChanged);
    expect(grpUndo.history).toEqual(refHistory);
    expect(grpUndo.edits.map(({ key, kind, state }) => ({ key, kind, state }))).toEqual(refUndoEdits.map(({ key, kind, state }) => ({ key, kind, state })));
    expect(grpUndo.state.pending.map(({ key, kind, state }) => ({ key, kind, state })))
      .toEqual(refState.pending.map(({ key, kind, state }) => ({ key, kind, state })));
    expect(effectiveState(grpUndo.state, keys[0]!)).toEqual({ kind: "DELETED" });
    expect(effectiveState(grpUndo.state, keys[5]!)).toEqual(moved(555));

    // Gör om hela gruppen
    const grpRedo = redoGroup(grpUndo.state, grpUndo.history, next2, AT);
    expect(grpRedo.changed).toBe(false);
    expect(grpRedo.history.redo).toEqual([]);
    expect(grpRedo.history.undo).toHaveLength(50);
    expect(effectiveState(grpRedo.state, keys[0]!)).toEqual(moved(999));

    // Tom historik ger oförändrade referenser
    const emptyRes = undoGroup(changedState, emptyHistory(), next2, AT);
    expect(emptyRes.state).toBe(changedState);
    expect(emptyRes.edits).toEqual([]);
  });

  it("acknowledge och mergePulled hanterar stora blandade batcher korrekt (O(P + R) / O(P + N))", () => {
    let state = emptyClientState();
    const batchInputs: NewEdit[] = [];
    for (let i = 0; i < 60; i += 1) {
      const r = refAt(100 + i);
      batchInputs.push({ editId: id(), key: baseKey(r), ref: r, state: moved(i), kind: "MOVE", at: AT });
    }
    // Kedja på objekt 0 (ska få conflict)
    const r0 = refAt(100);
    batchInputs.push({ editId: id(), key: baseKey(r0), ref: r0, state: moved(999), kind: "MOVE", at: AT });
    state = addEdits(state, batchInputs).state;

    const p = state.pending;
    const conflictServer: ServerObject = { key: p[0]!.key, ref: r0, state: moved(-1), lastEditId: id(), version: 2, seq: 50, authorId: "other", at: AT };
    const appliedServer: ServerObject = { key: p[1]!.key, ref: refAt(101), state: p[1]!.state, lastEditId: p[1]!.editId, version: 1, seq: 51, authorId: "me", at: AT };
    const ack = acknowledge(state, [
      { editId: p[0]!.editId, status: "CONFLICT", current: conflictServer },
      { editId: p[60]!.editId, status: "CONFLICT", current: conflictServer }, // redan borttagen av första krocken på samma key
      { editId: p[1]!.editId, status: "APPLIED", object: appliedServer },
      { editId: p[2]!.editId, status: "PROPOSED", proposalId: "prop-1" },
      { editId: p[3]!.editId, status: "REJECTED", reason: "invalid" }
    ]);
    expect(ack.conflicted).toEqual([p[0]!.key]);
    expect(ack.state.conflicts[p[0]!.key]!.mine).toEqual(moved(999));
    expect(ack.proposed).toEqual([p[2]!.key]);
    expect(ack.state.proposed?.[p[2]!.key]?.proposalId).toBe("prop-1");
    expect(ack.rejected).toHaveLength(1);
    expect(ack.state.pending).toHaveLength(56);

    // mergePulled tar bort egen ändring ur pending och uppdaterar krockens theirs.
    const ownPulled: ServerObject = { key: p[4]!.key, ref: refAt(104), state: p[4]!.state, lastEditId: p[4]!.editId, version: 1, seq: 52, authorId: "me", at: AT };
    const conflictUpdated: ServerObject = { ...conflictServer, state: moved(-2), seq: 53 };
    const merged = mergePulled(ack.state, [ownPulled, conflictUpdated], 53);
    expect(merged.seq).toBe(53);
    expect(merged.pending).toHaveLength(55);
    expect(merged.pending.some(e => e.editId === p[4]!.editId)).toBe(false);
    expect(merged.conflicts[p[0]!.key]!.theirs).toEqual(conflictUpdated);
  });
});
