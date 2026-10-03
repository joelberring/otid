import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { routeUploadGrantIssueRoute, routeUploadGrantListRoute, routeUploadGrantRevokeRoute } from "./route-upload-grant-route-handlers";

const db = {} as Database;
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const grantId = "10000000-0000-4000-8000-000000000003";
const sessionToken = `otid_org_session_v1.10000000-0000-4000-8000-000000000004.${"a".repeat(43)}`;
const csrf = "b".repeat(43);
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const headers = { origin: environment.O_TID_PUBLIC_ORIGIN, "content-type": "application/json", "idempotency-key": `route-upload-grant:${grantId}`,
  cookie: `__Host-otid-race-administrator-session=${sessionToken}; __Host-otid-race-administrator-csrf=${csrf}`, "x-otid-csrf": csrf };
const issue = { formatVersion: 1, grantId, entryId, secretHash: "c".repeat(64), expiresAt: "2026-09-21T12:00:00.000Z" };

describe("TASK111 route upload grant HTTP boundary", () => {
  it("keeps administrator grant metadata private and validates the manager session", async () => {
    const list = vi.fn().mockResolvedValue({ status: "ok", response: { formatVersion: 1, raceId, grants: [{
      formatVersion: 1, grantId, raceId, entryId, issuedAt: "2026-09-20T12:00:00.000Z", expiresAt: "2026-09-21T12:00:00.000Z", revokedAt: null
    }] } });
    const response = await routeUploadGrantListRoute(db, new Request(`https://otid.example/api/admin/races/${raceId}/route-upload/grants`, { headers: {
      cookie: `__Host-otid-race-administrator-session=${sessionToken}` } }), raceId, list, environment);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ raceId, grants: [{ grantId, entryId }] });
    expect(list).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, sessionToken }));
  });

  it("requires origin, CSRF, canonical request body and a URL/body grant match for writes", async () => {
    const issuer = vi.fn().mockResolvedValue({ status: "issued", response: { formatVersion: 1, grantId, entryId, raceId,
      issuedAt: "2026-09-20T12:00:00.000Z", expiresAt: issue.expiresAt, revokedAt: null, replayed: false } });
    const issued = await routeUploadGrantIssueRoute(db, new Request("https://otid.example/api/admin/races/x/route-upload/grants", { method: "POST", headers, body: JSON.stringify(issue) }), raceId, issuer, environment);
    expect(issued.status).toBe(201); expect(issuer).toHaveBeenCalledWith(db, expect.objectContaining({ raceId, idempotencyKey: headers["idempotency-key"], csrfHeader: csrf }));
    const revoke = vi.fn();
    const mismatch = await routeUploadGrantRevokeRoute(db, new Request("https://otid.example", { method: "POST", headers: { ...headers, "idempotency-key": `route-upload-grant-revoke:${grantId}` }, body: JSON.stringify({ formatVersion: 1, grantId: entryId, reason: "Fel länk" }) }), raceId, grantId, revoke, environment);
    expect(mismatch.status).toBe(400); expect(revoke).not.toHaveBeenCalled();
    const denied = await routeUploadGrantIssueRoute(db, new Request("https://otid.example", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(issue) }), raceId, issuer, environment);
    expect(denied.status).toBe(403);
  });
});
