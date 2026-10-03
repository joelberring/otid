import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import type { listStartListAsAdmin, loginPairingAdmin } from "@o-tid/application";
import { startListAdminListRoute, startListAdminLoginRoute } from "./start-list-admin-route-handlers";
import nextConfig from "../../next.config";

const db = {} as Database;
const id = "10000000-0000-4000-8000-000000000001";
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const sessionToken = `otid_org_session_v1.${id}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);

describe("TASK 006R privata startlisteroutes", () => {
  it("binder login till rätt race/capability och sätter egna privata cookies", async () => {
    const login = vi.fn(async () => ({ status: "authenticated" as const, response: { formatVersion: 1 as const,
      raceId: id, capability: "VIEW_START_LIST" as const, expiresAt: "2026-09-04T13:00:00Z" }, sessionToken, csrfToken })) as typeof loginPairingAdmin;
    const req = () => new Request("https://otid.example/api/start-list-session", { method: "POST",
      headers: { origin: "https://otid.example", "content-type": "application/json" },
      body: JSON.stringify({ formatVersion: 1, accessCredential: `otid_org_start_list_v1.${id}.${"a".repeat(43)}` }) });
    const crossOrigin = req(); crossOrigin.headers.set("origin", "https://evil.example");
    expect((await startListAdminLoginRoute(db, crossOrigin, id, login, environment)).status).toBe(403);
    expect(crossOrigin.bodyUsed).toBe(false); expect(login).not.toHaveBeenCalled();
    const response = await startListAdminLoginRoute(db, req(), id, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), { expectedRaceId: id, expectedCapability: "VIEW_START_LIST" });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__Host-otid-start-list-admin-session=");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[1]).toContain("__Host-otid-start-list-admin-csrf=");
    for (const cookie of cookies) for (const attribute of ["Secure", "SameSite=Strict", "Path=/"]) expect(cookie).toContain(attribute);
    expect((await nextConfig.headers!()).find((row) => row.source === "/admin/:raceId/start-list")?.headers)
      .toContainEqual({ key: "Cache-Control", value: "private, no-store" });
  });
  it("förmedlar endast validerad privat läsning och avvisar authfel eller felaktig projektion", async () => {
    const req = () => new Request("https://otid.example/api/start-list", { headers: {
      cookie: `__Host-otid-start-list-admin-session=${sessionToken}` } });
    const payload = { formatVersion: 1 as const, raceId: id, snapshotVersion: 3,
      timeZone: "Europe/Stockholm", generatedAt: "2026-09-04T10:00:00Z", classes: [] };
    const list: typeof listStartListAsAdmin = vi.fn(async () => ({ status: "ok" as const, response: payload }));
    const response = await startListAdminListRoute(db, req(), id, list, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(list).toHaveBeenCalledWith(db, { raceId: id, sessionToken, csrfCookie: null, csrfHeader: null });
    expect((await startListAdminListRoute(db, req(), id, async () => ({ status: "forbidden" as const }), environment)).status).toBe(403);
    expect((await startListAdminListRoute(db, req(), id, async () => ({ status: "unauthorized" as const }), environment)).status).toBe(401);
    const corrupt = vi.fn(async () => ({ status: "ok", response: { ...payload, rawPayload: "private" } })) as unknown as typeof listStartListAsAdmin;
    const failure = await startListAdminListRoute(db, req(), id, corrupt, environment);
    expect(failure.status).toBe(500); expect(await failure.text()).not.toContain("rawPayload");
  });
});
