import {
  authenticatePairingAdminSession,
  listResultDisqualificationWithdrawalsAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  withdrawResultDisqualificationAsAdmin
} from "@o-tid/application";
import {
  resultDisqualificationWithdrawalAdminLoginRequestSchema,
  resultDisqualificationWithdrawalAdminLoginResponseSchema,
  resultDisqualificationWithdrawalIdempotencyKeySchema,
  resultDisqualificationWithdrawalListResponseSchema,
  resultDisqualificationWithdrawalRequestSchema,
  resultDisqualificationWithdrawalResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  ResultDisqualificationWithdrawalAdminConfigurationError,
  clearResultDisqualificationWithdrawalAdminCookies,
  hasExpectedResultDisqualificationWithdrawalAdminOrigin,
  hasNoResultDisqualificationWithdrawalAdminRequestBody,
  privateResultDisqualificationWithdrawalAdminHeaders,
  readResultDisqualificationWithdrawalAdminJson,
  resultDisqualificationWithdrawalAdminFailure,
  resultDisqualificationWithdrawalAdminJson,
  resultDisqualificationWithdrawalAdminSecurityPolicy,
  resultDisqualificationWithdrawalAdminSessionProof,
  setResultDisqualificationWithdrawalAdminCookies
} from "./result-disqualification-withdrawal-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listResultDisqualificationWithdrawalsAsAdmin;
type Withdraw = typeof withdrawResultDisqualificationAsAdmin;

function policyOrFailure(environment: Environment) {
  try { return { policy: resultDisqualificationWithdrawalAdminSecurityPolicy(environment) } as const; }
  catch (error) {
    if (error instanceof ResultDisqualificationWithdrawalAdminConfigurationError) {
      return { response: resultDisqualificationWithdrawalAdminFailure(500, "INTERNAL_ERROR") } as const;
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
  if (result.status === "invalid-request") return resultDisqualificationWithdrawalAdminFailure(400, "INVALID_REQUEST");
  if (result.status === "unauthorized") return resultDisqualificationWithdrawalAdminFailure(401, "UNAUTHORIZED");
  if (result.status === "forbidden") return resultDisqualificationWithdrawalAdminFailure(403, "FORBIDDEN");
  if (result.status === "not-found") return resultDisqualificationWithdrawalAdminFailure(404, "NOT_FOUND");
  if (result.status === "conflict") return resultDisqualificationWithdrawalAdminFailure(409, "CONFLICT");
  return undefined;
}

export async function resultDisqualificationWithdrawalAdminLoginRoute(
  db: Database, request: Request, raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultDisqualificationWithdrawalAdminOrigin(request, configured.policy)) {
    return resultDisqualificationWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  let body: unknown;
  try { body = await readResultDisqualificationWithdrawalAdminJson(request); }
  catch { return resultDisqualificationWithdrawalAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = resultDisqualificationWithdrawalAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return resultDisqualificationWithdrawalAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, {
      expectedRaceId: raceId, expectedCapability: "WITHDRAW_DISQUALIFICATION"
    });
    if (result.status === "unauthorized") return resultDisqualificationWithdrawalAdminFailure(401, "UNAUTHORIZED");
    const response = resultDisqualificationWithdrawalAdminLoginResponseSchema.parse(result.response);
    return setResultDisqualificationWithdrawalAdminCookies(
      resultDisqualificationWithdrawalAdminJson(response), configured.policy,
      { sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt }
    );
  } catch { return resultDisqualificationWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function resultDisqualificationWithdrawalAdminSessionStatusRoute(
  db: Database, request: Request, raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = resultDisqualificationWithdrawalAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "WITHDRAW_DISQUALIFICATION" });
    if (result.status === "unauthorized") return resultDisqualificationWithdrawalAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return resultDisqualificationWithdrawalAdminFailure(403, "FORBIDDEN");
    return resultDisqualificationWithdrawalAdminJson(resultDisqualificationWithdrawalAdminLoginResponseSchema.parse({
      formatVersion: 1, raceId: result.principal.raceId,
      capability: result.principal.capability, expiresAt: result.principal.expiresAt
    }));
  } catch { return resultDisqualificationWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function resultDisqualificationWithdrawalAdminLogoutRoute(
  db: Database, request: Request, raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultDisqualificationWithdrawalAdminOrigin(request, configured.policy)) {
    return resultDisqualificationWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  const proof = resultDisqualificationWithdrawalAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof, raceId, capability: "WITHDRAW_DISQUALIFICATION",
      readBodyIsEmpty: () => hasNoResultDisqualificationWithdrawalAdminRequestBody(request)
    });
    if (result.status === "unauthorized") return clearResultDisqualificationWithdrawalAdminCookies(
      resultDisqualificationWithdrawalAdminFailure(401, "UNAUTHORIZED"), configured.policy
    );
    if (result.status === "forbidden") return resultDisqualificationWithdrawalAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return resultDisqualificationWithdrawalAdminFailure(400, "INVALID_REQUEST");
    return clearResultDisqualificationWithdrawalAdminCookies(
      new Response(null, { status: 204, headers: privateResultDisqualificationWithdrawalAdminHeaders }),
      configured.policy
    );
  } catch { return resultDisqualificationWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function resultDisqualificationWithdrawalListRoute(
  db: Database, request: Request, raceId: string,
  list: List = listResultDisqualificationWithdrawalsAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = resultDisqualificationWithdrawalAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    const failure = applicationFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return resultDisqualificationWithdrawalAdminFailure(500, "INTERNAL_ERROR");
    return resultDisqualificationWithdrawalAdminJson(
      resultDisqualificationWithdrawalListResponseSchema.parse(result.response)
    );
  } catch { return resultDisqualificationWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function authenticatedResultDisqualificationWithdrawalRoute(
  db: Database, request: Request, raceId: string, entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  withdraw: Withdraw = withdrawResultDisqualificationAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultDisqualificationWithdrawalAdminOrigin(request, configured.policy)) {
    return resultDisqualificationWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  const proof = resultDisqualificationWithdrawalAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof, raceId, capability: "WITHDRAW_DISQUALIFICATION", requireCsrf: true
    });
    if (authorization.status === "unauthorized") return resultDisqualificationWithdrawalAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return resultDisqualificationWithdrawalAdminFailure(403, "FORBIDDEN");
  } catch { return resultDisqualificationWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!resultDisqualificationWithdrawalIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return resultDisqualificationWithdrawalAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try { body = await readResultDisqualificationWithdrawalAdminJson(request); }
  catch { return resultDisqualificationWithdrawalAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = resultDisqualificationWithdrawalRequestSchema.safeParse(body);
  if (!parsed.success) return resultDisqualificationWithdrawalAdminFailure(400, "INVALID_REQUEST");
  try {
    const result = await withdraw(db, { ...proof, raceId, entryId, idempotencyKey, request: parsed.data });
    const failure = applicationFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return resultDisqualificationWithdrawalAdminFailure(500, "INTERNAL_ERROR");
    return resultDisqualificationWithdrawalAdminJson(
      resultDisqualificationWithdrawalResponseSchema.parse(result.response)
    );
  } catch { return resultDisqualificationWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}
