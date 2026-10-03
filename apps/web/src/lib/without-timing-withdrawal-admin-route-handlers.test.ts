import { describe, expect, it, vi } from "vitest";
import type { authenticatePairingAdminSession, withdrawWithoutTimingAsAdmin } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { authenticatedWithoutTimingWithdrawalRoute } from "./without-timing-withdrawal-admin-route-handlers";

const db = {} as Database;
const raceId = "10000000-0000-4000-8000-000000000001";
const entryId = "10000000-0000-4000-8000-000000000002";
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
describe("TASK 006N NT-återtaganderoutes", () => {
  it("avvisar fel origin före bodyläsning", async () => {
    let reads = 0;
    const request = { headers: new Headers({ origin: "https://evil.example" }), body: { getReader() { reads += 1; throw new Error("body lästes"); } } } as unknown as Request;
    expect((await authenticatedWithoutTimingWithdrawalRoute(db, request, raceId, entryId, vi.fn() as unknown as typeof authenticatePairingAdminSession, vi.fn() as unknown as typeof withdrawWithoutTimingAsAdmin, environment)).status).toBe(403);
    expect(reads).toBe(0);
  });
  it("avvisar fel idempotensnyckel före bodyläsning", async () => {
    let reads = 0;
    const csrf = "c".repeat(43);
    const request = { headers: new Headers({ origin: environment.O_TID_PUBLIC_ORIGIN, cookie: `__Host-otid-without-timing-withdrawal-admin-session=x; __Host-otid-without-timing-withdrawal-admin-csrf=${csrf}`, "x-otid-csrf": csrf, "idempotency-key": "bad" }), body: { getReader() { reads += 1; throw new Error("body lästes"); } } } as unknown as Request;
    const authenticated = vi.fn(async () => ({ status: "authenticated" as const, principal: { accessCredentialId: "10000000-0000-4000-8000-000000000003", raceId, capability: "WITHDRAW_WITHOUT_TIMING" as const, sessionId: "10000000-0000-4000-8000-000000000004", expiresAt: "2026-09-01T13:00:00.000Z" } }));
    expect((await authenticatedWithoutTimingWithdrawalRoute(db, request, raceId, entryId, authenticated as unknown as typeof authenticatePairingAdminSession, vi.fn() as unknown as typeof withdrawWithoutTimingAsAdmin, environment)).status).toBe(400);
    expect(reads).toBe(0);
  });
});
