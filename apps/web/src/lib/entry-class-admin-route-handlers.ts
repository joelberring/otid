import {
  authenticatePairingAdminSession,
  changeEntryClassAsAdmin,
  listEntryClassesAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  entryClassAdminListResponseSchema,
  entryClassAdminLoginRequestSchema,
  entryClassAdminLoginResponseSchema,
  entryClassChangeIdempotencyKeySchema,
  entryClassChangeRequestSchema,
  entryClassChangeResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  EntryClassAdminConfigurationError,
  clearEntryClassAdminCookies,
  entryClassAdminFailure,
  entryClassAdminJson,
  entryClassAdminSecurityPolicy,
  entryClassAdminSessionProof,
  hasExpectedEntryClassAdminOrigin,
  hasNoEntryClassAdminRequestBody,
  privateEntryClassAdminHeaders,
  readEntryClassAdminJson,
  setEntryClassAdminCookies
} from "./entry-class-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listEntryClassesAsAdmin;
type Change = typeof changeEntryClassAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: entryClassAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof EntryClassAdminConfigurationError) {
      return { response: entryClassAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function entryClassAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryClassAdminOrigin(request, configured.policy)) return entryClassAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try {
    body = await readEntryClassAdminJson(request);
  } catch {
    return entryClassAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = entryClassAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return entryClassAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "CHANGE_ENTRY_CLASS" });
    if (result.status === "unauthorized") return entryClassAdminFailure(401, "UNAUTHORIZED");
    const responseBody = entryClassAdminLoginResponseSchema.parse(result.response);
    return setEntryClassAdminCookies(entryClassAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: responseBody.expiresAt
    });
  } catch {
    return entryClassAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryClassAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryClassAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "CHANGE_ENTRY_CLASS" });
    if (result.status === "unauthorized") return entryClassAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryClassAdminFailure(403, "FORBIDDEN");
    return entryClassAdminJson(entryClassAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return entryClassAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryClassAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryClassAdminOrigin(request, configured.policy)) return entryClassAdminFailure(403, "FORBIDDEN");
  const proof = entryClassAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "CHANGE_ENTRY_CLASS",
      readBodyIsEmpty: () => hasNoEntryClassAdminRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearEntryClassAdminCookies(entryClassAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    }
    if (result.status === "forbidden") return entryClassAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return entryClassAdminFailure(400, "INVALID_REQUEST");
    return clearEntryClassAdminCookies(new Response(null, { status: 204, headers: privateEntryClassAdminHeaders }), configured.policy);
  } catch {
    return entryClassAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryClassAdminListRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listEntryClassesAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryClassAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    if (result.status === "unauthorized") return entryClassAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryClassAdminFailure(403, "FORBIDDEN");
    if (!("response" in result)) return entryClassAdminFailure(500, "INTERNAL_ERROR");
    return entryClassAdminJson(entryClassAdminListResponseSchema.parse(result.response));
  } catch {
    return entryClassAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function authenticatedEntryClassChangeRoute(
  db: Database,
  request: Request,
  raceId: string,
  entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  change: Change = changeEntryClassAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryClassAdminOrigin(request, configured.policy)) return entryClassAdminFailure(403, "FORBIDDEN");
  const proof = entryClassAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "CHANGE_ENTRY_CLASS",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return entryClassAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return entryClassAdminFailure(403, "FORBIDDEN");
  } catch {
    return entryClassAdminFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!entryClassChangeIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return entryClassAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try {
    body = await readEntryClassAdminJson(request);
  } catch {
    return entryClassAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = entryClassChangeRequestSchema.safeParse(body);
  if (!parsed.success) return entryClassAdminFailure(400, "INVALID_REQUEST");

  try {
    const result = await change(db, {
      ...proof,
      raceId,
      entryId,
      idempotencyKey,
      request: parsed.data
    });
    if (result.status === "unauthorized") return entryClassAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryClassAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return entryClassAdminFailure(400, "INVALID_REQUEST");
    if (result.status === "not-found") return entryClassAdminFailure(404, "NOT_FOUND");
    if (result.status === "conflict") return entryClassAdminFailure(409, "CONFLICT");
    if (!("response" in result)) return entryClassAdminFailure(500, "INTERNAL_ERROR");
    return entryClassAdminJson(entryClassChangeResponseSchema.parse(result.response));
  } catch {
    return entryClassAdminFailure(500, "INTERNAL_ERROR");
  }
}
