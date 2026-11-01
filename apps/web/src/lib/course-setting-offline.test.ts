import { describe, expect, it } from "vitest";
import type { CourseSettingEditsRequest, CourseSettingEditsSaved, CourseSettingState } from "@o-tid/contracts";
import { applyEdit, replayEdits, type CourseSettingDocument, type CourseSettingEdit, type CreatedIds } from "@o-tid/course-setting";
import { addPoint, applySteps, createEditor, setView, type EditorState } from "./course-setting-editor";
import {
  drainQueue, memoryFieldStore, recordToKeep, usableRecord, type FieldRecord, type QueuedItem, type QueueTransport
} from "./course-setting-offline";
import { CourseSettingSync, EditorStore, HttpStatusError, type SyncStatus } from "./course-setting-sync";
import { testDocument } from "./course-setting-test-document";

const raceId = "10000000-0000-4000-8000-000000000001";
const me = { accountId: "20000000-0000-4000-8000-000000000002", displayName: "Bea" };

/** Servern som tjänsten: spelar upp på aktuell version och ger samma svar för samma requestId. Kan vara utan nät. */
class Server {
  version = 1;
  online = true;
  /** Nästa sparning når servern men svaret kommer aldrig fram (nätet gick mitt i). */
  loseNextResponse = false;
  readonly answers = new Map<string, CourseSettingEditsSaved>();
  saves = 0;
  constructor(public document: CourseSettingDocument) {}
  async saveEdits(request: CourseSettingEditsRequest): Promise<CourseSettingEditsSaved> {
    if (!this.online) throw new TypeError("Failed to fetch");
    const known = this.answers.get(request.requestId);
    if (known) return known;
    this.saves += 1;
    const result = replayEdits(this.document, request.edits as CourseSettingEdit[], { created: request.created as CreatedIds[] });
    if (result.applied.length > 0) { this.version += 1; this.document = result.document; }
    const answer: CourseSettingEditsSaved = { formatVersion: 1, raceId, version: this.version, updatedAt: new Date().toISOString(),
      rebased: request.baseVersion !== this.version - 1, applied: result.applied.length,
      rejected: result.rejected.map(row => ({ index: row.index, code: row.code, message: row.message })),
      idMap: { controls: { ...result.idMap.controls }, courseControls: { ...result.idMap.courseControls }, courses: { ...result.idMap.courses } } };
    this.answers.set(request.requestId, answer);
    if (this.loseNextResponse) { this.loseNextResponse = false; throw new TypeError("Failed to fetch"); }
    return answer;
  }
  async fetchSetting() {
    if (!this.online) throw new TypeError("Failed to fetch");
    return { version: this.version, document: this.document };
  }
}

function state(document: CourseSettingDocument, version: number): CourseSettingState & { setting: NonNullable<CourseSettingState["setting"]> } {
  return { formatVersion: 1, raceId, access: { ...me, level: "EDIT", admin: true },
    setting: { version, updatedAt: new Date().toISOString(), updatedBy: me, mode: "LEAD", document: document as never },
    original: null, mapFile: null };
}

/** En telefon: editorn och sparandet, från serverns läge eller från posten i telefonen (som sidan gör). */
function phone(server: Server, record?: FieldRecord) {
  const document = record ? record.document : server.document;
  const initial = setView(createEditor(document), "k");
  const store = new EditorStore(record ? { ...initial, log: record.log, nextSeq: Math.max(0, ...record.log.map(row => row.seq)) + 1 } : initial);
  const base = record ? { version: record.state.setting.version, document: record.state.setting.document as unknown as CourseSettingDocument }
    : { version: server.version, document: server.document };
  const statuses: SyncStatus[] = [];
  const sync = new CourseSettingSync(store, base, {
    saveEdits: request => server.saveEdits(JSON.parse(JSON.stringify(request)) as CourseSettingEditsRequest),
    fetchSetting: () => server.fetchSetting()
  }, { onStatus: status => statuses.push(status), onLost: () => undefined, setTimer: () => 0, clearTimer: () => undefined,
    resume: record?.inFlight, newId: () => crypto.randomUUID() });
  const edit = (change: (current: EditorState) => EditorState) => { store.update(change); sync.changed(); };
  /** Det sidan sparar i telefonen. */
  const keep = (offline = false) => recordToKeep({ raceId, state: state(base.document, base.version), version: sync.version, base: sync.document,
    document: store.state.document, log: store.state.log, inFlight: sync.pendingRequest, offline, now: new Date() });
  return { store, sync, edit, keep, statuses };
}

const move = (control: string, x: number, y: number): CourseSettingEdit => ({ type: "MOVE_CONTROL", control, at: { x, y } });

describe("steg 67: åtgärderna utan nät", () => {
  it("ligger kvar i telefonen när sidan laddas om utan nät och sparas när nätet kommer tillbaka", async () => {
    const server = new Server(testDocument());
    const first = phone(server);
    server.online = false;
    first.edit(current => applySteps(current, [move("a", 12, 1)], applyEdit));
    first.edit(current => addPoint(current, "ADD_CONTROL", { x: 40, y: 40 }, applyEdit, () => "77"));
    await first.sync.flush();
    expect(first.statuses.at(-1)).toBe("failed");
    const record = usableRecord(first.keep(), raceId)!;
    // Flytten och den nya kontrollen (som också läggs in i banan).
    expect(record.log.map(row => row.edit.type)).toEqual(["MOVE_CONTROL", "ADD_CONTROL", "INSERT_COURSE_CONTROL"]);

    // Omladdning utan nät: editorn öppnas ur posten med åtgärderna gjorda.
    const second = phone(server, structuredClone(record));
    expect(second.store.state.document.controls.a!.at).toEqual({ x: 12, y: 1 });
    expect(Object.values(second.store.state.document.controls).some(row => row.code === "77")).toBe(true);

    // Någon annan sparar under tiden; nätet kommer tillbaka och åtgärderna spelas upp på den nya versionen.
    server.online = true;
    server.document = applyEdit(server.document, move("b", 25, 15)).document;
    server.version = 2;
    second.sync.changed();
    await second.sync.flush();
    expect(server.document.controls.a!.at).toEqual({ x: 12, y: 1 });
    expect(server.document.controls.b!.at).toEqual({ x: 25, y: 15 });
    expect(Object.values(server.document.controls).filter(row => row.code === "77")).toHaveLength(1);
    expect(second.store.state.log).toHaveLength(0);
    expect(second.store.state.document).toEqual(server.document);
    expect(second.keep()).toBeUndefined();
    expect(second.keep(true)?.log).toEqual([]);
  });

  it("en begäran som nådde servern men inte fick svar skickas igen med samma requestId (inget görs två gånger)", async () => {
    const server = new Server(testDocument());
    const first = phone(server);
    server.loseNextResponse = true;
    first.edit(current => addPoint(current, "ADD_CONTROL", { x: 40, y: 40 }, applyEdit, () => "77"));
    await first.sync.flush();
    const record = first.keep()!;
    expect(record.inFlight?.upTo).toBe(record.log.at(-1)!.seq);
    expect(record.inFlight?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(server.saves).toBe(1);

    const second = phone(server, structuredClone(record));
    second.sync.changed();
    await second.sync.flush();
    expect(server.saves).toBe(1);
    expect(Object.values(server.document.controls).filter(row => row.code === "77")).toHaveLength(1);
    expect(second.store.state.log).toHaveLength(0);
    expect(second.store.state.document).toEqual(server.document);
  });

  it("utloggad: sparandet stannar med åtgärderna kvar och fortsätter efter en ny inloggning", async () => {
    const server = new Server(testDocument());
    const client = phone(server);
    const save = server.saveEdits.bind(server);
    let loggedIn = false;
    server.saveEdits = async request => { if (!loggedIn) throw new HttpStatusError(401); return save(request); };
    client.edit(current => applySteps(current, [move("a", 13, 1)], applyEdit));
    await client.sync.flush();
    expect(client.statuses.at(-1)).toBe("stopped");
    expect(client.sync.halted).toBe(true);
    expect(client.keep()?.log).toHaveLength(1);
    loggedIn = true;
    client.sync.resume();
    await client.sync.flush();
    expect(server.document.controls.a!.at).toEqual({ x: 13, y: 1 });
    expect(client.keep()).toBeUndefined();
  });

  it("en post från en annan tävling eller med trasig logg används inte", () => {
    const record = recordToKeep({ raceId, state: state(testDocument(), 1), version: 1, base: testDocument(), document: testDocument(),
      log: [{ seq: 2, edit: move("a", 1, 1), created: { controls: [], courseControls: [], courses: [] } },
        { seq: 1, edit: move("a", 2, 2), created: { controls: [], courseControls: [], courses: [] } }], offline: false, now: new Date() });
    expect(usableRecord(record, raceId)).toBeUndefined();
    expect(usableRecord({ ...record!, log: [] }, "30000000-0000-4000-8000-000000000003")).toBeUndefined();
    expect(usableRecord({ ...record!, log: [] }, raceId)).toBeDefined();
  });
});

describe("steg 67: kön med notiser och bockar", () => {
  const note = (id: string): QueuedItem => ({ id, raceId, kind: "note", createdAt: "2026-11-01T10:00:00.000Z",
    request: { requestId: id, target: { kind: "CONTROL", control: "a" }, at: { x: 10, y: 0 }, course: null, text: "Flaggan saknas", photo: null } });
  const check = (id: string, checked: boolean): QueuedItem => ({ id, raceId, kind: "inspection", createdAt: "2026-11-01T10:01:00.000Z",
    request: { formatVersion: 1, control: "a", checked, at: "2026-11-01T10:01:00.000Z", position: { x: 10, y: 0 } } });

  it("skickas i ordning; utan nät stannar kön och inget tas bort", async () => {
    const store = memoryFieldStore();
    for (const item of [note("n1"), check("c1", true), note("n2")]) await store.addQueued(item);
    await store.addQueued(note("n1"));
    const sent: string[] = [];
    let online = false;
    const transport: QueueTransport = {
      note: async (_race, request) => { if (!online) throw new TypeError("Failed to fetch"); sent.push(request.requestId); },
      inspection: async (_race, request) => { if (!online) throw new TypeError("Failed to fetch"); sent.push(`check:${request.checked}`); }
    };
    expect(await drainQueue(store, raceId, transport)).toEqual({ sent: [], rejected: [], stopped: "offline" });
    expect((await store.listQueue(raceId)).map(item => item.id)).toEqual(["n1", "c1", "n2"]);
    online = true;
    const result = await drainQueue(store, raceId, transport);
    expect(result.sent.map(item => item.id)).toEqual(["n1", "c1", "n2"]);
    expect(sent).toEqual(["n1", "check:true", "n2"]);
    expect(await store.listQueue(raceId)).toEqual([]);
  });

  it("utloggad eller serverfel stoppar kön; ett avvisat (4xx) tas bort med beskedet och resten skickas", async () => {
    const store = memoryFieldStore();
    for (const item of [note("n1"), check("c1", true), note("n2")]) await store.addQueued(item);
    let failure: unknown = new HttpStatusError(401);
    const transport: QueueTransport = {
      note: async () => { if (failure) throw failure as Error; },
      inspection: async () => { throw new HttpStatusError(400); }
    };
    expect((await drainQueue(store, raceId, transport)).stopped).toBe("auth");
    failure = new Error("csrf");
    expect((await drainQueue(store, raceId, transport)).stopped).toBe("auth");
    failure = new HttpStatusError(503);
    expect((await drainQueue(store, raceId, transport)).stopped).toBe("offline");
    expect(await store.listQueue(raceId)).toHaveLength(3);
    failure = undefined;
    const result = await drainQueue(store, raceId, transport);
    expect(result.sent.map(item => item.id)).toEqual(["n1", "n2"]);
    expect(result.rejected.map(row => [row.item.id, row.status])).toEqual([["c1", 400]]);
    expect(await store.listQueue(raceId)).toEqual([]);
  });
});
