import { describe, expect, it } from "vitest";
import { readWithoutTimingAdminJson, withoutTimingAdminSecurityPolicy, withoutTimingAdminSessionProof } from "./without-timing-admin-security";

describe("TASK 006M utan-tidtagning-webbsäkerhet", () => {
  it("kräver HTTPS i produktion och egna host-only cookies", () => {
    expect(withoutTimingAdminSecurityPolicy({ NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" })).toMatchObject({ secureCookies: true, cookieNames: { session: "__Host-otid-without-timing-admin-session" } });
    expect(() => withoutTimingAdminSecurityPolicy({ NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "http://otid.example" })).toThrow();
  });
  it("avvisar dubbla CSRF-cookies och för stor deklarerad body före pull", async () => {
    const policy = withoutTimingAdminSecurityPolicy({ NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example" });
    const token = "c".repeat(43);
    const duplicate = new Request("https://otid.example", { headers: { cookie: `__Host-otid-without-timing-admin-csrf=${token}; __Host-otid-without-timing-admin-csrf=${token}`, "x-otid-csrf": token } });
    expect(withoutTimingAdminSessionProof(duplicate, policy, true).csrfCookie).toBeNull();
    let pulled = false;
    const tooLarge = { headers: new Headers({ "content-type": "application/json", "content-length": "4097" }), body: { getReader() { pulled = true; throw new Error("body lästes"); } } } as unknown as Request;
    await expect(readWithoutTimingAdminJson(tooLarge)).rejects.toThrow();
    expect(pulled).toBe(false);
  });
});
