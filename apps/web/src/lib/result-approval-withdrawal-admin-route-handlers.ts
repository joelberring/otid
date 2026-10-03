import {
  authenticatePairingAdminSession,
  listResultApprovalWithdrawalsAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  withdrawResultApprovalAsAdmin
} from "@o-tid/application";
import {
  resultApprovalWithdrawalAdminLoginRequestSchema,
  resultApprovalWithdrawalAdminLoginResponseSchema,
  resultApprovalWithdrawalIdempotencyKeySchema,
  resultApprovalWithdrawalListResponseSchema,
  resultApprovalWithdrawalRequestSchema,
  resultApprovalWithdrawalResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  ResultApprovalWithdrawalAdminConfigurationError,
  clearResultApprovalWithdrawalAdminCookies,
  hasExpectedResultApprovalWithdrawalAdminOrigin,
  hasNoResultApprovalWithdrawalAdminRequestBody,
  privateResultApprovalWithdrawalAdminHeaders,
  readResultApprovalWithdrawalAdminJson,
  resultApprovalWithdrawalAdminFailure,
  resultApprovalWithdrawalAdminJson,
  resultApprovalWithdrawalAdminSecurityPolicy,
  resultApprovalWithdrawalAdminSessionProof,
  setResultApprovalWithdrawalAdminCookies
} from "./result-approval-withdrawal-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listResultApprovalWithdrawalsAsAdmin;
type Withdraw = typeof withdrawResultApprovalAsAdmin;

function policyOrFailure(environment: Environment) {
  try { return { policy: resultApprovalWithdrawalAdminSecurityPolicy(environment) } as const; }
  catch (error) {
    if (error instanceof ResultApprovalWithdrawalAdminConfigurationError) {
      return { response: resultApprovalWithdrawalAdminFailure(500, "INTERNAL_ERROR") } as const;
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
  if (result.status === "invalid-request") return resultApprovalWithdrawalAdminFailure(400, "INVALID_REQUEST");
  if (result.status === "unauthorized") return resultApprovalWithdrawalAdminFailure(401, "UNAUTHORIZED");
  if (result.status === "forbidden") return resultApprovalWithdrawalAdminFailure(403, "FORBIDDEN");
  if (result.status === "not-found") return resultApprovalWithdrawalAdminFailure(404, "NOT_FOUND");
  if (result.status === "conflict") return resultApprovalWithdrawalAdminFailure(409, "CONFLICT");
  return undefined;
}

export async function resultApprovalWithdrawalAdminLoginRoute(
  db: Database, request: Request, raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultApprovalWithdrawalAdminOrigin(request, configured.policy)) {
    return resultApprovalWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  let body: unknown;
  try { body = await readResultApprovalWithdrawalAdminJson(request); }
  catch { return resultApprovalWithdrawalAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = resultApprovalWithdrawalAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return resultApprovalWithdrawalAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, {
      expectedRaceId: raceId, expectedCapability: "WITHDRAW_RESULT_APPROVAL"
    });
    if (result.status === "unauthorized") return resultApprovalWithdrawalAdminFailure(401, "UNAUTHORIZED");
    const response = resultApprovalWithdrawalAdminLoginResponseSchema.parse(result.response);
    return setResultApprovalWithdrawalAdminCookies(
      resultApprovalWithdrawalAdminJson(response), configured.policy,
      { sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt }
    );
  } catch { return resultApprovalWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function resultApprovalWithdrawalAdminSessionStatusRoute(
  db: Database, request: Request, raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = resultApprovalWithdrawalAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "WITHDRAW_RESULT_APPROVAL" });
    if (result.status === "unauthorized") return resultApprovalWithdrawalAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return resultApprovalWithdrawalAdminFailure(403, "FORBIDDEN");
    return resultApprovalWithdrawalAdminJson(resultApprovalWithdrawalAdminLoginResponseSchema.parse({
      formatVersion: 1, raceId: result.principal.raceId,
      capability: result.principal.capability, expiresAt: result.principal.expiresAt
    }));
  } catch { return resultApprovalWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function resultApprovalWithdrawalAdminLogoutRoute(
  db: Database, request: Request, raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultApprovalWithdrawalAdminOrigin(request, configured.policy)) {
    return resultApprovalWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  const proof = resultApprovalWithdrawalAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof, raceId, capability: "WITHDRAW_RESULT_APPROVAL",
      readBodyIsEmpty: () => hasNoResultApprovalWithdrawalAdminRequestBody(request)
    });
    if (result.status === "unauthorized") return clearResultApprovalWithdrawalAdminCookies(
      resultApprovalWithdrawalAdminFailure(401, "UNAUTHORIZED"), configured.policy
    );
    if (result.status === "forbidden") return resultApprovalWithdrawalAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return resultApprovalWithdrawalAdminFailure(400, "INVALID_REQUEST");
    return clearResultApprovalWithdrawalAdminCookies(
      new Response(null, { status: 204, headers: privateResultApprovalWithdrawalAdminHeaders }),
      configured.policy
    );
  } catch { return resultApprovalWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function resultApprovalWithdrawalListRoute(
  db: Database, request: Request, raceId: string,
  list: List = listResultApprovalWithdrawalsAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = resultApprovalWithdrawalAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    const failure = applicationFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return resultApprovalWithdrawalAdminFailure(500, "INTERNAL_ERROR");
    return resultApprovalWithdrawalAdminJson(
      resultApprovalWithdrawalListResponseSchema.parse(result.response)
    );
  } catch { return resultApprovalWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function authenticatedResultApprovalWithdrawalRoute(
  db: Database, request: Request, raceId: string, entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  withdraw: Withdraw = withdrawResultApprovalAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedResultApprovalWithdrawalAdminOrigin(request, configured.policy)) {
    return resultApprovalWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  const proof = resultApprovalWithdrawalAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof, raceId, capability: "WITHDRAW_RESULT_APPROVAL", requireCsrf: true
    });
    if (authorization.status === "unauthorized") return resultApprovalWithdrawalAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return resultApprovalWithdrawalAdminFailure(403, "FORBIDDEN");
  } catch { return resultApprovalWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!resultApprovalWithdrawalIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return resultApprovalWithdrawalAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try { body = await readResultApprovalWithdrawalAdminJson(request); }
  catch { return resultApprovalWithdrawalAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = resultApprovalWithdrawalRequestSchema.safeParse(body);
  if (!parsed.success) return resultApprovalWithdrawalAdminFailure(400, "INVALID_REQUEST");
  try {
    const result = await withdraw(db, { ...proof, raceId, entryId, idempotencyKey, request: parsed.data });
    const failure = applicationFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return resultApprovalWithdrawalAdminFailure(500, "INTERNAL_ERROR");
    return resultApprovalWithdrawalAdminJson(
      resultApprovalWithdrawalResponseSchema.parse(result.response)
    );
  } catch { return resultApprovalWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}
