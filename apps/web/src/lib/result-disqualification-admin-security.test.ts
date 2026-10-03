import { describe, expect, it } from "vitest";
import {
  ResultDisqualificationAdminConfigurationError,
  readResultDisqualificationAdminJson,
  resultDisqualificationAdminJson,
  resultDisqualificationAdminSecurityPolicy,
  resultDisqualificationAdminSessionProof,
  setResultDisqualificationAdminCookies
} from "./result-disqualification-admin-security";
import {
  resultDisqualificationWithdrawalAdminJson,
  resultDisqualificationWithdrawalAdminSecurityPolicy,
  setResultDisqualificationWithdrawalAdminCookies
} from "./result-disqualification-withdrawal-admin-security";

describe("TASK 006G separerad webbsäkerhet", () => {
  it("kräver HTTPS i produktion och explicit HTTP-loopback i utveckling", () => {
    expect(resultDisqualificationAdminSecurityPolicy({
      NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example"
    })).toMatchObject({
      publicOrigin: "https://otid.example", secureCookies: true,
      cookieNames: { session: "__Host-otid-result-disqualification-admin-session" }
    });
    expect(() => resultDisqualificationAdminSecurityPolicy({
      NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "http://otid.example"
    })).toThrow(ResultDisqualificationAdminConfigurationError);
    expect(() => resultDisqualificationWithdrawalAdminSecurityPolicy({
      NODE_ENV: "development", O_TID_PUBLIC_ORIGIN: "http://192.0.2.1:3000"
    })).toThrow(ResultDisqualificationAdminConfigurationError);
  });

  it("sätter skilda domainfria host-only cookies med HttpOnly endast på sessionen", () => {
    const environment = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" } as const;
    const expiry = "2026-08-31T13:00:00.000Z";
    const disqualification = setResultDisqualificationAdminCookies(
      resultDisqualificationAdminJson({ ok: true }), resultDisqualificationAdminSecurityPolicy(environment),
      { sessionToken: "session-safe", csrfToken: "csrf-safe", expiresAt: expiry }
    );
    const withdrawal = setResultDisqualificationWithdrawalAdminCookies(
      resultDisqualificationWithdrawalAdminJson({ ok: true }),
      resultDisqualificationWithdrawalAdminSecurityPolicy(environment),
      { sessionToken: "session-safe", csrfToken: "csrf-safe", expiresAt: expiry }
    );
    const first = (disqualification.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    const second = (withdrawal.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(first[0]).toMatch(/^__Host-otid-result-disqualification-admin-session=.*; Path=\//);
    expect(second[0]).toMatch(/^__Host-otid-result-disqualification-withdrawal-admin-session=.*; Path=\//);
    expect(first[0]).toContain("SameSite=Strict; HttpOnly; Secure");
    expect(first[1]).not.toContain("HttpOnly");
    expect([...first, ...second].join(";")).not.toContain("Domain=");
  });

  it("avvisar dubbla proof-cookies och deklarerad body över 4 KiB utan pull", async () => {
    const policy = resultDisqualificationAdminSecurityPolicy({
      NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example"
    });
    const token = "c".repeat(43);
    const duplicate = new Request("https://otid.example/api/private", { headers: {
      cookie: `__Host-otid-result-disqualification-admin-csrf=${token}; __Host-otid-result-disqualification-admin-csrf=${token}`,
      "x-otid-csrf": token
    } });
    expect(resultDisqualificationAdminSessionProof(duplicate, policy, true).csrfCookie).toBeNull();
    let pulled = false;
    const tooLarge = {
      headers: new Headers({ "content-type": "application/json", "content-length": "4097" }),
      body: { getReader() { pulled = true; throw new Error("får inte läsas"); } }
    } as unknown as Request;
    await expect(readResultDisqualificationAdminJson(tooLarge)).rejects.toThrow("Ogiltig bodylängd");
    expect(pulled).toBe(false);
  });
});
