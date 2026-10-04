import { describe, expect, it, vi } from "vitest";
import type { listFixedStartSlotPlansAsAdministrator } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { db, id, other, csrf, token, environment, dependencies, request } from "./race-administrator-route-test-helpers";

describe("administratörsroutes: förberedelse", () => {
  it("TASK108 lämnar endast den validerade läsrapporten till raceadministratören", async () => {
    const report = { formatVersion: 1 as const, raceId: id, snapshotVersion: 2, timeZone: "Europe/Stockholm", classes: [{
      classId: other, className: "D21", entryCount: 1, maxEntries: 3, capacityRemaining: 2,
      plan: { status: "AVAILABLE" as const, firstStartTime: "2026-09-20T08:00:00.000Z", intervalSeconds: 60,
        drawnAt: "2026-09-20T07:00:00.000Z", slots: [{ state: "VACANT" as const, fixedStartTime: "2026-09-20T08:00:00.000Z" }], unassignedEntries: [] }
    }] };
    const fixedStartSlotPlans = vi.fn<typeof listFixedStartSlotPlansAsAdministrator>().mockResolvedValue({ status: "ok", response: report });
    const services = { ...dependencies(), fixedStartSlotPlans };
    const read = () => new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } });
    const response = await raceAdministratorRoute(db, read(), id, { kind: "fixed-start-slot-plans" }, services, environment);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(report);
    expect(fixedStartSlotPlans).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id }));
    fixedStartSlotPlans.mockResolvedValueOnce({ status: "forbidden" });
    expect((await raceAdministratorRoute(db, read(), id, { kind: "fixed-start-slot-plans" }, services, environment)).status).toBe(403);
  });
  it("TASK135 binds one separately ranked shortened-course transfer to its frozen class basis", async () => {
    const courseVersionId = "10000000-0000-4000-8000-000000000003";
    const controlOneId = "10000000-0000-4000-8000-000000000004";
    const controlTwoId = "10000000-0000-4000-8000-000000000005";
    const entryId = "10000000-0000-4000-8000-000000000006";
    const sourceResultId = "10000000-0000-4000-8000-000000000007";
    const readoutId = "10000000-0000-4000-8000-000000000008";
    const createdResultId = "10000000-0000-4000-8000-000000000009";
    const shortCourseId = "10000000-0000-4000-8000-000000000010";
    const shortCourseVersionId = "10000000-0000-4000-8000-000000000011";
    const shortClassId = "10000000-0000-4000-8000-000000000012";
    const candidate = { formatVersion: 1 as const, raceId: id, sourceClassId: other, sourceClassName: "D21",
      sourceCourseId: other, sourceCourseName: "Långa", sourceCourseVersionId: courseVersionId, sourceCourseVersion: 1,
      sourceStartRule: "PUNCH" as const, snapshotVersion: 2, basisHash: "a".repeat(64),
      sourceControls: [{ courseControlId: controlOneId, sequence: 1, controlCode: 31 }, { courseControlId: controlTwoId, sequence: 2, controlCode: 42 }],
      entries: [{ entryId, entryVersion: 1, displayName: "Ada Löpare", startRule: "PUNCH" as const, fixedStartTime: null,
        sourceResult: { kind: "CARD_READOUT_MP" as const, resultRevisionId: sourceResultId, resultRevision: 1,
          readoutId, snapshotVersion: 2, courseVersionId, status: "MP" as const, cause: "CARD_READOUT" as const, published: true as const } }] };
    const body = { formatVersion: 1 as const, requestId: id, sourceClassId: other, expectedSourceCourseVersionId: courseVersionId,
      expectedSourceStartRule: "PUNCH" as const, expectedSnapshotVersion: 2, expectedBasisHash: candidate.basisHash,
      shortCourseName: "Långa kort", shortClassName: "D21 kort", expectedSourceControlCount: 2,
      controlPrefix: [candidate.sourceControls[0]!], entryIds: [entryId] };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, transferId: id, raceId: id,
      sourceClassId: other, sourceCourseVersionId: courseVersionId, shortCourseId, shortCourseVersionId, shortClassId,
      sourceSnapshotVersion: 2, snapshotVersionAfter: 3, sourceBasisHash: candidate.basisHash, request: body,
      transferredAt: "2026-09-22T12:01:00.000Z", items: [{ entryId, entryVersionBefore: 1, entryVersionAfter: 2,
        effect: "MOVED_AND_REEVALUATED" as const, sourceResultRevisionId: sourceResultId, sourceReadoutId: readoutId,
        createdResultRevisionId: createdResultId, createdResultRevision: 2, resultingStatus: "OK" as const }] };
    const shortenedCourseClassTransferPreview = vi.fn<typeof import("@o-tid/application").previewShortenedCourseClassTransferAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: candidate });
    const shortenedCourseClassTransfer = vi.fn<typeof import("@o-tid/application").transferShortenedCourseClassAsAdministrator>()
      .mockResolvedValue({ status: "transferred", response: receipt });
    const services = { ...dependencies(), shortenedCourseClassTransferPreview, shortenedCourseClassTransfer };
    const action = { kind: "shortened-course-class-transfer" as const, classId: other };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }), id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(candidate);
    expect(shortenedCourseClassTransferPreview).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      request: { formatVersion: 1, sourceClassId: other } }));
    const write = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `shortened-course-class-transfer:${id}` }), id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    expect(shortenedCourseClassTransfer).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      idempotencyKey: `shortened-course-class-transfer:${id}`, request: body }));
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify({ ...body, sourceClassId: id }), {
      "idempotency-key": `shortened-course-class-transfer:${id}` }), id, action, services, environment)).status).toBe(400);
  });
  it("Redigera bana: banlista, besked och sparande binds till administratören, banan och begäran", async () => {
    const list = { formatVersion: 1 as const, raceId: id, snapshotVersion: 2, courses: [{ courseId: other, courseVersionId: id, name: "Lång",
      controlCodes: [31, 32, 33], classes: [{ classId: id, name: "H21" }], entryCount: 3, readOutCount: 2 }] };
    const preview = { formatVersion: 1 as const, raceId: id, courseId: other, courseName: "Lång", snapshotVersion: 2,
      currentControlCodes: [31, 32, 33], controlCodes: [31, 33], readOutCount: 2, becomesOkCount: 1, becomesMispunchedCount: 0,
      unchangedCount: 1, notRecalculatedCount: 0, requiresConfirmation: true,
      changes: [{ entryId: id, displayName: "Ada Löpare", className: "H21", before: "MP" as const, after: "OK" as const }] };
    const body = { formatVersion: 1 as const, requestId: id, expectedSnapshotVersion: 2, courseId: other, controlCodes: [31, 33],
      confirmResultChanges: true };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, courseId: other, request: body,
      previousCourseVersionId: id, courseVersionId: "10000000-0000-4000-8000-000000000003", classIds: [id],
      snapshotVersionBefore: 2, snapshotVersionAfter: 3, recalculated: [{ entryId: id, resultRevisionId: other, revision: 2 }],
      editedAt: "2026-10-03T12:00:00.000Z" };
    const courses = vi.fn<typeof import("@o-tid/application").listCoursesForEditAsAdministrator>().mockResolvedValue({ status: "ok", response: list });
    const courseEditPreview = vi.fn<typeof import("@o-tid/application").previewCourseEditAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: preview });
    const courseEdit = vi.fn<typeof import("@o-tid/application").editCourseAsAdministrator>()
      .mockResolvedValue({ status: "edited", response: receipt });
    const services = { ...dependencies(), courses, courseEditPreview, courseEdit };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }),
    id, { kind: "courses" }, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(list);
    const previewed = await raceAdministratorRoute(db, request("POST", JSON.stringify({ formatVersion: 1, expectedSnapshotVersion: 2,
      controlCodes: [31, 33] })), id, { kind: "course-edit-preview", courseId: other }, services, environment);
    expect(previewed.status).toBe(200); expect(await previewed.json()).toEqual(preview);
    expect(courseEditPreview).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, courseId: other, csrfHeader: csrf }));
    const action = { kind: "course-edit" as const, courseId: other };
    const write = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `course-edit:${id}` }),
      id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    expect(courseEdit).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, idempotencyKey: `course-edit:${id}`, request: body }));
    // Fel bana i adressen, fel nyckel, utan origin och ny statusändring sedan beskedet.
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `course-edit:${id}` }),
      id, { kind: "course-edit", courseId: id }, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `course-edit:${other}` }),
      id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `course-edit:${id}`, origin: "https://evil.example" }),
      id, action, services, environment)).status).toBe(403);
    courseEdit.mockResolvedValueOnce({ status: "confirmation-required", preview });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `course-edit:${id}` }),
      id, action, services, environment)).status).toBe(409);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
  });
  it("TASK081 binds manual course/class creation to administrator CSRF, race and frozen request", async () => {
    const body = { formatVersion: 1 as const, requestId: other, expectedSnapshotVersion: 1,
      courseName: "Manuell bana", className: "Öppen", startRule: "PUNCH" as const, controlCodes: [31, 42, 31] };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: other, raceId: id,
      courseId: other, courseVersionId: other, classId: other, request: body,
      snapshotVersionBefore: 1, snapshotVersionAfter: 2, createdAt: "2026-09-19T12:00:00.000Z" };
    const manualCourseClass = vi.fn(async () => ({ status: "created" as const, response: receipt }));
    const services = { ...dependencies(), manualCourseClass };
    const action = { kind: "manual-course-class" as const };
    const headers = { "idempotency-key": `manual-course-class-create:${other}` };
    const good = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), headers), id, action, services, environment);
    expect(good.status).toBe(200); expect(await good.json()).toEqual(receipt);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify({ ...body, controlCodes: [] }), headers), id, action, services, environment)).status).toBe(400);
    // CSRF is verified by the application mutation together with session revocation;
    // this route unit test uses a service double and only proves request binding.
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { ...headers, "x-otid-csrf": "bad" }), id, action, services, environment)).status).toBe(200);
    manualCourseClass.mockResolvedValueOnce({ status: "created", response: { ...receipt, raceId: other } });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), headers), id, action, services, environment)).status).toBe(500);
  });
  it("TASK300 binds new class creation to the exact existing course and frozen request", async () => {
    const body = { formatVersion: 1 as const, requestId: other, expectedSnapshotVersion: 1,
      courseVersionId: other, className: "Öppen", startRule: "PUNCH" as const };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: other, raceId: id,
      courseId: other, courseVersionId: other, courseName: "Bana", courseVersion: 1,
      classId: other, request: body, snapshotVersionBefore: 1, snapshotVersionAfter: 2,
      createdAt: "2026-10-03T12:00:00.000Z" };
    const manualClass = vi.fn(async () => ({ status: "created" as const, response: receipt }));
    const services = { ...dependencies(), manualClass };
    const action = { kind: "manual-class" as const };
    const headers = { "idempotency-key": `manual-class-create:${other}` };
    const good = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), headers), id, action, services, environment);
    expect(good.status).toBe(200); expect(await good.json()).toEqual(receipt);
    expect(good.headers.get("cache-control")).toContain("no-store");
    expect(manualClass).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      idempotencyKey: headers["idempotency-key"], request: body, sessionToken: token }));
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify({ ...body, className: " " }), headers), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `manual-class-create:${id}` }), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { ...headers, origin: "https://other.example" }), id, action, services, environment)).status).toBe(403);
    expect(manualClass).toHaveBeenCalledTimes(1);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
    manualClass.mockResolvedValueOnce({ status: "created", response: { ...receipt, raceId: other } });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), headers), id, action, services, environment)).status).toBe(500);
  });
  it("TASK301 scopes manual class name read and write and validates frozen receipt", async () => {
    const candidate = { formatVersion: 1 as const, raceId: id, classId: other, snapshotVersion: 2,
      className: "Öpen", courseVersionId: other, editable: true };
    const body = { formatVersion: 1 as const, requestId: other, expectedSnapshotVersion: 2,
      expectedClassName: "Öpen", className: "Öppen" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: other, raceId: id,
      classId: other, courseVersionId: other, previousClassName: "Öpen", className: "Öppen",
      request: body, snapshotVersionBefore: 2, snapshotVersionAfter: 3, changedAt: "2026-10-03T12:00:00.000Z" };
    const manualClassNameCandidate = vi.fn(async () => ({ status: "ok" as const, response: candidate }));
    const manualClassName = vi.fn(async () => ({ status: "changed" as const, response: receipt }));
    const services = { ...dependencies(), manualClassNameCandidate, manualClassName };
    const action = { kind: "manual-class-name" as const, classId: other };
    const readRequest = () => new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } });
    const read = await raceAdministratorRoute(db, readRequest(), id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(candidate);
    expect(read.headers.get("cache-control")).toContain("no-store");
    const headers = { "idempotency-key": `manual-class-name:${other}` };
    const write = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), headers), id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    expect(manualClassName).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, classId: other, request: body }));
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `manual-class-name:${id}` }), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { ...headers, origin: "https://other.example" }), id, action, services, environment)).status).toBe(403);
    expect(manualClassName).toHaveBeenCalledTimes(1);
    expect((await raceAdministratorRoute(db, readRequest(), id, { ...action, classId: "invalid" }, services, environment)).status).toBe(400);
    manualClassName.mockResolvedValueOnce({ status: "changed", response: { ...receipt, classId: id } });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), headers), id, action, services, environment)).status).toBe(500);
  });
  it("TASK065 binds start-rule preview and change to administrator, class and frozen intent", async () => {
    const preview = { formatVersion: 1 as const, raceId: id, classId: other, className: "Öppen",
      snapshotVersion: 3, startRule: "FIXED" as const, entryCount: 2, fixedStartTimeCount: 1,
      entriesWithResults: 1, generatedAt: "2026-09-12T12:00:00.000Z" };
    const body = { formatVersion: 1 as const, requestId: id, expectedSnapshotVersion: 3,
      expectedStartRule: "FIXED" as const, startRule: "PUNCH" as const, reason: "Fri start" };
    const receipt = { formatVersion: 1 as const, requestId: id, raceId: id, classId: other,
      previousStartRule: "FIXED" as const, startRule: "PUNCH" as const, snapshotVersionBefore: 3,
      snapshotVersionAfter: 4, entryCount: 2, clearedStartTimes: 1, changed: true,
      changedAt: "2026-09-12T12:01:00.000Z" };
    const startRulePreview = vi.fn(async (_db: Database, input: Parameters<typeof import("@o-tid/application").previewClassStartRuleAsAdministrator>[1]) => {
      expect(input).toMatchObject({ raceId: id, classId: other, sessionToken: token });
      return { status: "ok" as const, response: preview };
    });
    const startRule = vi.fn(async (_db: Database, input: Parameters<typeof import("@o-tid/application").changeClassStartRuleAsAdministrator>[1]) => {
      expect(input).toMatchObject({ raceId: id, classId: other, sessionToken: token, request: body });
      return { status: "changed" as const, response: receipt };
    });
    const services = { ...dependencies(), startRulePreview, startRule };
    const action = { kind: "start-rule" as const, classId: other };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }), id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(preview);
    const write = await raceAdministratorRoute(db, request("PATCH", JSON.stringify(body)), id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    startRule.mockResolvedValueOnce({ status: "changed", response: { ...receipt, classId: id } });
    expect((await raceAdministratorRoute(db, request("PATCH", JSON.stringify(body)), id, action, services, environment)).status).toBe(500);
  });
  it("binder kapacitetsändring till klass, gammalt tak och version", async () => {
    const body = { formatVersion: 1, expectedCapacityVersion: 1, expectedMaxEntries: null, maxEntries: 5 };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, classId: other,
      previousMaxEntries: null, maxEntries: 5, versionBefore: 1, versionAfter: 2, entryCount: 2, changedAt: "2026-09-12T12:00:00Z" };
    const capacity = vi.fn(async () => ({ status: "changed" as const, response: receipt }));
    const req = () => request("PATCH", JSON.stringify(body), { "idempotency-key": `class-capacity:${id}` });
    const response = await raceAdministratorRoute(db, req(), id, { kind: "capacity", classId: other }, { ...dependencies(), capacity }, environment);
    expect(response.status).toBe(200);
    expect(capacity).toHaveBeenCalledWith(db, expect.objectContaining({ classId: other, request: body }));
    capacity.mockResolvedValue({ status: "changed", response: { ...receipt, maxEntries: 6 } });
    expect((await raceAdministratorRoute(db, req(), id, { kind: "capacity", classId: other }, { ...dependencies(), capacity }, environment)).status).toBe(500);
  });
});
