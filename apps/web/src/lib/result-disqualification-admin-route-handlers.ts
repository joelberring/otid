import {
  authenticatePairingAdminSession,
  disqualifyResultAsAdmin,
  listResultDisqualificationCandidatesAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  resultDisqualificationAdminLoginRequestSchema,
  resultDisqualificationAdminLoginResponseSchema,
  resultDisqualificationCandidateResponseSchema,
  resultDisqualificationIdempotencyKeySchema,
  resultDisqualificationRequestSchema,
  resultDisqualificationResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  ResultDisqualificationAdminConfigurationError,
  clearResultDisqualificationAdminCookies,
  hasExpectedResultDisqualificationAdminOrigin,
  hasNoResultDisqualificationAdminRequestBody,
  privateResultDisqualificationAdminHeaders,
  readResultDisqualificationAdminJson,
  resultDisqualificationAdminFailure,
  resultDisqualificationAdminJson,
  resultDisqualificationAdminSecurityPolicy,
  resultDisqualificationAdminSessionProof,
  setResultDisqualificationAdminCookies
} from "./result-disqualification-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listResultDisqualificationCandidatesAsAdmin;
type Disqualify = typeof disqualifyResultAsAdmin;

function policyOrFailure(environment: Environment) {
  try { return { policy: resultDisqualificationAdminSecurityPolicy(environment) } as const; }
  catch (error) {
    if (error instanceof ResultDisqualificationAdminConfigurationError) {
      return { response: resultDisqualificationAdminFailure(500, "INTERNAL_ERROR") } as const;
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

function applicationFailure(result: { status: string }): Response | undefined {
  if (result.status === "invalid-request") return resultDisqualificationAdminFailure(400, "INVALID_REQUEST");
  if (result.status === "unauthorized") return resultDisqualificationAdminFailure(401, "UNAUTHORIZED");
  if (result.status === "forbidden") return resultDisqualificationAdminFailure(403, "FORBIDDEN");
  if (result.status === "not-found") return resultDisqualificationAdminFailure(404, "NOT_FOUND");
  if (result.status === "conflict") return resultDisqualificationAdminFailure(409, "CONFLICT");
  return undefined;
}

export async function resultDisqualificationAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultDisqualificationAdminOrigin(request, configured.policy)) {
    return resultDisqualificationAdminFailure(403, "FORBIDDEN");
  }
  let body: unknown;
  try { body = await readResultDisqualificationAdminJson(request); }
  catch { return resultDisqualificationAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = resultDisqualificationAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return resultDisqualificationAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "DISQUALIFY_RESULT" });
    if (result.status === "unauthorized") return resultDisqualificationAdminFailure(401, "UNAUTHORIZED");
    const response = resultDisqualificationAdminLoginResponseSchema.parse(result.response);
    return setResultDisqualificationAdminCookies(resultDisqualificationAdminJson(response), configured.policy, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
  } catch { return resultDisqualificationAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function resultDisqualificationAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = resultDisqualificationAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "DISQUALIFY_RESULT" });
    if (result.status === "unauthorized") return resultDisqualificationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return resultDisqualificationAdminFailure(403, "FORBIDDEN");
    return resultDisqualificationAdminJson(resultDisqualificationAdminLoginResponseSchema.parse({
      formatVersion: 1, raceId: result.principal.raceId,
      capability: result.principal.capability, expiresAt: result.principal.expiresAt
    }));
  } catch { return resultDisqualificationAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function resultDisqualificationAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultDisqualificationAdminOrigin(request, configured.policy)) {
    return resultDisqualificationAdminFailure(403, "FORBIDDEN");
  }
  const proof = resultDisqualificationAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof, raceId, capability: "DISQUALIFY_RESULT",
      readBodyIsEmpty: () => hasNoResultDisqualificationAdminRequestBody(request)
    });
    if (result.status === "unauthorized") return clearResultDisqualificationAdminCookies(
      resultDisqualificationAdminFailure(401, "UNAUTHORIZED"), configured.policy
    );
    if (result.status === "forbidden") return resultDisqualificationAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return resultDisqualificationAdminFailure(400, "INVALID_REQUEST");
    return clearResultDisqualificationAdminCookies(
      new Response(null, { status: 204, headers: privateResultDisqualificationAdminHeaders }), configured.policy
    );
  } catch { return resultDisqualificationAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function resultDisqualificationCandidateListRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listResultDisqualificationCandidatesAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = resultDisqualificationAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    const failure = applicationFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return resultDisqualificationAdminFailure(500, "INTERNAL_ERROR");
    return resultDisqualificationAdminJson(resultDisqualificationCandidateResponseSchema.parse(result.response));
  } catch { return resultDisqualificationAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function authenticatedResultDisqualificationRoute(
  db: Database,
  request: Request,
  raceId: string,
  entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  disqualify: Disqualify = disqualifyResultAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultDisqualificationAdminOrigin(request, configured.policy)) {
    return resultDisqualificationAdminFailure(403, "FORBIDDEN");
  }
  const proof = resultDisqualificationAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof, raceId, capability: "DISQUALIFY_RESULT", requireCsrf: true
    });
    if (authorization.status === "unauthorized") return resultDisqualificationAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return resultDisqualificationAdminFailure(403, "FORBIDDEN");
  } catch { return resultDisqualificationAdminFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!resultDisqualificationIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return resultDisqualificationAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try { body = await readResultDisqualificationAdminJson(request); }
  catch { return resultDisqualificationAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = resultDisqualificationRequestSchema.safeParse(body);
  if (!parsed.success) return resultDisqualificationAdminFailure(400, "INVALID_REQUEST");
  try {
    const result = await disqualify(db, { ...proof, raceId, entryId, idempotencyKey, request: parsed.data });
    const failure = applicationFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return resultDisqualificationAdminFailure(500, "INTERNAL_ERROR");
    return resultDisqualificationAdminJson(resultDisqualificationResponseSchema.parse(result.response));
  } catch { return resultDisqualificationAdminFailure(500, "INTERNAL_ERROR"); }
}
