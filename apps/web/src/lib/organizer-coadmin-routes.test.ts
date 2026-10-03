import { describe, expect, it, vi } from "vitest";
import type {
  authenticateUserAccountSession,
  grantEventAdministratorAsUserAccount,
  listEventAdministratorsAsUserAccount,
  revokeEventAdministratorAsUserAccount
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  organizerEventAdministratorGrantRoute,
  organizerEventAdministratorRevokeRoute,
  organizerEventAdministratorsListRoute
} from "./organizer-account-route-handlers";

const db = {} as Database;
const origin = "https://otid.example";
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: origin } as const;
const eventId = "10000000-0000-4000-8000-000000000001";
const grantId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const sessionId = "10000000-0000-4000-8000-000000000004";
const session = `otid_user_session_v1.${sessionId}.${"s".repeat(43)}`;
const csrf = "c".repeat(43);
const cookies = `__Host-otid-organizer-session=${session}; __Host-otid-organizer-csrf=${csrf}`;
const proofHeaders = { origin, cookie: cookies, "x-otid-csrf": csrf };
const auth = vi.fn(async () => ({ status: "authenticated" as const,
  principal: { accountId: "10000000-0000-4000-8000-000000000005", sessionId, displayName: "Ägare", expiresAt: "2026-09-23T12:00:00.000Z" } })) as unknown as typeof authenticateUserAccountSession;

function req(method: string, body?: unknown, headers: Record<string, string> = {}, path = "") {
  return new Request(`${origin}/api/organizer/events/${eventId}/administrators${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

describe("TASK151 organizer coadministrator HTTP routes", () => {
  it("lists only a schema-valid event history with no-store headers", async () => {
    const list = vi.fn(async () => ({ status: "ok" as const,
      response: { formatVersion: 1 as const, eventId, grants: [] } })) as unknown as typeof listEventAdministratorsAsUserAccount;
    const response = await organizerEventAdministratorsListRoute(db, req("GET", undefined, { cookie: cookies }), eventId, list, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ formatVersion: 1, eventId, grants: [] });
    expect(list).toHaveBeenCalledWith(db, expect.objectContaining({ eventId, sessionToken: session }));
  });

  it("requires exact origin, authenticated CSRF and idempotency before reading a grant body", async () => {
    const grant = vi.fn() as unknown as typeof grantEventAdministratorAsUserAccount;
    const badOrigin = req("POST", { ignored: true }, { ...proofHeaders, origin: "https://evil.example" });
    const denied = await organizerEventAdministratorGrantRoute(db, badOrigin, eventId, grant, auth, environment);
    expect(denied.status).toBe(403);
    expect(grant).not.toHaveBeenCalled();
    const body = { formatVersion: 1, requestId, eventId, loginName: "coadmin", role: "ADMIN" };
    const response = await organizerEventAdministratorGrantRoute(db, req("POST", body, {
      ...proofHeaders, "idempotency-key": `organizer-admin-grant:${requestId}`
    }), eventId, vi.fn(async (_database: Database, input: Parameters<typeof grantEventAdministratorAsUserAccount>[1]) => {
      expect(await input.readBody()).toEqual(body);
      return { status: "granted" as const, response: { formatVersion: 1 as const, replayed: false,
        requestId, eventId, grantId, accountId: "10000000-0000-4000-8000-000000000006", loginName: "coadmin",
        displayName: "Medarrangör", role: "ADMIN" as const, grantedAt: "2026-09-23T08:00:00.000Z" } };
    }) as unknown as typeof grantEventAdministratorAsUserAccount, auth, environment);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ eventId, grantId, loginName: "coadmin" });
  });

  it("rejects a body for another event before calling the grant service", async () => {
    const grant = vi.fn() as unknown as typeof grantEventAdministratorAsUserAccount;
    const response = await organizerEventAdministratorGrantRoute(db, req("POST", {
      formatVersion: 1, requestId, eventId: "10000000-0000-4000-8000-000000000007", loginName: "coadmin", role: "ADMIN"
    }, { ...proofHeaders, "idempotency-key": `organizer-admin-grant:${requestId}` }), eventId, grant, auth, environment);
    expect(response.status).toBe(400);
    expect(grant).not.toHaveBeenCalled();
  });

  it("binds revoke path, body, idempotency and returned grant identity", async () => {
    const body = { formatVersion: 1, requestId, eventId, grantId };
    const revoke = vi.fn(async (_database: Database, input: Parameters<typeof revokeEventAdministratorAsUserAccount>[1]) => {
      expect(await input.readBody()).toEqual(body);
      return { status: "revoked" as const,
        response: { formatVersion: 1 as const, replayed: false, requestId, eventId, grantId, revokedAt: "2026-09-23T08:00:00.000Z" } };
    }) as unknown as typeof revokeEventAdministratorAsUserAccount;
    const response = await organizerEventAdministratorRevokeRoute(db, req("POST", body, {
      ...proofHeaders, "idempotency-key": `organizer-admin-revoke:${requestId}`
    }, `/${grantId}/revoke`), eventId, grantId, revoke, auth, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ eventId, grantId, requestId });
  });
});
