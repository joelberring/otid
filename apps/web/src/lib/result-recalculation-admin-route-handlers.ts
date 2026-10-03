import {
  authenticatePairingAdminSession,
  listResultRecalculationCandidatesAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  recalculateEntryAsAdmin
} from "@o-tid/application";
import {
  resultRecalculationAdminLoginRequestSchema,
  resultRecalculationAdminLoginResponseSchema,
  resultRecalculationCandidateResponseSchema,
  resultRecalculationIdempotencyKeySchema,
  resultRecalculationRequestSchema,
  resultRecalculationResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  ResultRecalculationAdminConfigurationError,
  clearResultRecalculationAdminCookies,
  hasExpectedResultRecalculationAdminOrigin,
  hasNoResultRecalculationAdminRequestBody,
  privateResultRecalculationAdminHeaders,
  readResultRecalculationAdminJson,
  resultRecalculationAdminFailure,
  resultRecalculationAdminJson,
  resultRecalculationAdminSecurityPolicy,
  resultRecalculationAdminSessionProof,
  setResultRecalculationAdminCookies
} from "./result-recalculation-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listResultRecalculationCandidatesAsAdmin;
type Recalculate = typeof recalculateEntryAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: resultRecalculationAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof ResultRecalculationAdminConfigurationError) {
      return { response: resultRecalculationAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function resultRecalculationAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultRecalculationAdminOrigin(request, configured.policy)) {
    return resultRecalculationAdminFailure(403, "FORBIDDEN");
  }
  let body: unknown;
  try {
    body = await readResultRecalculationAdminJson(request);
  } catch {
    return resultRecalculationAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = resultRecalculationAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return resultRecalculationAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, {
      expectedRaceId: raceId,
      expectedCapability: "RECALCULATE_RESULT"
    });
    if (result.status === "unauthorized") return resultRecalculationAdminFailure(401, "UNAUTHORIZED");
    const responseBody = resultRecalculationAdminLoginResponseSchema.parse(result.response);
    return setResultRecalculationAdminCookies(
      resultRecalculationAdminJson(responseBody),
      configured.policy,
      { sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: responseBody.expiresAt }
    );
  } catch {
    return resultRecalculationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function resultRecalculationAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = resultRecalculationAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "RECALCULATE_RESULT" });
    if (result.status === "unauthorized") return resultRecalculationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return resultRecalculationAdminFailure(403, "FORBIDDEN");
    return resultRecalculationAdminJson(resultRecalculationAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return resultRecalculationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function resultRecalculationAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultRecalculationAdminOrigin(request, configured.policy)) {
    return resultRecalculationAdminFailure(403, "FORBIDDEN");
  }
  const proof = resultRecalculationAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "RECALCULATE_RESULT",
      readBodyIsEmpty: () => hasNoResultRecalculationAdminRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearResultRecalculationAdminCookies(
        resultRecalculationAdminFailure(401, "UNAUTHORIZED"),
        configured.policy
      );
    }
    if (result.status === "forbidden") return resultRecalculationAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return resultRecalculationAdminFailure(400, "INVALID_REQUEST");
    return clearResultRecalculationAdminCookies(
      new Response(null, { status: 204, headers: privateResultRecalculationAdminHeaders }),
      configured.policy
    );
  } catch {
    return resultRecalculationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function resultRecalculationCandidateRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listResultRecalculationCandidatesAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = resultRecalculationAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    if (result.status === "unauthorized") return resultRecalculationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return resultRecalculationAdminFailure(403, "FORBIDDEN");
    if (!("response" in result)) return resultRecalculationAdminFailure(500, "INTERNAL_ERROR");
    return resultRecalculationAdminJson(resultRecalculationCandidateResponseSchema.parse(result.response));
  } catch {
    return resultRecalculationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function authenticatedResultRecalculationRoute(
  db: Database,
  request: Request,
  raceId: string,
  entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  recalculate: Recalculate = recalculateEntryAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultRecalculationAdminOrigin(request, configured.policy)) {
    return resultRecalculationAdminFailure(403, "FORBIDDEN");
  }
  const proof = resultRecalculationAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "RECALCULATE_RESULT",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return resultRecalculationAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return resultRecalculationAdminFailure(403, "FORBIDDEN");
  } catch {
    return resultRecalculationAdminFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!resultRecalculationIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return resultRecalculationAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try {
    body = await readResultRecalculationAdminJson(request);
  } catch {
    return resultRecalculationAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = resultRecalculationRequestSchema.safeParse(body);
  if (!parsed.success) return resultRecalculationAdminFailure(400, "INVALID_REQUEST");

  try {
    const result = await recalculate(db, {
      ...proof,
      raceId,
      entryId,
      idempotencyKey,
      request: parsed.data
    });
    if (result.status === "unauthorized") return resultRecalculationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return resultRecalculationAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return resultRecalculationAdminFailure(400, "INVALID_REQUEST");
    if (result.status === "not-found") return resultRecalculationAdminFailure(404, "NOT_FOUND");
    if (result.status === "conflict") return resultRecalculationAdminFailure(409, "CONFLICT");
    if (!("response" in result)) return resultRecalculationAdminFailure(500, "INTERNAL_ERROR");
    return resultRecalculationAdminJson(resultRecalculationResponseSchema.parse(result.response));
  } catch {
    return resultRecalculationAdminFailure(500, "INTERNAL_ERROR");
  }
}
