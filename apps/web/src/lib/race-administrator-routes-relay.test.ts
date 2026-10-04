import { describe, expect, it, vi } from "vitest";
import { raceAdministratorRoute } from "./race-administrator-route-handlers";
import { db, id, other, environment, dependencies, request } from "./race-administrator-route-test-helpers";

describe("administratörsroutes: stafett", () => {
  it("nytt lag: kräver idempotensnyckel som binder begäran; konflikt ger 409 och GET 405", async () => {
    const body = { formatVersion: 1 as const, requestId: id, expectedSnapshotVersion: 2, classId: other, number: null, name: "OK Test 1",
      organisationName: "OK Test", runners: [{ givenName: "Ada", familyName: "Ek", organisationName: null, cardNumber: "8101" },
        { givenName: "Bo", familyName: "Ek", organisationName: null, cardNumber: null }] };
    const receipt = { formatVersion: 1 as const, replayed: false, requestId: id, raceId: id, teamId: other, number: 1, request: body,
      snapshotVersionAfter: 3, createdAt: "2026-10-04T12:00:00.000Z" };
    const relayTeam = vi.fn<typeof import("@o-tid/application").registerRelayTeamAsAdministrator>()
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
    const relayOverview = vi.fn<typeof import("@o-tid/application").getRelayOverviewAsAdministrator>()
      .mockResolvedValue({ status: "ok", response: overview });
    const services = { ...dependencies(), relayOverview };
    const shown = await raceAdministratorRoute(db, request("GET"), id, { kind: "relay" }, services, environment);
    expect(shown.status).toBe(200);
    expect(await shown.json()).toEqual(overview);
    relayOverview.mockResolvedValueOnce({ status: "ok", response: { ...overview, raceId: other } });
    expect((await raceAdministratorRoute(db, request("GET"), id, { kind: "relay" }, services, environment)).status).toBe(500);
    expect((await raceAdministratorRoute(db, request("POST", "{}"), id, { kind: "relay" }, services, environment)).status).toBe(405);
  });
});
