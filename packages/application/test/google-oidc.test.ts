import { describe, expect, it } from "vitest";
import {
  googleAuthorizationUrl, googleIdentityFromClaims, GoogleOidcError, newGoogleLoginState, parseGoogleLoginState, pkceChallenge,
  sameState, serializeGoogleLoginState, GOOGLE_LOGIN_STATE_LIFETIME_MS
} from "../src/google-oidc";
import { googleDisplayName } from "../src/google-login";

/** ADR-0205: de rena delarna av Google-inloggningen (PKCE, adressen till Google, kakans värde och påståendena). */
describe("Google OpenID Connect", () => {
  it("räknar PKCE S256 som RFC 7636 (bilaga B)", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("bygger adressen till Google med kodflöde, PKCE, state, nonce och rätt omdirigering", () => {
    const login = newGoogleLoginState(new Date("2026-11-03T20:00:00Z"));
    const url = new URL(googleAuthorizationUrl({ clientId: "klient", clientSecret: "hemlig",
      redirectUri: "https://otid.berring.se/api/account/google/callback" }, login));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: "code", client_id: "klient",
      redirect_uri: "https://otid.berring.se/api/account/google/callback", scope: "openid email profile", state: login.state,
      nonce: login.nonce, code_challenge: pkceChallenge(login.codeVerifier), code_challenge_method: "S256", prompt: "select_account" });
    expect(url.href).not.toContain("hemlig");
    expect(url.href).not.toContain(login.codeVerifier);
  });

  it("läser tillbaka kakan bara när den är hel och yngre än tio minuter", () => {
    const now = new Date("2026-11-03T20:00:00Z");
    const login = newGoogleLoginState(now);
    const value = serializeGoogleLoginState(login);
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseGoogleLoginState(value, now)).toEqual(login);
    expect(parseGoogleLoginState(value, new Date(now.getTime() + GOOGLE_LOGIN_STATE_LIFETIME_MS + 1))).toBeUndefined();
    expect(parseGoogleLoginState(value.slice(0, -4), now)).toBeUndefined();
    expect(parseGoogleLoginState(Buffer.from(JSON.stringify(["kort", login.nonce, login.codeVerifier, login.createdAt])).toString("base64url"), now))
      .toBeUndefined();
    expect(parseGoogleLoginState(null, now)).toBeUndefined();
    expect(parseGoogleLoginState("inte;en kaka", now)).toBeUndefined();
  });

  it("ADR-0205 tillägg: kopplingen bär sessionens id och valet Kom ihåg mig; en kaka i det gamla formatet (fyra delar) godtas inte", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    const sessionId = "6f0c1a52-3b9e-4c55-8d7e-1f2a3b4c5d6e";
    const link = newGoogleLoginState(now, { mode: "link", sessionId });
    expect(parseGoogleLoginState(serializeGoogleLoginState(link), now)).toEqual({ ...link, mode: "link", sessionId });
    const remembered = newGoogleLoginState(now, { remember: true });
    expect(parseGoogleLoginState(serializeGoogleLoginState(remembered), now)).toEqual({ ...remembered, remember: true });
    expect(() => newGoogleLoginState(now, { mode: "link" })).toThrow();
    const old = Buffer.from(JSON.stringify([link.state, link.nonce, link.codeVerifier, link.createdAt])).toString("base64url");
    expect(parseGoogleLoginState(old, now)).toBeUndefined();
    const forged = (mode: string, id: string) => Buffer.from(JSON.stringify([link.state, link.nonce, link.codeVerifier, link.createdAt, mode, id, 0]))
      .toString("base64url");
    expect(parseGoogleLoginState(forged("link", "inte-ett-id"), now)).toBeUndefined();
    expect(parseGoogleLoginState(forged("login", sessionId), now)).toBeUndefined();
    expect(parseGoogleLoginState(forged("admin", ""), now)).toBeUndefined();
  });

  it("ändrat 2026-11-07: Ta bort kontot med Google kräver en ny inloggning (prompt=login, max_age=0) och är bunden till sessionen", () => {
    const now = new Date("2026-11-07T10:00:00Z");
    const sessionId = "6f0c1a52-3b9e-4c55-8d7e-1f2a3b4c5d6e";
    const remove = newGoogleLoginState(now, { mode: "delete", sessionId });
    expect(parseGoogleLoginState(serializeGoogleLoginState(remove), now)).toEqual({ ...remove, mode: "delete", sessionId });
    expect(() => newGoogleLoginState(now, { mode: "delete" })).toThrow();
    const url = new URL(googleAuthorizationUrl({ clientId: "klient", clientSecret: "hemlig", redirectUri: "https://otid.berring.se/cb" }, remove));
    expect([url.searchParams.get("prompt"), url.searchParams.get("max_age")]).toEqual(["login", "0"]);
    const forged = Buffer.from(JSON.stringify([remove.state, remove.nonce, remove.codeVerifier, remove.createdAt, "delete", "", 0])).toString("base64url");
    expect(parseGoogleLoginState(forged, now)).toBeUndefined();
    // auth_time (sekunder) blir millisekunder; saknas den finns inget.
    expect(googleIdentityFromClaims({ sub: "1", email: "a@b.se", auth_time: 1_794_000_000 }).authTime).toBe(1_794_000_000_000);
    expect(googleIdentityFromClaims({ sub: "1", email: "a@b.se" })).not.toHaveProperty("authTime");
  });

  it("jämför state exakt", () => {
    const { state } = newGoogleLoginState();
    expect(sameState(state, state)).toBe(true);
    expect(sameState(state, `${state.slice(0, -1)}A` === state ? `${state.slice(0, -1)}B` : `${state.slice(0, -1)}A`)).toBe(false);
    expect(sameState(state, null)).toBe(false);
    expect(sameState(state, state.slice(1))).toBe(false);
  });

  it("godtar adressen bara när Google har bekräftat den", () => {
    expect(googleIdentityFromClaims({ sub: "1", email: "a@b.se", email_verified: true, name: " Anna " }))
      .toEqual({ sub: "1", email: "a@b.se", emailVerified: true, name: "Anna" });
    expect(googleIdentityFromClaims({ sub: "1", email: "a@b.se", email_verified: false }).emailVerified).toBe(false);
    expect(googleIdentityFromClaims({ sub: "1", email: "a@b.se" }).emailVerified).toBe(false);
    expect(() => googleIdentityFromClaims({ sub: 1, email: "a@b.se" })).toThrow(GoogleOidcError);
  });

  it("tar namnet från Google, annars adressens första del, högst 120 tecken", () => {
    expect(googleDisplayName({ name: "  Anna   Andersson " }, "anna@b.se")).toBe("Anna Andersson");
    expect(googleDisplayName({}, "anna.a@b.se")).toBe("anna.a");
    expect(googleDisplayName({ name: "x".repeat(200) }, "a@b.se")).toHaveLength(120);
  });
});
