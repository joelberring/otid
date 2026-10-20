import { describe, expect, it, vi } from "vitest";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { db, id, other, csrf, token, environment, session, dependencies, request } from "./race-administrator-route-test-helpers";

describe("administratörsroutes: resultat och export", () => {
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
    services.authenticate.mockResolvedValueOnce({ status: "authenticated", principal: { accountId: id, raceId: id, eventId: id, grantId: id, grantRole: "FUNCTIONARY", role: "FUNCTIONARY", sessionId: id, expiresAt: session.expiresAt } });
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(403);
    expect(resultExport).not.toHaveBeenCalled();
    expect((await raceAdministratorRoute(db, request("POST"), id, action, services, environment)).status).toBe(405);
  });
  it("steg 23: ett statusflöde binder beslut, kvitto och konflikt till löparen (ADR-0173)", async () => {
    const body = { formatVersion: 1, requestId: id, expectedRevision: 0, decision: { kind: "DID_NOT_START" } };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, entryId: other, resultRevisionId: other,
      revision: 1, cause: "MANUAL_DID_NOT_START", status: "DNS" as const, reason: "DID_NOT_START", decidedAt: "2026-09-12T12:00:00Z" };
    const setEntryStatus = vi.fn(async () => ({ status: "decided" as const, response: receipt }));
    const services = { ...dependencies(), setEntryStatus };
    const action = { kind: "entry-status" as const, entryId: other };
    const req = (value: object = body, padding = 0, key = `entry-status:${id}`) =>
      request("POST", JSON.stringify(value) + " ".repeat(padding), { "idempotency-key": key });
    const result = await raceAdministratorRoute(db, req(), id, action, services, environment);
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
    expect(setEntryStatus).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, entryId: other,
      idempotencyKey: `entry-status:${id}`, request: body }));
    for (const altered of [{ raceId: other }, { entryId: id }, { requestId: other }]) {
      setEntryStatus.mockResolvedValueOnce({ status: "decided", response: { ...receipt, ...altered } });
      expect((await raceAdministratorRoute(db, req(), id, action, services, environment)).status).toBe(500);
    }
    setEntryStatus.mockResolvedValueOnce({ status: "conflict", headRevision: 3, readiness: "STALE_RESULT" } as never);
    const conflict = await raceAdministratorRoute(db, req(), id, action, services, environment);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ formatVersion: 1, error: "CONFLICT", headRevision: 3, readiness: "STALE_RESULT" });
    expect((await raceAdministratorRoute(db, req(body, 4096), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, req(body, 0, `entry-status:${other}`), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, req({ ...body, decision: { kind: "LATE" } }), id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("PATCH"), id, action, services, environment)).status).toBe(405);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, action, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);

    const status = { formatVersion: 1 as const, raceId: id, entryId: other, entryName: "Ada Test", className: "H21", headRevision: 0,
      governingDecision: "NONE" as const, noActiveResult: false, readiness: { DID_NOT_START: "READY" as const,
        DID_NOT_FINISH: "NO_ACTIVE_RESULT" as const, DISQUALIFIED: "NO_ACTIVE_RESULT" as const,
        OUT_OF_COMPETITION: "NO_ACTIVE_RESULT" as const, WITHOUT_TIMING: "NO_ACTIVE_RESULT" as const,
        APPROVE_MANUALLY: "NO_ACTIVE_RESULT" as const, FINISH_TIME: "NO_ACTIVE_RESULT" as const,
        START_TIME: "NO_ACTIVE_RESULT" as const, MANUAL_TIME: "READY" as const, APPROVE_CONTROLS: "NO_ACTIVE_RESULT" as const,
        WITHDRAW: "NO_ACTIVE_DECISION" as const },
      withdrawRestores: null, timing: null, withdrawTiming: null,
      manualTime: { knownStartTime: null, readoutFinishTime: null, hasReadout: false }, approvableControls: [] };
    const entryStatus = vi.fn(async () => ({ status: "ok" as const, response: status }));
    const read = await raceAdministratorRoute(db, request("GET"), id, action, { ...services, entryStatus }, environment);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(status);
    entryStatus.mockResolvedValueOnce({ status: "ok", response: { ...status, entryId: id } });
    expect((await raceAdministratorRoute(db, request("GET"), id, action, { ...services, entryStatus }, environment)).status).toBe(500);
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
  it("TASK033 binds single-entry effective result to private race and entry scope", async () => {
    const response = { formatVersion: 1 as const, raceId: id, entryId: id, history: [], entryVersion: 1, currentClassId: id,
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
    const body = { formatVersion: 1 as const, classId: other, engineVersion: "test-engine",
      manifestHash: candidate.manifestHash, entryIds: [other] };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, classId: other,
      manifestHash: candidate.manifestHash, snapshotVersion: 2, engineVersion: "test-engine",
      recalculatedAt: "2026-09-19T12:00:00Z", items: [{ entryId: other, resultRevisionId: id, revision: 2 }] };
    const classResultRecalculationCandidates = vi.fn<typeof import("@o-tid/application").listClassResultRecalculationCandidatesAsAdmin>()
      .mockResolvedValue({ status: "ok", response: candidate });
    const classResultRecalculate = vi.fn<typeof import("@o-tid/application").recalculateClassResultsAsAdmin>()
      .mockResolvedValue({ status: "recalculated", response: receipt });
    const services = { ...dependencies(), classResultRecalculationCandidates, classResultRecalculate };
    const action = { kind: "class-result-recalculation" as const, classId: other };
    const read = await raceAdministratorRoute(db, new Request("https://otid.example/api/admin", { headers: {
      cookie: `__Host-otid-organizer-session=${token}; __Host-otid-organizer-csrf=${csrf}`
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
    const body = { formatVersion: 1, expectedEntryVersion: 2, expectedClassId: id, expectedCardAssignmentId: id, expectedReadoutId: id, expectedLatestResultRevision: { id, revision: 4 }, expectedEngineVersion: "test-engine" };
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
      { revision: 6 }, { engineVersion: "changed-engine" }]) {
      recalculate.mockResolvedValueOnce({ status: "recalculated", response: { ...receipt, ...change } });
      expect((await raceAdministratorRoute(db, req(), id, { kind: "recalculate", entryId: id }, services, environment)).status).toBe(500);
    }
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "recalculation-candidates" }, services, environment)).status).toBe(500);
    services.authenticate.mockResolvedValueOnce({ status: "unauthorized" });
    const denied = req();
    expect((await raceAdministratorRoute(db, denied, id, { kind: "recalculate", entryId: id }, services, environment)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
  });
});
