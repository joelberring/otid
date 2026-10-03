import {
  authenticatePairingAdminSession,
  registerEntryAsAdmin,
  listEntryRegistrationStartSlotsAsAdmin,
  listEntryRegistrationClassesAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  entryRegistrationClassesResponseSchema,
  entryRegistrationAdminLoginRequestSchema,
  entryRegistrationAdminLoginResponseSchema,
  entryRegistrationIdempotencyKeySchema,
  entryRegistrationRequestSchema,
  entryRegistrationResponseSchema,
  entryRegistrationStartSlotCandidatesSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  EntryRegistrationAdminConfigurationError,
  clearEntryRegistrationAdminCookies,
  entryRegistrationAdminFailure,
  entryRegistrationAdminJson,
  entryRegistrationAdminSecurityPolicy,
  entryRegistrationAdminSessionProof,
  hasExpectedEntryRegistrationAdminOrigin,
  hasNoEntryRegistrationAdminRequestBody,
  privateEntryRegistrationAdminHeaders,
  readEntryRegistrationAdminJson,
  setEntryRegistrationAdminCookies
} from "./entry-registration-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listEntryRegistrationClassesAsAdmin;
type ListSlots = typeof listEntryRegistrationStartSlotsAsAdmin;
type Change = typeof registerEntryAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: entryRegistrationAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof EntryRegistrationAdminConfigurationError) {
      return { response: entryRegistrationAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function entryRegistrationAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryRegistrationAdminOrigin(request, configured.policy)) return entryRegistrationAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try {
    body = await readEntryRegistrationAdminJson(request);
  } catch {
    return entryRegistrationAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = entryRegistrationAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return entryRegistrationAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "REGISTER_ENTRY" });
    if (result.status === "unauthorized") return entryRegistrationAdminFailure(401, "UNAUTHORIZED");
    const responseBody = entryRegistrationAdminLoginResponseSchema.parse(result.response);
    return setEntryRegistrationAdminCookies(entryRegistrationAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: responseBody.expiresAt
    });
  } catch {
    return entryRegistrationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryRegistrationAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryRegistrationAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "REGISTER_ENTRY" });
    if (result.status === "unauthorized") return entryRegistrationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryRegistrationAdminFailure(403, "FORBIDDEN");
    return entryRegistrationAdminJson(entryRegistrationAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return entryRegistrationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryRegistrationAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryRegistrationAdminOrigin(request, configured.policy)) return entryRegistrationAdminFailure(403, "FORBIDDEN");
  const proof = entryRegistrationAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "REGISTER_ENTRY",
      readBodyIsEmpty: () => hasNoEntryRegistrationAdminRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearEntryRegistrationAdminCookies(entryRegistrationAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    }
    if (result.status === "forbidden") return entryRegistrationAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return entryRegistrationAdminFailure(400, "INVALID_REQUEST");
    return clearEntryRegistrationAdminCookies(new Response(null, { status: 204, headers: privateEntryRegistrationAdminHeaders }), configured.policy);
  } catch {
    return entryRegistrationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryRegistrationAdminListRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listEntryRegistrationClassesAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryRegistrationAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    if (result.status === "unauthorized") return entryRegistrationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryRegistrationAdminFailure(403, "FORBIDDEN");
    if (!("response" in result)) return entryRegistrationAdminFailure(500, "INTERNAL_ERROR");
    return entryRegistrationAdminJson(entryRegistrationClassesResponseSchema.parse(result.response));
  } catch {
    return entryRegistrationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function entryRegistrationAdminStartSlotCandidatesRoute(
  db: Database,
  request: Request,
  raceId: string,
  targetClassId: string,
  list: ListSlots = listEntryRegistrationStartSlotsAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = entryRegistrationAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId, targetClassId });
    if (result.status === "unauthorized") return entryRegistrationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryRegistrationAdminFailure(403, "FORBIDDEN");
    if (result.status === "not-found") return entryRegistrationAdminFailure(404, "NOT_FOUND");
    if (result.status !== "ok") return entryRegistrationAdminFailure(409, "CONFLICT");
    const response = entryRegistrationStartSlotCandidatesSchema.parse(result.response);
    if (response.raceId !== raceId || response.targetClassId !== targetClassId) return entryRegistrationAdminFailure(500, "INTERNAL_ERROR");
    return entryRegistrationAdminJson(response);
  } catch {
    return entryRegistrationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function authenticatedEntryRegistrationRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  change: Change = registerEntryAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEntryRegistrationAdminOrigin(request, configured.policy)) return entryRegistrationAdminFailure(403, "FORBIDDEN");
  const proof = entryRegistrationAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "REGISTER_ENTRY",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return entryRegistrationAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return entryRegistrationAdminFailure(403, "FORBIDDEN");
  } catch {
    return entryRegistrationAdminFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!entryRegistrationIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return entryRegistrationAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try {
    body = await readEntryRegistrationAdminJson(request);
  } catch {
    return entryRegistrationAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = entryRegistrationRequestSchema.safeParse(body);
  if (!parsed.success) return entryRegistrationAdminFailure(400, "INVALID_REQUEST");

  try {
    const result = await change(db, {
      ...proof,
      raceId,
      idempotencyKey,
      request: parsed.data
    });
    if (result.status === "unauthorized") return entryRegistrationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return entryRegistrationAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return entryRegistrationAdminFailure(400, "INVALID_REQUEST");
    if (result.status === "conflict") return entryRegistrationAdminFailure(409, "CONFLICT");
    if (!("response" in result)) return entryRegistrationAdminFailure(500, "INTERNAL_ERROR");
    return entryRegistrationAdminJson(entryRegistrationResponseSchema.parse(result.response));
  } catch {
    return entryRegistrationAdminFailure(500, "INTERNAL_ERROR");
  }
}
