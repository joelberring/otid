import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { exchangeGoogleCode, googleAuthorizationUrl, newGoogleLoginState, type GoogleEndpoints, type GoogleOidcConfig } from "../../src/google-oidc";

/**
 * ADR-0205: falsk OpenID-leverantör för integrationstesterna: auktorisering (koden knyts till PKCE-utmaningen och nonce),
 * tokenändpunkt och JWKS över HTTP, med en egen nyckel (och en främmande för att prova fel signatur).
 */
export interface FakeGoogle {
  endpoints: GoogleEndpoints;
  config: GoogleOidcConfig;
  authorize(authorizationUrl: string, claims: Record<string, unknown>): string;
  /** Hela flödet utan databasen: start (state, nonce, PKCE), leverantören, kodbytet och ID-token. */
  identity(claims: Record<string, unknown>): ReturnType<typeof exchangeGoogleCode>;
  close(): Promise<void>;
  signWith(key: "own" | "foreign"): void;
}

export async function startFakeGoogle(): Promise<FakeGoogle> {
  const own = await generateKeyPair("RS256");
  const foreign = await generateKeyPair("RS256");
  const jwk: JWK = { ...await exportJWK(own.publicKey), kid: "nyckel-1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { challenge: string; claims: Record<string, unknown> }>();
  let signing = own.privateKey;
  let issuer = "";
  const server: Server = createServer((request, response) => {
    if (request.url === "/certs") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ keys: [jwk] })); return; }
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    request.on("end", () => void (async () => {
      const form = new URLSearchParams(body);
      const grant = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (!grant || grant.challenge !== challenge || form.get("client_secret") !== "hemlig" || form.get("redirect_uri") !== config.redirectUri) {
        response.statusCode = 400; response.end(JSON.stringify({ error: "invalid_grant" })); return;
      }
      const idToken = await new SignJWT({ ...grant.claims }).setProtectedHeader({ alg: "RS256", kid: "nyckel-1" }).sign(signing);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ access_token: "x", id_token: idToken, token_type: "Bearer" }));
    })());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  issuer = "https://accounts.google.com";
  const endpoints: GoogleEndpoints = { authorization: `${origin}/auth`, token: `${origin}/token`, jwks: `${origin}/certs`, issuers: [issuer] };
  const config: GoogleOidcConfig = { clientId: "otid-klient.apps.googleusercontent.com", clientSecret: "hemlig",
    redirectUri: "https://otid.example/api/account/google/callback", endpoints };
  return {
    endpoints, config,
    authorize(authorizationUrl, claims) {
      const params = new URL(authorizationUrl).searchParams;
      expect(params.get("code_challenge_method")).toBe("S256");
      expect(params.get("scope")).toBe("openid email profile");
      const code = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      codes.set(code, { challenge: params.get("code_challenge")!, claims: { iss: issuer, aud: config.clientId, iat: now, exp: now + 300,
        nonce: params.get("nonce"), ...claims } });
      return code;
    },
    async identity(claims) {
      const login = newGoogleLoginState();
      const code = this.authorize(googleAuthorizationUrl(config, login), claims);
      return exchangeGoogleCode(config, { code, login });
    },
    signWith(key) { signing = key === "own" ? own.privateKey : foreign.privateKey; },
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  };
}
