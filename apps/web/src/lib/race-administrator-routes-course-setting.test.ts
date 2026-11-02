import { describe, expect, it, vi } from "vitest";
import type * as Application from "@o-tid/application";
import {
  COURSE_SETTING_EDITS_MAX, COURSE_SETTING_EDITS_MAX_BYTES, courseSettingDocumentSchema, courseSettingSaveRequestSchema
} from "@o-tid/contracts";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { ppenFileName } from "./race-administrator-routes-course-setting";
import { subscribeCourseSetting, type CourseSettingEvent } from "./course-setting-events";
import { csrf, db, dependencies, environment, id, request, token } from "./race-administrator-route-test-helpers";

/** Steg 62: banläggningens routes (läge, sparande med version, .ppen, versioner, överföring) och kontraktets grundform. */
const document = courseSettingDocumentSchema.parse({ version: 1, event: { title: "Träning", mapScale: 10000, overprintStandard: "ISOM2017", descriptionStandard: "2018",
  numbering: { start: 31, disallowInvertible: false } },
controls: { "1": { id: "1", kind: "START", at: { x: 4, y: 8 }, descriptions: [] }, "2": { id: "2", kind: "NORMAL", code: "31", at: { x: 15, y: 42 }, descriptions: [] } },
courseControls: { "1": { id: "1", control: "1", next: "2" }, "2": { id: "2", control: "2" } },
courses: [{ id: "1", name: "Lång", kind: "NORMAL", order: 1, first: "1", labelKind: "SEQUENCE" }], legs: {}, specialObjects: [], raw: [] });
const saved = { formatVersion: 1 as const, raceId: id, version: 3, updatedAt: "2026-10-31T10:00:00.000Z" };
const conflict = { formatVersion: 1 as const, error: "VERSION_CONFLICT" as const,
  current: { version: 4, updatedAt: "2026-10-31T10:01:00.000Z", updatedBy: { accountId: id, displayName: "Anna" } } };
const get = () => new Request("https://otid.example/api/admin", { headers: { cookie: `__Host-otid-organizer-session=${token}` } });
describe("banläggningens kontrakt", () => {
  it("tar emot ett dokument med rätt grundform och avvisar trasiga länkar, fel version och okända slag", () => {
    expect(courseSettingDocumentSchema.safeParse(document).success).toBe(true);
    const broken = [{ ...document, version: 2 }, { ...document, courseControls: { "1": { id: "1", control: "9" } } },
      { ...document, courses: [{ ...document.courses[0]!, first: "7" }] }, { ...document, controls: { "1": { ...document.controls["1"]!, id: "x" } } },
      { ...document, controls: { "1": { ...document.controls["1"]!, kind: "BOJ" } } }, { ...document, event: { ...document.event, mapScale: 1 } }];
    for (const value of broken) expect(courseSettingDocumentSchema.safeParse(value).success, JSON.stringify(value).slice(0, 80)).toBe(false);
    expect(courseSettingSaveRequestSchema.safeParse({ formatVersion: 1, expectedVersion: 0, document }).success).toBe(true);
    expect(courseSettingSaveRequestSchema.safeParse({ formatVersion: 1, expectedVersion: -1, document }).success).toBe(false);
  });

  it("ger filnamnet utan konstiga tecken och alltid .ppen", () => {
    expect(ppenFileName("SBN26_1.ppen")).toBe("SBN26_1.ppen");
    expect(ppenFileName("../../etc/\"x\"")).toBe(".._.._etc__x_.ppen");
    expect(ppenFileName("")).toBe("banlaggning.ppen");
  });
});

describe("administratörsroutes: banläggningen", () => {
  it("ger läget och sparar med versionskontroll (409 med aktuell version)", async () => {
    const courseSetting = vi.fn<typeof Application.readCourseSettingAsAdmin>().mockResolvedValue({ status: "ok", response: {
      formatVersion: 1, raceId: id, access: { accountId: id, displayName: "Anna", level: "EDIT", admin: true }, setting: null, original: null,
      mapFile: null } });
    const courseSettingSave = vi.fn<typeof Application.saveCourseSettingAsAdmin>().mockResolvedValue({ status: "ok", response: saved });
    const services = { ...dependencies(), courseSetting, courseSettingSave };
    const read = await raceAdministratorRoute(db, get(), id, { kind: "course-setting" }, services, environment);
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    const body = JSON.stringify({ formatVersion: 1, expectedVersion: 2, document });
    const ok = await raceAdministratorRoute(db, request("PUT", body), id, { kind: "course-setting" }, services, environment);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(saved);
    expect(courseSettingSave.mock.calls[0]![1]).toMatchObject({ raceId: id, csrfHeader: csrf, request: { expectedVersion: 2 } });
    courseSettingSave.mockResolvedValueOnce({ status: "version-conflict", conflict });
    const clash = await raceAdministratorRoute(db, request("PUT", body), id, { kind: "course-setting" }, services, environment);
    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual(conflict);
    expect((await raceAdministratorRoute(db, request("PUT", "inte json"), id, { kind: "course-setting" }, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("PUT", body, { origin: "https://annan.example" }), id, { kind: "course-setting" },
      services, environment)).status).toBe(403);
    expect((await raceAdministratorRoute(db, request("POST", body), id, { kind: "course-setting" }, services, environment)).status).toBe(405);
    expect(courseSettingSave).toHaveBeenCalledTimes(2);
  });

  it("läser in .ppen, återställer, listar versioner och ger originalfilen", async () => {
    const courseSettingImport = vi.fn<typeof Application.importCourseSettingAsAdmin>().mockResolvedValue({ status: "ok", response: saved });
    const courseSettingRestore = vi.fn<typeof Application.restoreCourseSettingRevisionAsAdmin>().mockResolvedValue({ status: "not-found" });
    const courseSettingRevisions = vi.fn<typeof Application.listCourseSettingRevisionsAsAdmin>().mockResolvedValue({ status: "ok",
      response: { formatVersion: 1, raceId: id, revisions: [{ version: 2, kind: "IMPORT", createdAt: saved.updatedAt,
        createdBy: { accountId: id, displayName: null }, courses: 1, controls: 2 }] } });
    const courseSettingRevision = vi.fn<typeof Application.readCourseSettingRevisionAsAdmin>().mockResolvedValue({ status: "ok", response: {
      formatVersion: 1, raceId: id, version: 2, kind: "IMPORT", createdAt: saved.updatedAt, createdBy: { accountId: id, displayName: null }, document } });
    const courseSettingOriginal = vi.fn<typeof Application.readCourseSettingOriginalAsAdmin>().mockResolvedValue({ status: "ok",
      fileName: "Träning.ppen", ppen: "<course-scribe-event />" });
    const services = { ...dependencies(), courseSettingImport, courseSettingRestore, courseSettingRevisions, courseSettingRevision, courseSettingOriginal };
    const imported = await raceAdministratorRoute(db, request("POST", JSON.stringify({ formatVersion: 1, expectedVersion: 0, document,
      fileName: "Träning.ppen", ppen: "<course-scribe-event />" })), id, { kind: "course-setting-import" }, services, environment);
    expect(imported.status).toBe(200);
    const restore = JSON.stringify({ formatVersion: 1, expectedVersion: 3, revision: 2 });
    expect((await raceAdministratorRoute(db, request("POST", restore), id, { kind: "course-setting-restore" }, services, environment)).status).toBe(404);
    expect((await raceAdministratorRoute(db, get(), id, { kind: "course-setting-revisions" }, services, environment)).status).toBe(200);
    expect((await raceAdministratorRoute(db, get(), id, { kind: "course-setting-revision", version: 2 }, services, environment)).status).toBe(200);
    expect(courseSettingRevision.mock.calls[0]![1]).toMatchObject({ version: 2 });
    expect((await raceAdministratorRoute(db, get(), id, { kind: "course-setting-revision", version: 0 }, services, environment)).status).toBe(400);
    const original = await raceAdministratorRoute(db, get(), id, { kind: "course-setting-original" }, services, environment);
    expect(original.status).toBe(200);
    expect(original.headers.get("content-disposition")).toContain(`filename*=UTF-8''${encodeURIComponent("Träning.ppen")}`);
    expect(await original.text()).toBe("<course-scribe-event />");
  });

  it("överföringen ger banfilens förhandsvisning, 409 vid annan version och 422 med begripligt fel", async () => {
    const preview = { formatVersion: 1 as const, raceId: id, source: "COURSE_FILE" as const, snapshotId: id, snapshotVersion: 4,
      fetchedAt: saved.updatedAt, sourceName: "Banläggningen, version 3", rows: [], summary: { new: 0, changed: 0, withdrawn: 0, conflicts: 0, unchanged: 1 },
      consequence: { requiresConfirmation: false, readOutCount: 0, becomesOkCount: 0, becomesMispunchedCount: 0, unchangedCount: 0,
        notRecalculatedCount: 0, changes: [], cardsAfterReadout: [] } };
    const courseSettingTransfer = vi.fn<typeof Application.previewCourseSettingTransferAsAdmin>().mockResolvedValue({ status: "ok",
      response: preview as never });
    const services = { ...dependencies(), courseSettingTransfer };
    const body = JSON.stringify({ formatVersion: 1, version: 3 });
    expect((await raceAdministratorRoute(db, request("POST", body), id, { kind: "course-setting-transfer" }, services, environment)).status).toBe(200);
    courseSettingTransfer.mockResolvedValueOnce({ status: "version-conflict", conflict });
    expect((await raceAdministratorRoute(db, request("POST", body), id, { kind: "course-setting-transfer" }, services, environment)).status).toBe(409);
    courseSettingTransfer.mockResolvedValueOnce({ status: "problem", problem: { formatVersion: 1, error: "INVALID_CODES", controls: ["7"] } });
    const problem = await raceAdministratorRoute(db, request("POST", body), id, { kind: "course-setting-transfer" }, services, environment);
    expect(problem.status).toBe(422);
    expect(await problem.json()).toEqual({ formatVersion: 1, error: "INVALID_CODES", controls: ["7"] });
  });

  it("prövar banläggningens behörighet: läsa med COMMENT, spara med EDIT, överföra bara admin", async () => {
    const services = dependencies();
    services.authenticateCourseSetting.mockResolvedValue({ status: "forbidden" });
    for (const action of [{ kind: "course-setting" as const }, { kind: "course-setting-revisions" as const }, { kind: "course-setting-original" as const }]) {
      expect((await raceAdministratorRoute(db, get(), id, action, services, environment)).status).toBe(403);
      expect(services.authenticateCourseSetting.mock.calls.at(-1)![1]).toMatchObject({ required: "COMMENT" });
    }
    expect((await raceAdministratorRoute(db, request("POST", "{}"), id, { kind: "course-setting-transfer" }, services, environment)).status).toBe(403);
    expect(services.authenticateCourseSetting.mock.calls.at(-1)![1]).toMatchObject({ required: "ADMIN", requireCsrf: true });
    expect((await raceAdministratorRoute(db, request("PUT", "{}"), id, { kind: "course-setting" }, services, environment)).status).toBe(403);
    expect(services.authenticateCourseSetting.mock.calls.at(-1)![1]).toMatchObject({ required: "EDIT" });
    // Rollen på tävlingen frågas aldrig (funktionären har den, men inte banläggningen).
    expect(services.authenticate).not.toHaveBeenCalled();
  });
});

describe("administratörsroutes: samarbetet (steg 66)", () => {
  const savedEdits = { formatVersion: 1 as const, raceId: id, version: 5, updatedAt: "2026-11-01T10:00:00.000Z", rebased: true, applied: 1,
    rejected: [{ index: 1, code: "CONFLICT" as const, message: "Någon annan hann ändra samma sak" }], idMap: { controls: {}, courseControls: {}, courses: {} } };
  it("sparar åtgärder, ger avvisade åtgärder och säger till öppna editorer att en ny version finns", async () => {
    const courseSettingEdits = vi.fn<typeof Application.saveCourseSettingEditsAsAdmin>().mockResolvedValue({ status: "ok", response: savedEdits });
    const services = { ...dependencies(), courseSettingEdits };
    const events: CourseSettingEvent[] = [];
    const stop = subscribeCourseSetting(id, { accountId: id, displayName: "Bo", level: "EDIT" }, event => events.push(event))!;
    try {
      const body = JSON.stringify({ formatVersion: 1, requestId: id, baseVersion: 3, edits: [{ type: "DELETE_CONTROL", control: "1" }] });
      const response = await raceAdministratorRoute(db, request("POST", body), id, { kind: "course-setting-edits" }, services, environment);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(savedEdits);
      expect(events).toContainEqual({ type: "version", version: 5, by: id });
      expect(services.authenticateCourseSetting.mock.calls.at(-1)![1]).toMatchObject({ required: "EDIT", requireCsrf: true });
      courseSettingEdits.mockResolvedValueOnce({ status: "forbidden" });
      expect((await raceAdministratorRoute(db, request("POST", body), id, { kind: "course-setting-edits" }, services, environment)).status).toBe(403);
      expect((await raceAdministratorRoute(db, get(), id, { kind: "course-setting-edits" }, services, environment)).status).toBe(405);
    } finally { stop(); }
  });

  it("översynen 2026-11-02: för stor kropp och fler än 5 000 åtgärder ger 413 (dela upp), trasig begäran 400, och tjänsten anropas inte", async () => {
    const courseSettingEdits = vi.fn<typeof Application.saveCourseSettingEditsAsAdmin>().mockResolvedValue({ status: "ok", response: savedEdits });
    const services = { ...dependencies(), courseSettingEdits };
    const post = (body: string, headers: Record<string, string> = {}) =>
      raceAdministratorRoute(db, request("POST", body, headers), id, { kind: "course-setting-edits" }, services, environment);
    const many = JSON.stringify({ formatVersion: 1, requestId: id, baseVersion: 3,
      edits: Array.from({ length: COURSE_SETTING_EDITS_MAX + 1 }, () => ({ type: "DELETE_CONTROL", control: "1" })) });
    expect((await post(many)).status).toBe(413);
    const huge = JSON.stringify({ formatVersion: 1, requestId: id, baseVersion: 3, edits: [{ type: "SET_EVENT", changes: { title: "x".repeat(COURSE_SETTING_EDITS_MAX_BYTES) } }] });
    expect((await post(huge)).status).toBe(413);
    expect((await post("{}", { "content-length": String(COURSE_SETTING_EDITS_MAX_BYTES + 1) })).status).toBe(413);
    expect((await post("{inte json")).status).toBe(400);
    expect(courseSettingEdits).not.toHaveBeenCalled();
    courseSettingEdits.mockResolvedValueOnce({ status: "too-large" });
    expect((await post(JSON.stringify({ formatVersion: 1, requestId: id, baseVersion: 3, edits: [{ type: "DELETE_CONTROL", control: "1" }] }))).status).toBe(413);
  });

  it("ger notisens foto privat och utan tolkning, och strömmen som text/event-stream", async () => {
    const courseSettingNotePhoto = vi.fn<typeof Application.readCourseSettingNotePhotoAsAdmin>()
      .mockResolvedValue({ status: "ok", mediaType: "image/jpeg", photo: Buffer.from([0xff, 0xd8, 0xff]) });
    const services = { ...dependencies(), courseSettingNotePhoto };
    const photo = await raceAdministratorRoute(db, get(), id, { kind: "course-setting-note-photo", noteId: id }, services, environment);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");
    expect(photo.headers.get("cache-control")).toBe("private, no-store");
    expect(photo.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await raceAdministratorRoute(db, get(), id, { kind: "course-setting-note-photo", noteId: "inte-ett-id" }, services, environment)).status)
      .toBe(400);
    const controller = new AbortController();
    const stream = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { signal: controller.signal,
      headers: { cookie: `__Host-otid-organizer-session=${token}` } }), id, { kind: "course-setting-events" }, services, environment);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const reader = stream.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: presence");
    controller.abort();
    await reader.cancel();
  });
});
