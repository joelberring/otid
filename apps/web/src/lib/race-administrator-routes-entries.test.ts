import { describe, expect, it, vi } from "vitest";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { readRaceAdministratorCsrfCookie } from "./race-administrator-cookies";
import { db, id, other, csrf, token, environment, session, list, dependencies, request, intent } from "./race-administrator-route-test-helpers";

describe("administratörsroutes: session och deltagare", () => {
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
      fixedStartTime: null as string | null, startTimeAssigned: false, snapshotVersionBefore: 6, snapshotVersionAfter: 7,
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
  it("sessionen öppnas bara med kontot: POST /session finns inte (ADR-0168)", async () => {
    const services = dependencies();
    const result = await raceAdministratorRoute(db, request("POST", JSON.stringify({ formatVersion: 1 })), id,
      { kind: "session" }, services, environment);
    expect(result.status).toBe(405);
    expect(result.headers.get("allow")).toBe("GET, DELETE");
    expect(services.authenticate).not.toHaveBeenCalled();
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
      request: body, entryVersionAfter: 2, snapshotVersionAfter: 4, changedAt: "2026-09-12T12:00:00Z" };
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
