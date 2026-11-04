import { describe, expect, it, vi } from "vitest";
import { GoogleOidcError, newGoogleLoginState, serializeGoogleLoginState, type signInWithGoogle } from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { googleCallbackRoute, googleStartRoute } from "./google-route-handlers";
import { googleLoginEnabled } from "./google-login-enabled";
import { configurationProblems } from "./startup-check";

/** ADR-0205: rutterna för Logga in med Google, med påhittat kodbyte och påhittad inloggning. */
const db = {} as Database;
const env = { NODE_ENV: "production", O_TID_PUBLIC_ORIGIN: "https://otid.example", OTID_GOOGLE_CLIENT_ID: "klient.apps.googleusercontent.com",
  OTID_GOOGLE_CLIENT_SECRET: "hemlig" } as const;
const now = new Date("2026-11-03T20:00:00Z");
const accountId = "10000000-0000-4000-8000-000000000001";
const sessionToken = `otid_user_session_v1.10000000-0000-4000-8000-000000000002.${"s".repeat(43)}`;
const identity = { sub: "123", email: "anna@klubb.se", emailVerified: true, name: "Anna" };
const authenticated = { status: "authenticated", created: false, sessionToken, csrfToken: "c".repeat(43), response: { formatVersion: 1, accountId,
  email: "anna@klubb.se", displayName: "Anna", superadmin: false, expiresAt: "2026-12-03T20:00:00.000Z", emailVerified: true } } as const;

function callback(query: string, cookie?: string) {
  return new Request(`https://otid.example/api/account/google/callback?${query}`, { headers: cookie ? { cookie } : {} });
}
function started() {
  const login = newGoogleLoginState(now);
  return { login, cookie: `__Host-otid-google-login=${serializeGoogleLoginState(login)}` };
}
const location = (response: Response) => response.headers.get("location");
const cookies = (response: Response) => response.headers.getSetCookie();

describe("Logga in med Google", () => {
  it("visas och svarar bara när båda variablerna är satta", async () => {
    expect(googleLoginEnabled(env)).toBe(true);
    expect(googleLoginEnabled({ ...env, OTID_GOOGLE_CLIENT_SECRET: " " })).toBe(false);
    expect(googleStartRoute(new Request("https://otid.example/api/account/google/start"), { ...env, OTID_GOOGLE_CLIENT_ID: "" }).status).toBe(404);
    expect((await googleCallbackRoute(db, callback("code=x&state=y"), { ...env, OTID_GOOGLE_CLIENT_SECRET: "" })).status).toBe(404);
    expect(configurationProblems({ ...env, DATABASE_URL: "postgres://x", OTID_GOOGLE_CLIENT_SECRET: "" }).join(" ")).toContain("OTID_GOOGLE_CLIENT_ID");
  });

  it("start: kortlivad kaka (Lax, HttpOnly, Secure, __Host-) och vidare till Google med återkomsten på den publika adressen", () => {
    const response = googleStartRoute(new Request("https://otid.example/api/account/google/start"), env, now);
    expect(response.status).toBe(303);
    const url = new URL(location(response)!);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://otid.example/api/account/google/callback");
    const [cookie] = cookies(response);
    expect(cookie).toMatch(/^__Host-otid-google-login=[A-Za-z0-9_-]+; Path=\/; Max-Age=600; SameSite=Lax; HttpOnly; Secure$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("lyckad återkomst: sessionens kakor och en sida som går vidare till Mina tävlingar", async () => {
    const { login, cookie } = started();
    const exchange = vi.fn().mockResolvedValue(identity);
    const signIn = vi.fn().mockResolvedValue(authenticated) as unknown as typeof signInWithGoogle;
    const response = await googleCallbackRoute(db, callback(`code=kod&state=${login.state}`, cookie), env, { exchange, signIn, now });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('content="0;url=/organizer"');
    expect(exchange).toHaveBeenCalledWith(expect.objectContaining({ redirectUri: "https://otid.example/api/account/google/callback" }),
      { code: "kod", login }, { now });
    const set = cookies(response);
    expect(set.some(value => value.startsWith("__Host-otid-google-login=deleted") && value.includes("Max-Age=0"))).toBe(true);
    expect(set.some(value => value.startsWith(`__Host-otid-organizer-session=${sessionToken}`))).toBe(true);
  });

  it("fel state, saknad kaka, avbruten inloggning, obekräftad adress, spärrat konto och fel ID-token ger ett besked på inloggningen", async () => {
    const { login, cookie } = started();
    const exchange = vi.fn().mockResolvedValue(identity);
    const signIn = vi.fn();
    const run = (query: string, withCookie = cookie) =>
      googleCallbackRoute(db, callback(query, withCookie), env, { exchange, signIn: signIn as unknown as typeof signInWithGoogle, now });
    expect(location(await run(`code=kod&state=${"A".repeat(43)}`))).toBe("https://otid.example/organizer?google=fel");
    expect(location(await run(`code=kod&state=${login.state}`, ""))).toBe("https://otid.example/organizer?google=fel");
    expect(location(await run("error=access_denied&state=x"))).toBe("https://otid.example/organizer?google=avbruten");
    expect(exchange).not.toHaveBeenCalled();
    signIn.mockResolvedValueOnce({ status: "email-not-verified" });
    expect(location(await run(`code=kod&state=${login.state}`))).toBe("https://otid.example/organizer?google=obekraftad");
    signIn.mockResolvedValueOnce({ status: "blocked" });
    expect(location(await run(`code=kod&state=${login.state}`))).toBe("https://otid.example/organizer?google=sparrad");
    exchange.mockRejectedValueOnce(new GoogleOidcError("nonce"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rejected = await run(`code=kod&state=${login.state}`);
    expect(location(rejected)).toBe("https://otid.example/organizer?google=fel");
    expect(cookies(rejected).some(value => value.includes("organizer-session"))).toBe(false);
  });
});
