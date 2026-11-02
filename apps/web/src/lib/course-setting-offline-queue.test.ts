import { describe, expect, it } from "vitest";
import type { CourseSettingEditsRequest, CourseSettingEditsSaved, CourseSettingState } from "@o-tid/contracts";
import { applyEdit, replayEdits, type CourseSettingDocument, type CourseSettingEdit, type CreatedIds } from "@o-tid/course-setting";
import { applySteps, createEditor, setView } from "./course-setting-editor";
import {
  drainQueue, memoryFieldStore, recordToKeep, RecordWriter, remapQueue, remapQueuedItem, type FieldStore, type QueuedItem, type QueueTransport
} from "./course-setting-offline";
import { CourseSettingSync, EditorStore, HttpStatusError } from "./course-setting-sync";
import { testDocument } from "./course-setting-test-document";

const raceId = "10000000-0000-4000-8000-000000000001";
const me = { accountId: "20000000-0000-4000-8000-000000000002", displayName: "Bea" };

/** Servern: åtgärderna som tjänsten, notiser och bockar som avvisas (409) när kontrollen inte finns. */
class Server {
  version = 1;
  online = false;
  readonly notes: { control: string; text: string }[] = [];
  readonly checked = new Set<string>();
  constructor(public document: CourseSettingDocument) {}
  async saveEdits(request: CourseSettingEditsRequest): Promise<CourseSettingEditsSaved> {
    if (!this.online) throw new TypeError("Failed to fetch");
    const result = replayEdits(this.document, request.edits as CourseSettingEdit[], { created: request.created as CreatedIds[] });
    if (result.applied.length > 0) { this.version += 1; this.document = result.document; }
    return { formatVersion: 1, raceId, version: this.version, updatedAt: new Date().toISOString(), rebased: request.baseVersion !== this.version - 1,
      applied: result.applied.length, rejected: result.rejected.map(row => ({ index: row.index, code: row.code, message: row.message })),
      idMap: { controls: { ...result.idMap.controls }, courseControls: { ...result.idMap.courseControls }, courses: { ...result.idMap.courses } } };
  }
  async fetchSetting() { if (!this.online) throw new TypeError("Failed to fetch"); return { version: this.version, document: this.document }; }
  readonly transport: QueueTransport = {
    note: async (_race, request) => {
      if (!this.online) throw new TypeError("Failed to fetch");
      const target = request.target;
      if (target.kind !== "CONTROL") throw new Error("bara kontroller i testet");
      if (!this.document.controls[target.control]) throw new HttpStatusError(409);
      this.notes.push({ control: target.control, text: request.text });
    },
    inspection: async (_race, request) => {
      if (!this.online) throw new TypeError("Failed to fetch");
      if (!this.document.controls[request.control]) throw new HttpStatusError(409);
      this.checked.add(request.control);
    },
    deleteNote: async () => undefined
  };
}

/** En telefon med editor, sparande och egen kö, kopplade som sidan gör det (`useCourseSettingOffline`). */
function phone(server: Server) {
  const store = new EditorStore(setView(createEditor(server.document), "k"));
  const field = memoryFieldStore();
  const sync = new CourseSettingSync(store, { version: server.version, document: server.document }, {
    saveEdits: request => server.saveEdits(JSON.parse(JSON.stringify(request)) as CourseSettingEditsRequest),
    fetchSetting: () => server.fetchSetting()
  }, { onStatus: () => undefined, onLost: () => undefined, setTimer: () => 0, clearTimer: () => undefined });
  const remaps: Promise<unknown>[] = [];
  sync.listenIds((map, gone) => { remaps.push(remapQueue(field, raceId, map, gone)); });
  /** Ny kontroll utan nät; ger editorns id för den. */
  const addControl = (x: number, y: number) => {
    const before = new Set(Object.keys(store.state.document.controls));
    store.update(state => applySteps(state, [{ type: "ADD_CONTROL", kind: "NORMAL", at: { x, y } }], applyEdit));
    sync.changed();
    return Object.keys(store.state.document.controls).find(id => !before.has(id))!;
  };
  const queueNote = (control: string, text: string) => field.addQueued({ id: crypto.randomUUID(), raceId, kind: "note",
    createdAt: new Date().toISOString(), request: { requestId: crypto.randomUUID(), target: { kind: "CONTROL", control }, at: null, course: null,
      text, photo: null } });
  const queueCheck = (control: string) => field.addQueued({ id: crypto.randomUUID(), raceId, kind: "inspection", createdAt: new Date().toISOString(),
    request: { formatVersion: 1, control, checked: true, at: new Date().toISOString(), position: null } });
  /** Nätet är tillbaka: först ändringarna, sedan kön (med id översatta). */
  const online = async () => {
    await sync.flush();
    await Promise.all(remaps);
    expect(sync.dirty).toBe(false);
    return drainQueue(field, raceId, server.transport);
  };
  return { store, sync, field, addControl, queueNote, queueCheck, online };
}

describe("översynen 2026-11-02: telefonens kö översätter id", () => {
  it("två skapar var sin kontroll utan nät med samma lokala id; notiser och bockar hamnar på rätt kontroll", async () => {
    const server = new Server(testDocument());
    const anna = phone(server), bo = phone(server);
    const annasControl = anna.addControl(40, 40);
    const bosControl = bo.addControl(80, 80);
    expect(annasControl).toBe(bosControl);
    await anna.queueNote(annasControl, "Annas sten");
    await anna.queueCheck(annasControl);
    await bo.queueNote(bosControl, "Bos höjd");
    await bo.queueCheck(bosControl);

    server.online = true;
    const first = await anna.online();
    expect(first.rejected).toEqual([]);
    const second = await bo.online();
    expect(second.rejected).toEqual([]);

    const at = (id: string) => server.document.controls[id]!.at;
    const annas = server.notes.find(row => row.text === "Annas sten")!, bos = server.notes.find(row => row.text === "Bos höjd")!;
    expect(at(annas.control)).toEqual({ x: 40, y: 40 });
    expect(at(bos.control)).toEqual({ x: 80, y: 80 });
    expect(annas.control).not.toBe(bos.control);
    expect([...server.checked].map(at).sort((a, b) => a.x - b.x)).toEqual([{ x: 40, y: 40 }, { x: 80, y: 80 }]);
    // Bos editor har också fått serverns id.
    expect(bo.store.state.document.controls[bos.control]!.at).toEqual({ x: 80, y: 80 });
  });

  it("översättningen görs på en gång (57 → 58 och 58 → 59 byter inte två gånger) och det som aldrig kom fram tas ur kön", async () => {
    const note = (control: string): QueuedItem => ({ id: control, raceId, kind: "note", createdAt: "2026-11-02T10:00:00.000Z",
      request: { requestId: crypto.randomUUID(), target: { kind: "CONTROL", control }, at: null, course: null, text: control, photo: null } });
    const map = { controls: { 57: "58", 58: "59" }, courseControls: {}, courses: {} };
    expect((remapQueuedItem(note("57"), map) as Extract<QueuedItem, { kind: "note" }>).request.target).toEqual({ kind: "CONTROL", control: "58" });
    expect((remapQueuedItem(note("58"), map) as Extract<QueuedItem, { kind: "note" }>).request.target).toEqual({ kind: "CONTROL", control: "59" });
    expect(remapQueuedItem(note("60"), map, { controls: ["60"], courses: [] })).toBe("gone");
    const store = memoryFieldStore();
    for (const id of ["57", "58", "60"]) await store.addQueued(note(id));
    const removed = await remapQueue(store, raceId, map, { controls: ["60"], courses: [] });
    expect(removed.map(item => item.id)).toEqual(["60"]);
    expect((await store.listQueue(raceId)).map(item => item.kind === "note" && item.request.target.kind === "CONTROL" ? item.request.target.control : ""))
      .toEqual(["58", "59"]);
  });
});

function state(document: CourseSettingDocument, version: number): CourseSettingState & { setting: NonNullable<CourseSettingState["setting"]> } {
  return { formatVersion: 1, raceId, access: { ...me, level: "EDIT", admin: true },
    setting: { version, updatedAt: new Date().toISOString(), updatedBy: me, mode: "LEAD", document: document as never },
    original: null, mapFile: null };
}

describe("översynen 2026-11-02: posten i telefonen", () => {
  /** Ett lager som räknar skrivningarna och kan bli fullt. */
  function counting(): FieldStore & { bases: number; logs: number; full: boolean } {
    const inner = memoryFieldStore();
    const store = { ...inner, bases: 0, logs: 0, full: false,
      writeRecord: async (record: Parameters<FieldStore["writeRecord"]>[0], withBase: boolean) => {
        if (store.full) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        if (withBase) store.bases += 1;
        store.logs += 1;
        await inner.writeRecord(record, withBase);
      } };
    return store;
  }
  const move = (x: number): CourseSettingEdit => ({ type: "MOVE_CONTROL", control: "a", at: { x, y: 0 } });

  it("grunden skrivs bara när den ändrats; loggen efter varje ändring; posten läses tillbaka med dokumentet", async () => {
    const store = counting();
    const results: unknown[] = [];
    const writer = new RecordWriter(store, error => results.push(error));
    const base = testDocument(), current = state(base, 1);
    let editor = setView(createEditor(base), "k");
    for (let x = 1; x <= 5; x += 1) {
      editor = applySteps(editor, [move(x)], applyEdit);
      const record = recordToKeep({ raceId, state: current, version: 1, base, document: editor.document, log: editor.log, offline: false, now: new Date() });
      expect(await writer.write(raceId, record, { version: 1, parts: [base, current] })).toBe(true);
    }
    expect(store.bases).toBe(1);
    expect(store.logs).toBe(5);
    const read = await store.readRecord(raceId);
    expect(read!.log).toHaveLength(5);
    expect(read!.document).toEqual(editor.document);
    // En ny version: grunden skrivs igen.
    const newer = applyEdit(base, move(5)).document;
    await writer.write(raceId, recordToKeep({ raceId, state: state(newer, 2), version: 2, base: newer, document: newer, log: [], offline: true,
      now: new Date() }), { version: 2, parts: [newer, current] });
    expect(store.bases).toBe(2);
    expect(results.every(result => result === undefined)).toBe(true);
  });

  it("lagringsfel (full lagring): rapporteras, och nästa skrivning tar med grunden igen", async () => {
    const store = counting();
    const results: unknown[] = [];
    const writer = new RecordWriter(store, error => results.push(error));
    const base = testDocument(), current = state(base, 1);
    const editor = applySteps(setView(createEditor(base), "k"), [move(3)], applyEdit);
    const record = recordToKeep({ raceId, state: current, version: 1, base, document: editor.document, log: editor.log, offline: false, now: new Date() });
    store.full = true;
    expect(await writer.write(raceId, record, { version: 1, parts: [base, current] })).toBe(false);
    expect((results[0] as DOMException).name).toBe("QuotaExceededError");
    store.full = false;
    expect(await writer.write(raceId, record, { version: 1, parts: [base, current] })).toBe(true);
    expect(store.bases).toBe(1);
    expect(results.at(-1)).toBeUndefined();
    expect((await store.readRecord(raceId))!.document.controls.a!.at).toEqual({ x: 3, y: 0 });
  });
});
