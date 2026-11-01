import { describe, expect, it } from "vitest";
import type { CourseSettingEditsRequest, CourseSettingEditsSaved } from "@o-tid/contracts";
import {
  applyEdit, editTouches, replayEdits, touchedConflict, type CourseSettingDocument, type CourseSettingEdit, type CreatedIds
} from "@o-tid/course-setting";
import { addPoint, applySteps, createEditor, setView, undo, type EditorState } from "./course-setting-editor";
import { CourseSettingSync, EditorStore, rebaseEditor, type LostEdit } from "./course-setting-sync";
import { testDocument } from "./course-setting-test-document";

/** Steg 66: samtidigt arbete – två editorer mot en server som gör som tjänsten (uppspelning med konfliktloggen). */
class FakeServer {
  version = 1;
  touches = new Map<number, string[]>();
  constructor(public document: CourseSettingDocument) {}
  async saveEdits(request: CourseSettingEditsRequest): Promise<CourseSettingEditsSaved> {
    const rebased = request.baseVersion !== this.version;
    const touched: string[] = [];
    for (let version = request.baseVersion + 1; version <= this.version; version += 1) touched.push(...this.touches.get(version)!);
    const result = replayEdits(this.document, request.edits as CourseSettingEdit[], { created: request.created as CreatedIds[],
      conflict: rebased ? touchedConflict(touched) : undefined });
    if (result.applied.length > 0) {
      this.version += 1;
      this.document = result.document;
      this.touches.set(this.version, result.applied.flatMap(row => editTouches(row.edit)));
    }
    return { formatVersion: 1, raceId: "10000000-0000-4000-8000-000000000001", version: this.version, updatedAt: new Date().toISOString(), rebased,
      applied: result.applied.length, rejected: result.rejected.map(row => ({ index: row.index, code: row.code, message: row.message })),
      idMap: { controls: { ...result.idMap.controls }, courseControls: { ...result.idMap.courseControls }, courses: { ...result.idMap.courses } } };
  }
  async fetchSetting() { return { version: this.version, document: this.document }; }
}

/** En editor med eget sparande (timrar körs för hand). */
function client(server: FakeServer) {
  const store = new EditorStore(setView(createEditor(server.document), "k"));
  const lost: LostEdit[] = [];
  const timers: (() => void)[] = [];
  const sync = new CourseSettingSync(store, { version: server.version, document: server.document }, {
    saveEdits: request => server.saveEdits(JSON.parse(JSON.stringify(request)) as CourseSettingEditsRequest),
    fetchSetting: () => server.fetchSetting()
  }, { onStatus: () => undefined, onLost: rows => lost.push(...rows), setTimer: callback => { timers.push(callback); return timers.length; },
    clearTimer: () => undefined });
  const edit = (change: (state: EditorState) => EditorState) => { store.update(change); sync.changed(); };
  return { store, sync, lost, edit };
}

const move = (control: string, x: number, y: number): CourseSettingEdit => ({ type: "MOVE_CONTROL", control, at: { x, y } });

describe("steg 66: samtidigt arbete i editorn", () => {
  it("sparar åtgärder; utan andras ändringar är dokumentet redan serverns", async () => {
    const server = new FakeServer(testDocument());
    const a = client(server);
    a.edit(state => applySteps(state, [move("a", 11, 1)], applyEdit));
    expect(a.store.state.log).toHaveLength(1);
    await a.sync.flush();
    expect(server.version).toBe(2);
    expect(server.document.controls.a!.at).toEqual({ x: 11, y: 1 });
    expect(a.store.state.log).toHaveLength(0);
    expect(a.sync.version).toBe(2);
  });

  it("två som flyttar olika kontroller samtidigt: båda ändringarna finns kvar hos båda", async () => {
    const server = new FakeServer(testDocument());
    const a = client(server), b = client(server);
    a.edit(state => applySteps(state, [move("a", 11, 1)], applyEdit));
    b.edit(state => applySteps(state, [move("b", 21, 11)], applyEdit));
    await a.sync.flush();
    await b.sync.flush();
    expect(server.version).toBe(3);
    expect(b.store.state.document.controls.a!.at).toEqual({ x: 11, y: 1 });
    expect(b.store.state.document.controls.b!.at).toEqual({ x: 21, y: 11 });
    // B:s ångra finns kvar och ångrar bara B:s flytt.
    expect(b.store.state.past).toHaveLength(1);
    a.sync.remote(3);
    await a.sync.flush();
    expect(a.store.state.document.controls.b!.at).toEqual({ x: 21, y: 11 });
    b.edit(undo);
    await b.sync.flush();
    expect(server.document.controls.b!.at).toEqual(testDocument().controls.b!.at);
    expect(server.document.controls.a!.at).toEqual({ x: 11, y: 1 });
  });

  it("samma kontroll: den första vinner och den andra får besked, och hans ångra för det steget försvinner", async () => {
    const server = new FakeServer(testDocument());
    const a = client(server), b = client(server);
    a.edit(state => applySteps(state, [move("a", 11, 1)], applyEdit));
    b.edit(state => applySteps(state, [move("a", 30, 30)], applyEdit));
    await a.sync.flush();
    await b.sync.flush();
    expect(server.document.controls.a!.at).toEqual({ x: 11, y: 1 });
    expect(b.store.state.document.controls.a!.at).toEqual({ x: 11, y: 1 });
    expect(b.lost.map(row => row.edit.type)).toEqual(["MOVE_CONTROL"]);
    expect(b.store.state.past).toHaveLength(0);
  });

  it("nya kontroller hos båda: senare åtgärder på den egna nya kontrollen träffar rätt efter uppspelningen", async () => {
    const server = new FakeServer(testDocument());
    const a = client(server), b = client(server);
    const code = () => "77";
    a.edit(state => addPoint(state, "ADD_CONTROL", { x: 40, y: 40 }, applyEdit, code));
    b.edit(state => addPoint(state, "ADD_CONTROL", { x: 50, y: 50 }, applyEdit, () => "88"));
    const bNew = b.store.state.selection!.kind === "control" ? b.store.state.selection!.control : "";
    await a.sync.flush();
    // B flyttar sin nya kontroll innan B:s första sparning är klar (båda åtgärderna osparade).
    b.edit(state => applySteps(state, [move(bNew, 55, 55)], applyEdit));
    await b.sync.flush();
    const codes = Object.values(server.document.controls).filter(row => row.code === "77" || row.code === "88");
    expect(codes.map(row => [row.code, row.at])).toEqual(expect.arrayContaining([["77", { x: 40, y: 40 }], ["88", { x: 55, y: 55 }]]));
    expect(b.store.state.document).toEqual(server.document);
  });

  it("förslagsläget: förslaget spelas upp på andras nya version", () => {
    const base = testDocument();
    let state: EditorState = { ...setView(createEditor(base), "k"), suggesting: { base, baseVersion: 1 } };
    state = applySteps(state, [move("b", 22, 12)], applyEdit);
    const current = applyEdit(base, move("a", 12, 2)).document;
    const { state: next, lost } = rebaseEditor(state, { base, current, version: 2 });
    expect(lost).toEqual([]);
    expect(next.suggesting).toMatchObject({ baseVersion: 2 });
    expect(next.document.controls.a!.at).toEqual({ x: 12, y: 2 });
    expect(next.document.controls.b!.at).toEqual({ x: 22, y: 12 });
    expect(undo(next).document.controls.b!.at).toEqual(base.controls.b!.at);
  });
});
