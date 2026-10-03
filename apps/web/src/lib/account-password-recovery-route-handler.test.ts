import { describe, expect, it, vi } from "vitest";
import type { redeemAccountPasswordRecovery } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { accountPasswordRecoveryRoute } from "./account-password-recovery-route-handler";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const body = { formatVersion: 1, requestId: "a0000000-0000-4000-8000-000000000001",
  loginName: "test.runner", code: "A".repeat(43), password: "E".repeat(43) };

function request(payload: unknown = body, origin: string = environment.O_TID_PUBLIC_ORIGIN) {
  return new Request("https://otid.example/api/account/recovery", { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(payload) });
}

describe("TASK161 återställningsroute", () => {
  it("avvisar främmande Origin och ogiltigt kontrakt före databasanrop", async () => {
    const redeem = vi.fn() as unknown as typeof redeemAccountPasswordRecovery;
    const wrongOrigin = await accountPasswordRecoveryRoute(db, request(body, "https://evil.example"), redeem, environment);
    expect(wrongOrigin.status).toBe(403);
    expect(wrongOrigin.headers.get("cache-control")).toContain("no-store");
    expect((await accountPasswordRecoveryRoute(db, request({ ...body, code: "bad" }), redeem, environment)).status).toBe(400);
    expect(redeem).not.toHaveBeenCalled();
  });

  it("ger neutralt svar utan cookie för felaktig eller redan förbrukad kod", async () => {
    for (const status of ["invalid", "invalid-request", "conflict"] as const) {
      const redeem = vi.fn(async () => ({ status })) as unknown as typeof redeemAccountPasswordRecovery;
      const response = await accountPasswordRecoveryRoute(db, request(), redeem, environment);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ formatVersion: 1, error: "RECOVERY_UNAVAILABLE" });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("returnerar endast kontoid och ny verifierarversion, utan session eller kod", async () => {
    const result = { formatVersion: 1 as const,
      accountId: "10000000-0000-4000-8000-000000000001", loginName: body.loginName, passwordVersion: 2 };
    const redeem = vi.fn(async () => ({ status: "recovered" as const,
      response: result })) as unknown as typeof redeemAccountPasswordRecovery;
    const response = await accountPasswordRecoveryRoute(db, request(), redeem, environment);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(result);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(redeem).toHaveBeenCalledWith(db, body);
  });
});
