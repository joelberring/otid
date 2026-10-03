import { describe, expect, it } from "vitest";
import {
  DidNotStartWithdrawalAdminConfigurationError,
  didNotStartWithdrawalAdminJson,
  didNotStartWithdrawalAdminSecurityPolicy,
  didNotStartWithdrawalAdminSessionProof,
  readDidNotStartWithdrawalAdminJson,
  setDidNotStartWithdrawalAdminCookies
} from "./did-not-start-withdrawal-admin-security";

describe("TASK 006F DNS-återtagningssäkerhet", () => {
  it("kräver exakt HTTPS-origin i produktion och endast explicit loopback under utveckling", () => {
    expect(didNotStartWithdrawalAdminSecurityPolicy({
      NODE_ENV: "production",
      O_TID_PUBLIC_ORIGIN: "https://otid.example"
    })).toMatchObject({
      publicOrigin: "https://otid.example",
      secureCookies: true,
      cookieNames: { session: "__Host-otid-dns-withdrawal-admin-session" }
    });
    expect(() => didNotStartWithdrawalAdminSecurityPolicy({
      NODE_ENV: "production",
      O_TID_PUBLIC_ORIGIN: "http://otid.example"
    })).toThrow(DidNotStartWithdrawalAdminConfigurationError);
    expect(() => didNotStartWithdrawalAdminSecurityPolicy({
      NODE_ENV: "development",
      O_TID_PUBLIC_ORIGIN: "http://192.0.2.1:3000"
    })).toThrow(DidNotStartWithdrawalAdminConfigurationError);
  });

  it("sätter domainfria host-only cookies och gör endast sessionen HttpOnly", () => {
    const policy = didNotStartWithdrawalAdminSecurityPolicy({
      NODE_ENV: "production",
      O_TID_PUBLIC_ORIGIN: "https://otid.example"
    });
    const response = setDidNotStartWithdrawalAdminCookies(
      didNotStartWithdrawalAdminJson({ ok: true }),
      policy,
      {
        sessionToken: "session-safe",
        csrfToken: "csrf-safe",
        expiresAt: "2026-08-31T13:00:00.000Z"
      }
    );
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^__Host-otid-dns-withdrawal-admin-session=.*; Path=\/;/);
    expect(cookies[0]).toContain("SameSite=Strict; HttpOnly; Secure");
    expect(cookies[1]).toMatch(/^__Host-otid-dns-withdrawal-admin-csrf=.*; Path=\/;/);
    expect(cookies[1]).not.toContain("HttpOnly");
    expect(cookies.join(";")).not.toContain("Domain=");
  });

  it("avvisar dubbla proof-cookies och body över 4 KiB utan att läsa den", async () => {
    const policy = didNotStartWithdrawalAdminSecurityPolicy({
      NODE_ENV: "production",
      O_TID_PUBLIC_ORIGIN: "https://otid.example"
    });
    const token = "c".repeat(43);
    const duplicate = new Request("https://otid.example/api/private", {
      headers: {
        cookie: `__Host-otid-dns-withdrawal-admin-csrf=${token}; __Host-otid-dns-withdrawal-admin-csrf=${token}`,
        "x-otid-csrf": token
      }
    });
    expect(didNotStartWithdrawalAdminSessionProof(duplicate, policy, true).csrfCookie).toBeNull();

    let pulled = false;
    const tooLarge = {
      headers: new Headers({ "content-type": "application/json", "content-length": "4097" }),
      body: { getReader() { pulled = true; throw new Error("får inte läsas"); } }
    } as unknown as Request;
    await expect(readDidNotStartWithdrawalAdminJson(tooLarge)).rejects.toThrow("Ogiltig bodylängd");
    expect(pulled).toBe(false);
  });
});
