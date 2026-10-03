import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { db, id, other, csrf, token, environment, dependencies, request } from "./race-administrator-route-test-helpers";

describe("administratörsroutes: tävlingsdagen", () => {
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
});
