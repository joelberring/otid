import { describe, expect, it, vi } from "vitest";
import type { activateAccountInvitation } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { accountInvitationActivationRoute } from "./account-invitation-route-handler";

const db = {} as Database;
const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
const body = { formatVersion: 1, requestId: "a0000000-0000-4000-8000-000000000001",
  loginName: "test.runner", code: "A".repeat(43), password: "E".repeat(43) };

function request(payload: unknown = body, origin: string = environment.O_TID_PUBLIC_ORIGIN) {
  return new Request("https://otid.example/api/account/activation", { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify(payload) });
}

describe("TASK159 aktiveringsroute", () => {
  it("avvisar främmande Origin före body och begränsar request", async () => {
    const activate = vi.fn() as unknown as typeof activateAccountInvitation;
    const wrongOrigin = request(body, "https://evil.example");
    const response = await accountInvitationActivationRoute(db, wrongOrigin, activate, environment);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(activate).not.toHaveBeenCalled();
    expect((await accountInvitationActivationRoute(db, request({ ...body, code: "bad" }), activate, environment)).status).toBe(400);
    expect((await accountInvitationActivationRoute(db, request({ ...body, extra: "x".repeat(5_000) }), activate, environment)).status).toBe(400);
    expect(activate).not.toHaveBeenCalled();
  });

  it("ger samma neutrala svar för okänd, utgången och förbrukad kod", async () => {
    for (const status of ["invalid", "invalid-request", "conflict"] as const) {
      const activate = vi.fn(async () => ({ status })) as unknown as typeof activateAccountInvitation;
      const response = await accountInvitationActivationRoute(db, request(), activate, environment);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ formatVersion: 1, error: "INVITATION_UNAVAILABLE" });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("svarar endast med validerat konto, utan kod eller session", async () => {
    const responseBody = { formatVersion: 1 as const,
      accountId: "10000000-0000-4000-8000-000000000001", loginName: body.loginName };
    const activate = vi.fn(async () => ({ status: "activated" as const,
      response: responseBody })) as unknown as typeof activateAccountInvitation;
    const response = await accountInvitationActivationRoute(db, request(), activate, environment);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(responseBody);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(activate).toHaveBeenCalledWith(db, body);
  });
});
