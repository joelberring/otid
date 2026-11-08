import { randomBytes, randomUUID, createHash } from "node:crypto";
import { and, desc, eq, isNull, lt, notExists, or } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { consumeAccountRequestAllowance } from "./account-throttle";
import type { ClubProof } from "./club-access";
import { UUID_PATTERN } from "./serialization";
import type { DbExecutor } from "./snapshot";
import { authenticateUserAccountSessionForMutation, authenticateUserAccountSessionForProtectedRead } from "./user-account";

/**
 * ADR-0219 (K2): O-Tid som inloggningsserver (OAuth 2.1) för AI-kopplingen. Publika klienter registrerar sig själva (RFC 7591),
 * personen godkänner i O-Tid (inloggad som vanligt) och klienten byter koden mot nycklar med PKCE (S256). Behörigheten
 * `kartprojekt` räcker bara till kartprojekten (MCP-verktygen); allt annat i O-Tid kräver sessionen som förut. Ägaren 2026-11-08:
 * `banlaggning` ger AI-banläggningsassistenten (läsa banläggningen där kontot har behörighet och lämna notiser). En koppling som
 * godkändes före den har bara `kartprojekt`; personen kopplar om för att ge mer. Koder och nycklar
 * sparas bara som sha256; en förnyelsenyckel byts vid varje förnyelse och en gammal som används igen återkallar kopplingen.
 */
export const OAUTH_SCOPES = ["kartprojekt", "banlaggning"] as const;
export type OauthScope = typeof OAUTH_SCOPES[number];
/** Behörigheterna i en sparad `scope` (mellanslag mellan), bara de kända. */
export const scopesOf = (scope: string): OauthScope[] => scope.split(" ").filter((part): part is OauthScope => (OAUTH_SCOPES as readonly string[]).includes(part));
export const OAUTH_CODE_LIFETIME_MS = 5 * 60_000;
export const OAUTH_ACCESS_LIFETIME_MS = 60 * 60_000;
export const OAUTH_REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60_000;
/** Återkallade och utgångna kopplingar står kvar så länge (kontot ser vad som hänt), sedan rensas de. */
const GRANT_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** Registreringar per IP och timme, och token-anrop per IP och timme. */
const REGISTRATIONS_PER_HOUR = 20;
const TOKEN_REQUESTS_PER_HOUR = 300;
const MAX_REDIRECTS = 10;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export type OauthError = { status: "error"; error: string; description: string; httpStatus: number };
const failure = (error: string, description: string, httpStatus = 400): OauthError => ({ status: "error", error, description, httpStatus });

/**
 * En omdirigering som får registreras: https (vilken värd som helst) eller http till den egna datorn, utan fragment och
 * användaruppgifter. Claude använder https://claude.ai/api/mcp/auth_callback.
 */
export function validRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return url.hostname.length > 0;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** RFC 7636: BASE64URL(SHA256(verifier)) utan utfyllnad. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** RFC 7591: registrerar en publik klient (ingen hemlighet). Ger klientens id och det sparade. */
export async function registerOauthClient(db: Database, input: { body: unknown; ip: string }, now = new Date())
  : Promise<OauthError | { status: "created"; client: { client_id: string; client_name: string; redirect_uris: string[];
    token_endpoint_auth_method: "none"; grant_types: string[]; response_types: string[]; client_id_issued_at: number } }> {
  const body = (input.body && typeof input.body === "object" ? input.body : {}) as Record<string, unknown>;
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > MAX_REDIRECTS || !uris.every(validRedirectUri)) {
    return failure("invalid_redirect_uri", "redirect_uris ska vara 1–10 adresser med https (eller http till localhost)");
  }
  const method = body.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return failure("invalid_client_metadata", "Bara publika klienter (token_endpoint_auth_method none)");
  const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : "AI-klient";
  return db.transaction(async tx => {
    if (!await consumeAccountRequestAllowance(tx, { scope: "OAUTH_REGISTER_IP", key: input.ip, limit: REGISTRATIONS_PER_HOUR }, now)) {
      return failure("too_many_requests", "För många registreringar; försök igen senare", 429);
    }
    const id = randomBytes(18).toString("base64url");
    await tx.insert(schema.oauthClients).values({ id, name, redirectUris: [...new Set(uris)], createdAt: now });
    return { status: "created", client: { client_id: id, client_name: name, redirect_uris: [...new Set(uris)],
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      client_id_issued_at: Math.floor(now.getTime() / 1000) } } as const;
  });
}

export interface AuthorizationRequest {
  clientId: string; redirectUri: string; codeChallenge: string; state: string | null; scope: string; resource: string | null;
}

/**
 * Prövar en begäran om godkännande (frågeparametrarna till /oauth/authorize). Fel som inte får skickas tillbaka till klienten
 * (okänd klient eller omdirigering) blir `invalid`; övriga fel skickas tillbaka till omdirigeringen (`redirectError`).
 */
export async function checkAuthorizationRequest(tx: DbExecutor, query: Record<string, string | undefined>, resource: string)
  : Promise<{ status: "invalid"; description: string } | { status: "redirect-error"; redirect: string }
    | { status: "ok"; request: AuthorizationRequest; clientName: string }> {
  const clientId = query.client_id ?? "";
  const redirectUri = query.redirect_uri ?? "";
  if (!CLIENT_ID_PATTERN.test(clientId)) return { status: "invalid", description: "Okänd klient" };
  const [client] = await tx.select().from(schema.oauthClients).where(eq(schema.oauthClients.id, clientId));
  if (!client) return { status: "invalid", description: "Okänd klient" };
  if (!client.redirectUris.includes(redirectUri)) return { status: "invalid", description: "Omdirigeringen är inte registrerad för klienten" };
  const state = query.state ?? null;
  const back = (error: string, description: string) => ({ status: "redirect-error" as const,
    redirect: withParams(redirectUri, { error, error_description: description, ...(state ? { state } : {}) }) });
  if (query.response_type !== "code") return back("unsupported_response_type", "Bara response_type=code");
  if (query.code_challenge_method !== "S256" || !CHALLENGE_PATTERN.test(query.code_challenge ?? "")) {
    return back("invalid_request", "PKCE med S256 krävs");
  }
  // Utan scope: alla. Okända avvisas.
  const scopes = query.scope ? [...new Set(query.scope.split(" ").filter(Boolean))] : [...OAUTH_SCOPES];
  if (scopes.length === 0 || scopes.some(scope => !(OAUTH_SCOPES as readonly string[]).includes(scope))) {
    return back("invalid_scope", `Bara ${OAUTH_SCOPES.join(" och ")}`);
  }
  if (query.resource && query.resource !== resource) return back("invalid_target", "Okänd resurs");
  if (state !== null && state.length > 500) return back("invalid_request", "state är för lång");
  return { status: "ok", clientName: client.name, request: { clientId, redirectUri, codeChallenge: query.code_challenge!, state,
    scope: OAUTH_SCOPES.filter(scope => scopes.includes(scope)).join(" "), resource: query.resource ?? null } };
}

function withParams(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** Sidan för godkännande: klientens namn och vart svaret skickas, för den inloggade. */
export async function describeAuthorization(db: Database, input: ClubProof & { query: Record<string, string | undefined>; resource: string },
  now = new Date()): Promise<{ status: "unauthorized" | "forbidden" } | { status: "invalid"; description: string }
  | { status: "redirect-error"; redirect: string } | { status: "ok"; clientName: string; redirectHost: string; accountEmail: string; scopes: OauthScope[] }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, input, now);
    if (auth.status !== "authenticated") return auth;
    const checked = await checkAuthorizationRequest(tx, input.query, input.resource);
    if (checked.status !== "ok") return checked;
    return { status: "ok", clientName: checked.clientName, redirectHost: new URL(checked.request.redirectUri).host, accountEmail: auth.principal.email,
      scopes: scopesOf(checked.request.scope) } as const;
  });
}

/** Personen tillåter eller nekar. Ger adressen att skicka webbläsaren till (koden eller felet, med `state`). */
export async function decideAuthorization(db: Database, input: ClubProof & { query: Record<string, string | undefined>; resource: string;
  approve: boolean }, now = new Date()): Promise<{ status: "unauthorized" | "forbidden" } | { status: "invalid"; description: string }
  | { status: "redirect"; redirect: string }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const checked = await checkAuthorizationRequest(tx, input.query, input.resource);
    if (checked.status === "invalid") return checked;
    if (checked.status === "redirect-error") return { status: "redirect", redirect: checked.redirect } as const;
    const { request } = checked;
    const state = request.state ? { state: request.state } : {};
    if (!input.approve) {
      return { status: "redirect", redirect: withParams(request.redirectUri, { error: "access_denied", error_description: "Personen nekade", ...state }) } as const;
    }
    const code = secret("otid_c_");
    await tx.insert(schema.oauthCodes).values({ codeSha256: sha256(code), clientId: request.clientId, accountId: auth.principal.accountId,
      redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, scope: request.scope, resource: request.resource,
      createdAt: now, expiresAt: new Date(now.getTime() + OAUTH_CODE_LIFETIME_MS) });
    return { status: "redirect", redirect: withParams(request.redirectUri, { code, ...state }) } as const;
  });
}

export interface TokenResponse {
  access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string;
}

async function issue(tx: DbExecutor, grant: { id: string; refreshSha256: string }, now: Date): Promise<{ access: string; refresh: string }> {
  const access = secret("otid_at_"), refresh = secret("otid_rt_");
  await tx.update(schema.oauthGrants).set({ accessSha256: sha256(access), refreshSha256: sha256(refresh), previousRefreshSha256: grant.refreshSha256,
    accessExpiresAt: new Date(now.getTime() + OAUTH_ACCESS_LIFETIME_MS), refreshExpiresAt: new Date(now.getTime() + OAUTH_REFRESH_LIFETIME_MS),
    refreshedAt: now }).where(eq(schema.oauthGrants.id, grant.id));
  return { access, refresh };
}

const tokenResponse = (tokens: { access: string; refresh: string }, scope: string): TokenResponse =>
  ({ access_token: tokens.access, token_type: "Bearer", expires_in: Math.floor(OAUTH_ACCESS_LIFETIME_MS / 1000), refresh_token: tokens.refresh, scope });

/** Token-anropet (formulär): `authorization_code` med PKCE eller `refresh_token` (byts vid varje förnyelse). */
export async function exchangeOauthToken(db: Database, input: { form: Record<string, string | undefined>; ip: string; resource: string },
  now = new Date()): Promise<OauthError | { status: "ok"; response: TokenResponse }> {
  const form = input.form;
  return db.transaction(async tx => {
    if (!await consumeAccountRequestAllowance(tx, { scope: "OAUTH_TOKEN_IP", key: input.ip, limit: TOKEN_REQUESTS_PER_HOUR }, now)) {
      return failure("too_many_requests", "För många försök; försök igen senare", 429);
    }
    await purgeExpired(tx, now);
    if (form.resource && form.resource !== input.resource) return failure("invalid_target", "Okänd resurs");
    if (form.grant_type === "authorization_code") {
      const code = form.code ?? "";
      const [row] = await tx.select().from(schema.oauthCodes).where(eq(schema.oauthCodes.codeSha256, sha256(code))).for("update");
      if (!row || row.usedAt || row.expiresAt <= now || row.clientId !== form.client_id || row.redirectUri !== form.redirect_uri) {
        return failure("invalid_grant", "Koden är ogiltig, använd eller för gammal");
      }
      await tx.update(schema.oauthCodes).set({ usedAt: now }).where(eq(schema.oauthCodes.codeSha256, row.codeSha256));
      if (!VERIFIER_PATTERN.test(form.code_verifier ?? "") || pkceChallenge(form.code_verifier!) !== row.codeChallenge) {
        return failure("invalid_grant", "PKCE stämmer inte");
      }
      const [client] = await tx.select().from(schema.oauthClients).where(eq(schema.oauthClients.id, row.clientId));
      const grantId = randomUUID();
      const access = secret("otid_at_"), refresh = secret("otid_rt_");
      await tx.insert(schema.oauthGrants).values({ id: grantId, accountId: row.accountId, clientId: row.clientId, clientName: client?.name ?? "AI-klient",
        scope: row.scope, resource: row.resource, accessSha256: sha256(access), accessExpiresAt: new Date(now.getTime() + OAUTH_ACCESS_LIFETIME_MS),
        refreshSha256: sha256(refresh), refreshExpiresAt: new Date(now.getTime() + OAUTH_REFRESH_LIFETIME_MS), createdAt: now });
      await tx.update(schema.oauthClients).set({ lastUsedAt: now }).where(eq(schema.oauthClients.id, row.clientId));
      return { status: "ok", response: tokenResponse({ access, refresh }, row.scope) } as const;
    }
    if (form.grant_type === "refresh_token") {
      const presented = sha256(form.refresh_token ?? "");
      const [grant] = await tx.select().from(schema.oauthGrants).where(eq(schema.oauthGrants.refreshSha256, presented)).for("update");
      if (!grant) {
        // En förnyelsenyckel som redan bytts: någon annan har en kopia. Kopplingen återkallas (OAuth 2.1, rotation).
        await tx.update(schema.oauthGrants).set({ revokedAt: now })
          .where(and(eq(schema.oauthGrants.previousRefreshSha256, presented), isNull(schema.oauthGrants.revokedAt)));
        return failure("invalid_grant", "Förnyelsenyckeln är ogiltig");
      }
      if (grant.revokedAt || grant.refreshExpiresAt <= now || grant.clientId !== form.client_id) {
        return failure("invalid_grant", "Förnyelsenyckeln är ogiltig");
      }
      return { status: "ok", response: tokenResponse(await issue(tx, grant, now), grant.scope) } as const;
    }
    return failure("unsupported_grant_type", "Bara authorization_code och refresh_token");
  });
}

/** RFC 7009: återkallar kopplingen som nyckeln hör till (åtkomst- eller förnyelsenyckel). Okänd nyckel är inget fel. */
export async function revokeOauthToken(db: Database, token: string, now = new Date()): Promise<void> {
  const hash = sha256(token);
  await db.update(schema.oauthGrants).set({ revokedAt: now })
    .where(and(isNull(schema.oauthGrants.revokedAt), or(eq(schema.oauthGrants.accessSha256, hash), eq(schema.oauthGrants.refreshSha256, hash))));
}

/** Kontot bakom en åtkomstnyckel (giltig, inte återkallad), eller undefined. Senast använd uppdateras högst en gång i minuten. */
export async function authenticateOauthAccess(db: Database, token: string | null, now = new Date())
  : Promise<{ accountId: string; grantId: string; clientName: string; scopes: OauthScope[] } | undefined> {
  if (!token || !token.startsWith("otid_at_") || token.length > 100) return undefined;
  const [grant] = await db.select().from(schema.oauthGrants).where(eq(schema.oauthGrants.accessSha256, sha256(token)));
  if (!grant || grant.revokedAt || grant.accessExpiresAt <= now) return undefined;
  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > 60_000) {
    await db.update(schema.oauthGrants).set({ lastUsedAt: now }).where(eq(schema.oauthGrants.id, grant.id));
  }
  return { accountId: grant.accountId, grantId: grant.id, clientName: grant.clientName, scopes: scopesOf(grant.scope) };
}

export interface AiConnectionView {
  grantId: string; clientName: string; createdAt: string; lastUsedAt: string | null; expiresAt: string; revokedAt: string | null;
}

/** Kontots AI-kopplingar (de senaste 50), aktiva först. */
export async function listAiConnections(db: Database, proof: ClubProof, now = new Date())
  : Promise<{ status: "unauthorized" | "forbidden" } | { status: "ok"; connections: AiConnectionView[] }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    const rows = await tx.select().from(schema.oauthGrants).where(eq(schema.oauthGrants.accountId, auth.principal.accountId))
      .orderBy(desc(schema.oauthGrants.createdAt)).limit(50);
    const active = (row: typeof rows[number]) => !row.revokedAt && row.refreshExpiresAt > now;
    return { status: "ok", connections: [...rows.filter(active), ...rows.filter(row => !active(row))].map(row => ({ grantId: row.id,
      clientName: row.clientName, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.refreshExpiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? (row.refreshExpiresAt <= now ? row.refreshExpiresAt.toISOString() : null) })) } as const;
  });
}

/** Kontot återkallar en av sina kopplingar. */
export async function revokeAiConnection(db: Database, input: ClubProof & { grantId: string }, now = new Date())
  : Promise<{ status: "unauthorized" | "forbidden" | "not-found" | "revoked" }> {
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    if (!UUID_PATTERN.test(input.grantId)) return { status: "not-found" } as const;
    const updated = await tx.update(schema.oauthGrants).set({ revokedAt: now })
      .where(and(eq(schema.oauthGrants.id, input.grantId), eq(schema.oauthGrants.accountId, auth.principal.accountId)))
      .returning({ id: schema.oauthGrants.id, revokedAt: schema.oauthGrants.revokedAt });
    return updated.length > 0 ? { status: "revoked" } as const : { status: "not-found" } as const;
  });
}

/** Kontot tas bort: dess koder och kopplingar försvinner. */
export async function purgeOauthForAccount(tx: DbExecutor, accountId: string): Promise<void> {
  await tx.delete(schema.oauthCodes).where(eq(schema.oauthCodes.accountId, accountId));
  await tx.delete(schema.oauthGrants).where(eq(schema.oauthGrants.accountId, accountId));
}

/** Gamla koder, kopplingar som gått ut eller återkallats för länge sedan och klienter som aldrig använts. */
async function purgeExpired(tx: DbExecutor, now: Date): Promise<void> {
  const before = new Date(now.getTime() - GRANT_RETENTION_MS);
  await tx.delete(schema.oauthCodes).where(lt(schema.oauthCodes.expiresAt, new Date(now.getTime() - 60 * 60_000)));
  await tx.delete(schema.oauthGrants).where(or(lt(schema.oauthGrants.refreshExpiresAt, before), lt(schema.oauthGrants.revokedAt, before)));
  await tx.delete(schema.oauthClients).where(and(isNull(schema.oauthClients.lastUsedAt), lt(schema.oauthClients.createdAt, before),
    notExists(tx.select({ one: schema.oauthCodes.codeSha256 }).from(schema.oauthCodes).where(eq(schema.oauthCodes.clientId, schema.oauthClients.id)))));
}
