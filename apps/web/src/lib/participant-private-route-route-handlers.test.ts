import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { participantPrivateRouteDetailRoute, participantPrivateRouteListRoute } from "./participant-private-route-route-handlers";

const db = {} as Database;
const routeUploadId = "10000000-0000-4000-8000-000000000001";
const accountSession = `otid_user_session_v1.10000000-0000-4000-8000-000000000006.${"b".repeat(43)}`;
const environment = { NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://localhost:3000" } as const;
const cookie = `otid_organizer_session=${accountSession}`;

describe("TASK154 participant private route HTTP boundary", () => {
  it("returns a private schema validated list for the signed in account", async () => {
    const list = vi.fn().mockResolvedValue({ status: "ok", response: { formatVersion: 1, items: [{ routeUploadId,
      raceId: "10000000-0000-4000-8000-000000000002", eventName: "Prov", raceName: "Lång", storedAt: "2026-09-23T12:00:00.000Z", pointCount: 4, segmentCount: 1 }] } });
    const response = await participantPrivateRouteListRoute(db, new Request("http://localhost:3000/api/participant/me/routes", { headers: { cookie } }), list, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ formatVersion: 1, items: [{ routeUploadId, pointCount: 4 }] });
    expect(list).toHaveBeenCalledWith(db, expect.objectContaining({ sessionToken: accountSession }));
  });

  it("returns the selected facts-only version and maps absent or nonowned ids to neutral 404", async () => {
    const read = vi.fn().mockResolvedValue({ status: "ok", response: { formatVersion: 2, routeUploadId,
      raceId: "10000000-0000-4000-8000-000000000002", eventName: "Prov", raceName: "Lång", storedAt: "2026-09-23T12:00:00.000Z",
      metadata: { distanceMeters: 1234, pointCount: 4, segmentCount: 1,
        timing: { status: "AVAILABLE", startedAt: "2026-09-23T10:00:00.000Z", finishedAt: "2026-09-23T10:10:00.000Z", durationMilliseconds: 600000 } },
      sharing: { consent: "NOT_GRANTED", adminRelease: "INACTIVE", publicRoute: { status: "UNAVAILABLE" } } } });
    const response = await participantPrivateRouteDetailRoute(db, new Request("http://localhost:3000/api/participant/me/routes", { headers: { cookie } }), routeUploadId, read, environment);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ routeUploadId, metadata: { distanceMeters: 1234, timing: { status: "AVAILABLE" } },
      sharing: { consent: "NOT_GRANTED", adminRelease: "INACTIVE", publicRoute: { status: "UNAVAILABLE" } } });
    expect(read).toHaveBeenCalledWith(db, expect.objectContaining({ sessionToken: accountSession }), routeUploadId);

    read.mockResolvedValueOnce({ status: "not-found" });
    const missing = await participantPrivateRouteDetailRoute(db, new Request("http://localhost:3000/api/participant/me/routes", { headers: { cookie } }), routeUploadId, read, environment);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ formatVersion: 1, error: "UNAUTHORIZED" });
  });

  it("keeps route integrity failures opaque and rejects anonymous access", async () => {
    const invalid = await participantPrivateRouteDetailRoute(db, new Request("http://localhost:3000/api/participant/me/routes", { headers: { cookie } }), routeUploadId,
      async () => ({ status: "invalid-route" }), environment);
    expect(invalid.status).toBe(409);
    expect(await invalid.text()).not.toContain("invalid-route");
    const anonymous = await participantPrivateRouteListRoute(db, new Request("http://localhost:3000/api/participant/me/routes"), async () => ({ status: "unauthorized" }), environment);
    expect(anonymous.status).toBe(401);
  });
});
