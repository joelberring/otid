import { describe, expect, it, vi } from "vitest";
import type { Database } from "@o-tid/database";
import { eventorImportRoute } from "./eventor-import-route";
const db = {} as Database;
const environment = { NODE_ENV: "development" as const, O_TID_PUBLIC_ORIGIN: "http://localhost:3000" };
function request(origin = environment.O_TID_PUBLIC_ORIGIN) {
  return new Request("http://localhost:3000/api/admin/eventor-import", { method: "POST", headers: {
    origin, "content-type": "application/json", cookie: "otid_event_creation_session=session; otid_event_creation_csrf=csrf",
    "x-otid-csrf": "csrf", "idempotency-key": "eventor-import:test",
  }, body: "{}" });
}
function services() {
  return { list: vi.fn(async () => ({ status: "unauthorized" as const })),
    preview: vi.fn(async () => ({ status: "source-unavailable" as const })),
    commit: vi.fn(async () => ({ status: "conflict" as const })) };
}
describe("Eventor route security boundary", () => {
  it("rejects bad Origin before service/body and uses private response headers", async () => {
    const service = services(); const response = await eventorImportRoute(db, request("https://attacker.invalid"), "commit", service, environment);
    expect(response.status).toBe(403); expect(service.commit).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ formatVersion: 1, error: "FORBIDDEN" });
  });
  it("passes only server session proof and deferred bounded JSON to the service", async () => {
    const service = services(); const response = await eventorImportRoute(db, request(), "commit", service, environment);
    expect(response.status).toBe(409);
    const args = service.commit.mock.calls[0] as unknown as [Database, { readBody: () => Promise<unknown>; sessionToken: string; csrfHeader: string }];
    expect(args[1].sessionToken).toBe("session"); expect(args[1].csrfHeader).toBe("csrf");
    expect(await args[1].readBody()).toEqual({});
  });
  it("sanitizes upstream/configuration/internal failures", async () => {
    const service = services();
    expect((await eventorImportRoute(db, request(), "preview", service, environment)).status).toBe(503);
    service.commit.mockRejectedValueOnce(new Error("secret upstream SQL details"));
    const response = await eventorImportRoute(db, request(), "commit", service, environment);
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("secret");
    expect((await eventorImportRoute(db, request(), "commit", service, {})).status).toBe(500);
  });
});
