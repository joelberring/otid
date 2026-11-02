import { describe, expect, it } from "vitest";
import {
  COURSE_SETTING_EDITS_MAX, COURSE_SETTING_EDITS_MAX_BYTES, courseSettingEditsRequestSchema, type CourseSettingEditsRequest,
  type CourseSettingEditsSaved
} from "@o-tid/contracts";
import { applyEdit, replayEdits, type CourseSettingDocument, type CourseSettingEdit, type CreatedIds } from "@o-tid/course-setting";
import { applySteps, createEditor, setView, type EditorState } from "./course-setting-editor";
import {
  CourseSettingSync, EDIT_TOO_LARGE, EDIT_UNREADABLE, EditorStore, HttpStatusError, SAVE_BATCH_EDITS, takeBatch, type LostEdit
} from "./course-setting-sync";
import { testDocument } from "./course-setting-test-document";

const raceId = "10000000-0000-4000-8000-000000000001";

/**
 * Översynen 2026-11-02: servern med samma gränser som routen och tjänsten. För stor kropp eller fler än 5 000 åtgärder
 * ger 413, en basversion som är nyare än serverns eller ett schema som inte stämmer ger 400. Inget sparas då.
 */
class LimitedServer {
  version = 1;
  requests: { edits: number; bytes: number; status: number }[] = [];
  /** Nästa begäran svarar 400 (t.ex. fel i en proxy eller ett schema som inte stämmer). */
  badNext = 0;
  /** Åtgärder med denna text kan servern aldrig läsa. */
  unreadable?: string;
  constructor(public document: CourseSettingDocument) {}
  async saveEdits(request: CourseSettingEditsRequest): Promise<CourseSettingEditsSaved> {
    const body = JSON.stringify(request);
    const bytes = new TextEncoder().encode(body).byteLength;
    const answer = (status: number) => { this.requests.push({ edits: request.edits.length, bytes, status }); return status; };
    if (bytes > COURSE_SETTING_EDITS_MAX_BYTES || request.edits.length > COURSE_SETTING_EDITS_MAX) throw new HttpStatusError(answer(413));
    if (this.badNext > 0) { this.badNext -= 1; throw new HttpStatusError(answer(400)); }
    if (this.unreadable && body.includes(this.unreadable)) throw new HttpStatusError(answer(400));
    if (!courseSettingEditsRequestSchema.safeParse(JSON.parse(body)).success || request.baseVersion > this.version) throw new HttpStatusError(answer(400));
    answer(200);
    const result = replayEdits(this.document, request.edits as CourseSettingEdit[], { created: request.created as CreatedIds[] });
    if (result.applied.length > 0) { this.version += 1; this.document = result.document; }
    return { formatVersion: 1, raceId, version: this.version, updatedAt: new Date().toISOString(), rebased: request.baseVersion !== this.version - 1,
      applied: result.applied.length, rejected: result.rejected.map(row => ({ index: row.index, code: row.code, message: row.message })),
      idMap: { controls: { ...result.idMap.controls }, courseControls: { ...result.idMap.courseControls }, courses: { ...result.idMap.courses } } };
  }
  async fetchSetting() { return { version: this.version, document: this.document }; }
}

function client(server: LimitedServer, base = { version: server.version, document: server.document }) {
  const store = new EditorStore(setView(createEditor(base.document), "k"));
  const lost: LostEdit[] = [];
  const sync = new CourseSettingSync(store, base, {
    saveEdits: request => server.saveEdits(JSON.parse(JSON.stringify(request)) as CourseSettingEditsRequest),
    fetchSetting: () => server.fetchSetting()
  }, { onStatus: () => undefined, onLost: rows => lost.push(...rows), setTimer: () => 0, clearTimer: () => undefined });
  const edit = (change: (state: EditorState) => EditorState) => { store.update(change); sync.changed(); };
  return { store, sync, lost, edit };
}

const move = (control: string, x: number, y: number): CourseSettingEdit => ({ type: "MOVE_CONTROL", control, at: { x, y } });
/** En bild som specialobjekt (base64), `kb` kilobyte. */
const image = (kb: number, mark = "A"): CourseSettingEdit => ({ type: "ADD_SPECIAL", special: { kind: "image",
  points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], image: { format: "png", data: mark.repeat(kb * 1024) } } });

describe("översynen 2026-11-02: sparandet i omgångar", () => {
  it("delar upp efter antal och byte men tar alltid minst en", () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({ seq: index + 1, edit: move("a", index, 0),
      created: { controls: [], courseControls: [], courses: [] } }));
    expect(takeBatch(entries, { edits: 3, bytes: 1_000_000 }).map(row => row.seq)).toEqual([1, 2, 3]);
    expect(takeBatch(entries, { edits: 100, bytes: 1 }).map(row => row.seq)).toEqual([1]);
  });

  it("6 000 åtgärder från telefonen sparas i omgångar utan att något går förlorat", async () => {
    const server = new LimitedServer(testDocument());
    const a = client(server);
    for (let index = 0; index < 6000; index += 1) a.store.update(state => applySteps(state, [move("a", index % 97, index % 89)], applyEdit));
    a.sync.changed();
    await a.sync.flush();
    expect(a.lost).toEqual([]);
    expect(a.store.state.log).toHaveLength(0);
    expect(server.requests.every(row => row.status === 200 && row.edits <= SAVE_BATCH_EDITS)).toBe(true);
    expect(server.requests).toHaveLength(Math.ceil(6000 / SAVE_BATCH_EDITS));
    expect(server.document.controls.a!.at).toEqual({ x: 5999 % 97, y: 5999 % 89 });
    expect(a.store.state.document).toEqual(server.document);
  });

  it("stora bilder: varje omgång håller sig under gränsen och alla bilder kommer fram", async () => {
    const server = new LimitedServer(testDocument());
    const a = client(server);
    for (let index = 0; index < 6; index += 1) a.edit(state => applySteps(state, [image(900, String.fromCharCode(65 + index))], applyEdit));
    await a.sync.flush();
    expect(a.lost).toEqual([]);
    expect(server.document.specialObjects).toHaveLength(6);
    expect(server.requests.every(row => row.status === 200 && row.bytes < COURSE_SETTING_EDITS_MAX_BYTES)).toBe(true);
    expect(server.requests.length).toBeGreaterThan(1);
  });

  it("413 för en omgång: försöker igen med hälften, inget avvisas", async () => {
    const server = new LimitedServer(testDocument());
    const a = client(server);
    // Tre bilder på 1,5 MB får plats i omgångens byte-gräns var för sig men inte tillsammans hos en snålare server.
    for (let index = 0; index < 3; index += 1) a.edit(state => applySteps(state, [image(1500, String.fromCharCode(66 + index))], applyEdit));
    const save = server.saveEdits.bind(server);
    server.saveEdits = async request => {
      if (request.edits.length > 1) { server.requests.push({ edits: request.edits.length, bytes: 0, status: 413 }); throw new HttpStatusError(413); }
      return save(request);
    };
    // Gör omgången stor nog att innehålla flera (byte-gränsen sätts högt för testet).
    (a.sync as unknown as { limit: { edits: number; bytes: number } }).limit = { edits: 500, bytes: 10 * 1024 * 1024 };
    await a.sync.flush();
    expect(a.lost).toEqual([]);
    expect(server.document.specialObjects).toHaveLength(3);
    expect(server.requests.some(row => row.status === 413)).toBe(true);
  });

  it("413 för en enda åtgärd: tydligt besked och resten sparas", async () => {
    const server = new LimitedServer(testDocument());
    const a = client(server);
    a.edit(state => applySteps(state, [move("a", 1, 1)], applyEdit));
    a.edit(state => applySteps(state, [image(4200)], applyEdit));
    a.edit(state => applySteps(state, [move("b", 2, 2)], applyEdit));
    await a.sync.flush();
    expect(a.lost.map(row => row.message)).toEqual([EDIT_TOO_LARGE]);
    expect(a.lost[0]!.edit.type).toBe("ADD_SPECIAL");
    expect(server.document.controls.a!.at).toEqual({ x: 1, y: 1 });
    expect(server.document.controls.b!.at).toEqual({ x: 2, y: 2 });
    expect(server.document.specialObjects).toHaveLength(0);
    expect(a.store.state.log).toHaveLength(0);
    // Den för stora bilden skickas aldrig (den är större än gränsen redan i telefonen).
    expect(server.requests.every(row => row.status === 200)).toBe(true);
  });

  it("400 för hela begäran: läser om och försöker igen, inget avvisas eller stryks", async () => {
    const server = new LimitedServer(testDocument());
    const a = client(server);
    a.edit(state => applySteps(state, [move("a", 3, 3)], applyEdit));
    a.edit(state => applySteps(state, [move("b", 4, 4)], applyEdit));
    server.badNext = 1;
    await a.sync.flush();
    expect(a.lost).toEqual([]);
    expect(server.requests.map(row => row.status)).toEqual([400, 200]);
    expect(server.document.controls.a!.at).toEqual({ x: 3, y: 3 });
    expect(server.document.controls.b!.at).toEqual({ x: 4, y: 4 });
  });

  it("basversionen nyare än serverns (servern återställd): läser om och spelar upp på serverns version", async () => {
    const server = new LimitedServer(testDocument());
    server.version = 3;
    const a = client(server);
    a.edit(state => applySteps(state, [move("a", 5, 5)], applyEdit));
    // Servern backad till version 2 (t.ex. återställd säkerhetskopia) med en annan flytt.
    server.version = 2;
    server.document = applyEdit(server.document, move("b", 9, 9)).document;
    await a.sync.flush();
    expect(a.lost).toEqual([]);
    expect(server.requests.map(row => row.status)).toEqual([400, 200]);
    expect(server.document.controls.a!.at).toEqual({ x: 5, y: 5 });
    expect(a.store.state.document.controls.b!.at).toEqual({ x: 9, y: 9 });
  });

  it("en åtgärd som servern aldrig kan läsa stryks ensam efter omläsning; de andra sparas", async () => {
    const server = new LimitedServer(testDocument());
    const a = client(server);
    a.edit(state => applySteps(state, [move("a", 6, 6)], applyEdit));
    a.edit(state => applySteps(state, [{ type: "UPDATE_COURSE", course: "k", changes: { name: "OLÄSLIG" } }], applyEdit));
    a.edit(state => applySteps(state, [move("b", 7, 7)], applyEdit));
    server.unreadable = "OLÄSLIG";
    await a.sync.flush();
    expect(a.lost.map(row => row.message)).toEqual([EDIT_UNREADABLE]);
    expect(server.document.controls.a!.at).toEqual({ x: 6, y: 6 });
    expect(server.document.controls.b!.at).toEqual({ x: 7, y: 7 });
    expect(server.document.courses[0]!.name).toBe("Lång");
  });

  it("en återupptagen begäran (samma requestId) skickas som den var, också när loggen är längre än en omgång", async () => {
    const server = new LimitedServer(testDocument());
    const store = new EditorStore(setView(createEditor(server.document), "k"));
    for (let index = 0; index < 700; index += 1) store.update(state => applySteps(state, [move("a", index, 0)], applyEdit));
    const ids: string[] = [];
    const sync = new CourseSettingSync(store, { version: 1, document: server.document }, {
      saveEdits: request => { ids.push(request.requestId); return server.saveEdits(JSON.parse(JSON.stringify(request)) as CourseSettingEditsRequest); },
      fetchSetting: () => server.fetchSetting()
    }, { onStatus: () => undefined, onLost: () => undefined, setTimer: () => 0, clearTimer: () => undefined,
      resume: { requestId: "30000000-0000-4000-8000-000000000003", upTo: 300 } });
    sync.changed();
    await sync.flush();
    expect(ids[0]).toBe("30000000-0000-4000-8000-000000000003");
    expect(server.requests[0]!.edits).toBe(300);
    expect(store.state.log).toHaveLength(0);
    expect(server.document.controls.a!.at).toEqual({ x: 699, y: 0 });
  });
});
