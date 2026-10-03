import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import {
  participantClaimIssueRoute, participantClaimListRoute,
  participantClaimRedeemRoute, participantClaimRevokeRoute,
  participantOwnResultsRoute
} from "./participant-entry-claim-route-handlers";

const db = {} as Database;
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const claimId = "10000000-0000-4000-8000-000000000003";
const requestId = "10000000-0000-4000-8000-000000000004";
const adminSession = `otid_org_session_v1.10000000-0000-4000-8000-000000000005.${"a".repeat(43)}`;
const accountSession = `otid_user_session_v1.10000000-0000-4000-8000-000000000006.${"b".repeat(43)}`;
const csrf = "c".repeat(43);
const adminEnvironment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const accountEnvironment = { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://localhost:3000" } as const;
const adminCookies = `__Host-otid-race-administrator-session=${adminSession}; __Host-otid-race-administrator-csrf=${csrf}`;

describe("TASK152 participant claim HTTP boundary", () => {
  it("returns private metadata only for the path-bound entry", async () => {
    const list = vi.fn().mockResolvedValue({ status: "ok", response: { formatVersion: 1, raceId, entryId, claims: [] } });
    const response = await participantClaimListRoute(db, new Request(`https://otid.example/api/admin/races/${raceId}/entries/${entryId}/participant-claims`, { headers: { cookie: adminCookies } }), raceId, entryId, list, adminEnvironment);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ formatVersion: 1, raceId, entryId, claims: [] });
    expect(list).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, entryId, sessionToken: adminSession }));
  });

  it("requires origin, CSRF, matching path identity and an idempotency key to issue", async () => {
    const issue = vi.fn().mockResolvedValue({ status: "issued", response: { formatVersion: 1, requestId, claimId, raceId, entryId,
      issuedAt: "2026-09-23T12:00:00.000Z", expiresAt: "2026-09-25T12:00:00.000Z", replayed: false } });
    const body = { formatVersion: 1, requestId, raceId, entryId, secretHash: "d".repeat(64), expiresAt: "2026-09-25T12:00:00.000Z", attestation: "IDENTITY_CHECKED" };
    const headers = { origin: adminEnvironment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json", cookie: adminCookies,
      "x-otid-csrf": csrf, "idempotency-key": `participant-claim-issue:${requestId}` };
    const response = await participantClaimIssueRoute(db, new Request("https://otid.example", { method: "POST", headers, body: JSON.stringify(body) }), raceId, entryId, issue, adminEnvironment);
    expect(response.status).toBe(201);
    expect(await response.text()).not.toContain(body.secretHash);
    expect(issue).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, entryId, idempotencyKey: headers["idempotency-key"], csrfHeader: csrf }));
    const denied = await participantClaimIssueRoute(db, new Request("https://otid.example", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), raceId, entryId, issue, adminEnvironment);
    expect(denied.status).toBe(403);
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it("rejects revoke body/path disagreement before calling the service", async () => {
    const revoke = vi.fn();
    const headers = { origin: adminEnvironment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json", cookie: adminCookies,
      "x-otid-csrf": csrf, "idempotency-key": `participant-claim-revoke:${requestId}` };
    const body = { formatVersion: 1, requestId, raceId, entryId, claimId: entryId, reason: "Fel mottagare" };
    const response = await participantClaimRevokeRoute(db, new Request("https://otid.example", { method: "POST", headers, body: JSON.stringify(body) }), raceId, entryId, claimId, revoke, adminEnvironment);
    expect(response.status).toBe(400);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("uses organizer account cookies for redemption and returns a neutral missing-code response", async () => {
    const redeem = vi.fn().mockResolvedValue({ status: "not-found" });
    const key = `participant-claim-redeem:${requestId}`;
    const response = await participantClaimRedeemRoute(db, new Request("http://localhost:3000/api/participant/me/claims", { method: "POST",
      headers: { origin: accountEnvironment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json",
        cookie: `otid_organizer_session=${accountSession}; otid_organizer_csrf=${csrf}`, "x-otid-csrf": csrf, "idempotency-key": key },
      body: JSON.stringify({ formatVersion: 1, requestId, code: "a".repeat(21) + "A" }) }), redeem, accountEnvironment);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ error: "UNAUTHORIZED" });
    expect(redeem).toHaveBeenCalledWith(db, expect.objectContaining({ sessionToken: accountSession, csrfCookie: csrf, csrfHeader: csrf, idempotencyKey: key }));
  });

  it("validates own-result response and keeps it private", async () => {
    const list = vi.fn().mockResolvedValue({ status: "ok", response: { formatVersion: 1, items: [] } });
    const response = await participantOwnResultsRoute(db, new Request("http://localhost:3000/api/participant/me/results", {
      headers: { cookie: `otid_organizer_session=${accountSession}` }
    }), list, accountEnvironment);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ formatVersion: 1, items: [] });
  });
});
