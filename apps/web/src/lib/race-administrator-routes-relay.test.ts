import { describe, expect, it, vi } from "vitest";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { db, id, other, environment, dependencies, request } from "./race-administrator-route-test-helpers";

describe("administratörsroutes: stafett", () => {
  it("nytt lag: kräver idempotensnyckel som binder begäran; konflikt ger 409 och GET 405", async () => {
    const body = { formatVersion: 1 as const, requestId: id, classId: other, number: null, name: "OK Test 1",
      organisationName: "OK Test", runners: [{ givenName: "Ada", familyName: "Ek", organisationName: null, cardNumber: "8101" },
        { givenName: "Bo", familyName: "Ek", organisationName: null, cardNumber: null }] };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, teamId: other, number: 1, request: body,
      snapshotVersionAfter: 3, createdAt: "2026-10-04T12:00:00.000Z" };
    const relayTeam = vi.fn<typeof import("@o-tid/application").registerRelayTeamAsAdmin>()
      .mockResolvedValue({ status: "saved", response: receipt });
    const services = { ...dependencies(), relayTeam };
    const action = { kind: "relay-team" as const };
    const saved = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `relay-team:${id}` }),
      id, action, services, environment);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual(receipt);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `relay-team:${other}` }),
      id, action, services, environment)).status).toBe(400);
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify({ ...body, runners: [body.runners[0], body.runners[0]] }),
      { "idempotency-key": `relay-team:${id}` }), id, action, services, environment)).status).toBe(400);
    relayTeam.mockResolvedValueOnce({ status: "conflict" });
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `relay-team:${id}` }),
      id, action, services, environment)).status).toBe(409);
    expect((await raceAdministratorRoute(db, request("GET"), id, action, services, environment)).status).toBe(405);
  });

  it("lagvyn läses med GET och kvittot måste gälla tävlingen", async () => {
    const overview = { formatVersion: 1 as const, raceId: id, snapshotVersion: 2, timeZone: "Europe/Stockholm", classes: [], teams: [] };
    const relayOverview = vi.fn<typeof import("@o-tid/application").getRelayOverviewAsAdmin>()
      .mockResolvedValue({ status: "ok", response: overview });
    const services = { ...dependencies(), relayOverview };
    const shown = await raceAdministratorRoute(db, request("GET"), id, { kind: "relay" }, services, environment);
    expect(shown.status).toBe(200);
    expect(await shown.json()).toEqual(overview);
    relayOverview.mockResolvedValueOnce({ status: "ok", response: { ...overview, raceId: other } });
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "relay" }, services, environment)).status).toBe(500);
    expect((await raceAdministratorRoute(db, request("POST", "{}"), id, { kind: "relay" }, services, environment)).status).toBe(405);
  });

  it("ändrad stafettklass (steg 47): besked att bekräfta och borttagen sträcka med resultat ger 409 med orsak", async () => {
    const body = { formatVersion: 1 as const, requestId: id, classId: other, name: "Stafett", restartRanking: "AFTER_NORMAL" as const,
      forking: "EVEN" as const, confirmResultChanges: false, legs: [
        { leg: 1, startMethod: "MASS_START" as const, startTime: "2026-10-04T15:00:00.000Z", variantCode: null, courseId: null, restartAfterMinutes: null },
        { leg: 2, startMethod: "FLYING_RESTART" as const, startTime: null, variantCode: null, courseId: other, restartAfterMinutes: 60 }] };
    const preview = { formatVersion: 1 as const, raceId: id, classId: other, readOutCount: 1, recalculatedCount: 1, addedLegs: [], removedLegs: [],
      changes: [{ displayName: "Ada Ek", leg: 2, teamNumber: 1, before: "OK" as const, after: "MP" as const }], requiresConfirmation: true };
    const relayClassEdit = vi.fn<typeof import("@o-tid/application").editRelayClassAsAdmin>()
      .mockResolvedValue({ status: "confirmation-required", preview });
    const services = { ...dependencies(), relayClassEdit };
    const action = { kind: "relay-class-edit" as const };
    const refused = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `relay-class-edit:${id}` }),
      id, action, services, environment);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ formatVersion: 1, error: "CONFIRMATION_REQUIRED", preview });
    relayClassEdit.mockResolvedValueOnce({ status: "leg-has-result" });
    const blocked = await raceAdministratorRoute(db, request("POST", JSON.stringify(body), { "idempotency-key": `relay-class-edit:${id}` }),
      id, action, services, environment);
    expect(await blocked.json()).toEqual({ formatVersion: 1, error: "LEG_HAS_RESULT" });
    // Flygande omstart utan minuter avvisas av kontraktet.
    const invalid = { ...body, legs: [body.legs[0], { ...body.legs[1], restartAfterMinutes: null }] };
    expect((await raceAdministratorRoute(db, request("POST", JSON.stringify(invalid), { "idempotency-key": `relay-class-edit:${id}` }),
      id, action, services, environment)).status).toBe(400);
  });
});
