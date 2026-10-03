import {
  authenticatePairingAdminSession,
  changeEntryCardAsAdmin,
  listEntryCardsAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  entryCardAdminListResponseSchema,
  entryCardAdminLoginRequestSchema,
  entryCardAdminLoginResponseSchema,
  entryCardChangeIdempotencyKeySchema,
  entryCardChangeRequestSchema,
  entryCardChangeResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  EntryCardAdminConfigurationError,
  clearEntryCardAdminCookies,
  entryCardAdminFailure,
  entryCardAdminJson,
  entryCardAdminSecurityPolicy,
  entryCardAdminSessionProof,
  hasExpectedEntryCardAdminOrigin,
  hasNoEntryCardAdminRequestBody,
  privateEntryCardAdminHeaders,
  readEntryCardAdminJson,
  setEntryCardAdminCookies
} from "./entry-card-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listEntryCardsAsAdmin;
type Change = typeof changeEntryCardAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: entryCardAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof EntryCardAdminConfigurationError) {
      return { response: entryCardAdminFailure(500, "INTERNAL_ERROR") } as const;
    }
    throw error;
  }
}

function invalidLoginStatus(value: unknown): 400 | 401 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return 400;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === 2 && keys[0] === "accessCredential" && keys[1] === "formatVersion" &&
    record.formatVersion === 1 && typeof record.accessCredential === "string" ? 401 : 400;
}

export async function entryCardAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryCardAdminOrigin(request, configured.policy)) return entryCardAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try {
    body = await readEntryCardAdminJson(request);
  } catch {
    return entryCardAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = entryCardAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return entryCardAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "CHANGE_ENTRY_CARD" });
    if (result.status === "unauthorized") return entryCardAdminFailure(401, "UNAUTHORIZED");
    const responseBody = entryCardAdminLoginResponseSchema.parse(result.response);
    return setEntryCardAdminCookies(entryCardAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: responseBody.expiresAt
    });
  } catch {
    return entryCardAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryCardAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryCardAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "CHANGE_ENTRY_CARD" });
    if (result.status === "unauthorized") return entryCardAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryCardAdminFailure(403, "FORBIDDEN");
    return entryCardAdminJson(entryCardAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return entryCardAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryCardAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryCardAdminOrigin(request, configured.policy)) return entryCardAdminFailure(403, "FORBIDDEN");
  const proof = entryCardAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "CHANGE_ENTRY_CARD",
      readBodyIsEmpty: () => hasNoEntryCardAdminRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearEntryCardAdminCookies(entryCardAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    }
    if (result.status === "forbidden") return entryCardAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return entryCardAdminFailure(400, "INVALID_REQUEST");
    return clearEntryCardAdminCookies(new Response(null, { status: 204, headers: privateEntryCardAdminHeaders }), configured.policy);
  } catch {
    return entryCardAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryCardAdminListRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listEntryCardsAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryCardAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    if (result.status === "unauthorized") return entryCardAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryCardAdminFailure(403, "FORBIDDEN");
    if (!("response" in result)) return entryCardAdminFailure(500, "INTERNAL_ERROR");
    return entryCardAdminJson(entryCardAdminListResponseSchema.parse(result.response));
  } catch {
    return entryCardAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function authenticatedEntryCardChangeRoute(
  db: Database,
  request: Request,
  raceId: string,
  entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  change: Change = changeEntryCardAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryCardAdminOrigin(request, configured.policy)) return entryCardAdminFailure(403, "FORBIDDEN");
  const proof = entryCardAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "CHANGE_ENTRY_CARD",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return entryCardAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return entryCardAdminFailure(403, "FORBIDDEN");
  } catch {
    return entryCardAdminFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!entryCardChangeIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return entryCardAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try {
    body = await readEntryCardAdminJson(request);
  } catch {
    return entryCardAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = entryCardChangeRequestSchema.safeParse(body);
  if (!parsed.success) return entryCardAdminFailure(400, "INVALID_REQUEST");

  try {
    const result = await change(db, {
      ...proof,
      raceId,
      entryId,
      idempotencyKey,
      request: parsed.data
    });
    if (result.status === "unauthorized") return entryCardAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryCardAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return entryCardAdminFailure(400, "INVALID_REQUEST");
    if (result.status === "not-found") return entryCardAdminFailure(404, "NOT_FOUND");
    if (result.status === "conflict") return entryCardAdminFailure(409, "CONFLICT");
    if (!("response" in result)) return entryCardAdminFailure(500, "INTERNAL_ERROR");
    return entryCardAdminJson(entryCardChangeResponseSchema.parse(result.response));
  } catch {
    return entryCardAdminFailure(500, "INTERNAL_ERROR");
  }
}

