import { describe, expect, it } from "vitest";
import {
  PairingAdminConfigurationError,
  PairingAdminRequestError,
  clearPairingAdminCookies,
  hasExpectedPairingAdminOrigin,
  hasNoRequestBody,
  pairingAdminFailure,
  pairingAdminSecurityPolicy,
  pairingAdminSessionProof,
  readPairingAdminJson,
  setPairingAdminCookies
} from "./pairing-admin-security";

const productionEnvironment = {
  NODE_ENV: "production",
  O_TID_PUBLIC_ORIGIN: "https://otid.example"
} as const;
const developmentEnvironment = {
  NODE_ENV: "development",
  O_TID_PUBLIC_ORIGIN: "http://127.0.0.1:3000"
} as const;

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://otid.example/api/admin/races/10000000-0000-4000-8000-000000000001/pairing-session", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body
  });
}

function setCookieValues(response: Response): string[] {
  return (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
}

describe("pairingadmin-säkerhetsgräns", () => {
  it("kräver canonical HTTPS-origin och __Host-cookies i produktion", () => {
    const policy = pairingAdminSecurityPolicy(productionEnvironment);
    expect(policy).toEqual({
      publicOrigin: "https://otid.example",
      cookieNames: {
        session: "__Host-otid-pairing-admin-session",
        csrf: "__Host-otid-pairing-admin-csrf"
      },
      secureCookies: true
    });
    expect(() => pairingAdminSecurityPolicy({
      NODE_ENV: "production",
      O_TID_PUBLIC_ORIGIN: "http://otid.example"
    })).toThrow(PairingAdminConfigurationError);
    expect(() => pairingAdminSecurityPolicy({
      NODE_ENV: "production",
      O_TID_PUBLIC_ORIGIN: "https://otid.example/"
    })).toThrow(PairingAdminConfigurationError);
  });

  it("tillåter osäkra devcookies endast för explicit HTTP-loopback", () => {
    expect(pairingAdminSecurityPolicy(developmentEnvironment)).toMatchObject({
      publicOrigin: "http://127.0.0.1:3000",
      cookieNames: {
        session: "otid_pairing_admin_session",
        csrf: "otid_pairing_admin_csrf"
      },
      secureCookies: false
    });
    expect(() => pairingAdminSecurityPolicy({
      NODE_ENV: "development",
      O_TID_PUBLIC_ORIGIN: "http://192.168.1.20:3000"
    })).toThrow(PairingAdminConfigurationError);
    expect(() => pairingAdminSecurityPolicy({ NODE_ENV: "test" })).toThrow(PairingAdminConfigurationError);
  });

  it("jämför Origin exakt och använder varken request-URL, Host eller forwarded headers", () => {
    const policy = pairingAdminSecurityPolicy(productionEnvironment);
    const allowed = new Request("https://attacker.invalid/api", {
      method: "POST",
      headers: {
        origin: "https://otid.example",
        host: "attacker.invalid",
        "x-forwarded-host": "otid.example"
      }
    });
    expect(hasExpectedPairingAdminOrigin(allowed, policy)).toBe(true);
    expect(hasExpectedPairingAdminOrigin(new Request("https://otid.example/api", {
      method: "POST",
      headers: { origin: "https://evil.example" }
    }), policy)).toBe(false);
    expect(hasExpectedPairingAdminOrigin(new Request("https://otid.example/api", {
      method: "POST"
    }), policy)).toBe(false);
  });

  it("läser exakt en policyvald session och CSRF-bevis utan URL-dekodning", () => {
    const policy = pairingAdminSecurityPolicy(developmentEnvironment);
    const request = new Request("http://127.0.0.1:3000/api", {
      headers: {
        cookie: "other=x; otid_pairing_admin_session=session.token; otid_pairing_admin_csrf=csrf_token",
        "x-otid-csrf": "csrf_token"
      }
    });
    expect(pairingAdminSessionProof(request, policy, true)).toEqual({
      sessionToken: "session.token",
      csrfCookie: "csrf_token",
      csrfHeader: "csrf_token"
    });
    const duplicate = new Request("http://127.0.0.1:3000/api", {
      headers: { cookie: "otid_pairing_admin_session=a; otid_pairing_admin_session=b" }
    });
    expect(pairingAdminSessionProof(duplicate, policy, false).sessionToken).toBeNull();
  });

  it("kräver exakt application/json och högst 4 KiB faktisk UTF-8-body", async () => {
    await expect(readPairingAdminJson(jsonRequest('{"formatVersion":1}')))
      .resolves.toEqual({ formatVersion: 1 });
    await expect(readPairingAdminJson(jsonRequest("{}", {
      "content-type": "application/json; charset=utf-8"
    }))).rejects.toThrow(PairingAdminRequestError);
    await expect(readPairingAdminJson(jsonRequest(JSON.stringify({ value: "å".repeat(2_100) }))))
      .rejects.toThrow(PairingAdminRequestError);
    await expect(readPairingAdminJson(jsonRequest("{}", { "content-length": "4097" })))
      .rejects.toThrow(PairingAdminRequestError);
  });

  it("kräver verkligt tom request för bodylösa routes", async () => {
    await expect(hasNoRequestBody(new Request("https://otid.example/api", { method: "DELETE" })))
      .resolves.toBe(true);
    await expect(hasNoRequestBody(new Request("https://otid.example/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    }))).resolves.toBe(false);
    await expect(hasNoRequestBody(new Request("https://otid.example/api", {
      method: "POST",
      body: new Uint8Array([1])
    }))).resolves.toBe(false);
  });

  it("sätter och rensar session/CSRF med separata korrekta cookieattribut", () => {
    const policy = pairingAdminSecurityPolicy(productionEnvironment);
    const response = setPairingAdminCookies(pairingAdminFailure(401), policy, {
      sessionToken: "session.token",
      csrfToken: "csrf_token",
      expiresAt: "2026-09-01T12:00:00.000Z"
    });
    const cookies = setCookieValues(response);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("__Host-otid-pairing-admin-session=session.token");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("Secure");
    expect(cookies[0]).toContain("SameSite=Strict");
    expect(cookies[0]).toContain("Path=/");
    expect(cookies[0]).not.toContain("Domain=");
    expect(cookies[1]).toContain("__Host-otid-pairing-admin-csrf=csrf_token");
    expect(cookies[1]).not.toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");

    const cleared = setCookieValues(clearPairingAdminCookies(pairingAdminFailure(401), policy));
    expect(cleared).toHaveLength(2);
    expect(cleared.every((value) => value.includes("Max-Age=0"))).toBe(true);
  });
});
