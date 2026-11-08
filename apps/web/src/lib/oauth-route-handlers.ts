import {
  authenticateOauthAccess, decideAuthorization, describeAuthorization, exchangeOauthToken, handleMcpMessage, listAiConnections, OAUTH_SCOPE,
  registerOauthClient, revokeAiConnection, revokeOauthToken, type OauthError
} from "@o-tid/application";
import type { Database } from "@o-tid/database";
import {
  SecurityConfigurationError, accountFailure, clientAddress, hasExpectedOrigin, privateHeaders, privateJson, readBoundedBytes, readJsonBody,
  securityPolicy, sessionProof, type SecurityPolicy
} from "./security-policy";
import { logServerError } from "./server-error-log";

/**
 * ADR-0219 (K2): AI-kopplingens anrop. Metadata (RFC 8414, RFC 9728), registrering (RFC 7591), token och återkallelse
 * (formulär, inga kakor), sidan för godkännande (sessionen som annars, exakt Origin och CSRF när personen svarar) och MCP på
 * `/api/mcp` med åtkomstnyckeln i `Authorization: Bearer`. Svaren cachas aldrig.
 */
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
const REGISTER_MAX_BYTES = 16 * 1024;
const MCP_MAX_BYTES = 1024 * 1024;

function policy(environment: Environment): SecurityPolicy | undefined {
  try { return securityPolicy(environment); }
  catch (error) {
    if (error instanceof SecurityConfigurationError) return undefined;
    throw error;
  }
}

/** MCP-resursen (det åtkomstnyckeln gäller). */
export const mcpResource = (origin: string) => `${origin}/api/mcp`;

async function guarded(work: () => Promise<Response>): Promise<Response> {
  try { return await work(); }
  catch (error) {
    logServerError("oauth", "route", error);
    return accountFailure(500, "INTERNAL_ERROR");
  }
}

function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...privateHeaders, "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store", pragma: "no-cache", ...headers } });
}

const oauthFailure = (error: OauthError) => oauthJson({ error: error.error, error_description: error.description }, error.httpStatus);

/** RFC 9728: skyddade resursens metadata. */
export function protectedResourceRoute(environment: Environment = process.env): Response {
  const value = policy(environment);
  if (!value) return accountFailure(500, "INTERNAL_ERROR");
  return oauthJson({ resource: mcpResource(value.publicOrigin), authorization_servers: [value.publicOrigin], scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"], resource_name: "O-Tid kartritning" });
}

/** RFC 8414: inloggningsserverns metadata. */
export function authorizationServerRoute(environment: Environment = process.env): Response {
  const value = policy(environment);
  if (!value) return accountFailure(500, "INTERNAL_ERROR");
  const origin = value.publicOrigin;
  return oauthJson({ issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`, revocation_endpoint: `${origin}/api/oauth/revoke`, scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"] });
}

export async function registerRoute(db: Database, request: Request): Promise<Response> {
  return guarded(async () => {
    let body: unknown;
    try { body = await readJsonBody(request, REGISTER_MAX_BYTES); }
    catch { return oauthJson({ error: "invalid_client_metadata", error_description: "Kroppen ska vara JSON" }, 400); }
    const result = await registerOauthClient(db, { body, ip: clientAddress(request) });
    return result.status === "created" ? oauthJson(result.client, 201) : oauthFailure(result);
  });
}

/** Formuläret (eller JSON) i token- och återkallelseanropen. */
async function formOf(request: Request): Promise<Record<string, string | undefined>> {
  const bytes = await readBoundedBytes(request, 16 * 1024);
  const text = new TextDecoder().decode(bytes);
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string")) as Record<string, string>;
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export async function tokenRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const value = policy(environment);
  if (!value) return accountFailure(500, "INTERNAL_ERROR");
  return guarded(async () => {
    let form: Record<string, string | undefined>;
    try { form = await formOf(request); } catch { return oauthJson({ error: "invalid_request", error_description: "Formuläret kunde inte läsas" }, 400); }
    const result = await exchangeOauthToken(db, { form, ip: clientAddress(request), resource: mcpResource(value.publicOrigin) });
    return result.status === "ok" ? oauthJson(result.response) : oauthFailure(result);
  });
}

export async function revokeRoute(db: Database, request: Request): Promise<Response> {
  return guarded(async () => {
    let form: Record<string, string | undefined>;
    try { form = await formOf(request); } catch { return oauthJson({ error: "invalid_request" }, 400); }
    if (form.token) await revokeOauthToken(db, form.token);
    return oauthJson({});
  });
}

const queryOf = (url: URL) => Object.fromEntries(url.searchParams);

/** GET: sidan för godkännande frågar vad som begärs (inloggad); POST: personen tillåter eller nekar. */
export async function authorizeRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const value = policy(environment);
  if (!value) return accountFailure(500, "INTERNAL_ERROR");
  const resource = mcpResource(value.publicOrigin);
  return guarded(async () => {
    if (request.method === "GET") {
      const result = await describeAuthorization(db, { ...sessionProof(request, value, false), query: queryOf(new URL(request.url)), resource });
      if (result.status === "unauthorized") return accountFailure(401, "UNAUTHORIZED");
      if (result.status === "forbidden") return accountFailure(403, "FORBIDDEN");
      return privateJson(result);
    }
    if (!hasExpectedOrigin(request, value)) return accountFailure(403, "FORBIDDEN");
    let body: { query?: unknown; approve?: unknown };
    try { body = await readJsonBody(request, 16 * 1024) as typeof body; } catch { return accountFailure(400, "INVALID_REQUEST"); }
    const query = body.query && typeof body.query === "object" ? Object.fromEntries(Object.entries(body.query as Record<string, unknown>)
      .filter(([, entry]) => typeof entry === "string")) as Record<string, string> : {};
    const result = await decideAuthorization(db, { ...sessionProof(request, value, true), query, resource, approve: body.approve === true });
    if (result.status === "unauthorized") return accountFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return accountFailure(403, "FORBIDDEN");
    return privateJson(result);
  });
}

/** Kontots AI-kopplingar (GET) och att återkalla en (DELETE med id). */
export async function aiConnectionsRoute(db: Database, request: Request, grantId?: string, environment: Environment = process.env): Promise<Response> {
  const value = policy(environment);
  if (!value) return accountFailure(500, "INTERNAL_ERROR");
  return guarded(async () => {
    if (request.method === "GET") {
      const result = await listAiConnections(db, sessionProof(request, value, false));
      if (result.status !== "ok") return accountFailure(result.status === "unauthorized" ? 401 : 403, result.status === "unauthorized" ? "UNAUTHORIZED" : "FORBIDDEN");
      return privateJson({ formatVersion: 1, connections: result.connections });
    }
    if (!hasExpectedOrigin(request, value)) return accountFailure(403, "FORBIDDEN");
    const result = await revokeAiConnection(db, { ...sessionProof(request, value, true), grantId: grantId ?? "" });
    if (result.status === "revoked") return privateJson({ formatVersion: 1, revoked: true });
    if (result.status === "not-found") return accountFailure(404, "NOT_FOUND");
    return accountFailure(result.status === "unauthorized" ? 401 : 403, result.status === "unauthorized" ? "UNAUTHORIZED" : "FORBIDDEN");
  });
}

/** MCP (Streamable HTTP utan sessioner): POST med ett JSON-RPC-meddelande; svaret är JSON. GET och DELETE stöds inte. */
export async function mcpRoute(db: Database, request: Request, environment: Environment = process.env): Promise<Response> {
  const value = policy(environment);
  if (!value) return accountFailure(500, "INTERNAL_ERROR");
  const metadata = `${value.publicOrigin}/.well-known/oauth-protected-resource`;
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...privateHeaders, allow: "POST" } });
  return guarded(async () => {
    const header = request.headers.get("authorization") ?? "";
    const token = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1] ?? null;
    const grant = await authenticateOauthAccess(db, token);
    if (!grant) {
      return oauthJson({ error: "invalid_token", error_description: "Logga in i O-Tid via kopplingen" }, 401,
        { "www-authenticate": `Bearer resource_metadata="${metadata}"${token ? `, error="invalid_token"` : ""}` });
    }
    let message: unknown;
    try { message = JSON.parse(new TextDecoder().decode(await readBoundedBytes(request, MCP_MAX_BYTES))); }
    catch { return oauthJson({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Kroppen är inte JSON" } }, 400); }
    const response = await handleMcpMessage(db, grant.accountId, message);
    return response === null ? new Response(null, { status: 202, headers: privateHeaders }) : oauthJson(response);
  });
}
