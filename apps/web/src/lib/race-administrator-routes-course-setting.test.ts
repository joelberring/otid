import { describe, expect, it, vi } from "vitest";
import type * as Application from "@o-tid/application";
import { courseSettingDocumentSchema, courseSettingSaveRequestSchema } from "@o-tid/contracts";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { ppenFileName } from "./race-administrator-routes-course-setting";
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
const functionary = { status: "authenticated" as const, principal: { accountId: id, sessionId: id, raceId: id, eventId: id, grantId: id,
  grantRole: "FUNCTIONARY" as const, role: "FUNCTIONARY" as const, expiresAt: "2026-09-12T13:00:00Z" } };

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
      formatVersion: 1, raceId: id, setting: null, original: null, mapFile: null } });
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

  it("kräver administratör för allt", async () => {
    const services = dependencies();
    services.authenticate.mockResolvedValue(functionary);
    for (const action of [{ kind: "course-setting" as const }, { kind: "course-setting-revisions" as const }, { kind: "course-setting-original" as const }]) {
      expect((await raceAdministratorRoute(db, get(), id, action, services, environment)).status).toBe(403);
    }
    expect((await raceAdministratorRoute(db, request("POST", "{}"), id, { kind: "course-setting-transfer" }, services, environment)).status).toBe(403);
    expect(services.authenticate.mock.calls.at(-1)![1]).toMatchObject({ role: "ADMIN" });
  });
});
