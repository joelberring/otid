import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import {
  acknowledge, addEdit, baseKey, decideEdit, effectiveObjects, effectiveState, emptyClientState, emptyHistory, mergePulled, newKey, recordStep, recordSteps, redoStep,
  resolveConflict, undoStep, type EditResult, type ObjectRef, type ObjectState, type RevisionClientState, type RevisionEdit, type ServerObject
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
