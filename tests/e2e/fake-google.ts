import { createHash, createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * ADR-0205 tillägg: falsk OpenID-leverantör (i stället för Google) för webbläsartesterna. Webben pekas hit med
 * OTID_GOOGLE_BASE_URL (serverns väg: `/token`, `/certs` och utgivaren) och OTID_GOOGLE_AUTHORIZE_URL (webbläsarens väg: `/auth`).
 *
 * - `POST /__fixture/next` med JSON `{ sub, email, email_verified, name }` väljer vem som "loggar in hos Google" nästa gång.
 * - `GET /auth` skickar direkt tillbaka till `redirect_uri` med en kod (som Google efter att personen valt konto).
 * - `auth_time` i ID-token: nu när `/auth` fick `prompt=login` eller `max_age=0` (en ny inloggning), annars en timme sedan (en
 *   sparad inloggning hos Google). Ändrat 2026-11-07 för "Ta bort kontot" med Google.
 * - `POST /token` kontrollerar PKCE-verifieraren, klientens hemlighet och `redirect_uri` och svarar med en signerad ID-token;
 *   utgivaren (`iss`) är adressen som servern använde (`http://{Host}`), som OTID_GOOGLE_BASE_URL.
 */
export const FAKE_GOOGLE_PORT = Number(process.env.E2E_GOOGLE_PORT ?? 4337);
export const FAKE_GOOGLE_CLIENT_SECRET = "endast-for-test";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "e2e-1", alg: "RS256", use: "sig" };
const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");

function idToken(claims: Record<string, unknown>): string {
  const body = `${b64(JSON.stringify({ alg: "RS256", kid: "e2e-1", typ: "JWT" }))}.${b64(JSON.stringify(claims))}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(privateKey).toString("base64url")}`;
}

function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => resolve(body));
  });
}

export function startFakeGoogle(port = FAKE_GOOGLE_PORT): Promise<Server> {
  let next: Record<string, unknown> = { sub: "e2e-0", email: "e2e@gmail.test", email_verified: true };
  const codes = new Map<string, { challenge: string; nonce: string; redirectUri: string; claims: Record<string, unknown>; fresh: boolean }>();
  const server = createServer((request, response) => void (async () => {
    const url = new URL(request.url ?? "/", "http://fake-google");
    if (request.method === "POST" && url.pathname === "/__fixture/next") {
      next = JSON.parse(await readBody(request)) as Record<string, unknown>;
      response.writeHead(204).end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/certs") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/auth") {
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const back = new URL(redirectUri);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      if (typeof next.error === "string") back.searchParams.set("error", next.error);
      else {
        const code = randomUUID();
        codes.set(code, { challenge: url.searchParams.get("code_challenge") ?? "", nonce: url.searchParams.get("nonce") ?? "", redirectUri,
          claims: next, fresh: url.searchParams.get("prompt") === "login" || url.searchParams.get("max_age") === "0" });
        back.searchParams.set("code", code);
      }
      response.writeHead(302, { location: back.href }).end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/token") {
      const form = new URLSearchParams(await readBody(request));
      const grant = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (!grant || grant.challenge !== challenge || form.get("client_secret") !== FAKE_GOOGLE_CLIENT_SECRET
        || form.get("redirect_uri") !== grant.redirectUri) {
        response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const token = idToken({ iss: `http://${request.headers.host}`, aud: form.get("client_id"), iat: now, exp: now + 300, nonce: grant.nonce,
        auth_time: grant.fresh ? now : now - 3600, ...grant.claims });
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: "x", token_type: "Bearer", id_token: token }));
      return;
    }
    response.writeHead(404).end();
  })());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

/** Väljer vem som loggar in hos den falska leverantören nästa gång (testet och leverantören kör i samma maskin). */
export async function nextGoogleIdentity(claims: { sub: string; email: string; email_verified?: boolean; name?: string; error?: string }): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${FAKE_GOOGLE_PORT}/__fixture/next`, { method: "POST",
    body: JSON.stringify({ email_verified: true, ...claims }) });
  if (response.status !== 204) throw new Error(`Den falska Google-leverantören svarade ${response.status}`);
}
