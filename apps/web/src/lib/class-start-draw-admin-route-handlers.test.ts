import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import type { authenticatePairingAdminSession, commitClassStartDrawAsAdmin, loginPairingAdmin } from "@o-tid/application";
import { authenticatedClassStartDrawRoute, classStartDrawAdminLoginRoute, classStartDrawAdminPreviewRoute } from "./class-start-draw-admin-route-handlers";
import nextConfig from "../../next.config";

const db = {} as Database;
const id = "10000000-0000-4000-8000-000000000001";
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const sessionToken = `otid_org_session_v1.${id}.${"s".repeat(43)}`;
const csrfToken = "c".repeat(43);
const body = { formatVersion: 1, classId: id, expectedSnapshotVersion: 3, sourceHash: "a".repeat(64), parameters: { algorithmVersion: "xorshift32-fisher-yates-v1", seed: 7, firstStartTime: "2026-09-04T08:00:00.000Z", intervalSeconds: 60 } };
function request(text = JSON.stringify(body), extra: Record<string, string> = {}) {
  return new Request("https://otid.example/api/card", { method: "PATCH", body: text, headers: {
    origin: "https://otid.example", "content-type": "application/json", "idempotency-key": `class-start-draw:${id}`,
    cookie: `__Host-otid-class-start-draw-admin-session=${sessionToken}; __Host-otid-class-start-draw-admin-csrf=${csrfToken}`,
    "x-otid-csrf": csrfToken, ...extra
  } });
}
const authorized = () => ({ status: "authenticated" as const, principal: { accessCredentialId: id,
  raceId: id, capability: "DRAW_CLASS_START_TIMES" as const, sessionId: id, expiresAt: "2026-09-04T13:00:00Z" } });

describe("TASK 006U lottningsroutes", () => {
  it("kräver auth före previewbody men inget write-idempotency-key", async () => {
    const previewBody = { formatVersion: 1, classId: id, parameters: body.parameters };
    const unauthenticated = request(JSON.stringify(previewBody));
    const preview = vi.fn(async () => ({ status: "conflict" as const }));
    expect((await classStartDrawAdminPreviewRoute(db, unauthenticated, id, async () => ({ status: "unauthorized" }), preview, environment)).status).toBe(401);
    expect(unauthenticated.bodyUsed).toBe(false); expect(preview).not.toHaveBeenCalled();
    const authenticated = request(JSON.stringify(previewBody), { "idempotency-key": "" });
    expect((await classStartDrawAdminPreviewRoute(db, authenticated, id, async () => authorized(), preview, environment)).status).toBe(409);
    expect(preview).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id, request: previewBody, csrfHeader: csrfToken }));
  });
  it("sätter separata säkra cookies och binder login till capability och race", async () => {
    const login = vi.fn(async () => ({ status: "authenticated" as const, response: { formatVersion: 1 as const,
      raceId: id, capability: "DRAW_CLASS_START_TIMES" as const, expiresAt: "2026-09-04T13:00:00Z" }, sessionToken, csrfToken })) as typeof loginPairingAdmin;
    const response = await classStartDrawAdminLoginRoute(db, request(JSON.stringify({ formatVersion: 1,
      accessCredential: `otid_org_class_start_draw_v1.${id}.${"a".repeat(43)}` })), id, login, environment);
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledWith(db, expect.anything(), { expectedRaceId: id, expectedCapability: "DRAW_CLASS_START_TIMES" });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__Host-otid-class-start-draw-admin-session=");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[1]).toContain("__Host-otid-class-start-draw-admin-csrf=");
    expect(cookies[1]).not.toContain("HttpOnly");
    for (const cookie of cookies) for (const attribute of ["Secure", "SameSite=Strict", "Path=/"]) expect(cookie).toContain(attribute);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await nextConfig.headers!()).find((row) => row.source === "/admin/:raceId/class-start-draw")?.headers)
      .toContainEqual({ key: "Cache-Control", value: "private, no-store" });
  });
  it("avvisar origin och auth innan bodyn läses; skickar separat CSRF-bevis till autentisering", async () => {
    const authenticate = vi.fn(async () => ({ status: "unauthorized" as const }));
    const change = vi.fn() as unknown as typeof commitClassStartDrawAsAdmin;
    const crossOrigin = request(undefined, { origin: "https://evil.example" });
    expect((await authenticatedClassStartDrawRoute(db, crossOrigin, id, authenticate, change, environment)).status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
    expect(crossOrigin.bodyUsed).toBe(false);
    const unauthenticated = request();
    expect((await authenticatedClassStartDrawRoute(db, unauthenticated, id, authenticate, change, environment)).status).toBe(401);
    expect(unauthenticated.bodyUsed).toBe(false);
    expect(authenticate).toHaveBeenCalledWith(db, { raceId: id, capability: "DRAW_CLASS_START_TIMES", requireCsrf: true,
      sessionToken, csrfCookie: csrfToken, csrfHeader: csrfToken });
    expect(change).not.toHaveBeenCalled();
  });
  it("begränsar faktisk body, avvisar extra fält och lämnar normaliserat intent oförändrat till tjänsten", async () => {
    const authenticate: typeof authenticatePairingAdminSession = vi.fn(async () => authorized());
    const change: typeof commitClassStartDrawAsAdmin = vi.fn(async () => ({ status: "conflict" as const }));
    for (const req of [request(" ".repeat(4097)), request(JSON.stringify({ ...body, elapsedMs: 1000 }))]) {
      expect((await authenticatedClassStartDrawRoute(db, req, id, authenticate, change, environment)).status).toBe(400);
    }
    expect(change).not.toHaveBeenCalled();
    const response = await authenticatedClassStartDrawRoute(db, request(), id, authenticate, change, environment);
    expect(response.status).toBe(409);
    expect(change).toHaveBeenCalledWith(db, expect.objectContaining({ raceId: id,
      idempotencyKey: `class-start-draw:${id}`, request: body }));
  });
});
