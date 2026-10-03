import { describe, expect, it } from "vitest";
import { withoutTimingWithdrawalAdminSecurityPolicy, withoutTimingWithdrawalAdminSessionProof, readWithoutTimingWithdrawalAdminJson } from "./without-timing-withdrawal-admin-security";

describe("TASK 006N NT-återtagningssäkerhet", () => {
  it("kräver HTTPS i produktion och använder egna host-only cookies", () => {
    expect(withoutTimingWithdrawalAdminSecurityPolicy({ NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" })).toMatchObject({ secureCookies: true, cookieNames: { session: "__Host-otid-without-timing-withdrawal-admin-session" } });
    expect(() => withoutTimingWithdrawalAdminSecurityPolicy({ NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "http://otid.example" })).toThrow();
  });
  it("avvisar dubbla CSRF-cookies och body över 4 KiB före pull", async () => {
    const policy = withoutTimingWithdrawalAdminSecurityPolicy({ NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" });
    const token = "c".repeat(43);
    const duplicate = new Request("https://otid.example", { headers: { cookie: `__Host-otid-without-timing-withdrawal-admin-csrf=${token}; __Host-otid-without-timing-withdrawal-admin-csrf=${token}`, "x-otid-csrf": token } });
    expect(withoutTimingWithdrawalAdminSessionProof(duplicate, policy, true).csrfCookie).toBeNull();
    let pulled = false;
    const tooLarge = { headers: new Headers({ "content-type": "application/json", "content-length": "4097" }), body: { getReader() { pulled = true; throw new Error("lästes"); } } } as unknown as Request;
    await expect(readWithoutTimingWithdrawalAdminJson(tooLarge)).rejects.toThrow();
    expect(pulled).toBe(false);
  });
});
