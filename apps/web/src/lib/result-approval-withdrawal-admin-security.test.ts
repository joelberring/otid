import { describe, expect, it } from "vitest";
import {
  hasExpectedResultApprovalWithdrawalAdminOrigin,
  readResultApprovalWithdrawalAdminJson,
  resultApprovalWithdrawalAdminJson,
  resultApprovalWithdrawalAdminSecurityPolicy,
  resultApprovalWithdrawalAdminSessionProof,
  setResultApprovalWithdrawalAdminCookies
} from "./result-approval-withdrawal-admin-security";

describe("TASK 006H säkerhet för återtagande av resultatgodkännande", () => {
  const production = {
    NODE_ENV: "production",
    O_TID_PUBLIC_ORIGIN: "https://otid.example"
  } as const;

  it("använder egen host-only session och CSRF-cookie", () => {
    const policy = resultApprovalWithdrawalAdminSecurityPolicy(production);
    const response = setResultApprovalWithdrawalAdminCookies(
      resultApprovalWithdrawalAdminJson({ formatVersion: 1, error: "UNAUTHORIZED" }),
      policy,
      {
        sessionToken: "session-safe",
        csrfToken: "csrf-safe",
        expiresAt: "2026-09-01T13:00:00.000Z"
      }
    );
    const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(cookies[0]).toMatch(/^__Host-otid-result-approval-withdrawal-admin-session=.*; Path=\//);
    expect(cookies.join(";")).not.toContain("Domain=");
    expect(cookies[0]).toContain("SameSite=Strict; HttpOnly; Secure");
    expect(cookies[1]).not.toContain("HttpOnly");
  });

  it("kräver exakt origin och läser inte en deklarerad body över 4 KiB", async () => {
    const policy = resultApprovalWithdrawalAdminSecurityPolicy(production);
    expect(hasExpectedResultApprovalWithdrawalAdminOrigin(
      new Request("https://otid.example", { headers: { origin: "https://otid.example" } }),
      policy
    )).toBe(true);
    expect(hasExpectedResultApprovalWithdrawalAdminOrigin(
      new Request("https://otid.example", { headers: { origin: "https://evil.example" } }),
      policy
    )).toBe(false);

    let pulled = false;
    const tooLarge = {
      headers: new Headers({ "content-type": "application/json", "content-length": "4097" }),
      body: { getReader() { pulled = true; throw new Error("body får inte läsas"); } }
    } as unknown as Request;
    await expect(readResultApprovalWithdrawalAdminJson(tooLarge)).rejects.toThrow("Ogiltig bodylängd");
    expect(pulled).toBe(false);
  });

  it("avvisar dubbla CSRF-cookies för den egna sessionen", () => {
    const policy = resultApprovalWithdrawalAdminSecurityPolicy(production);
    const csrf = "c".repeat(43);
    const request = new Request("https://otid.example", { headers: {
      cookie: `__Host-otid-result-approval-withdrawal-admin-csrf=${csrf}; __Host-otid-result-approval-withdrawal-admin-csrf=${csrf}`,
      "x-otid-csrf": csrf
    } });
    expect(resultApprovalWithdrawalAdminSessionProof(request, policy, true).csrfCookie).toBeNull();
  });
});
