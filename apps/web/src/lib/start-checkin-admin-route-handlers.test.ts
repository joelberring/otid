import { describe, expect, it, vi } from "vitest";
import type {
  authenticatePairingAdminSession,
  listStartCheckinRosterAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  registerStartCheckinDeviceAsAdmin,
  syncStartCheckinAsAdmin
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  startCheckinAdminDeviceRoute,
  startCheckinAdminLoginRoute,
  startCheckinAdminLogoutRoute,
  startCheckinAdminRosterRoute,
  startCheckinAdminSessionStatusRoute,
  startCheckinAdminSyncRoute
} from "./start-checkin-admin-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const deviceId = "10000000-0000-4000-8000-000000000003";
const credentialId = "10000000-0000-4000-8000-000000000004";
const requestId = "10000000-0000-4000-8000-000000000005";
const sessionToken = `otid_org_session_v1.10000000-0000-4000-8000-000000000006.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const startCredential = `otid_org_start_checkin_v1.10000000-0000-4000-8000-000000000007.${"a".repeat(43)}`;
const finishCredential = `otid_org_finish_forest_watch_v1.10000000-0000-4000-8000-000000000008.${"a".repeat(43)}`;

function request(method: string, body?: BodyInit, headers: Record<string, string> = {}): Request {
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = body;
  return new Request(`https://otid.example/api/races/${raceId}/start-checkin`, init);
}

function unsafeHeaders(capability: "START_CHECKIN" | "FINISH_FOREST_WATCH" = "START_CHECKIN") {
  const prefix = capability === "START_CHECKIN" ? "start-checkin" : "finish-forest-watch";
  return {
    origin: "https://otid.example",
    cookie: `__Host-otid-${prefix}-admin-session=${sessionToken}; __Host-otid-${prefix}-admin-csrf=${csrfToken}`,
    "x-otid-csrf": csrfToken
  };
}

function principal(capability: "START_CHECKIN" | "FINISH_FOREST_WATCH") {
  return { status: "authenticated" as const, principal: { accessCredentialId: credentialId, raceId, capability,
    sessionId: "10000000-0000-4000-8000-000000000009", expiresAt: "2026-09-05T13:00:00.000Z" } };
}

const receipt = { formatVersion: 1 as const, storage: "STORED" as const, requestId, deviceId, raceId, entryId,
  localSequence: 1, contentHash: "a".repeat(64), receivedAt: "2026-09-05T12:00:00.000Z",
  effect: { kind: "CONFLICT" as const, revision: 0, reason: "STALE_ENTRY" as const } };

describe("TASK 006W avprickningsadmin HTTP-routes", () => {
  it.each([
    ["START_CHECKIN", startCredential, "__Host-otid-start-checkin-admin-session", "__Host-otid-finish-forest-watch-admin-session"],
    ["FINISH_FOREST_WATCH", finishCredential, "__Host-otid-finish-forest-watch-admin-session", "__Host-otid-start-checkin-admin-session"]
  ] as const)("sätter endast rätt cookiepar för %s", async (capability, accessCredential, expected, other) => {
    const login = vi.fn(async () => ({ status: "authenticated" as const, response: { formatVersion: 1 as const, raceId, capability,
      expiresAt: "2026-09-05T13:00:00.000Z" }, sessionToken, csrfToken })) as unknown as typeof loginPairingAdmin;
    const response = await startCheckinAdminLoginRoute(db, request("POST", JSON.stringify({ formatVersion: 1, accessCredential }), {
      origin: "https://otid.example", "content-type": "application/json" }), raceId, capability, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), { expectedRaceId: raceId, expectedCapability: capability });
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().join("\n");
    expect(cookies).toContain(expected);
    expect(cookies).not.toContain(other);
    expect(cookies).toContain("SameSite=Strict");
  });

  it("skiljer fel credentialprefix (401) från fel JSON-form (400)", async () => {
    const login = vi.fn() as unknown as typeof loginPairingAdmin;
    const wrongPrefix = await startCheckinAdminLoginRoute(db, request("POST", JSON.stringify({ formatVersion: 1, accessCredential: finishCredential }), {
      origin: "https://otid.example", "content-type": "application/json" }), raceId, "START_CHECKIN", login, environment);
    const malformed = await startCheckinAdminLoginRoute(db, request("POST", JSON.stringify({ formatVersion: 2 }), {
      origin: "https://otid.example", "content-type": "application/json" }), raceId, "START_CHECKIN", login, environment);
    expect(wrongPrefix.status).toBe(401);
    expect(malformed.status).toBe(400);
    expect(login).not.toHaveBeenCalled();
  });

  it("validerar raceId före tjänsten och ger aldrig en detaljrik intern respons", async () => {
    const login = vi.fn() as unknown as typeof loginPairingAdmin;
    const badRace = await startCheckinAdminLoginRoute(db, request("POST", "{}"), "inte-uuid", "START_CHECKIN", login, environment);
    expect(badRace.status).toBe(400);
    expect(login).not.toHaveBeenCalled();
    const auth = vi.fn(async () => { throw new Error("hemlig DB-detalj"); }) as unknown as typeof authenticatePairingAdminSession;
    const internal = await startCheckinAdminSessionStatusRoute(db, request("GET"), raceId, "START_CHECKIN", auth, environment);
    expect(internal.status).toBe(500);
    expect(await internal.text()).not.toContain("hemlig");
  });

  it("vidarebefordrar bara rätt funktions cookies och sessionstatus är capabilitybunden", async () => {
    const authenticate = vi.fn(async () => principal("FINISH_FOREST_WATCH")) as unknown as typeof authenticatePairingAdminSession;
    const response = await startCheckinAdminSessionStatusRoute(db, request("GET", undefined, {
      cookie: "__Host-otid-start-checkin-admin-session=other; __Host-otid-finish-forest-watch-admin-session=" + sessionToken
    }), raceId, "FINISH_FOREST_WATCH", authenticate, environment);
    expect(response.status).toBe(200);
    expect(authenticate).toHaveBeenCalledWith(db, expect.objectContaining({ capability: "FINISH_FOREST_WATCH", sessionToken }));
  });

  it("kräver origin och CSRF före device-body, och vidarebefordrar beviset", async () => {
    let reads = 0;
    const unread = { headers: new Headers(unsafeHeaders()), body: { getReader() { reads += 1; throw new Error("läst"); } } } as unknown as Request;
    const rejected = vi.fn(async () => ({ status: "forbidden" as const })) as unknown as typeof registerStartCheckinDeviceAsAdmin;
    const blocked = await startCheckinAdminDeviceRoute(db, unread, raceId, "START_CHECKIN", rejected, environment);
    expect(blocked.status).toBe(403);
    expect(reads).toBe(0);
    const register = vi.fn(async (_db: Database, input: Parameters<typeof registerStartCheckinDeviceAsAdmin>[1]) => {
      expect(input).toMatchObject({ sessionToken, csrfCookie: csrfToken, csrfHeader: csrfToken, capability: "START_CHECKIN" });
      await input.readBody();
      return { status: "registered" as const, response: { formatVersion: 1, deviceId, raceId, actorCredentialId: credentialId,
        capability: "START_CHECKIN" as const, label: "Start", registeredAt: "2026-09-05T12:00:00.000Z" } };
    }) as unknown as typeof registerStartCheckinDeviceAsAdmin;
    const accepted = await startCheckinAdminDeviceRoute(db, request("POST", JSON.stringify({ formatVersion: 1, deviceId, label: "Start" }), {
      ...unsafeHeaders(), "content-type": "application/json" }), raceId, "START_CHECKIN", register, environment);
    expect(accepted.status).toBe(200);
    const wrongRace = vi.fn(async () => ({ status: "registered" as const, response: { formatVersion: 1 as const, deviceId,
      raceId: "10000000-0000-4000-8000-000000000099", actorCredentialId: credentialId, capability: "START_CHECKIN" as const,
      label: "Start", registeredAt: "2026-09-05T12:00:00.000Z" } })) as unknown as typeof registerStartCheckinDeviceAsAdmin;
    const scoped = await startCheckinAdminDeviceRoute(db, request("POST", "{}", { ...unsafeHeaders(), "content-type": "application/json" }),
      raceId, "START_CHECKIN", wrongRace, environment);
    expect(scoped.status).toBe(500);
  });

  it("läser mutationbody först efter application-auth och översätter parsning till 400", async () => {
    const service = vi.fn(async (_db: Database, input: Parameters<typeof registerStartCheckinDeviceAsAdmin>[1]) => {
      await input.readBody();
      return { status: "registered" as const, response: { nope: true } };
    }) as unknown as typeof registerStartCheckinDeviceAsAdmin;
    const tooLarge = await startCheckinAdminDeviceRoute(db, request("POST", new Uint8Array(4097), {
      ...unsafeHeaders(), "content-type": "application/json" }), raceId, "START_CHECKIN", service, environment);
    expect(tooLarge.status).toBe(400);
  });

  it("validerar roster-output och ger 413 när läsunderlaget inte ryms", async () => {
    const tooLarge = vi.fn(async () => ({ status: "too-large" as const })) as unknown as typeof listStartCheckinRosterAsAdmin;
    const response = await startCheckinAdminRosterRoute(db, request("GET", undefined, { cookie: unsafeHeaders().cookie }), raceId, "START_CHECKIN", tooLarge, environment);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ formatVersion: 1, error: "TOO_LARGE" });
    const badSchema = vi.fn(async () => ({ status: "ok" as const, response: { formatVersion: 1 } })) as unknown as typeof listStartCheckinRosterAsAdmin;
    expect((await startCheckinAdminRosterRoute(db, request("GET"), raceId, "START_CHECKIN", badSchema, environment)).status).toBe(500);
  });

  it("requires exact review opt-in and preserves the standard service input", async () => {
    const read = vi.fn(async () => ({ status: "too-large" as const }));
    const service = read as unknown as typeof listStartCheckinRosterAsAdmin;
    for (const query of ["", "?reviewDetails=1"]) {
      await startCheckinAdminRosterRoute(db, new Request(`http://127.0.0.1:3000/roster${query}`), raceId, "START_CHECKIN", service, environment);
      const args = read.mock.calls.at(-1) as unknown as [Database, Record<string, unknown>];
      if (query) expect(args[1]).toHaveProperty("reviewDetails", true);
      else expect(args[1]).not.toHaveProperty("reviewDetails");
    }
    read.mockClear();
    for (const query of ["?reviewDetails=0", "?reviewDetails=1&reviewDetails=1", "?other=1"]) {
      expect((await startCheckinAdminRosterRoute(db, new Request(`http://127.0.0.1:3000/roster${query}`), raceId, "START_CHECKIN", service, environment)).status).toBe(400);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("returnerar durabel CONFLICT-kvittens som 200 men identitetskonflikt som 409", async () => {
    const stored = vi.fn(async (_db: Database, input: Parameters<typeof syncStartCheckinAsAdmin>[1]) => {
      await input.readBody();
      return { status: "stored" as const, response: receipt };
    }) as unknown as typeof syncStartCheckinAsAdmin;
    const ok = await startCheckinAdminSyncRoute(db, request("POST", "{}", { ...unsafeHeaders(), "content-type": "application/json" }), raceId, "START_CHECKIN", stored, environment);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(receipt);
    const conflict = vi.fn(async () => ({ status: "conflict" as const })) as unknown as typeof syncStartCheckinAsAdmin;
    const rejected = await startCheckinAdminSyncRoute(db, request("POST", "{}", { ...unsafeHeaders(), "content-type": "application/json" }), raceId, "START_CHECKIN", conflict, environment);
    expect(rejected.status).toBe(409);
  });

  it("logout kräver origin och tömmer bara den aktuella funktionens cookies", async () => {
    const logout = vi.fn(async (_db: Database, input: Parameters<typeof logoutPairingAdminSession>[1]) => {
      expect(await input.readBodyIsEmpty?.()).toBe(true);
      return { status: "logged-out" as const };
    }) as unknown as typeof logoutPairingAdminSession;
    const response = await startCheckinAdminLogoutRoute(db, request("DELETE", undefined, unsafeHeaders("FINISH_FOREST_WATCH")), raceId,
      "FINISH_FOREST_WATCH", logout, environment);
    expect(response.status).toBe(204);
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().join("\n");
    expect(cookies).toContain("__Host-otid-finish-forest-watch-admin-session");
    expect(cookies).not.toContain("__Host-otid-start-checkin-admin-session");
  });
});
