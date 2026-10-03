import { describe, expect, it, vi } from "vitest";
import type { syncStartCheckinWithRecovery } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { checkinRecoverySyncRoute } from "./checkin-recovery-route-handlers";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const raceId = "10000000-0000-4000-8000-000000000001";
const token = `otid_checkin_recovery_v1.10000000-0000-4000-8000-000000000002.${"a".repeat(43)}`;
const receipt = {
  formatVersion: 1 as const,
  storage: "STORED" as const,
  requestId: "10000000-0000-4000-8000-000000000003",
  deviceId: "10000000-0000-4000-8000-000000000004",
  raceId,
  entryId: "10000000-0000-4000-8000-000000000005",
  localSequence: 1,
  contentHash: "a".repeat(64),
  receivedAt: "2026-09-05T12:00:00.000Z",
  effect: { kind: "UNCHANGED" as const, revision: 0 }
};

function request(body: BodyInit = "{}", headers: Record<string, string> = {}): Request {
  return new Request(`https://otid.example/api/admin/races/${raceId}/checkin-recovery/sync`, {
    method: "POST",
    body,
    headers: { origin: "https://otid.example", "content-type": "application/json", ...headers }
  });
}

describe("TASK 006W recovery HTTP-synk", () => {
  it("avvisar fel origin före både applikation och body", async () => {
    let reads = 0;
    const unread = { headers: new Headers({ origin: "https://evil.example", authorization: `Bearer ${token}` }), body: {
      getReader() { reads += 1; throw new Error("body lästes"); }
    } } as unknown as Request;
    const sync = vi.fn() as unknown as typeof syncStartCheckinWithRecovery;
    const response = await checkinRecoverySyncRoute(db, unread, raceId, sync, environment);
    expect(response.status).toBe(403);
    expect(reads).toBe(0);
    expect(sync).not.toHaveBeenCalled();
  });

  it("lämnar bodyn oläst när recovery-autentiseringen avvisas", async () => {
    let reads = 0;
    const unread = { headers: new Headers({ origin: "https://otid.example", authorization: `Bearer ${token}` }), body: {
      getReader() { reads += 1; throw new Error("body lästes"); }
    } } as unknown as Request;
    const sync = vi.fn(async () => ({ status: "unauthorized" as const })) as unknown as typeof syncStartCheckinWithRecovery;
    const response = await checkinRecoverySyncRoute(db, unread, raceId, sync, environment);
    expect(response.status).toBe(401);
    expect(reads).toBe(0);
    expect(sync).toHaveBeenCalledWith(db, expect.objectContaining({ recoveryToken: token }));
  });

  it.each([undefined, "Basic ignored", `Bearer ${token} trailing`, `Bearer ${"x".repeat(8)}`])(
    "skickar inte saknad eller felaktig bearer vidare: %s", async (authorization) => {
      const sync = vi.fn(async (_db: Database, input: { recoveryToken: string | undefined }) => {
        expect(input.recoveryToken).toBeUndefined();
        return { status: "unauthorized" as const };
      }) as unknown as typeof syncStartCheckinWithRecovery;
      const headers = authorization === undefined ? {} : { authorization };
      const response = await checkinRecoverySyncRoute(db, request("{}", headers), raceId, sync, environment);
      expect(response.status).toBe(401);
    }
  );

  it("översätter fel content type och överstor JSON till generiska 400-svar", async () => {
    const sync = vi.fn(async (_db: Database, input: { readBody: () => Promise<unknown> }) => {
      await input.readBody();
      return { status: "stored" as const, response: receipt };
    }) as unknown as typeof syncStartCheckinWithRecovery;
    const wrongType = await checkinRecoverySyncRoute(db, request("{}", { authorization: `Bearer ${token}`, "content-type": "text/plain" }), raceId, sync, environment);
    const oversized = await checkinRecoverySyncRoute(db, request(new Uint8Array(4 * 1024 + 1), { authorization: `Bearer ${token}` }), raceId, sync, environment);
    expect(wrongType.status).toBe(400);
    expect(oversized.status).toBe(400);
  });

  it.each([
    ["unauthorized", 401], ["forbidden", 403], ["invalid-request", 400], ["not-found", 404], ["conflict", 409]
  ] as const)("mappar applikationsstatus %s till %i", async (status, expectedStatus) => {
    const sync = vi.fn(async () => ({ status })) as unknown as typeof syncStartCheckinWithRecovery;
    const response = await checkinRecoverySyncRoute(db, request("{}", { authorization: `Bearer ${token}` }), raceId, sync, environment);
    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({ formatVersion: 1, error: status === "invalid-request" ? "INVALID_REQUEST" : status.toUpperCase().replace("-", "_") });
  });

  it("validerar exakt receipt och race-scope, utan cookies, CORS eller felhemligheter", async () => {
    const stored = vi.fn(async () => ({ status: "stored" as const, response: receipt })) as unknown as typeof syncStartCheckinWithRecovery;
    const response = await checkinRecoverySyncRoute(db, request("{}", { authorization: `Bearer ${token}`, cookie: "recovery=never" }), raceId, stored, environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(receipt);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("authorization")).toBeNull();
    const wrongScope = vi.fn(async () => ({ status: "stored" as const, response: { ...receipt, raceId: "10000000-0000-4000-8000-000000000099" } })) as unknown as typeof syncStartCheckinWithRecovery;
    const internal = await checkinRecoverySyncRoute(db, request("{}", { authorization: `Bearer ${token}` }), raceId, wrongScope, environment);
    expect(internal.status).toBe(500);
    expect(await internal.text()).not.toContain("000000000099");
  });
});
