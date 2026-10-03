import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import {
  redeemRouteUploadLinkRoute,
  routePublicationConsentDecisionRoute,
  routePublicationConsentStateRoute,
  routeUploadReservationRoute,
  routeUploadStatusRoute
} from "./route-upload-route-handlers";

const db = {} as Database;
const grantId = "10000000-0000-4000-8000-000000000001";
const secret = "a".repeat(43);
const sessionToken = `otid_route_upload_session_v1.10000000-0000-4000-8000-000000000002.${"b".repeat(43)}`;
const csrfToken = "c".repeat(43);
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const hash = "d".repeat(64);

describe("TASK111 private route upload HTTP boundary", () => {
  it("exchanges only a valid bearer path for host-only Lax cookies and a token-free redirect", async () => {
    const redeem = vi.fn().mockResolvedValue({ status: "redeemed", sessionToken, csrfToken,
      raceId: "10000000-0000-4000-8000-000000000003", entryId: "10000000-0000-4000-8000-000000000004", expiresAt: "2026-09-21T12:00:00.000Z" });
    const response = await redeemRouteUploadLinkRoute(db, new Request(`https://otid.example/route-upload/${grantId}/${secret}`), grantId, secret, redeem, environment);
    expect(response.status).toBe(303); expect(response.headers.get("location")).toBe("/route-upload");
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const cookies = response.headers.getSetCookie(); expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__Host-otid-route-upload-session="); expect(cookies[0]).toContain("Path=/; "); expect(cookies[0]).toContain("SameSite=Lax; HttpOnly; Secure");
    expect(cookies[1]).toContain("__Host-otid-route-upload-csrf="); expect(cookies[1]).toContain("SameSite=Lax; Secure"); expect(cookies[1]).not.toContain("HttpOnly");
    expect(await response.text()).not.toContain(secret); expect(redeem).toHaveBeenCalledOnce();
  });

  it("requires same-origin CSRF session proof before a participant reservation", async () => {
    const reserve = vi.fn().mockResolvedValue({ status: "reserved", response: { formatVersion: 1, uploadId: "10000000-0000-4000-8000-000000000005",
      requestId: "10000000-0000-4000-8000-000000000006", grantId, reservedAt: "2026-09-20T12:00:00.000Z", replayed: false } });
    const request = new Request("https://otid.example/api/route-upload/reservations", { method: "POST", headers: {
      origin: "https://otid.example", "content-type": "application/json", "idempotency-key": "route-upload:10000000-0000-4000-8000-000000000006",
      cookie: `__Host-otid-route-upload-session=${sessionToken}; __Host-otid-route-upload-csrf=${csrfToken}`, "x-otid-csrf": csrfToken
    }, body: JSON.stringify({ formatVersion: 1, fileName: "min-rutt.gpx", mediaType: "application/gpx+xml", byteLength: 12, sha256: hash }) });
    const response = await routeUploadReservationRoute(db, request, reserve, environment);
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ uploadId: "10000000-0000-4000-8000-000000000005" });
    expect(reserve).toHaveBeenCalledWith(db, expect.objectContaining({ sessionToken, csrfCookie: csrfToken, csrfHeader: csrfToken }));
    const denied = await routeUploadReservationRoute(db, new Request("https://otid.example/api/route-upload/reservations", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), reserve, environment);
    expect(denied.status).toBe(403); expect(reserve).toHaveBeenCalledOnce();
  });

  it("returns only a principal-scoped anonymous stored receipt without a CSRF write proof", async () => {
    const readStatus = vi.fn().mockResolvedValue({ status: "ok", response: { formatVersion: 1, status: "stored", receipt: {
      storedAt: "2026-09-20T12:00:00.000Z", pointCount: 2, segmentCount: 1,
      firstRecordedAt: null, lastRecordedAt: null
    } } });
    const response = await routeUploadStatusRoute(db, new Request("https://otid.example/api/route-upload/status", { headers: {
      cookie: `__Host-otid-route-upload-session=${sessionToken}`
    } }), readStatus, environment);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = JSON.stringify(await response.json());
    expect(body).toContain("stored"); expect(body).not.toMatch(/uploadId|grantId|entryId|storeId|objectKey|versionId/i);
    expect(readStatus).toHaveBeenCalledWith(db, { sessionToken, csrfCookie: null, csrfHeader: null });
  });

  it("keeps the future-publication decision private to the upload session and requires a CSRF write proof", async () => {
    const readConsent = vi.fn().mockResolvedValue({ status: "ok", response: {
      formatVersion: 1, status: "stored", consent: "PRIVATE", revision: 0, decidedAt: null
    } });
    const stateResponse = await routePublicationConsentStateRoute(db, new Request("https://otid.example/api/route-upload/publication-consent", {
      headers: { cookie: `__Host-otid-route-upload-session=${sessionToken}` }
    }), readConsent, environment);
    expect(stateResponse.status).toBe(200);
    const stateBody = JSON.stringify(await stateResponse.json());
    expect(stateBody).toContain("PRIVATE");
    expect(stateBody).not.toMatch(/uploadId|grantId|entryId|manifestId|sourceHash|objectKey|versionId/i);

    const decideConsent = vi.fn().mockResolvedValue({ status: "stored", response: {
      formatVersion: 1, status: "stored", consent: "READY_FOR_FUTURE_PUBLICATION", revision: 1,
      decidedAt: "2026-09-20T12:00:00.000Z", replayed: false
    } });
    const response = await routePublicationConsentDecisionRoute(db, new Request("https://otid.example/api/route-upload/publication-consent", {
      method: "POST", headers: {
        origin: "https://otid.example", "content-type": "application/json",
        "idempotency-key": "route-publication-consent:10000000-0000-4000-8000-000000000007",
        cookie: `__Host-otid-route-upload-session=${sessionToken}; __Host-otid-route-upload-csrf=${csrfToken}`,
        "x-otid-csrf": csrfToken
      }, body: JSON.stringify({ formatVersion: 1, decision: "GRANT" })
    }), decideConsent, environment);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ consent: "READY_FOR_FUTURE_PUBLICATION", revision: 1 });
    expect(decideConsent).toHaveBeenCalledWith(db, expect.objectContaining({
      sessionToken, csrfCookie: csrfToken, csrfHeader: csrfToken,
      idempotencyKey: "route-publication-consent:10000000-0000-4000-8000-000000000007",
      request: { formatVersion: 1, decision: "GRANT" }
    }));
  });
});
