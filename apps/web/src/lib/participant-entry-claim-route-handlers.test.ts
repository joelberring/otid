import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { participantClaimRedeemRoute, participantOwnResultsRoute } from "./participant-entry-claim-route-handlers";

const db = {} as Database;
const requestId = "10000000-0000-4000-8000-000000000004";
const accountSession = `otid_user_session_v1.10000000-0000-4000-8000-000000000006.${"b".repeat(43)}`;
const csrf = "c".repeat(43);
const accountEnvironment = { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://localhost:3000" } as const;

describe("TASK152 participant claim HTTP boundary", () => {
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
