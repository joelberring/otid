import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import type { authenticatePairingAdminSession, changeEntryClassAsAdmin, listEntryClassesAsAdmin,
  loginPairingAdmin, logoutPairingAdminSession, listFixedStartSlotPlansAsAdministrator,
  listEntryTransferStartSlotsAsAdministrator } from "@o-tid/application";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { readRaceAdministratorCsrfCookie } from "./race-administrator-cookies";
import { DID_NOT_START_DECISION_POLICY_VERSION, DID_NOT_START_WITHDRAWAL_POLICY_VERSION } from "@o-tid/contracts";

const db = {} as Database;
const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const csrf = "c".repeat(43);
const token = `otid_org_session_v1.${id}.${"s".repeat(43)}`;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const session = { formatVersion: 1 as const, raceId: id, capability: "MANAGE_RACE" as const, expiresAt: "2026-09-12T13:00:00Z" };
const list = { formatVersion: 1 as const, raceId: id, snapshotVersion: 1,
  classes: [{ id, name: "Öppen" }], entries: [] };
function dependencies() {
  return {
    authenticate: vi.fn<typeof authenticatePairingAdminSession>().mockResolvedValue({ status: "authenticated", principal: {
      accessCredentialId: id, raceId: id, capability: "MANAGE_RACE", sessionId: id, expiresAt: session.expiresAt } }),
    login: vi.fn<typeof loginPairingAdmin>().mockResolvedValue({ status: "authenticated", response: session, sessionToken: token, csrfToken: csrf }),
    logout: vi.fn<typeof logoutPairingAdminSession>().mockResolvedValue({ status: "logged-out" }),
    participants: vi.fn<typeof listEntryClassesAsAdmin>().mockResolvedValue({ status: "ok", response: list }),
    changeClass: vi.fn<typeof changeEntryClassAsAdmin>().mockResolvedValue({ status: "conflict" })
  };
}
function request(method: string, body?: string, headers: Record<string, string> = {}) {
  return new Request("https://otid.example/api/admin", { method, ...(body === undefined ? {} : { body }), headers: {
    origin: environment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json", "x-otid-csrf": csrf,
    "idempotency-key": `entry-class-change:${id}`,
    cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}`, ...headers } });
}
const intent = JSON.stringify({ formatVersion: 1, classId: other, expectedEntryVersion: 1 });

describe("TASK029 gemensamma administratörsroutes", () => {
  it("TASK185 reads the speaker projection through the race administrator scope", async () => {
    const board = { formatVersion: 1 as const, raceId: id, eventName: "Test", raceName: "Lång",
      raceSnapshotVersion: 1, timeZone: "Europe/Stockholm", generatedAt: "2026-09-12T12:00:00.000Z",
      selection: "LATEST_PUBLISHED_HEADS_BY_REGISTRATION" as const, rows: [] };
    const speakerBoard = vi.fn<typeof import("@o-tid/application").listSpeakerBoardAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: board });
    const services = { ...dependencies(), speakerBoard };
    const read = new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}` } });
    const response = await raceAdministratorRoute(db, read, id, { kind: "speaker-board" }, services, environment);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(board);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(speakerBoard).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, sessionToken: token }));
    speakerBoard.mockResolvedValueOnce({ status: "ok", response: { ...board, raceId: other } });
    expect((await raceAdministratorRoute(db, new Request(read.url, { headers: read.headers }), id,
      { kind: "speaker-board" }, services, environment)).status).toBe(500);
    expect((await raceAdministratorRoute(db, request("POST"), id, { kind: "speaker-board" }, services, environment)).status).toBe(405);
  });
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
  it("TASK109 lämnar lottade startslots endast genom den privata transfergränsen", async () => {
    const response = { formatVersion: 1 as const, raceId: id, entryId: other, targetClassId: id, snapshotVersion: 2,
      targetCourseVersionId: id, targetCapacityVersion: 1, startRule: "FIXED" as const,
      plan: { status: "AVAILABLE" as const, drawRequestId: id, sourceHash: "a".repeat(64),
        slots: [{ fixedStartTime: "2026-09-20T10:00:00.000Z" }] } };
    const transferStartSlotCandidates = vi.fn<typeof listEntryTransferStartSlotsAsAdministrator>()
      .mockResolvedValue({ status: "ok", response });
    const services = { ...dependencies(), transferStartSlotCandidates };
    const read = new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } });
    const result = await raceAdministratorRoute(db, read, id,
      { kind: "transfer-start-slot-candidates", entryId: other, targetClassId: id }, services, environment);
    expect(result.status).toBe(200); expect(await result.json()).toEqual(response);
    expect(transferStartSlotCandidates).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, entryId: other, targetClassId: id }));
  });
  it("TASK093 binds one observed finish correction to its exact candidate and retry intent", async () => {
    const sourceRevisionId = "10000000-0000-4000-8000-000000000003";
    const readoutId = "10000000-0000-4000-8000-000000000004";
    const source = { resultRevisionId: sourceRevisionId, resultRevision: 1, readoutId, cause: "CARD_READOUT" as const,
      courseVersionId: id, snapshotVersion: 1, outcome: { status: "OK" as const, reason: "COMPLETE" as const },
      startTime: "2026-09-19T10:00:00.000Z", finishTime: "2026-09-19T10:30:00.000Z", elapsedMs: 1_800_000,
      latestMatchedSplitElapsedMs: 1_200_000 };
    const candidate = { formatVersion: 1 as const, raceId: id, entryId: other, entryName: "Ada Löpare", entryVersion: 1,
      classId: other, className: "Öppen", snapshotVersion: 1, basisHash: "a".repeat(64), source };
    const body = { formatVersion: 1 as const, requestId: id, entryId: other, expectedEntryVersion: 1, expectedClassId: other,
      expectedCourseVersionId: id, expectedSnapshotVersion: 1, expectedBasisHash: candidate.basisHash,
      expectedSourceResultRevisionId: sourceRevisionId, expectedSourceResultRevision: 1, expectedReadoutId: readoutId,
      expectedSourceFinishTime: source.finishTime, correctedFinishTime: "2026-09-19T10:31:00.000Z", acknowledgedCorrection: true as const };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, correctionId: id, raceId: id, entryId: other,
      classId: other, courseVersionId: id, sourceSnapshotVersion: 1, sourceBasisHash: candidate.basisHash, snapshotVersionAfter: 1,
      source, previousFinishTime: source.finishTime, correctedFinishTime: body.correctedFinishTime, elapsedMs: 1_860_000,
      createdResultRevisionId: "10000000-0000-4000-8000-000000000005", createdResultRevision: 2,
      cause: "MANUAL_FINISH_TIME_CORRECTION" as const, request: body, correctedAt: "2026-09-19T12:01:00.000Z" };
    const manualFinishTimeCorrectionCandidate = vi.fn<typeof import("@o-tid/application").previewManualFinishTimeCorrectionAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: candidate });
    const manualFinishTimeCorrection = vi.fn<typeof import("@o-tid/application").correctManualFinishTimeAsAdministrator>()
      .mockResolvedValue({ status: "corrected", response: receipt });
    const services = { ...dependencies(), manualFinishTimeCorrectionCandidate, manualFinishTimeCorrection };
    const action = { kind: "manual-finish-time-correction" as const, entryId: other };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }), id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(candidate);
    const write = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `manual-finish-time-correction:${id}` }), id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    expect(manualFinishTimeCorrection).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      idempotencyKey: `manual-finish-time-correction:${id}`, request: body }));
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify({ ...body, entryId: id }), {
      "idempotency-key": `manual-finish-time-correction:${id}` }), id, action, services, environment)).status).toBe(400);
    manualFinishTimeCorrection.mockResolvedValueOnce({ status: "corrected", response: { ...receipt, correctedFinishTime: source.finishTime } });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `manual-finish-time-correction:${id}` }), id, action, services, environment)).status).toBe(500);
  });
  it("TASK104 binds one PUNCH start correction to its exact candidate and retry intent", async () => {
    const sourceRevisionId = "10000000-0000-4000-8000-000000000003";
    const readoutId = "10000000-0000-4000-8000-000000000004";
    const source = { resultRevisionId: sourceRevisionId, resultRevision: 1, readoutId, cause: "CARD_READOUT" as const,
      courseVersionId: id, snapshotVersion: 1, startRule: "PUNCH" as const,
      outcome: { status: "OK" as const, reason: "COMPLETE" as const },
      startTime: "2026-09-20T10:00:00.000Z", finishTime: "2026-09-20T10:30:00.000Z", elapsedMs: 1_800_000,
      splits: [{ controlCode: 31, occurrence: 1, elapsedMs: 600_000, legMs: 600_000 }] };
    const candidate = { formatVersion: 1 as const, raceId: id, entryId: other, entryName: "Ada Löpare", entryVersion: 1,
      classId: other, className: "Öppen", snapshotVersion: 1, basisHash: "a".repeat(64), source };
    const body = { formatVersion: 1 as const, requestId: id, entryId: other, expectedEntryVersion: 1, expectedClassId: other,
      expectedCourseVersionId: id, expectedSnapshotVersion: 1, expectedBasisHash: candidate.basisHash,
      expectedSourceResultRevisionId: sourceRevisionId, expectedSourceResultRevision: 1, expectedReadoutId: readoutId,
      expectedSourceStartTime: source.startTime, correctedStartTime: "2026-09-20T09:59:00.000Z", acknowledgedCorrection: true as const };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, correctionId: id, raceId: id, entryId: other,
      classId: other, courseVersionId: id, sourceSnapshotVersion: 1, sourceBasisHash: candidate.basisHash, snapshotVersionAfter: 1,
      source, previousStartTime: source.startTime, correctedStartTime: body.correctedStartTime, elapsedMs: 1_860_000,
      createdResultRevisionId: "10000000-0000-4000-8000-000000000005", createdResultRevision: 2,
      cause: "MANUAL_PUNCH_START_TIME_CORRECTION" as const, request: body, correctedAt: "2026-09-20T12:01:00.000Z" };
    const manualPunchStartTimeCorrectionCandidate = vi.fn<typeof import("@o-tid/application").previewManualPunchStartTimeCorrectionAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: candidate });
    const manualPunchStartTimeCorrection = vi.fn<typeof import("@o-tid/application").correctManualPunchStartTimeAsAdministrator>()
      .mockResolvedValue({ status: "corrected", response: receipt });
    const services = { ...dependencies(), manualPunchStartTimeCorrectionCandidate, manualPunchStartTimeCorrection };
    const action = { kind: "manual-punch-start-time-correction" as const, entryId: other };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }), id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(candidate);
    const write = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `manual-punch-start-time-correction:${id}` }), id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    expect(manualPunchStartTimeCorrection).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      idempotencyKey: `manual-punch-start-time-correction:${id}`, request: body }));
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify({ ...body, entryId: id }), {
      "idempotency-key": `manual-punch-start-time-correction:${id}` }), id, action, services, environment)).status).toBe(400);
    manualPunchStartTimeCorrection.mockResolvedValueOnce({ status: "corrected", response: { ...receipt, correctedStartTime: source.startTime } });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `manual-punch-start-time-correction:${id}` }), id, action, services, environment)).status).toBe(500);
  });
  it("TASK105 binds one PUNCH-start withdrawal to its direct correction head", async () => {
    const sourceRevisionId = "10000000-0000-4000-8000-000000000003";
    const correctedRevisionId = "10000000-0000-4000-8000-000000000004";
    const candidate = { formatVersion: 1 as const, raceId: id, entryId: other, entryName: "Ada Löpare", entryVersion: 1,
      classId: other, className: "Öppen", courseVersionId: id, snapshotVersion: 1, basisHash: "a".repeat(64), correctionId: id,
      source: { id: sourceRevisionId, revision: 1, startTime: "2026-09-20T10:00:00.000Z" },
      corrected: { id: correctedRevisionId, revision: 2, startTime: "2026-09-20T09:59:00.000Z" },
      absoluteHead: { id: correctedRevisionId, revision: 2 } };
    const body = { formatVersion: 1 as const, requestId: id, entryId: other, expectedEntryVersion: 1, expectedClassId: other,
      expectedCourseVersionId: id, expectedSnapshotVersion: 1, expectedBasisHash: candidate.basisHash, expectedCorrectionId: id,
      expectedSource: { id: sourceRevisionId, revision: 1 }, expectedCorrected: { id: correctedRevisionId, revision: 2 },
      expectedAbsoluteHead: candidate.absoluteHead, acknowledgedWithdrawal: true as const };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, withdrawalId: "10000000-0000-4000-8000-000000000005",
      raceId: id, entryId: other, classId: other, courseVersionId: id, snapshotVersion: 1, correctionId: id,
      source: candidate.source, corrected: candidate.corrected,
      created: { id: "10000000-0000-4000-8000-000000000006", revision: 3, startTime: candidate.source.startTime },
      cause: "MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL" as const, request: body, withdrawnAt: "2026-09-20T12:01:00.000Z" };
    const manualPunchStartTimeCorrectionWithdrawalCandidate = vi.fn<typeof import("@o-tid/application").previewManualPunchStartTimeCorrectionWithdrawalAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: candidate });
    const manualPunchStartTimeCorrectionWithdrawal = vi.fn<typeof import("@o-tid/application").withdrawManualPunchStartTimeCorrectionAsAdministrator>()
      .mockResolvedValue({ status: "withdrawn", response: receipt });
    const services = { ...dependencies(), manualPunchStartTimeCorrectionWithdrawalCandidate, manualPunchStartTimeCorrectionWithdrawal };
    const action = { kind: "manual-punch-start-time-correction-withdrawal" as const, entryId: other };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }), id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(candidate);
    const write = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `manual-punch-start-time-correction-withdrawal:${id}` }), id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    expect(manualPunchStartTimeCorrectionWithdrawal).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      idempotencyKey: `manual-punch-start-time-correction-withdrawal:${id}`, request: body }));
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify({ ...body, acknowledgedWithdrawal: false }), {
      "idempotency-key": `manual-punch-start-time-correction-withdrawal:${id}` }), id, action, services, environment)).status).toBe(400);
  });
  it("TASK085 binds one unknown readout, its optimistic basis and idempotent resolution request", async () => {
    const candidate = { formatVersion: 1 as const, raceId: id, snapshotVersion: 1, engineVersion: "v1",
      readouts: [{ id: other, cardNumber: "85001", readAt: "2026-09-19T10:21:00.000Z", finishPunchedAt: "2026-09-19T10:20:00.000Z" }],
      classes: [{ id: other, name: "Öppen", courseVersionId: id, maxEntries: null, entryCount: 1 }],
      entries: [{ id, givenName: "Ada", familyName: "Test", organisationName: null, classId: other, entryVersion: 1,
        activeAssignment: null, latestResultRevision: null }] };
    const body = { formatVersion: 1 as const, requestId: id, target: "EXISTING_ENTRY" as const, readoutId: other,
      cardNumber: "85001", expectedSnapshotVersion: 1, expectedEngineVersion: "v1", entryId: id,
      expectedEntryVersion: 1, expectedClassId: other, expectedAssignment: null, expectedLatestResultRevision: null };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, readoutId: other,
      cardNumber: "85001", target: "EXISTING_ENTRY" as const, entryId: id, entryVersion: 2, classId: other,
      assignmentId: "10000000-0000-4000-8000-000000000003", resultRevisionId: "10000000-0000-4000-8000-000000000004",
      revision: 1, cause: "UNKNOWN_READOUT_RESOLUTION" as const, status: "OK" as const, reason: "COMPLETE" as const,
      engineVersion: "v1", snapshotVersionBefore: 1, snapshotVersionAfter: 2, courseVersionId: id,
      resolvedAt: "2026-09-19T12:01:00.000Z" };
    const unknownReadoutResolutionCandidates = vi.fn<typeof import("@o-tid/application").listUnknownReadoutResolutionCandidatesAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: candidate });
    const unknownReadoutResolution = vi.fn<typeof import("@o-tid/application").resolveUnknownReadoutAsAdministrator>()
      .mockResolvedValue({ status: "resolved", response: receipt });
    const services = { ...dependencies(), unknownReadoutResolutionCandidates, unknownReadoutResolution };
    const action = { kind: "unknown-readout-resolution" as const };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }), id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(candidate);
    expect(unknownReadoutResolutionCandidates).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, sessionToken: token }));
    const write = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `unknown-readout-resolution:${id}` }), id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    expect(unknownReadoutResolution).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      idempotencyKey: `unknown-readout-resolution:${id}`, request: body }));
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify({ ...body, requestId: other }), {
      "idempotency-key": `unknown-readout-resolution:${id}` }), id, action, services, environment)).status).toBe(400);
  });
  it("TASK102 binds operator issue, metadata list and revocation to the administrator session", async () => {
    const access = { formatVersion: 1 as const, credentialId: other, raceId: id, capability: "START_CHECKIN" as const,
      label: "Start", issuedAt: "2026-09-20T10:00:00.000Z", expiresAt: "2026-09-20T14:00:00.000Z", revokedAt: null };
    const issueBody = { formatVersion: 1 as const, capability: "START_CHECKIN" as const, label: "Start", expiresAt: access.expiresAt };
    const listAccesses = vi.fn(async () => ({ status: "ok" as const, response: { formatVersion: 1 as const, accesses: [access] } }));
    const issueOperatorAccess = vi.fn(async () => ({ status: "issued" as const, response: {
      formatVersion: 1 as const, accessCredential: `otid_org_start_checkin_v1.${other}.${"a".repeat(43)}`, access
    } }));
    const revokeOperatorAccess = vi.fn(async () => ({ status: "revoked" as const, response: {
      formatVersion: 1 as const, status: "revoked" as const, access: { ...access, revokedAt: "2026-09-20T10:01:00.000Z" }
    } }));
    const services = { ...dependencies(), operatorAccesses: listAccesses, issueOperatorAccess, revokeOperatorAccess };
    const action = { kind: "operator-access" as const };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }), id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual({ formatVersion: 1, accesses: [access] });
    const issued = await raceAdministratorRoute(db, request("POST", JSON.stringify(issueBody)), id, action, services, environment);
    expect(issued.status).toBe(201);
    expect(await issued.text()).toMatch(/"accessCredential":"otid_org_start_checkin_v1\./);
    expect(issueOperatorAccess).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, request: issueBody }));
    const revoked = await raceAdministratorRoute(db, request("DELETE", JSON.stringify({ formatVersion: 1, credentialId: other })), id, action, services, environment);
    expect(revoked.status).toBe(200); expect(await revoked.json()).toMatchObject({ status: "revoked" });
    expect(revokeOperatorAccess).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, request: { formatVersion: 1, credentialId: other } }));
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify({ ...issueBody, capability: "PAIR_STATION" })), id, action, services, environment)).status).toBe(400);
  });
  it("TASK084 binds a result-bearing course relink to its candidate basis and exact administrator intent", async () => {
    const candidate = { formatVersion: 1 as const, raceId: id, courseId: id, courseName: "Manuell", classId: other,
      className: "Öppen", snapshotVersion: 2, classCourseVersionId: id, classCourseVersion: 1,
      currentControlCodes: [31, 42, 31], historicalResultRevisionCount: 1, basisHash: "a".repeat(64),
      entries: [{ entryId: other, entryVersion: 1, latestResultRevision: { id, revision: 1, courseVersionId: id,
        snapshotVersion: 2, published: true, status: "OK", reason: "COMPLETE", cause: "CARD_READOUT" }, effectiveManualDecision: null }] };
    const body = { formatVersion: 1 as const, requestId: id, expectedSnapshotVersion: 2, expectedBasisHash: candidate.basisHash,
      courseId: id, classId: other, expectedClassCourseVersionId: id, controlCodes: [31, 31, 42], acknowledgedImpact: true as const };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, courseId: id, classId: other,
      previousCourseVersionId: id, previousCourseVersion: 1, courseVersionId: "10000000-0000-4000-8000-000000000003", courseVersion: 2,
      sourceSnapshotVersion: 2, sourceBasisHash: candidate.basisHash, request: body, entryCount: 1,
      historicalResultRevisionCount: 1, snapshotVersionAfter: 3, changedAt: "2026-09-19T12:01:00.000Z" };
    const manualCourseResultBearingRelinkCandidate = vi.fn<typeof import("@o-tid/application").previewManualCourseResultBearingRelinkAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: candidate });
    const manualCourseResultBearingRelink = vi.fn<typeof import("@o-tid/application").relinkManualCourseResultBearingClassAsAdministrator>()
      .mockResolvedValue({ status: "changed", response: receipt });
    const services = { ...dependencies(), manualCourseResultBearingRelinkCandidate, manualCourseResultBearingRelink };
    const action = { kind: "manual-course-result-bearing-link" as const, classId: other };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }), id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(candidate);
    expect(manualCourseResultBearingRelinkCandidate).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, classId: other, sessionToken: token }));
    const write = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `manual-course-result-bearing-link:${id}` }), id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    expect(manualCourseResultBearingRelink).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      idempotencyKey: `manual-course-result-bearing-link:${id}`, request: body }));
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify({ ...body, acknowledgedImpact: false }), {
      "idempotency-key": `manual-course-result-bearing-link:${id}` }), id, action, services, environment)).status).toBe(400);
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
  it("TASK083 returns a read-only manual-course result impact only for its administrator class", async () => {
    const impact = { formatVersion: 1 as const, raceId: id, classId: other, className: "Öppen",
      course: { id, name: "Manuell", currentVersionId: id, currentVersion: 1, controlCodes: [31, 42, 31] },
      snapshotVersion: 2, totals: { entryCount: 1, entriesWithResults: 1, historicalResultRevisions: 2 },
      entries: [{ entryId: other, displayName: "Ada Test", latestResultRevision: { id, revision: 2,
        status: "OK", courseVersionId: id, snapshotVersion: 2, published: true, effectiveManualDecision: "NONE" as const } }],
      generatedAt: "2026-09-19T12:00:00.000Z" };
    const manualCourseResultImpact = vi.fn<typeof import("@o-tid/application").getManualCourseResultImpactAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: impact });
    const services = { ...dependencies(), manualCourseResultImpact };
    const action = { kind: "manual-course-result-impact" as const, classId: other };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }),
    id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(impact);
    expect(manualCourseResultImpact).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, classId: other, sessionToken: token }));
    expect((await raceAdministratorRoute(db, request("POST"), id, action, services, environment)).status).toBe(405);
    manualCourseResultImpact.mockResolvedValueOnce({ status: "not-found" });
    expect((await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }),
    id, action, services, environment)).status).toBe(404);
  });
  it("TASK082 binds the manual course-version preview and relink receipt to one administrator class", async () => {
    const preview = { formatVersion: 1 as const, raceId: id, courseId: other, classId: other,
      courseName: "Manuell", className: "Öppen", snapshotVersion: 2, classCourseVersionId: id,
      classCourseVersion: 1, controlCodes: [31, 42, 31], entryCount: 1, resultRevisionCount: 0,
      canRelink: true, generatedAt: "2026-09-19T12:00:00.000Z" };
    const body = { formatVersion: 1 as const, requestId: id, expectedSnapshotVersion: 2,
      courseId: other, classId: other, expectedClassCourseVersionId: id, controlCodes: [31, 31, 42] };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id,
      courseId: other, classId: other, previousCourseVersionId: id, previousCourseVersion: 1,
      courseVersionId: "10000000-0000-4000-8000-000000000003", courseVersion: 2, request: body,
      entryCount: 1, snapshotVersionBefore: 2, snapshotVersionAfter: 3, changedAt: "2026-09-19T12:01:00.000Z" };
    const manualCourseVersionRelinkPreview = vi.fn(async () => ({ status: "ok" as const, response: preview }));
    const manualCourseVersionRelink = vi.fn<typeof import("@o-tid/application").relinkManualCourseVersionClassAsAdministrator>()
      .mockResolvedValue({ status: "changed" as const, response: receipt });
    const services = { ...dependencies(), manualCourseVersionRelinkPreview, manualCourseVersionRelink };
    const action = { kind: "manual-course-version-link" as const, classId: other };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}` } }),
    id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(preview);
    expect(manualCourseVersionRelinkPreview).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, classId: other, sessionToken: token }));
    const write = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `manual-course-version-link:${id}` }), id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    expect(manualCourseVersionRelink).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      idempotencyKey: `manual-course-version-link:${id}`, request: body }));
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify({ ...body, classId: id }), {
      "idempotency-key": `manual-course-version-link:${id}` }), id, action, services, environment)).status).toBe(400);
    manualCourseVersionRelink.mockResolvedValueOnce({ status: "results-exist" as const });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `manual-course-version-link:${id}` }), id, action, services, environment)).status).toBe(409);
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
  it("TASK063 uses administrator authority and binds review receipts to the submitted intent", async () => {
    const body = { formatVersion: 1, requestId: id, entryId: other, sourceHash: "a".repeat(64),
      conflictRequestIds: [id], decision: "KEEP_CURRENT_STATE", reason: "Kontrollerat" };
    const response = { formatVersion: 1, requestId: body.requestId, entryId: body.entryId, sourceHash: body.sourceHash,
      conflictRequestIds: body.conflictRequestIds, decision: body.decision,
      raceId: id, reviewId: other, reviewedAt: "2026-09-12T12:00:00.000Z" };
    const reviewConflicts = vi.fn(async (_db: Database, input: Parameters<typeof import("@o-tid/application").reviewStartCheckinConflictsAsAdmin>[1]) => {
      expect(input).toMatchObject({ raceId: id, capability: "MANAGE_RACE", sessionToken: token });
      expect(await input.readBody()).toEqual(body);
      return { status: "reviewed" as const, response: { ...response, formatVersion: 1 as const, decision: "KEEP_CURRENT_STATE" as const } };
    });
    const services = { ...dependencies(), reviewConflicts };
    const action = { kind: "review-conflicts" as const };
    const good = await raceAdministratorRoute(db, request("POST", JSON.stringify(body)), id, action, services, environment);
    expect(good.status).toBe(200); expect(good.headers.get("cache-control")).toContain("no-store");
    reviewConflicts.mockResolvedValueOnce({ status: "reviewed", response: { ...response, formatVersion: 1, decision: "KEEP_CURRENT_STATE", entryId: id } });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body)), id, action, services, environment)).status).toBe(500);
    expect((await raceAdministratorRoute(db, request("POST", "x".repeat(65537)), id, action, services, environment)).status).toBe(413);
    expect(reviewConflicts).toHaveBeenCalledTimes(2);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await raceAdministratorRoute(db, request("POST", "invalid"), id, action, services, environment)).status).toBe(401);
    expect(reviewConflicts).toHaveBeenCalledTimes(2);
  });
  it("TASK048 binds frozen list and bytes to race and finalization under admin boundary", async () => {
    const metadata = { id: other, raceId: id, scope: "RACE" as const, classId: null, scopeRevision: 1,
      sourceSnapshotVersion: 1, basisHash: "a".repeat(64), frozenProjectionHash: "b".repeat(64),
      completeXmlSha256: "c".repeat(64), entryCount: 1, classCount: 1, finalizedAt: "2026-09-12T12:00:00Z" };
    const frozenResults = vi.fn(async () => ({ status: "ok" as const,
      response: { formatVersion: 1 as const, raceId: id, finalizations: [metadata] } }));
    const frozenResult = vi.fn(async () => ({ status: "ok" as const, finalization: metadata, bytes: new TextEncoder().encode("frozen") }));
    const services = { ...dependencies(), frozenResults, frozenResult };
    const action = { kind: "frozen-result" as const, finalizationId: other };
    const list = await raceAdministratorRoute(db, request("GET"), id, { kind: "frozen-results" }, services, environment);
    expect(list.status).toBe(200); expect(list.headers.get("cache-control")).toContain("no-store");
    const response = await raceAdministratorRoute(db, request("GET"), id, action, services, environment);
    expect(response.status).toBe(200); expect(await response.text()).toBe("frozen");
    expect(response.headers.get("x-otid-finalization-id")).toBe(other);
    expect(response.headers.get("x-otid-content-sha256")).toBe(metadata.completeXmlSha256);
    for (const altered of [{ id }, { raceId: other }]) {
      frozenResult.mockResolvedValueOnce({ status: "ok", finalization: { ...metadata, ...altered }, bytes: new Uint8Array() });
      expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(500);
    }
    frozenResults.mockResolvedValueOnce({ status: "ok", response: { formatVersion: 1, raceId: id, finalizations: [{ ...metadata, raceId: other }] } });
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "frozen-results" }, services, environment)).status).toBe(500);
    expect((await raceAdministratorRoute(db, request("GET"), id, { ...action, finalizationId: "bad" }, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("POST"), id, action, services, environment)).status).toBe(405);
    frozenResult.mockClear();
    services.authenticate.mockResolvedValueOnce({ status: "forbidden" });
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(403);
    expect(frozenResult).not.toHaveBeenCalled();
  });
  it("TASK047 returns private XML only for the actual scoped administrator", async () => {
    const bytes = new TextEncoder().encode("<ResultList/>"), metadata = { formatVersion: 1 as const, raceId: id,
      snapshotVersion: 1, classCount: 0, resultCount: 0, staleResultCount: 0, omittedEntryCount: 1, sha256: "a".repeat(64) };
    const resultExport = vi.fn(async () => ({ status: "ok" as const, bytes, metadata }));
    const services = { ...dependencies(), resultExport }, action = { kind: "result-export" as const };
    const response = await raceAdministratorRoute(db, request("GET"), id, action, services, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(response.headers.get("x-otid-omitted-entry-count")).toBe("1");
    expect(await response.text()).toBe("<ResultList/>");
    expect(resultExport).toHaveBeenCalledWith(db, { raceId: id, sessionToken: token });
    resultExport.mockResolvedValueOnce({ status: "ok", bytes, metadata: { ...metadata, raceId: other } });
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(500);
    expect((await raceAdministratorRoute(db, request("GET"), id, action,
      { ...services, resultExport: async () => ({ status: "conflict" }) }, environment)).status).toBe(409);
    expect((await raceAdministratorRoute(db, request("GET"), id, action,
      { ...services, resultExport: async () => ({ status: "too-large" }) }, environment)).status).toBe(413);
    resultExport.mockClear();
    services.authenticate.mockResolvedValueOnce({ status: "authenticated", principal: {
      accessCredentialId: id, raceId: id, capability: "EXPORT_IOF_RESULT_LIST", sessionId: id, expiresAt: session.expiresAt } });
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(403);
    expect(resultExport).not.toHaveBeenCalled();
    expect((await raceAdministratorRoute(db, request("POST"), id, action, services, environment)).status).toBe(405);
  });
  it("TASK044 binds approval and restoration to exact targets, revisions and technical outcome", async () => {
    const targetId = "10000000-0000-4000-8000-000000000003", approvalId = "10000000-0000-4000-8000-000000000004";
    const body = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedResultRevision: { id: targetId, revision: 1, status: "MP", reason: "MISSING_CONTROL" }, policyVersion: "manual-result-approval-v1" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      resultApprovalDecisionId: id, targetResultRevisionId: targetId, targetResultRevision: 1, targetReason: "MISSING_CONTROL" as const, resultRevisionId: approvalId,
      revision: 2, cause: "MANUAL_RESULT_APPROVAL" as const, status: "OK" as const, reason: "MANUAL_APPROVAL" as const,
      policyVersion: "manual-result-approval-v1" as const, snapshotVersion: 6, courseVersionId: other, decidedAt: "2026-09-12T12:00:00Z" };
    const approval = vi.fn(async () => ({ status: "approved" as const, response: receipt }));
    const services = { ...dependencies(), approval }, action = { kind: "approval" as const, entryId: other };
    const req = (padding = 0) => request("POST", JSON.stringify(body) + " ".repeat(padding), { "idempotency-key": `manual-result-approval:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(200);
    for (const altered of [{ raceId: other }, { entryId: id }, { requestId: other }, { targetResultRevisionId: id },
      { targetResultRevision: 2 }, { revision: 9 }, { snapshotVersion: 7 }, { courseVersionId: id }]) {
      approval.mockResolvedValueOnce({ status: "approved", response: { ...receipt, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, req(4096), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
    const withdrawBody = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedResultApprovalDecisionId: id, expectedTargetResultRevision: { id: targetId, revision: 1, status: "MP", reason: "MISSING_CONTROL" },
      expectedApprovedResultRevision: { id: approvalId, revision: 2 }, expectedAbsoluteResultRevision: { id: approvalId, revision: 2 },
      expectedRestorationSourceResultRevision: { id: targetId, revision: 1, status: "OK", reason: "COMPLETE" },
      policyVersion: "manual-result-approval-withdrawal-v1" };
    const restored = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      resultApprovalWithdrawalId: id, resultApprovalDecisionId: id, approvedResultRevisionId: approvalId,
      restorationSourceResultRevisionId: targetId, restorationResultRevisionId: id, revision: 3,
      cause: "MANUAL_RESULT_APPROVAL_WITHDRAWAL" as const, status: "OK" as "OK" | "MP",
      reason: "COMPLETE" as "COMPLETE" | "MISSING_CONTROL",
      policyVersion: "manual-result-approval-withdrawal-v1" as const, snapshotVersion: 6, courseVersionId: other, withdrawnAt: "2026-09-12T12:01:00Z" };
    const approvalWithdrawal = vi.fn(async () => ({ status: "withdrawn" as const, response: restored }));
    const withdrawalServices = { ...dependencies(), approvalWithdrawal }, withdrawalAction = { kind: "approval-withdrawal" as const, entryId: other };
    const withdrawReq = () => request("POST", JSON.stringify(withdrawBody), { "idempotency-key": `manual-result-approval-withdrawal:${id}` });
    expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(200);
    for (const altered of [{ resultApprovalDecisionId: other }, { restorationSourceResultRevisionId: id }, { revision: 4 },
      { status: "MP" as const, reason: "MISSING_CONTROL" as const }]) {
      approvalWithdrawal.mockResolvedValueOnce({ status: "withdrawn", response: { ...restored, ...altered } });
      expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(500);
    }
  });
  it("TASK042 binds DSQ and restoration to exact targets, revisions and technical outcome", async () => {
    const targetId = "10000000-0000-4000-8000-000000000003", dsqId = "10000000-0000-4000-8000-000000000004";
    const body = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedResultRevision: { id: targetId, revision: 1, status: "OK" }, policyVersion: "manual-disqualification-v1" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      resultDisqualificationDecisionId: id, targetResultRevisionId: targetId, targetResultRevision: 1, resultRevisionId: dsqId,
      revision: 2, cause: "MANUAL_DISQUALIFICATION" as const, status: "DSQ" as const, reason: "MANUAL_DISQUALIFICATION" as const,
      policyVersion: "manual-disqualification-v1" as const, snapshotVersion: 6, courseVersionId: other, decidedAt: "2026-09-12T12:00:00Z" };
    const dsq = vi.fn(async () => ({ status: "disqualified" as const, response: receipt }));
    const services = { ...dependencies(), dsq }, action = { kind: "disqualification" as const, entryId: other };
    const req = (padding = 0) => request("POST", JSON.stringify(body) + " ".repeat(padding), { "idempotency-key": `manual-disqualification:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(200);
    for (const altered of [{ raceId: other }, { entryId: id }, { requestId: other }, { targetResultRevisionId: id },
      { targetResultRevision: 2 }, { revision: 9 }, { snapshotVersion: 7 }, { courseVersionId: id }]) {
      dsq.mockResolvedValueOnce({ status: "disqualified", response: { ...receipt, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, req(4096), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
    const withdrawBody = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedResultDisqualificationDecisionId: id, expectedTargetResultRevision: { id: targetId, revision: 1 },
      expectedDisqualifiedResultRevision: { id: dsqId, revision: 2 }, expectedAbsoluteResultRevision: { id: dsqId, revision: 2 },
      expectedRestorationSourceResultRevision: { id: targetId, revision: 1, status: "OK", reason: "COMPLETE" },
      policyVersion: "manual-disqualification-withdrawal-v1" };
    const restored = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      resultDisqualificationWithdrawalId: id, resultDisqualificationDecisionId: id, disqualifiedResultRevisionId: dsqId,
      restorationSourceResultRevisionId: targetId, restorationResultRevisionId: id, revision: 3,
      cause: "MANUAL_DISQUALIFICATION_WITHDRAWAL" as const, status: "OK" as "OK" | "MP",
      reason: "COMPLETE" as "COMPLETE" | "MISSING_CONTROL",
      policyVersion: "manual-disqualification-withdrawal-v1" as const, snapshotVersion: 6, courseVersionId: other, withdrawnAt: "2026-09-12T12:01:00Z" };
    const dsqWithdrawal = vi.fn(async () => ({ status: "withdrawn" as const, response: restored }));
    const withdrawalServices = { ...dependencies(), dsqWithdrawal }, withdrawalAction = { kind: "disqualification-withdrawal" as const, entryId: other };
    const withdrawReq = () => request("POST", JSON.stringify(withdrawBody), { "idempotency-key": `manual-disqualification-withdrawal:${id}` });
    expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(200);
    for (const altered of [{ resultDisqualificationDecisionId: other }, { restorationSourceResultRevisionId: id }, { revision: 4 },
      { status: "MP" as const, reason: "MISSING_CONTROL" as const }]) {
      dsqWithdrawal.mockResolvedValueOnce({ status: "withdrawn", response: { ...restored, ...altered } });
      expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(500);
    }
  });
  it("TASK041 binds DNF and restoration to exact targets, revisions and technical outcome", async () => {
    const targetId = "10000000-0000-4000-8000-000000000003", dnfId = "10000000-0000-4000-8000-000000000004";
    const body = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedResultRevision: { id: targetId, revision: 1, status: "OK" }, policyVersion: "did-not-finish-v1" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      didNotFinishDecisionId: id, targetResultRevisionId: targetId, targetResultRevision: 1, resultRevisionId: dnfId,
      revision: 2, cause: "MANUAL_DID_NOT_FINISH" as const, status: "DNF" as const, reason: "DID_NOT_FINISH" as const,
      policyVersion: "did-not-finish-v1" as const, snapshotVersion: 6, courseVersionId: other, decidedAt: "2026-09-12T12:00:00Z" };
    const dnf = vi.fn(async () => ({ status: "did-not-finish" as const, response: receipt }));
    const services = { ...dependencies(), dnf }, action = { kind: "did-not-finish" as const, entryId: other };
    const req = (padding = 0) => request("POST", JSON.stringify(body) + " ".repeat(padding), { "idempotency-key": `did-not-finish:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(200);
    for (const altered of [{ raceId: other }, { entryId: id }, { requestId: other }, { targetResultRevisionId: id },
      { targetResultRevision: 2 }, { revision: 9 }, { snapshotVersion: 7 }, { courseVersionId: id }]) {
      dnf.mockResolvedValueOnce({ status: "did-not-finish", response: { ...receipt, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, req(4096), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
    const withdrawBody = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedDidNotFinishDecisionId: id, expectedTargetResultRevision: { id: targetId, revision: 1 },
      expectedDidNotFinishResultRevision: { id: dnfId, revision: 2 }, expectedAbsoluteResultRevision: { id: dnfId, revision: 2 },
      expectedRestorationSourceResultRevision: { id: targetId, revision: 1, status: "OK", reason: "COMPLETE" },
      reason: "ERRONEOUS_MANUAL_DID_NOT_FINISH", policyVersion: "did-not-finish-withdrawal-v1" };
    const restored = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      didNotFinishWithdrawalId: id, didNotFinishDecisionId: id, didNotFinishResultRevisionId: dnfId,
      restorationSourceResultRevisionId: targetId, restorationResultRevisionId: id, revision: 3,
      cause: "MANUAL_DID_NOT_FINISH_WITHDRAWAL" as const, status: "OK" as "OK" | "MP",
      reason: "COMPLETE" as "COMPLETE" | "MISSING_CONTROL", withdrawalReason: "ERRONEOUS_MANUAL_DID_NOT_FINISH" as const,
      policyVersion: "did-not-finish-withdrawal-v1" as const, snapshotVersion: 6, courseVersionId: other, withdrawnAt: "2026-09-12T12:01:00Z" };
    const dnfWithdrawal = vi.fn(async () => ({ status: "withdrawn" as const, response: restored }));
    const withdrawalServices = { ...dependencies(), dnfWithdrawal }, withdrawalAction = { kind: "did-not-finish-withdrawal" as const, entryId: other };
    const withdrawReq = () => request("POST", JSON.stringify(withdrawBody), { "idempotency-key": `did-not-finish-withdrawal:${id}` });
    expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(200);
    for (const altered of [{ didNotFinishDecisionId: other }, { restorationSourceResultRevisionId: id }, { revision: 4 },
      { status: "MP" as const, reason: "MISSING_CONTROL" as const }]) {
      dnfWithdrawal.mockResolvedValueOnce({ status: "withdrawn", response: { ...restored, ...altered } });
      expect((await raceAdministratorRoute(db, withdrawReq(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(500);
    }
  });
  it("TASK040 binds DNS and withdrawal receipts with the shared admin and rejects invalid writes", async () => {
    const body = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedLatestResultRevision: null, policyVersion: DID_NOT_START_DECISION_POLICY_VERSION };
    const dnsReceipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      didNotStartDecisionId: id, resultRevisionId: other, revision: 1 as const, cause: "MANUAL_DID_NOT_START" as const,
      status: "DNS" as const, reason: "DID_NOT_START" as const, decisionPolicyVersion: DID_NOT_START_DECISION_POLICY_VERSION as typeof DID_NOT_START_DECISION_POLICY_VERSION,
      snapshotVersion: 6, courseVersionId: other, decidedAt: "2026-09-12T12:00:00Z" };
    const dns = vi.fn(async () => ({ status: "decided" as const, response: dnsReceipt }));
    const services = { ...dependencies(), dns };
    const action = { kind: "did-not-start" as const, entryId: other };
    const req = (padding = 0) => request("POST", JSON.stringify(body) + " ".repeat(padding), { "idempotency-key": `did-not-start:${id}` });
    const result = await raceAdministratorRoute(db, req(), id, action, services, environment);
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
    for (const altered of [{ raceId: other }, { entryId: id }, { requestId: other }, { courseVersionId: id }, { snapshotVersion: 7 }]) {
      dns.mockResolvedValueOnce({ status: "decided", response: { ...dnsReceipt, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, req(4096), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);

    const withdrawBody = { formatVersion: 1, expectedEntryVersion: 1, expectedClassId: other, expectedCourseVersionId: other,
      expectedSnapshotVersion: 6, expectedDidNotStartDecisionId: id, expectedResultRevision: { id: other, revision: 1 },
      policyVersion: DID_NOT_START_WITHDRAWAL_POLICY_VERSION };
    const withdrawalReceipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other,
      withdrawalId: id, didNotStartDecisionId: id, withdrawnResultRevisionId: other, withdrawnResultRevision: 1,
      withdrawalPolicyVersion: DID_NOT_START_WITHDRAWAL_POLICY_VERSION as typeof DID_NOT_START_WITHDRAWAL_POLICY_VERSION, reason: "ERRONEOUS_MANUAL_DNS" as const,
      withdrawnAt: "2026-09-12T12:01:00Z" };
    const dnsWithdrawal = vi.fn(async () => ({ status: "withdrawn" as const, response: withdrawalReceipt }));
    const withdrawalServices = { ...dependencies(), dnsWithdrawal }, withdrawalAction = { kind: "did-not-start-withdrawal" as const, entryId: other };
    const withdrawalRequest = () => request("POST", JSON.stringify(withdrawBody), { "idempotency-key": `did-not-start-withdrawal:${id}` });
    expect((await raceAdministratorRoute(db, withdrawalRequest(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(200);
    for (const altered of [{ raceId: other }, { entryId: id }, { requestId: other }, { didNotStartDecisionId: other },
      { withdrawnResultRevisionId: id }, { withdrawnResultRevision: 2 }]) {
      dnsWithdrawal.mockResolvedValueOnce({ status: "withdrawn", response: { ...withdrawalReceipt, ...altered } });
      expect((await raceAdministratorRoute(db, withdrawalRequest(), id, withdrawalAction, withdrawalServices, environment)).status).toBe(500);
    }
  });
  it("TASK039 read-only history binds scope/cursor, rejects unknown queries and keeps admin boundary", async () => {
    const response = { formatVersion: 1 as const, raceId: id, entryId: other, entryVersion: 6, snapshotVersion: 8,
      generatedAt: "2026-09-12T12:00:00Z", timeZone: "Europe/Stockholm", items: [], nextBeforeVersion: null };
    const changes = vi.fn(async () => ({ status: "ok" as const, response }));
    const services = { ...dependencies(), changes }, action = { kind: "changes" as const, entryId: other };
    const req = (query = "") => new Request(`https://otid.example/api/admin${query}`, { headers: request("GET").headers });
    const result = await raceAdministratorRoute(db, req("?beforeVersion=6"), id, action, services, environment);
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
    expect(changes).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, entryId: other, beforeVersion: 6 }));
    for (const query of ["?beforeVersion=0", "?beforeVersion=01", "?beforeVersion=2147483648", "?beforeVersion=2&beforeVersion=3", "?name=private"]) {
      expect((await raceAdministratorRoute(db, req(query), id, action, services, environment)).status).toBe(400);
    }
    expect((await raceAdministratorRoute(db, request("POST"), id, action, services, environment)).status).toBe(405);
    for (const altered of [{ raceId: other }, { entryId: id }]) {
      changes.mockResolvedValueOnce({ status: "ok", response: { ...response, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const calls = changes.mock.calls.length;
    expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(401);
    expect(changes).toHaveBeenCalledTimes(calls);
  });
  it("TASK036 binds read-only candidate search to snapshot and authenticates before names", async () => {
    const body = { formatVersion: 1, expectedSnapshotVersion: 6, givenName: "Test", familyName: "Person", cardNumber: null };
    const response = { formatVersion: 1 as const, raceId: id, snapshotVersion: 6, totalMatches: 0, candidates: [] };
    const registrationCandidates = vi.fn(async () => ({ status: "ok" as const, response }));
    const services = { ...dependencies(), registrationCandidates }, action = { kind: "registration-candidates" as const };
    const req = (padding = 0) => request("POST", JSON.stringify(body) + " ".repeat(padding));
    const result = await raceAdministratorRoute(db, req(), id, action, services, environment);
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
    expect(registrationCandidates).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, request: body }));
    for (const altered of [{ raceId: other }, { snapshotVersion: 7 }]) {
      registrationCandidates.mockResolvedValueOnce({ status: "ok", response: { ...response, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, req(4096), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
  });
  it("TASK035 binds registration receipt and retains admin/body boundaries", async () => {
    const body = { formatVersion: 1, classId: id, expectedCourseVersionId: id, expectedStartRule: "PUNCH",
      expectedSnapshotVersion: 6, givenName: "Ny", familyName: "Testperson", organisationName: null,
      cardNumber: null, fixedStartTime: null };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id,
      entryId: other, entryVersion: 1 as const, classId: id, givenName: "Ny", familyName: "Testperson",
      organisationName: null as string | null, cardNumber: null as string | null, assignmentId: null as string | null,
      fixedStartTime: null as string | null, assignedStartSlot: null, snapshotVersionBefore: 6, snapshotVersionAfter: 7,
      createdAt: "2026-09-12T12:00:00Z" };
    const registration = vi.fn(async () => ({ status: "registered" as const, response: receipt }));
    const services = { ...dependencies(), registration };
    const req = (padding = 0) => request("POST", JSON.stringify({ ...body, givenName: " Ny " }) + " ".repeat(padding),
      { "idempotency-key": `entry-registration:${id}` });
    const action = { kind: "registration" as const };
    expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(200);
    expect(registration).toHaveBeenCalledWith(db, expect.objectContaining({ request: body }));
    for (const altered of [{ raceId: other }, { requestId: other }, { classId: other },
      { snapshotVersionBefore: 7, snapshotVersionAfter: 8 }, { givenName: "Fel" }, { familyName: "Fel" },
      { organisationName: "Fel" }, { cardNumber: "123456", assignmentId: id }, { fixedStartTime: "2026-09-12T12:00:00Z" }]) {
      registration.mockResolvedValueOnce({ status: "registered", response: { ...receipt, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, req(4096), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
  });
  it("TASK034 binds identity receipt, keeps 8 KiB limit and checks admin before body", async () => {
    const previousIdentity = { givenName: "Test", familyName: "Löpare", organisationName: null };
    const identity = { ...previousIdentity, givenName: "Rättat", organisationName: "Testklubb" };
    const body = { formatVersion: 1, expectedEntryVersion: 2, expectedClassId: id,
      expectedSnapshotVersion: 3, expectedIdentity: previousIdentity, identity };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: id,
      classId: id, previousIdentity, identity, entryVersionBefore: 2, entryVersionAfter: 3,
      snapshotVersionBefore: 3, snapshotVersionAfter: 4, changedAt: "2026-09-12T12:00:00Z" };
    const change = vi.fn(async () => ({ status: "changed" as const, response: receipt }));
    const candidates = vi.fn(async () => ({ status: "ok" as const, response: {
      formatVersion: 1 as const, raceId: id, snapshotVersion: 3, entries: [] } }));
    const services = { ...dependencies(), identity: change, identityCandidates: candidates };
    const req = (padding = 0) => request("PATCH", JSON.stringify({ ...body,
      identity: { ...identity, givenName: " Rättat " } }) + " ".repeat(padding),
    { "idempotency-key": `entry-identity-change:${id}` });
    const action = { kind: "identity" as const, entryId: id };
    const result = await raceAdministratorRoute(db, req(4200), id, action, services, environment);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(change).toHaveBeenCalledWith(db, expect.objectContaining({ request: body }));
    for (const altered of [{ raceId: other }, { entryId: other }, { classId: other }, { requestId: other },
      { entryVersionBefore: 3, entryVersionAfter: 4 }, { snapshotVersionBefore: 4, snapshotVersionAfter: 5 },
      { identity: { ...identity, familyName: "Fel" } }, { previousIdentity: { ...previousIdentity, givenName: "Fel" } }]) {
      change.mockResolvedValueOnce({ status: "changed", response: { ...receipt, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, req(8192), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("POST"), id, action, services, environment)).status).toBe(405);
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "identity-candidates" }, services, environment)).status).toBe(200);
    candidates.mockResolvedValueOnce({ status: "ok", response: { formatVersion: 1, raceId: other, snapshotVersion: 3, entries: [] } });
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "identity-candidates" }, services, environment)).status).toBe(500);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
  });
  it("TASK033 binds single-entry effective result to private race and entry scope", async () => {
    const response = { formatVersion: 1 as const, raceId: id, entryId: id, entryVersion: 1, currentClassId: id,
      snapshotVersion: 1, generatedAt: "2026-09-12T12:00:00.000Z", timeZone: "Europe/Stockholm",
      state: "NO_PUBLISHED_RESULT" as const, selectedRevision: null };
    const effectiveResult = vi.fn(async () => ({ status: "ok" as const, response }));
    const services = { ...dependencies(), effectiveResult };
    const result = await raceAdministratorRoute(db, request("GET"), id, { kind: "effective-result", entryId: id }, services, environment);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(effectiveResult).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, entryId: id }));
    for (const change of [{ entryId: other }, { raceId: other }]) {
      effectiveResult.mockResolvedValueOnce({ status: "ok", response: { ...response, ...change } });
      expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "effective-result", entryId: id }, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, request("POST"), id, { kind: "effective-result", entryId: id }, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "effective-result", entryId: id }, services, environment)).status).toBe(401);
  });
  it("TASK091 binds one class manifest and its exact atomic receipt", async () => {
    const candidate = { formatVersion: 1 as const, raceId: id, classId: other, className: "D21", snapshotVersion: 2,
      engineVersion: "test-engine", manifestHash: "a".repeat(64), entries: [{ id: other, entryVersion: 1,
        displayName: "Ada Test", readiness: "READY" as const, cardAssignmentId: id, readoutId: id,
        latestResultRevision: { id, revision: 1, snapshotVersion: 1 } }] };
    const body = { formatVersion: 1 as const, classId: other, snapshotVersion: 2, engineVersion: "test-engine",
      manifestHash: candidate.manifestHash, entryIds: [other] };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, classId: other,
      manifestHash: candidate.manifestHash, snapshotVersion: 2, engineVersion: "test-engine",
      recalculatedAt: "2026-09-19T12:00:00Z", items: [{ entryId: other, resultRevisionId: id, revision: 2 }] };
    const classResultRecalculationCandidates = vi.fn<typeof import("@o-tid/application").listClassResultRecalculationCandidatesAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: candidate });
    const classResultRecalculate = vi.fn<typeof import("@o-tid/application").recalculateClassResultsAsAdministrator>()
      .mockResolvedValue({ status: "recalculated", response: receipt });
    const services = { ...dependencies(), classResultRecalculationCandidates, classResultRecalculate };
    const action = { kind: "class-result-recalculation" as const, classId: other };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-race-administrator-session=${token}; __Host-otid-race-administrator-csrf=${csrf}`
    } }), id, action, services, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(candidate);
    expect(classResultRecalculationCandidates).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, classId: other }));
    const write = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `class-result-recalculation:${id}` }), id, action, services, environment);
    expect(write.status).toBe(200); expect(await write.json()).toEqual(receipt);
    expect(classResultRecalculate).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      idempotencyKey: `class-result-recalculation:${id}`, request: body }));
    classResultRecalculate.mockResolvedValueOnce({ status: "recalculated", response: { ...receipt, items: [] } as never });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), {
      "idempotency-key": `class-result-recalculation:${id}` }), id, action, services, environment)).status).toBe(500);
    expect((await raceAdministratorRoute(db, request("PATCH"), id, action, services, environment)).status).toBe(405);
  });
  it("TASK032 binder omräkningskvittens och privat kandidatscope", async () => {
    const body = { formatVersion: 1, expectedEntryVersion: 2, expectedClassId: id, expectedSnapshotVersion: 3,
      expectedCardAssignmentId: id, expectedReadoutId: id, expectedLatestResultRevision: { id, revision: 4 }, expectedEngineVersion: "test-engine" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: id,
      readoutId: id, resultRevisionId: other, revision: 5, cause: "EXPLICIT_RECALCULATION" as const,
      status: "OK" as const, reason: "COMPLETE" as const, engineVersion: "test-engine", snapshotVersion: 3,
      courseVersionId: id, recalculatedAt: "2026-09-12T12:00:00Z" };
    const recalculate = vi.fn(async () => ({ status: "recalculated" as const, response: receipt }));
    const recalculationCandidates = vi.fn(async () => ({ status: "ok" as const,
      response: { formatVersion: 1 as const, raceId: other, snapshotVersion: 3, engineVersion: "test-engine", entries: [] } }));
    const services = { ...dependencies(), recalculate, recalculationCandidates };
    const req = () => request("POST", JSON.stringify(body), { "idempotency-key": `result-recalculation:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, { kind: "recalculate", entryId: id }, services, environment)).status).toBe(200);
    for (const change of [{ raceId: other }, { entryId: other }, { readoutId: other }, { requestId: other },
      { revision: 6 }, { snapshotVersion: 4 }, { engineVersion: "changed-engine" }]) {
      recalculate.mockResolvedValueOnce({ status: "recalculated", response: { ...receipt, ...change } });
      expect((await raceAdministratorRoute(db, req(), id, { kind: "recalculate", entryId: id }, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "recalculation-candidates" }, services, environment)).status).toBe(500);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, { kind: "recalculate", entryId: id }, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
  });
  it("TASK031 normaliserar och binder hela starttidskvittensen", async () => {
    const body = { formatVersion: 1, expectedEntryVersion: 2, expectedClassId: id, expectedSnapshotVersion: 3,
      expectedFixedStartTime: "2026-09-12T10:00:00.000Z", fixedStartTime: "2026-09-12T10:01:00.000Z" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: id, classId: id,
      previousFixedStartTime: body.expectedFixedStartTime, fixedStartTime: body.fixedStartTime,
      entryVersionBefore: 2, entryVersionAfter: 3, snapshotVersionBefore: 3, snapshotVersionAfter: 4,
      changedAt: "2026-09-12T12:00:00Z" };
    const startTime = vi.fn(async () => ({ status: "changed" as const, response: receipt }));
    const services = { ...dependencies(), startTime };
    const req = () => request("PATCH", JSON.stringify({ ...body, fixedStartTime: "2026-09-12T12:01:00+02:00" }),
      { "idempotency-key": `entry-start-time-change:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, { kind: "start-time", entryId: id }, services, environment)).status).toBe(200);
    expect(startTime).toHaveBeenCalledWith(db, expect.objectContaining({ request: body }));
    for (const change of [{ raceId: other }, { entryId: other }, { classId: other }, { requestId: other },
      { previousFixedStartTime: "2026-09-12T09:00:00.000Z" }, { fixedStartTime: "2026-09-12T11:00:00.000Z" },
      { entryVersionBefore: 3, entryVersionAfter: 4 }, { snapshotVersionBefore: 4, snapshotVersionAfter: 5 }]) {
      startTime.mockResolvedValueOnce({ status: "changed", response: { ...receipt, ...change } });
      expect((await raceAdministratorRoute(db, req(), id, { kind: "start-time", entryId: id }, services, environment)).status).toBe(500);
    }
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, { kind: "start-time", entryId: id }, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
  });
  it("TASK030 binder brickkvittensen till hela intentet och kräver verklig admin", async () => {
    const body = { formatVersion: 1, expectedEntryVersion: 3, expectedClassId: id,
      expectedSnapshotVersion: 4, expectedAssignment: { id, cardNumber: "123" }, cardNumber: "456" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: id, classId: id,
      previousAssignment: body.expectedAssignment, activeAssignment: { id: other, cardNumber: "456" },
      entryVersionBefore: 3, entryVersionAfter: 4, snapshotVersionBefore: 4, snapshotVersionAfter: 5,
      changedAt: "2026-09-12T12:00:00Z" };
    const card = vi.fn(async () => ({ status: "changed" as const, response: receipt }));
    const services = { ...dependencies(), card };
    const req = () => request("PATCH", JSON.stringify({ ...body, cardNumber: " 456 " }), { "idempotency-key": `entry-card-change:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, { kind: "card", entryId: id }, services, environment)).status).toBe(200);
    expect(card).toHaveBeenCalledWith(db, expect.objectContaining({ request: body, idempotencyKey: `entry-card-change:${id}` }));
    for (const change of [{ entryId: other }, { classId: other }, { requestId: other },
      { previousAssignment: { id: other, cardNumber: "123" } }, { previousAssignment: { id, cardNumber: "789" } },
      { activeAssignment: { id: other, cardNumber: "789" } }, { entryVersionBefore: 4, entryVersionAfter: 5 },
      { snapshotVersionBefore: 5, snapshotVersionAfter: 6 }]) {
      card.mockResolvedValueOnce({ status: "changed", response: { ...receipt, ...change } });
      expect((await raceAdministratorRoute(db, req(), id, { kind: "card", entryId: id }, services, environment)).status).toBe(500);
    }
    services.authenticate.mockResolvedValueOnce({ status: "authenticated", principal: { accessCredentialId: id,
      raceId: id, capability: "CHANGE_ENTRY_CARD", sessionId: id, expiresAt: session.expiresAt } });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, { kind: "card", entryId: id }, services, environment)).status).toBe(403);
    expect(denied.bodyUsed).toBe(false);
  });
  it("TASK073 binder hyrstatus till exakt aktiv brickkoppling och kvittens", async () => {
    const body = { formatVersion: 1, expectedEntryVersion: 3, expectedClassId: id, expectedSnapshotVersion: 4,
      expectedAssignment: { id, cardNumber: "123", isRental: false }, isRental: true };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: id,
      classId: id, assignment: { id, cardNumber: "123" }, previousIsRental: false, isRental: true,
      entryVersionBefore: 3, entryVersionAfter: 4, snapshotVersionBefore: 4, snapshotVersionAfter: 5,
      changedAt: "2026-09-18T08:00:00Z" };
    const cardRental = vi.fn(async () => ({ status: "changed" as const, response: receipt }));
    const services = { ...dependencies(), cardRental };
    const req = () => request("PATCH", JSON.stringify(body),
      { "idempotency-key": `entry-card-rental-change:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, { kind: "card-rental", entryId: id }, services, environment)).status).toBe(200);
    expect(cardRental).toHaveBeenCalledWith(db, expect.objectContaining({ request: body,
      idempotencyKey: `entry-card-rental-change:${id}` }));
    for (const change of [{ raceId: other }, { entryId: other }, { classId: other }, { requestId: other },
      { assignment: { id: other, cardNumber: "123" } }, { assignment: { id, cardNumber: "456" } },
      { previousIsRental: true, isRental: false }, { entryVersionBefore: 4, entryVersionAfter: 5 },
      { snapshotVersionBefore: 5, snapshotVersionAfter: 6 }]) {
      cardRental.mockResolvedValueOnce({ status: "changed", response: { ...receipt, ...change } });
      expect((await raceAdministratorRoute(db, req(), id, { kind: "card-rental", entryId: id }, services, environment)).status).toBe(500);
    }
  });
  it("TASK143 binder återanvändning till återlämnad källassignment och ny målassignment", async () => {
    const assignmentId = "10000000-0000-4000-8000-000000000003";
    const targetAssignmentId = "10000000-0000-4000-8000-000000000004";
    const body = { formatVersion: 1, expectedSnapshotVersion: 4,
      source: { entryId: other, classId: other, entryVersion: 2,
        assignment: { id: assignmentId, cardNumber: "123", isRental: true, rentalReturned: true } },
      expectedTargetClassId: id, expectedTargetEntryVersion: 3 };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id,
      source: { entryId: other, classId: other, assignment: { id: assignmentId, cardNumber: "123" } },
      target: { entryId: id, classId: id,
        assignment: { id: targetAssignmentId, cardNumber: "123", isRental: true as const, rentalReturned: false as const } },
      sourceEntryVersionBefore: 2, sourceEntryVersionAfter: 3,
      targetEntryVersionBefore: 3, targetEntryVersionAfter: 4,
      snapshotVersionBefore: 4, snapshotVersionAfter: 5,
      changedAt: "2026-09-22T10:00:00Z" };
    const cardRentalReuse = vi.fn<typeof import("@o-tid/application").reuseReturnedRentalCardAsAdministrator>()
      .mockResolvedValue({ status: "changed", response: receipt });
    const services = { ...dependencies(), cardRentalReuse };
    const req = () => request("PATCH", JSON.stringify(body), { "idempotency-key": `entry-card-rental-reuse:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, { kind: "card-rental-reuse", entryId: id }, services, environment)).status).toBe(200);
    expect(cardRentalReuse).toHaveBeenCalledWith(db, expect.objectContaining({ request: body,
      idempotencyKey: `entry-card-rental-reuse:${id}`, entryId: id }));
    for (const change of [{ raceId: other }, { requestId: other },
      { source: { ...receipt.source, entryId: id } },
      { target: { ...receipt.target, classId: other } },
      { sourceEntryVersionBefore: 3, sourceEntryVersionAfter: 4 },
      { targetEntryVersionBefore: 4, targetEntryVersionAfter: 5 },
      { snapshotVersionBefore: 5, snapshotVersionAfter: 6 }]) {
      cardRentalReuse.mockResolvedValueOnce({ status: "changed", response: { ...receipt, ...change } } as never);
      expect((await raceAdministratorRoute(db, req(), id, { kind: "card-rental-reuse", entryId: id }, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, request("PATCH", JSON.stringify({
      ...body,
      source: { ...body.source, assignment: { ...body.source.assignment, rentalReturned: false } }
    }), { "idempotency-key": `entry-card-rental-reuse:${id}` }),
    id, { kind: "card-rental-reuse", entryId: id }, services, environment)).status).toBe(400);
  });
  it("TASK142 binder privat betalstatus till deltagar- och betalstatusversion utan publika följder", async () => {
    const body = { formatVersion: 1, expectedEntryVersion: 3, expectedClassId: id,
      expectedPaymentStatus: "UNMARKED", expectedPaymentStatusVersion: 1, paymentStatus: "PAID" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: id,
      classId: id, previousPaymentStatus: "UNMARKED" as const, paymentStatus: "PAID" as const,
      entryVersionAtChange: 3, paymentStatusVersionBefore: 1, paymentStatusVersionAfter: 2,
      changedAt: "2026-09-22T08:00:00Z" };
    const paymentStatus = vi.fn<typeof import("@o-tid/application").changeEntryPaymentStatusAsAdministrator>()
      .mockResolvedValue({ status: "changed", response: receipt });
    const services = { ...dependencies(), paymentStatus };
    const req = () => request("PATCH", JSON.stringify(body),
      { "idempotency-key": `entry-payment-status-change:${id}` });
    expect((await raceAdministratorRoute(db, req(), id, { kind: "payment-status", entryId: id }, services, environment)).status).toBe(200);
    expect(paymentStatus).toHaveBeenCalledWith(db, expect.objectContaining({ request: body,
      idempotencyKey: `entry-payment-status-change:${id}` }));
    for (const change of [{ raceId: other }, { entryId: other }, { classId: other }, { requestId: other },
      { entryVersionAtChange: 4 }, { previousPaymentStatus: "UNPAID" }, { paymentStatus: "UNPAID" },
      { paymentStatusVersionBefore: 2, paymentStatusVersionAfter: 3 },
      { paymentStatusVersionBefore: 1, paymentStatusVersionAfter: 3 }]) {
      paymentStatus.mockResolvedValueOnce({ status: "changed", response: { ...receipt, ...change } } as never);
      expect((await raceAdministratorRoute(db, req(), id, { kind: "payment-status", entryId: id }, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, request("PATCH", JSON.stringify({ ...body, amount: 100 }),
      { "idempotency-key": `entry-payment-status-change:${id}` }), id,
    { kind: "payment-status", entryId: id }, services, environment)).status).toBe(400);
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
  it("använder en egen session med säkra cookies och strikt verklig roll", async () => {
    const services = dependencies();
    const result = await raceAdministratorRoute(db, request("POST", JSON.stringify({ formatVersion: 1,
      accessCredential: `otid_org_race_admin_v1.${id}.${"a".repeat(43)}` })), id, { kind: "session" }, services, environment);
    expect(result.status).toBe(200);
    expect(services.login).toHaveBeenCalledWith(db, expect.anything(), { expectedRaceId: id, expectedCapability: "MANAGE_RACE" });
    const cookies = result.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__Host-otid-race-administrator-session=");
    expect(cookies[0]).toContain("HttpOnly");
    for (const cookie of cookies) for (const value of ["Secure", "SameSite=Strict", "Path=/"]) expect(cookie).toContain(value);
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it("stoppar origin/obehörig före body och begränsar faktisk storlek", async () => {
    const services = dependencies();
    const badOrigin = request("PATCH", intent, { origin: "https://wrong.example" });
    expect((await raceAdministratorRoute(db, badOrigin, id, { kind: "class", entryId: id }, services, environment)).status).toBe(403);
    expect(services.authenticate).not.toHaveBeenCalled();
    expect(badOrigin.bodyUsed).toBe(false);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const unauthenticated = request("PATCH", intent);
    expect((await raceAdministratorRoute(db, unauthenticated, id, { kind: "class", entryId: id }, services, environment)).status).toBe(401);
    expect(unauthenticated.bodyUsed).toBe(false);
    expect((await raceAdministratorRoute(db, request("PATCH", " ".repeat(4097)), id, { kind: "class", entryId: id }, services, environment)).status).toBe(400);
    expect(services.changeClass).not.toHaveBeenCalled();
  });
  it("läser inte begränsad cookie som administratör och binder listans race", async () => {
    const services = dependencies();
    const req = request("GET", undefined, { cookie: `__Host-otid-entry-class-admin-session=${token}` });
    await raceAdministratorRoute(db, req, id, { kind: "participants" }, services, environment);
    expect(services.authenticate).toHaveBeenCalledWith(db, expect.objectContaining({ capability: "MANAGE_RACE", sessionToken: null }));
    services.participants.mockResolvedValueOnce({ status: "ok", response: { ...list, raceId: other } });
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "participants" }, services, environment)).status).toBe(500);
    services.authenticate.mockResolvedValueOnce({ status: "authenticated", principal: { accessCredentialId: id,
      raceId: id, capability: "CHANGE_ENTRY_CLASS", sessionId: id, expiresAt: session.expiresAt } });
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "participants" }, services, environment)).status).toBe(403);
  });
  it("bevarar exakt klassintent och kontrollerar kvittensens mål", async () => {
    const services = dependencies();
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: id,
      previousClassId: id, classId: other, entryVersionBefore: 1, entryVersionAfter: 2,
      snapshotVersionBefore: 1, snapshotVersionAfter: 2, changedAt: "2026-09-12T12:00:00Z" };
    services.changeClass.mockResolvedValue({ status: "changed", response: receipt });
    const result = await raceAdministratorRoute(db, request("PATCH", intent), id, { kind: "class", entryId: id }, services, environment);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(receipt);
    expect(services.changeClass).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, entryId: id,
      idempotencyKey: `entry-class-change:${id}`, request: { formatVersion: 1, classId: other, expectedEntryVersion: 1 } }));
    services.changeClass.mockResolvedValue({ status: "changed", response: { ...receipt, entryId: other } });
    expect((await raceAdministratorRoute(db, request("PATCH", intent), id, { kind: "class", entryId: id }, services, environment)).status).toBe(500);
  });
  it("logout gäller gemensam roll och rensar just dess cookies", async () => {
    const services = dependencies();
    const response = await raceAdministratorRoute(db, request("DELETE"), id, { kind: "session" }, services, environment);
    expect(response.status).toBe(204);
    expect(services.logout).toHaveBeenCalledWith(db, expect.objectContaining({ capability: "MANAGE_RACE", sessionToken: token }));
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.getSetCookie().every((cookie) => cookie.includes("Max-Age=0"))).toBe(true);
    expect(readRaceAdministratorCsrfCookie(`__Host-otid-race-administrator-csrf=${csrf}`, new URL(environment.O_TID_PUBLIC_ORIGIN))).toBe(csrf);
    expect(readRaceAdministratorCsrfCookie(`__Host-otid-race-administrator-csrf=${csrf}; __Host-otid-race-administrator-csrf=${csrf}`,
      new URL(environment.O_TID_PUBLIC_ORIGIN))).toBeUndefined();
  });
  it("binder atomiskt transferintent inklusive tid och bevarar korrekt kvittens", async () => {
    const services = dependencies();
    const body = { formatVersion: 1 as const, expectedEntryVersion: 1, expectedClassId: id,
      expectedSnapshotVersion: 3, expectedFixedStartTime: null, targetClassId: other,
      expectedTargetCourseVersionId: id, expectedTargetStartRule: "FIXED" as const,
      fixedStartTime: "2026-09-12T10:30:00.000Z" };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: id,
      request: body, entryVersionAfter: 2, snapshotVersionAfter: 4, changedAt: "2026-09-12T12:00:00Z", assignedStartSlot: null };
    const transfer = vi.fn(async () => ({ status: "transferred" as const, response: receipt }));
    const response = await raceAdministratorRoute(db, request("PATCH", JSON.stringify({ ...body, fixedStartTime: "2026-09-12T12:30:00+02:00" }),
      { "idempotency-key": `entry-transfer:${id}` }), id, { kind: "transfer", entryId: id }, { ...services, transfer }, environment);
    expect(response.status).toBe(200);
    expect(transfer).toHaveBeenCalledWith(db, expect.objectContaining({ request: body, idempotencyKey: `entry-transfer:${id}` }));
    transfer.mockResolvedValue({ status: "transferred", response: { ...receipt, request: { ...body, fixedStartTime: "2026-09-12T10:31:00.000Z" } } });
    expect((await raceAdministratorRoute(db, request("PATCH", JSON.stringify(body), { "idempotency-key": `entry-transfer:${id}` }),
      id, { kind: "transfer", entryId: id }, { ...services, transfer }, environment)).status).toBe(500);
  });
});
