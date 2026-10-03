import { describe, expect, it, vi } from "vitest";
import type {
  authenticateUserAccountSession,
  issueEventAccountInvitationAsOwner,
  listEventAccountInvitationsAsOwner,
  revokeEventAccountInvitationAsOwner
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  organizerAccountInvitationIssueRoute,
  organizerAccountInvitationListRoute,
  organizerAccountInvitationRevokeRoute
} from "./organizer-account-invitation-route-handlers";

const db = {} as Database;
const env = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const eventId = "10000000-0000-4000-8000-000000000001";
const invitationId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const sessionToken = `otid_user_session_v1.10000000-0000-4000-8000-000000000004.${"s".repeat(43)}`;
const csrf = "c".repeat(43);
const cookie = `__Host-otid-organizer-session=${sessionToken}; __Host-otid-organizer-csrf=${csrf}`;
const authenticated = vi.fn(async () => ({
  status: "authenticated" as const,
  principal: { accountId: "10000000-0000-4000-8000-000000000005", displayName: "Ägare",
    sessionId: "10000000-0000-4000-8000-000000000004", expiresAt: "2026-09-23T12:00:00.000Z" }
})) as unknown as typeof authenticateUserAccountSession;

function post(url: string, body: unknown, key: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", body: JSON.stringify(body), headers: {
    origin: env.O_TID_PUBLIC_ORIGIN, cookie, "x-otid-csrf": csrf,
    "content-type": "application/json", "idempotency-key": key, ...headers
  } });
}

describe("TASK160 owner invitation HTTP boundary", () => {
  it("validates owner issue response without projecting a code", async () => {
    const body = { formatVersion: 1, requestId, eventId, loginName: "ny.admin",
      displayName: "Ny Admin", codeHash: "a".repeat(64) };
    const issue = vi.fn(async (_db: Database, input: Parameters<typeof issueEventAccountInvitationAsOwner>[1]) => {
      expect(await input.readBody()).toEqual(body);
      return { status: "issued" as const, response: { formatVersion: 1 as const, requestId, eventId,
        invitationId, loginName: body.loginName, displayName: body.displayName,
        expiresAt: "2026-09-24T12:00:00.000Z", replayed: false } };
    }) as unknown as typeof issueEventAccountInvitationAsOwner;
    const response = await organizerAccountInvitationIssueRoute(db,
      post(`https://otid.example/api/organizer/events/${eventId}/account-invitations`, body,
        `organizer-account-invitation-issue:${requestId}`), eventId, issue, authenticated, env);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual(expect.objectContaining({ eventId, invitationId, replayed: false }));
    expect(issue).toHaveBeenCalledWith(db, expect.objectContaining({ sessionToken, csrfHeader: csrf }));
  });

  it("rejects origin and CSRF before body and never calls the application service", async () => {
    const body = { formatVersion: 1, requestId, eventId, loginName: "ny.admin",
      displayName: "Ny Admin", codeHash: "a".repeat(64) };
    const issue = vi.fn() as unknown as typeof issueEventAccountInvitationAsOwner;
    const request = post(`https://otid.example/api/organizer/events/${eventId}/account-invitations`, body,
      `organizer-account-invitation-issue:${requestId}`, { origin: "https://evil.example" });
    const stream = request.body;
    let accessed = false;
    Object.defineProperty(request, "body", { configurable: true, get() { accessed = true; return stream; } });
    expect((await organizerAccountInvitationIssueRoute(db, request, eventId, issue, authenticated, env)).status).toBe(403);
    expect(accessed).toBe(false);
    const denied = vi.fn(async () => ({ status: "forbidden" as const })) as unknown as typeof authenticateUserAccountSession;
    expect((await organizerAccountInvitationIssueRoute(db,
      post(`https://otid.example/api/organizer/events/${eventId}/account-invitations`, body,
        `organizer-account-invitation-issue:${requestId}`), eventId, issue, denied, env)).status).toBe(403);
    expect(issue).not.toHaveBeenCalled();
  });

  it("scopes owner list and revoke to the exact event and invitation", async () => {
    const list = vi.fn(async () => ({ status: "ok" as const,
      response: { formatVersion: 1 as const, eventId, invitations: [] } })) as unknown as typeof listEventAccountInvitationsAsOwner;
    const listed = await organizerAccountInvitationListRoute(db,
      new Request(`https://otid.example/api/organizer/events/${eventId}/account-invitations`,
        { headers: { cookie } }), eventId, list, env);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ formatVersion: 1, eventId, invitations: [] });
    const revokeBody = { formatVersion: 1, requestId, eventId, invitationId };
    const revoke = vi.fn(async () => ({ status: "revoked" as const,
      response: { formatVersion: 1 as const, requestId, eventId, invitationId,
        revokedAt: "2026-09-23T12:00:00.000Z", replayed: false } })) as unknown as typeof revokeEventAccountInvitationAsOwner;
    const revoked = await organizerAccountInvitationRevokeRoute(db,
      post(`https://otid.example/api/organizer/events/${eventId}/account-invitations/${invitationId}/revoke`,
        revokeBody, `organizer-account-invitation-revoke:${requestId}`),
      eventId, invitationId, revoke, authenticated, env);
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toEqual(expect.objectContaining({ eventId, invitationId }));
    expect(revoke).toHaveBeenCalledWith(db, expect.objectContaining({ invitationId, sessionToken }));
  });
});
