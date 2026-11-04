import {
  authenticateUserAccountSession, logoutAllUserAccountSessions, moveGoogleLinkToAccount, newGoogleLoginState, parseGoogleMovePending,
  readGoogleMove, unlinkGoogleFromAccount
} from "@o-tid/application";
import { googleMoveDetailsSchema, googleMoveRequestSchema, googleMoveResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { configuration, googleRedirect, moveCookie, notFound } from "./google-route-handlers";
import { googleMoveCookieName } from "./organizer-account-cookies";
import {
  accountFailure, clearSessionCookies, hasExpectedOrigin, hasNoRequestBody, privateHeaders, privateJson, readJsonBody, readUniqueCookie,
  sessionProof, type SecurityPolicy
} from "./security-policy";
import { logServerError } from "./server-error-log";

/**
 * ADR-0205 tillägg: Koppla Google-konto under Mitt konto, flytta en koppling från ett tomt dubblettkonto, ta bort kopplingen och
 * Logga ut från alla enheter. Skrivande anrop kräver rätt Origin och kontots CSRF-värde, som Mitt konto i övrigt.
 *
 * - `POST /api/account/google/link` börjar kopplingen: svarar med adressen till Google och sparar state, nonce, PKCE och
 *   sessionens id i den kortlivade kakan (återkomsten: `googleCallbackRoute`).
 * - `GET|POST|DELETE /api/account/google/move` läser, gör eller avbryter flytten (kakan från återkomsten).
 * - `POST /api/account/google/unlink` tar bort kopplingen.
 * - `POST /api/account/logout-all` spärrar kontots alla sessioner och tar bort kakorna här.
 */
type Environment = Parameters<typeof configuration>[0];

async function guardedWrite(request: Request, policy: SecurityPolicy, body: "json" | "none")
  : Promise<{ response: Response } | { proof: ReturnType<typeof sessionProof>; body: unknown }> {
  if (!hasExpectedOrigin(request, policy)) return { response: accountFailure(403, "FORBIDDEN") };
  let value: unknown;
  if (body === "json") {
    try { value = await readJsonBody(request); } catch { return { response: accountFailure(400, "INVALID_REQUEST") }; }
  } else if (!await hasNoRequestBody(request)) return { response: accountFailure(400, "INVALID_REQUEST") };
  return { proof: { ...sessionProof(request, policy, true), requireCsrf: true }, body: value };
}

const authFailure = (status: string) => status === "forbidden" ? accountFailure(403, "FORBIDDEN") : status === "invalid-request"
  ? accountFailure(400, "INVALID_REQUEST") : accountFailure(401, "UNAUTHORIZED");

export async function googleLinkStartRoute(db: Database, request: Request, environment: Environment = process.env, now = new Date()): Promise<Response> {
  const configured = configuration(environment);
  if (!configured) return notFound();
  const input = await guardedWrite(request, configured.policy, "json");
  if ("response" in input) return input.response;
  try {
    const auth = await authenticateUserAccountSession(db, input.proof, now);
    if (auth.status !== "authenticated") return authFailure(auth.status);
    const started = googleRedirect(configured, newGoogleLoginState(now, { mode: "link", sessionId: auth.principal.sessionId }));
    const response = privateJson({ formatVersion: 1, location: started.location });
    response.headers.append("set-cookie", started.cookie);
    return response;
  } catch (error) { logServerError("account", "googleLinkStartRoute", error); return accountFailure(500, "INTERNAL_ERROR"); }
}

function pendingMove(request: Request, policy: SecurityPolicy, now: Date) {
  return parseGoogleMovePending(readUniqueCookie(request, googleMoveCookieName(policy.secureCookies)), now);
}

function moveFailure(status: string): Response {
  switch (status) {
    case "in-use": return accountFailure(409, "GOOGLE_IN_USE");
    case "wrong-password": return accountFailure(409, "CONFIRMATION_MISMATCH");
    case "login-again": return accountFailure(403, "LOGIN_AGAIN");
    case "expired": case "session-mismatch": return accountFailure(410, "EXPIRED");
    default: return authFailure(status);
  }
}

export async function googleMoveRoute(db: Database, request: Request, environment: Environment = process.env, now = new Date()): Promise<Response> {
  const configured = configuration(environment);
  if (!configured) return notFound();
  const { policy } = configured;
  const clear = moveCookie(policy, "deleted", 0);
  try {
    if (request.method === "DELETE") {
      if (!hasExpectedOrigin(request, policy)) return accountFailure(403, "FORBIDDEN");
      const response = new Response(null, { status: 204, headers: privateHeaders });
      response.headers.append("set-cookie", clear);
      return response;
    }
    if (request.method === "GET") {
      const pending = pendingMove(request, policy, now);
      if (!pending) return accountFailure(410, "EXPIRED");
      const result = await readGoogleMove(db, sessionProof(request, policy, false), pending, now);
      if (result.status !== "ready") return moveFailure(result.status);
      return privateJson(googleMoveDetailsSchema.parse({ formatVersion: 1, ...result.details }));
    }
    if (request.method !== "POST") return accountFailure(400, "INVALID_REQUEST");
    const input = await guardedWrite(request, policy, "json");
    if ("response" in input) return input.response;
    const body = googleMoveRequestSchema.safeParse(input.body);
    if (!body.success) return accountFailure(400, "INVALID_REQUEST");
    const pending = pendingMove(request, policy, now);
    if (!pending) return accountFailure(410, "EXPIRED");
    const result = await moveGoogleLinkToAccount(db, { proof: input.proof, pending, ...(body.data.password ? { password: body.data.password } : {}) }, now);
    if (result.status !== "moved") return moveFailure(result.status);
    // Inga adresser i loggen; superadmins logg har flytten.
    console.info("Google-kopplingen flyttades från ett tomt konto (dubblett), som togs bort.");
    const response = privateJson(googleMoveResponseSchema.parse({ formatVersion: 1, status: "moved", googleEmail: result.googleEmail }));
    response.headers.append("set-cookie", clear);
    return response;
  } catch (error) { logServerError("account", "googleMoveRoute", error); return accountFailure(500, "INTERNAL_ERROR"); }
}

export async function googleUnlinkRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const configured = configuration(environment);
  if (!configured) return notFound();
  const input = await guardedWrite(request, configured.policy, "none");
  if ("response" in input) return input.response;
  try {
    const result = await unlinkGoogleFromAccount(db, input.proof);
    if (result.status === "unlinked") return privateJson({ formatVersion: 1, status: "unlinked" });
    if (result.status === "not-linked") return accountFailure(404, "NOT_FOUND");
    if (result.status === "last-login-method") return accountFailure(409, "LAST_LOGIN_METHOD");
    return authFailure(result.status);
  } catch (error) { logServerError("account", "googleUnlinkRoute", error); return accountFailure(500, "INTERNAL_ERROR"); }
}

/** Logga ut från alla enheter. Fungerar också utan Google (egen policy). */
export async function logoutAllRoute(db: Database, request: Request, policy: SecurityPolicy): Promise<Response> {
  const input = await guardedWrite(request, policy, "none");
  if ("response" in input) return input.response;
  try {
    const result = await logoutAllUserAccountSessions(db, input.proof);
    if (result.status === "unauthorized") return clearSessionCookies(accountFailure(401, "UNAUTHORIZED"), policy);
    if (result.status !== "logged-out") return authFailure(result.status);
    return clearSessionCookies(privateJson({ formatVersion: 1, sessions: result.sessions }), policy);
  } catch (error) { logServerError("account", "logoutAllRoute", error); return accountFailure(500, "INTERNAL_ERROR"); }
}
