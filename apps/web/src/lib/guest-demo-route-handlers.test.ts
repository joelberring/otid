import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { guestDemoEnabled, guestDemoRoute, guestsPerHour } from "./guest-demo-route-handlers";

/** Demoläget del 2: formuläret "Prova arbetsytan" (POST /api/demo/guest). */
const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://tid.exempel.se", OTID_GUEST_DEMO: "1" };
const request = (origin = "https://tid.exempel.se", cookie?: string) => new Request("https://tid.exempel.se/api/demo/guest", {
  method: "POST", headers: { origin, ...(cookie ? { cookie } : {}) } });
const sessionToken = `otid_user_session_v1.${crypto.randomUUID()}.${"a".repeat(43)}`;
const created = { status: "created" as const, raceId: "7b0b4670-b62c-40b8-af35-ffaecb03c795", sessionToken, csrfToken: "b".repeat(43),
  expiresAt: new Date("2026-11-10T12:00:00Z"), sessionExpiresAt: "2026-12-09T12:00:00.000Z" };
const nobody = vi.fn(async () => ({ status: "unauthorized" as const }));

describe("demoläget: Prova arbetsytan", () => {
  it("av utan OTID_GUEST_DEMO=1; spärren läses ur miljön", async () => {
    expect(guestDemoEnabled({})).toBe(false);
    expect(guestDemoEnabled({ OTID_GUEST_DEMO: "1" })).toBe(true);
    expect(guestsPerHour({ OTID_GUEST_DEMO_PER_HOUR: "20" })).toBe(20);
    expect(guestsPerHour({ OTID_GUEST_DEMO_PER_HOUR: "0" })).toBeUndefined();
    const start = vi.fn();
    expect((await guestDemoRoute(db, request(), { ...environment, OTID_GUEST_DEMO: "" }, start, nobody)).status).toBe(404);
    expect(start).not.toHaveBeenCalled();
  });

  it("annan Origin vägras; skapat ger kakorna och arbetsytan", async () => {
    const start = vi.fn(async () => created);
    expect((await guestDemoRoute(db, request("https://annan.example"), environment, start, nobody)).status).toBe(403);
    const response = await guestDemoRoute(db, request(), environment, start, nobody);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/admin/${created.raceId}/manage`);
    expect(response.headers.getSetCookie().join("\n")).toContain(sessionToken);
    expect(start).toHaveBeenCalledWith(db, expect.objectContaining({ displayName: "Gäst" }));
  });

  it("spärren och fel ger startsidan med ett besked; ett eget konto loggas inte ut", async () => {
    const busy = await guestDemoRoute(db, request(), environment, vi.fn(async () => ({ status: "rate-limited" as const })), nobody);
    expect(busy.headers.get("location")).toBe("/?demo=upptaget");
    const failed = await guestDemoRoute(db, request(), environment, vi.fn(async () => ({ status: "failed" as const })), nobody);
    expect(failed.headers.get("location")).toBe("/?demo=fel");
    const start = vi.fn(async () => created);
    const signedIn = vi.fn(async () => ({ status: "authenticated" as const, principal: { accountId: "a", sessionId: "s", email: "k@exempel.se",
      displayName: "Kim", superadmin: false, expiresAt: "2026-12-01T00:00:00.000Z", emailVerified: true } }));
    const own = await guestDemoRoute(db, request(undefined, `__Host-otid-organizer-session=${sessionToken}`), environment, start, signedIn);
    expect(own.headers.get("location")).toBe("/organizer");
    expect(start).not.toHaveBeenCalled();
  });
});
