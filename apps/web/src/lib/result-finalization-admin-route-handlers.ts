import {
  authenticatePairingAdminSession,
  finalizeResultsAsAdmin,
  listResultFinalizationCandidatesAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  resultFinalizationAdminLoginRequestSchema,
  resultFinalizationAdminLoginResponseSchema,
  resultFinalizationCandidateResponseSchema,
  resultFinalizationIdempotencyKeySchema,
  resultFinalizationRequestSchema,
  resultFinalizationResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  ResultFinalizationAdminConfigurationError,
  clearResultFinalizationAdminCookies,
  hasExpectedResultFinalizationAdminOrigin,
  hasNoResultFinalizationAdminRequestBody,
  privateResultFinalizationAdminHeaders,
  readResultFinalizationAdminJson,
  resultFinalizationAdminFailure,
  resultFinalizationAdminJson,
  resultFinalizationAdminSecurityPolicy,
  resultFinalizationAdminSessionProof,
  setResultFinalizationAdminCookies
} from "./result-finalization-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listResultFinalizationCandidatesAsAdmin;
type Finalize = typeof finalizeResultsAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: resultFinalizationAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof ResultFinalizationAdminConfigurationError) {
      return { response: resultFinalizationAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function resultFinalizationAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultFinalizationAdminOrigin(request, configured.policy)) {
    return resultFinalizationAdminFailure(403, "FORBIDDEN");
  }
  let body: unknown;
  try { body = await readResultFinalizationAdminJson(request); } catch {
    return resultFinalizationAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = resultFinalizationAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return resultFinalizationAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, {
      expectedRaceId: raceId,
      expectedCapability: "FINALIZE_RESULTS"
    });
    if (result.status === "unauthorized") return resultFinalizationAdminFailure(401, "UNAUTHORIZED");
    const response = resultFinalizationAdminLoginResponseSchema.parse(result.response);
    return setResultFinalizationAdminCookies(resultFinalizationAdminJson(response), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: response.expiresAt
    });
  } catch {
    return resultFinalizationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function resultFinalizationAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = resultFinalizationAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "FINALIZE_RESULTS" });
    if (result.status === "unauthorized") return resultFinalizationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return resultFinalizationAdminFailure(403, "FORBIDDEN");
    return resultFinalizationAdminJson(resultFinalizationAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return resultFinalizationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function resultFinalizationAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultFinalizationAdminOrigin(request, configured.policy)) {
    return resultFinalizationAdminFailure(403, "FORBIDDEN");
  }
  const proof = resultFinalizationAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "FINALIZE_RESULTS",
      readBodyIsEmpty: () => hasNoResultFinalizationAdminRequestBody(request)
    });
    if (result.status === "unauthorized") return clearResultFinalizationAdminCookies(
      resultFinalizationAdminFailure(401, "UNAUTHORIZED"), configured.policy
    );
    if (result.status === "forbidden") return resultFinalizationAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return resultFinalizationAdminFailure(400, "INVALID_REQUEST");
    return clearResultFinalizationAdminCookies(
      new Response(null, { status: 204, headers: privateResultFinalizationAdminHeaders }),
      configured.policy
    );
  } catch {
    return resultFinalizationAdminFailure(500, "INTERNAL_ERROR");
  }
}

function resultFailure(result: { status: string }): Response | undefined {
  if (result.status === "invalid-request") return resultFinalizationAdminFailure(400, "INVALID_REQUEST");
  if (result.status === "unauthorized") return resultFinalizationAdminFailure(401, "UNAUTHORIZED");
  if (result.status === "forbidden") return resultFinalizationAdminFailure(403, "FORBIDDEN");
  if (result.status === "not-found") return resultFinalizationAdminFailure(404, "NOT_FOUND");
  if (result.status === "conflict") return resultFinalizationAdminFailure(409, "CONFLICT");
  if (result.status === "too-large") return resultFinalizationAdminFailure(413, "TOO_LARGE");
  return undefined;
}

export async function resultFinalizationCandidateRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listResultFinalizationCandidatesAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = resultFinalizationAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    const failure = resultFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return resultFinalizationAdminFailure(500, "INTERNAL_ERROR");
    return resultFinalizationAdminJson(resultFinalizationCandidateResponseSchema.parse(result.response));
  } catch {
    return resultFinalizationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function authenticatedResultFinalizationRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  finalize: Finalize = finalizeResultsAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultFinalizationAdminOrigin(request, configured.policy)) {
    return resultFinalizationAdminFailure(403, "FORBIDDEN");
  }
  const proof = resultFinalizationAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "FINALIZE_RESULTS",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return resultFinalizationAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return resultFinalizationAdminFailure(403, "FORBIDDEN");
  } catch {
    return resultFinalizationAdminFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!resultFinalizationIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return resultFinalizationAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try { body = await readResultFinalizationAdminJson(request); } catch {
    return resultFinalizationAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = resultFinalizationRequestSchema.safeParse(body);
  if (!parsed.success) return resultFinalizationAdminFailure(400, "INVALID_REQUEST");

  try {
    const result = await finalize(db, {
      ...proof,
      raceId,
      idempotencyKey,
      request: parsed.data
    });
    const failure = resultFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return resultFinalizationAdminFailure(500, "INTERNAL_ERROR");
    return resultFinalizationAdminJson(resultFinalizationResponseSchema.parse(result.response));
  } catch {
    return resultFinalizationAdminFailure(500, "INTERNAL_ERROR");
  }
}
