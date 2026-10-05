import { describe, expect, it, vi } from "vitest";
import type { requestPasswordReset } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { passwordResetAvailabilityRoute, passwordResetRequestRoute } from "./account-route-handlers";

const db = {} as Database;
const env = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://tid.klubb.se",
  OTID_SMTP_URL: "smtp://smtp.klubb.se:587", OTID_MAIL_FROM: "O-Tid <noreply@klubb.se>" } as const;
const post = (email: string) => new Request("https://tid.klubb.se/api/account/password-reset", { method: "POST",
  headers: { origin: env.O_TID_PUBLIC_ORIGIN, "content-type": "application/json", "x-forwarded-for": "198.51.100.4" },
  body: JSON.stringify({ formatVersion: 1, email }) });

describe("ADR-0172 glömt lösenord", () => {
  it("visar om e-post är påslagen och vem man annars kontaktar", async () => {
    const off = await passwordResetAvailabilityRoute(new Request("https://tid.klubb.se/api/account/password-reset"),
      { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://tid.klubb.se", OTID_CONTACT_EMAIL: "drift@klubb.se" });
    expect(await off.json()).toEqual({ formatVersion: 1, emailEnabled: false, contactEmail: "drift@klubb.se" });
    const on = await passwordResetAvailabilityRoute(new Request("https://tid.klubb.se/api/account/password-reset"), env);
    expect(await on.json()).toEqual({ formatVersion: 1, emailEnabled: true, contactEmail: null });
    expect(on.headers.get("cache-control")).toBe("private, no-store");
  });

  it("svarar likadant oavsett om kontot finns och skickar bara till ett befintligt konto", async () => {
    const send = vi.fn(async () => undefined);
    const reset = vi.fn(async (_db: unknown, body: unknown) => (body as { email: string }).email === "anna@klubb.se"
      ? { status: "accepted" as const, delivery: { accountId: "x", email: "anna@klubb.se", displayName: "Anna", token: "T".repeat(43),
        expiresAt: new Date("2026-10-05T16:30:00Z") } }
      : { status: "accepted" as const }) as unknown as typeof requestPasswordReset;
    const known = await passwordResetRequestRoute(db, post("anna@klubb.se"), env, send, reset);
    const unknown = await passwordResetRequestRoute(db, post("okand@klubb.se"), env, send, reset);
    expect([known.status, unknown.status]).toEqual([202, 202]);
    expect(await known.text()).toBe(await unknown.text());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ status: "on" }), expect.objectContaining({
      to: "anna@klubb.se", link: `https://tid.klubb.se/recover#token=${"T".repeat(43)}` }));
    expect(reset).toHaveBeenCalledWith(db, expect.anything(), { clientKey: "198.51.100.4" });
  });

  it("svarar likadant även när mejlet inte går iväg, och loggar inte adressen", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const send = vi.fn(async () => { throw Object.assign(new Error("550 <anna@klubb.se>"), { code: "EENVELOPE" }); });
    const reset = vi.fn(async () => ({ status: "accepted" as const, delivery: { accountId: "x", email: "anna@klubb.se", displayName: "Anna",
      token: "T".repeat(43), expiresAt: new Date() } })) as unknown as typeof requestPasswordReset;
    expect((await passwordResetRequestRoute(db, post("anna@klubb.se"), env, send, reset)).status).toBe(202);
    expect(log.mock.calls.join(" ")).toContain("EENVELOPE");
    expect(log.mock.calls.join(" ")).not.toContain("anna@klubb.se");
    log.mockRestore();
  });

  it("nekar utan e-post, med fel origin och med ogiltig adress", async () => {
    const reset = vi.fn() as unknown as typeof requestPasswordReset;
    const off = await passwordResetRequestRoute(db, post("anna@klubb.se"), { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: env.O_TID_PUBLIC_ORIGIN },
      vi.fn(), reset);
    expect(off.status).toBe(503);
    const evil = new Request("https://tid.klubb.se/api/account/password-reset", { method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect((await passwordResetRequestRoute(db, evil, env, vi.fn(), reset)).status).toBe(403);
    expect(reset).not.toHaveBeenCalled();
  });
});
