import {
  authenticatePairingAdminSession,
  changeEntryStartTimeAsAdmin,
  listEntryStartTimesAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  entryStartTimeAdminListResponseSchema,
  entryStartTimeAdminLoginRequestSchema,
  entryStartTimeAdminLoginResponseSchema,
  entryStartTimeChangeIdempotencyKeySchema,
  entryStartTimeChangeRequestSchema,
  entryStartTimeChangeResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  EntryStartTimeAdminConfigurationError,
  clearEntryStartTimeAdminCookies,
  entryStartTimeAdminFailure,
  entryStartTimeAdminJson,
  entryStartTimeAdminSecurityPolicy,
  entryStartTimeAdminSessionProof,
  hasExpectedEntryStartTimeAdminOrigin,
  hasNoEntryStartTimeAdminRequestBody,
  privateEntryStartTimeAdminHeaders,
  readEntryStartTimeAdminJson,
  setEntryStartTimeAdminCookies
} from "./entry-start-time-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listEntryStartTimesAsAdmin;
type Change = typeof changeEntryStartTimeAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: entryStartTimeAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof EntryStartTimeAdminConfigurationError) {
      return { response: entryStartTimeAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function entryStartTimeAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryStartTimeAdminOrigin(request, configured.policy)) return entryStartTimeAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try {
    body = await readEntryStartTimeAdminJson(request);
  } catch {
    return entryStartTimeAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = entryStartTimeAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return entryStartTimeAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "CHANGE_ENTRY_START_TIME" });
    if (result.status === "unauthorized") return entryStartTimeAdminFailure(401, "UNAUTHORIZED");
    const responseBody = entryStartTimeAdminLoginResponseSchema.parse(result.response);
    return setEntryStartTimeAdminCookies(entryStartTimeAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: responseBody.expiresAt
    });
  } catch {
    return entryStartTimeAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryStartTimeAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryStartTimeAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "CHANGE_ENTRY_START_TIME" });
    if (result.status === "unauthorized") return entryStartTimeAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryStartTimeAdminFailure(403, "FORBIDDEN");
    return entryStartTimeAdminJson(entryStartTimeAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return entryStartTimeAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryStartTimeAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryStartTimeAdminOrigin(request, configured.policy)) return entryStartTimeAdminFailure(403, "FORBIDDEN");
  const proof = entryStartTimeAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "CHANGE_ENTRY_START_TIME",
      readBodyIsEmpty: () => hasNoEntryStartTimeAdminRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearEntryStartTimeAdminCookies(entryStartTimeAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    }
    if (result.status === "forbidden") return entryStartTimeAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return entryStartTimeAdminFailure(400, "INVALID_REQUEST");
    return clearEntryStartTimeAdminCookies(new Response(null, { status: 204, headers: privateEntryStartTimeAdminHeaders }), configured.policy);
  } catch {
    return entryStartTimeAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryStartTimeAdminListRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listEntryStartTimesAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryStartTimeAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    if (result.status === "unauthorized") return entryStartTimeAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryStartTimeAdminFailure(403, "FORBIDDEN");
    if (!("response" in result)) return entryStartTimeAdminFailure(500, "INTERNAL_ERROR");
    return entryStartTimeAdminJson(entryStartTimeAdminListResponseSchema.parse(result.response));
  } catch {
    return entryStartTimeAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function authenticatedEntryStartTimeChangeRoute(
  db: Database,
  request: Request,
  raceId: string,
  entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  change: Change = changeEntryStartTimeAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryStartTimeAdminOrigin(request, configured.policy)) return entryStartTimeAdminFailure(403, "FORBIDDEN");
  const proof = entryStartTimeAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "CHANGE_ENTRY_START_TIME",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return entryStartTimeAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return entryStartTimeAdminFailure(403, "FORBIDDEN");
  } catch {
    return entryStartTimeAdminFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!entryStartTimeChangeIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return entryStartTimeAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try {
    body = await readEntryStartTimeAdminJson(request);
  } catch {
    return entryStartTimeAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = entryStartTimeChangeRequestSchema.safeParse(body);
  if (!parsed.success) return entryStartTimeAdminFailure(400, "INVALID_REQUEST");

  try {
    const result = await change(db, {
      ...proof,
      raceId,
      entryId,
      idempotencyKey,
      request: parsed.data
    });
    if (result.status === "unauthorized") return entryStartTimeAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryStartTimeAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return entryStartTimeAdminFailure(400, "INVALID_REQUEST");
    if (result.status === "not-found") return entryStartTimeAdminFailure(404, "NOT_FOUND");
    if (result.status === "conflict") return entryStartTimeAdminFailure(409, "CONFLICT");
    if (!("response" in result)) return entryStartTimeAdminFailure(500, "INTERNAL_ERROR");
    return entryStartTimeAdminJson(entryStartTimeChangeResponseSchema.parse(result.response));
  } catch {
    return entryStartTimeAdminFailure(500, "INTERNAL_ERROR");
  }
}
