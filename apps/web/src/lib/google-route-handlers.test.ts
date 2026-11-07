import { describe, expect, it, vi } from "vitest";
import {
  GoogleOidcError, newGoogleLoginState, parseGoogleMovePending, parseGoogleLoginState, serializeGoogleLoginState, type linkGoogleToAccount,
  type signInWithGoogle
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import { googleCallbackRoute, googleStartRoute } from "./google-route-handlers";
import { googleLoginEnabled } from "./google-login-enabled";
import { configurationProblems } from "./startup-check";
import { setSessionCookies, securityPolicy } from "./security-policy";

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

describe("ADR-0205 tillägg: Koppla Google-konto och Kom ihåg mig", () => {
  const sessionId = "10000000-0000-4000-8000-000000000002";
  const linkStarted = () => {
    const login = newGoogleLoginState(now, { mode: "link", sessionId });
    return { login, cookie: `__Host-otid-google-login=${serializeGoogleLoginState(login)}` };
  };

  it("start med ?remember=1 sparar valet i kakan; utan får inloggningen en kort session", async () => {
    const value = (response: Response) => cookies(response)[0]!.split(";")[0]!.split("=")[1]!;
    const remembered = googleStartRoute(new Request("https://otid.example/api/account/google/start?remember=1"), env, now);
    expect(parseGoogleLoginState(value(remembered), now)?.remember).toBe(true);
    const plain = googleStartRoute(new Request("https://otid.example/api/account/google/start"), env, now);
    expect(parseGoogleLoginState(value(plain), now)?.remember).toBeUndefined();
    const { login, cookie } = started();
    const signIn = vi.fn().mockResolvedValue(authenticated) as unknown as typeof signInWithGoogle;
    await googleCallbackRoute(db, callback(`code=kod&state=${login.state}`, cookie), env, { exchange: vi.fn().mockResolvedValue(identity), signIn, now });
    expect(signIn).toHaveBeenCalledWith(db, identity, expect.objectContaining({ remember: false }));
  });

  it("en kort session får en sessionskaka utan Expires; en lång behåller Expires", () => {
    const policy = securityPolicy(env);
    const set = (expiresAt: string) => setSessionCookies(new Response(null), policy, { sessionToken, csrfToken: "c".repeat(43), expiresAt })
      .headers.getSetCookie();
    const short = set(new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString());
    expect(short.every(value => !value.includes("Expires="))).toBe(true);
    const long = set(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());
    expect(long.every(value => value.includes("Expires="))).toBe(true);
  });

  it("kopplingen går först vidare från O-Tids egen sida (sessionens kakor är Strict), sedan kopplas den till sessionen i kakan", async () => {
    const { login, cookie } = linkStarted();
    const exchange = vi.fn().mockResolvedValue({ ...identity, email: "joel@gmail.com" });
    const link = vi.fn().mockResolvedValue({ status: "linked", googleEmail: "joel@gmail.com" }) as unknown as typeof linkGoogleToAccount;
    const first = await googleCallbackRoute(db, callback(`code=kod&state=${login.state}`, cookie), env, { exchange, link, now });
    expect(first.status).toBe(200);
    expect(await first.text()).toContain(`content="0;url=/api/account/google/callback?code=kod&amp;state=${login.state}&amp;steg=2"`);
    expect(exchange).not.toHaveBeenCalled();
    const session = `__Host-otid-organizer-session=${sessionToken}`;
    const second = await googleCallbackRoute(db, callback(`code=kod&state=${login.state}&steg=2`, `${cookie}; ${session}`), env, { exchange, link, now });
    expect(location(second)).toBe("https://otid.example/konto?google=kopplat");
    const [, input] = vi.mocked(link).mock.calls[0]!;
    expect(input.boundSessionId).toBe(sessionId);
    expect(input.proof.sessionToken).toBe(sessionToken);
    expect(cookies(second).some(value => value.startsWith("__Host-otid-google-login=deleted"))).toBe(true);
  });

  it("annan session, upptaget konto och en flytt: besked under Mitt konto, och flytten får en signerad Strict-kaka", async () => {
    const { login, cookie } = linkStarted();
    const exchange = vi.fn().mockResolvedValue(identity);
    const link = vi.fn();
    const run = () => googleCallbackRoute(db, callback(`code=kod&state=${login.state}&steg=2`, cookie), env,
      { exchange, link: link as unknown as typeof linkGoogleToAccount, now });
    link.mockResolvedValueOnce({ status: "session-mismatch" });
    expect(location(await run())).toBe("https://otid.example/konto?google=sessionen");
    link.mockResolvedValueOnce({ status: "in-use", googleEmail: "anna@klubb.se", sourceHasPassword: true });
    expect(location(await run())).toBe("https://otid.example/konto?google=upptaget");
    // Det andra kontot saknar eget lösenord: beskedet säger hur man väljer ett först (Glömt lösenordet).
    link.mockResolvedValueOnce({ status: "in-use", googleEmail: "anna@klubb.se", sourceHasPassword: false });
    expect(location(await run())).toBe("https://otid.example/konto?google=upptaget-utan-losenord");
    link.mockResolvedValueOnce({ status: "email-not-verified" });
    expect(location(await run())).toBe("https://otid.example/konto?google=obekraftad");
    const pending = { sub: "123", googleEmail: "anna@klubb.se", sourceAccountId: accountId, sessionId, expiresAt: now.getTime() + 600_000 };
    link.mockResolvedValueOnce({ status: "move-needed", pending });
    const moved = await run();
    expect(location(moved)).toBe("https://otid.example/konto/flytta-google");
    const move = cookies(moved).find(value => value.startsWith("__Host-otid-google-move="))!;
    expect(move).toMatch(/; Path=\/; Max-Age=600; SameSite=Strict; HttpOnly; Secure$/);
    expect(parseGoogleMovePending(move.split(";")[0]!.split("=")[1], now)).toEqual(pending);
    // Fel state i läget link: aldrig vidare till kodbytet.
    expect(location(await googleCallbackRoute(db, callback(`code=kod&state=${"A".repeat(43)}&steg=2`, cookie), env,
      { exchange, link: link as unknown as typeof linkGoogleToAccount, now }))).toBe("https://otid.example/konto?google=fel");
    expect(link).toHaveBeenCalledTimes(5);
  });
});
