import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { db, id, other, csrf, token, environment, dependencies, request } from "./race-administrator-route-test-helpers";

describe("administratörsroutes: tävlingsdagen", () => {
  it("TASK185 reads the speaker projection through the race administrator scope", async () => {
    const board = { formatVersion: 1 as const, raceId: id, eventName: "Test", raceName: "Lång",
      raceSnapshotVersion: 1, timeZone: "Europe/Stockholm", generatedAt: "2026-09-12T12:00:00.000Z",
      selection: "LATEST_PUBLISHED_HEADS_BY_REGISTRATION" as const, rows: [] };
    const speakerBoard = vi.fn<typeof import("@o-tid/application").listSpeakerBoardAsAdmin>()
      .mockResolvedValue({ status: "ok", response: board });
    const services = { ...dependencies(), speakerBoard };
    const read = new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-organizer-session=${token}` } });
    const response = await raceAdministratorRoute(db, read, id, { kind: "speaker-board" }, services, environment);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(board);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(speakerBoard).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, sessionToken: token }));
    speakerBoard.mockResolvedValueOnce({ status: "ok", response: { ...board, raceId: other } });
    expect((await raceAdministratorRoute(db, new Request(read.url, { headers: read.headers }), id,
      { kind: "speaker-board" }, services, environment)).status).toBe(500);
    expect((await raceAdministratorRoute(db, request("POST"), id, { kind: "speaker-board" }, services, environment)).status).toBe(405);
  });
  it("TASK085 binds one unknown readout, its optimistic basis and idempotent resolution request", async () => {
    const candidate = { formatVersion: 1 as const, raceId: id, snapshotVersion: 1, engineVersion: "v1",
      readouts: [{ id: other, cardNumber: "85001", readAt: "2026-09-19T10:21:00.000Z", finishPunchedAt: "2026-09-19T10:20:00.000Z" }],
      classes: [{ id: other, name: "Öppen", courseVersionId: id, maxEntries: null, entryCount: 1 }],
      entries: [{ id, givenName: "Ada", familyName: "Test", organisationName: null, classId: other, entryVersion: 1,
        activeAssignment: null, latestResultRevision: null }] };
    const body = { formatVersion: 1 as const, requestId: id, target: "EXISTING_ENTRY" as const, readoutId: other,
      cardNumber: "85001", expectedEngineVersion: "v1", entryId: id,
      expectedEntryVersion: 1, expectedClassId: other, expectedAssignment: null, expectedLatestResultRevision: null };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, readoutId: other,
      cardNumber: "85001", target: "EXISTING_ENTRY" as const, entryId: id, entryVersion: 2, classId: other,
      assignmentId: "10000000-0000-4000-8000-000000000003", resultRevisionId: "10000000-0000-4000-8000-000000000004",
      revision: 1, cause: "UNKNOWN_READOUT_RESOLUTION" as const, status: "OK" as const, reason: "COMPLETE" as const,
      engineVersion: "v1", snapshotVersionBefore: 1, snapshotVersionAfter: 2, courseVersionId: id,
      resolvedAt: "2026-09-19T12:01:00.000Z" };
    const unknownReadoutResolutionCandidates = vi.fn<typeof import("@o-tid/application").listUnknownReadoutResolutionCandidatesAsAdmin>()
      .mockResolvedValue({ status: "ok", response: candidate });
    const unknownReadoutResolution = vi.fn<typeof import("@o-tid/application").resolveUnknownReadoutAsAdmin>()
      .mockResolvedValue({ status: "resolved", response: receipt });
    const services = { ...dependencies(), unknownReadoutResolutionCandidates, unknownReadoutResolution };
    const action = { kind: "unknown-readout-resolution" as const };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-organizer-session=${token}; __Host-otid-organizer-csrf=${csrf}` } }), id, action, services, environment);
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
  it("TASK063 uses administrator authority and binds review receipts to the submitted intent", async () => {
    const body = { formatVersion: 1, requestId: id, entryId: other, sourceHash: "a".repeat(64),
      conflictRequestIds: [id], decision: "KEEP_CURRENT_STATE", reason: "Kontrollerat" };
    const response = { formatVersion: 1, requestId: body.requestId, entryId: body.entryId, sourceHash: body.sourceHash,
      conflictRequestIds: body.conflictRequestIds, decision: body.decision,
      raceId: id, reviewId: other, reviewedAt: "2026-09-12T12:00:00.000Z" };
    const reviewConflicts = vi.fn(async (_db: Database, input: Parameters<typeof import("@o-tid/application").reviewStartCheckinConflictsAsAdmin>[1]) => {
      expect(input).toMatchObject({ raceId: id, sessionToken: token });
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
