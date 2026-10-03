import {
  authenticatePairingAdminSession,
  changeEntryIdentityAsAdmin,
  listEntryIdentitiesAsAdmin,
  listEntryIdentityHistoryAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  entryIdentityAdminListResponseSchema,
  entryIdentityAdminLoginRequestSchema,
  entryIdentityAdminLoginResponseSchema,
  entryIdentityChangeIdempotencyKeySchema,
  entryIdentityChangeRequestSchema,
  entryIdentityChangeResponseSchema,
  entryIdentityHistoryResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  EntryIdentityAdminConfigurationError,
  clearEntryIdentityAdminCookies,
  entryIdentityAdminFailure,
  entryIdentityAdminJson,
  entryIdentityAdminSecurityPolicy,
  entryIdentityAdminSessionProof,
  hasExpectedEntryIdentityAdminOrigin,
  hasNoEntryIdentityAdminRequestBody,
  privateEntryIdentityAdminHeaders,
  readEntryIdentityAdminJson,
  setEntryIdentityAdminCookies
} from "./entry-identity-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listEntryIdentitiesAsAdmin;
type Change = typeof changeEntryIdentityAsAdmin;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function validScope(request: Request, raceId: string, entryId?: string): boolean {
  return uuid.test(raceId) && (entryId === undefined || uuid.test(entryId)) && new URL(request.url).search === "";
}

function policyOrFailure(environment: Environment) {
  try {
    return { policy: entryIdentityAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof EntryIdentityAdminConfigurationError) {
      return { response: entryIdentityAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function entryIdentityAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  if (!validScope(request, raceId)) return entryIdentityAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryIdentityAdminOrigin(request, configured.policy)) return entryIdentityAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try {
    body = await readEntryIdentityAdminJson(request);
  } catch {
    return entryIdentityAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = entryIdentityAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return entryIdentityAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "CHANGE_ENTRY_IDENTITY" });
    if (result.status === "unauthorized") return entryIdentityAdminFailure(401, "UNAUTHORIZED");
    const responseBody = entryIdentityAdminLoginResponseSchema.parse(result.response);
    if (responseBody.raceId !== raceId) return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
    return setEntryIdentityAdminCookies(entryIdentityAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: responseBody.expiresAt
    });
  } catch {
    return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryIdentityAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  if (!validScope(request, raceId)) return entryIdentityAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryIdentityAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "CHANGE_ENTRY_IDENTITY" });
    if (result.status === "unauthorized") return entryIdentityAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryIdentityAdminFailure(403, "FORBIDDEN");
    if (result.principal.raceId !== raceId) return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
    return entryIdentityAdminJson(entryIdentityAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryIdentityAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  if (!validScope(request, raceId)) return entryIdentityAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryIdentityAdminOrigin(request, configured.policy)) return entryIdentityAdminFailure(403, "FORBIDDEN");
  const proof = entryIdentityAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "CHANGE_ENTRY_IDENTITY",
      readBodyIsEmpty: () => hasNoEntryIdentityAdminRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearEntryIdentityAdminCookies(entryIdentityAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    }
    if (result.status === "forbidden") return entryIdentityAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return entryIdentityAdminFailure(400, "INVALID_REQUEST");
    return clearEntryIdentityAdminCookies(new Response(null, { status: 204, headers: privateEntryIdentityAdminHeaders }), configured.policy);
  } catch {
    return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryIdentityAdminListRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listEntryIdentitiesAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  if (!validScope(request, raceId)) return entryIdentityAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryIdentityAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    if (result.status === "unauthorized") return entryIdentityAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryIdentityAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return entryIdentityAdminFailure(400, "INVALID_REQUEST");
    if (!("response" in result)) return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
    const response = entryIdentityAdminListResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
    return entryIdentityAdminJson(response);
  } catch {
    return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function authenticatedEntryIdentityChangeRoute(
  db: Database,
  request: Request,
  raceId: string,
  entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  change: Change = changeEntryIdentityAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  if (!validScope(request, raceId, entryId)) return entryIdentityAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryIdentityAdminOrigin(request, configured.policy)) return entryIdentityAdminFailure(403, "FORBIDDEN");
  const proof = entryIdentityAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "CHANGE_ENTRY_IDENTITY",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return entryIdentityAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return entryIdentityAdminFailure(403, "FORBIDDEN");
    if (authorization.principal.raceId !== raceId || authorization.principal.capability !== "CHANGE_ENTRY_IDENTITY") {
      return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
    }
  } catch {
    return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!entryIdentityChangeIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return entryIdentityAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try {
    body = await readEntryIdentityAdminJson(request);
  } catch {
    return entryIdentityAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = entryIdentityChangeRequestSchema.safeParse(body);
  if (!parsed.success) return entryIdentityAdminFailure(400, "INVALID_REQUEST");

  try {
    const result = await change(db, {
      ...proof,
      raceId,
      entryId,
      idempotencyKey,
      request: parsed.data
    });
    if (result.status === "unauthorized") return entryIdentityAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryIdentityAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return entryIdentityAdminFailure(400, "INVALID_REQUEST");
    if (result.status === "not-found") return entryIdentityAdminFailure(404, "NOT_FOUND");
    if (result.status === "conflict") return entryIdentityAdminFailure(409, "CONFLICT");
    if (!("response" in result)) return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
    const response = entryIdentityChangeResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== entryId ||
      response.requestId !== idempotencyKey!.slice("entry-identity-change:".length)) {
      return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
    }
    return entryIdentityAdminJson(response);
  } catch {
    return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryIdentityAdminHistoryRoute(
  db: Database, request: Request, raceId: string, entryId: string,
  list: typeof listEntryIdentityHistoryAsAdmin = listEntryIdentityHistoryAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  if (!uuid.test(raceId) || !uuid.test(entryId)) return entryIdentityAdminFailure(400, "INVALID_REQUEST");
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => !["limit", "cursor"].includes(key)) ||
    query.getAll("limit").length > 1 || query.getAll("cursor").length > 1) {
    return entryIdentityAdminFailure(400, "INVALID_REQUEST");
  }
  const limitText = query.get("limit") ?? "20";
  const cursor = query.get("cursor");
  if (!/^[1-9]\d?$/.test(limitText) || Number(limitText) > 50 ||
    (cursor !== null && !/^[A-Za-z0-9_-]{1,1024}$/.test(cursor))) return entryIdentityAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryIdentityAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId, entryId, limit: Number(limitText), ...(cursor === null ? {} : { cursor }) });
    if (result.status === "unauthorized") return entryIdentityAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryIdentityAdminFailure(403, "FORBIDDEN");
    if (result.status === "not-found") return entryIdentityAdminFailure(404, "NOT_FOUND");
    if (result.status === "invalid-request") return entryIdentityAdminFailure(400, "INVALID_REQUEST");
    if (!("response" in result)) return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
    const response = entryIdentityHistoryResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entryId !== entryId) return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
    return entryIdentityAdminJson(response);
  } catch {
    return entryIdentityAdminFailure(500, "INTERNAL_ERROR");
  }
}
