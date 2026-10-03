import {
  authenticatePairingAdminSession,
  listDidNotStartWithdrawalsAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  withdrawDidNotStartAsAdmin
} from "@o-tid/application";
import {
  didNotStartWithdrawalAdminLoginRequestSchema,
  didNotStartWithdrawalAdminLoginResponseSchema,
  didNotStartWithdrawalIdempotencyKeySchema,
  didNotStartWithdrawalListResponseSchema,
  didNotStartWithdrawalRequestSchema,
  didNotStartWithdrawalResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  DidNotStartWithdrawalAdminConfigurationError,
  clearDidNotStartWithdrawalAdminCookies,
  didNotStartWithdrawalAdminFailure,
  didNotStartWithdrawalAdminJson,
  didNotStartWithdrawalAdminSecurityPolicy,
  didNotStartWithdrawalAdminSessionProof,
  hasExpectedDidNotStartWithdrawalAdminOrigin,
  hasNoDidNotStartWithdrawalAdminRequestBody,
  privateDidNotStartWithdrawalAdminHeaders,
  readDidNotStartWithdrawalAdminJson,
  setDidNotStartWithdrawalAdminCookies
} from "./did-not-start-withdrawal-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listDidNotStartWithdrawalsAsAdmin;
type Withdraw = typeof withdrawDidNotStartAsAdmin;

function policyOrFailure(environment: Environment) {
  try { return { policy: didNotStartWithdrawalAdminSecurityPolicy(environment) } as const; }
  catch (error) {
    if (error instanceof DidNotStartWithdrawalAdminConfigurationError) {
      return { response: didNotStartWithdrawalAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function didNotStartWithdrawalAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedDidNotStartWithdrawalAdminOrigin(request, configured.policy)) {
    return didNotStartWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  let body: unknown;
  try { body = await readDidNotStartWithdrawalAdminJson(request); }
  catch { return didNotStartWithdrawalAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = didNotStartWithdrawalAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return didNotStartWithdrawalAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, {
      expectedRaceId: raceId,
      expectedCapability: "WITHDRAW_DID_NOT_START"
    });
    if (result.status === "unauthorized") return didNotStartWithdrawalAdminFailure(401, "UNAUTHORIZED");
    const response = didNotStartWithdrawalAdminLoginResponseSchema.parse(result.response);
    return setDidNotStartWithdrawalAdminCookies(
      didNotStartWithdrawalAdminJson(response),
      configured.policy,
      { sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt }
    );
  } catch { return didNotStartWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function didNotStartWithdrawalAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = didNotStartWithdrawalAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "WITHDRAW_DID_NOT_START" });
    if (result.status === "unauthorized") return didNotStartWithdrawalAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return didNotStartWithdrawalAdminFailure(403, "FORBIDDEN");
    return didNotStartWithdrawalAdminJson(didNotStartWithdrawalAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch { return didNotStartWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function didNotStartWithdrawalAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedDidNotStartWithdrawalAdminOrigin(request, configured.policy)) {
    return didNotStartWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  const proof = didNotStartWithdrawalAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "WITHDRAW_DID_NOT_START",
      readBodyIsEmpty: () => hasNoDidNotStartWithdrawalAdminRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearDidNotStartWithdrawalAdminCookies(
        didNotStartWithdrawalAdminFailure(401, "UNAUTHORIZED"),
        configured.policy
      );
    }
    if (result.status === "forbidden") return didNotStartWithdrawalAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return didNotStartWithdrawalAdminFailure(400, "INVALID_REQUEST");
    return clearDidNotStartWithdrawalAdminCookies(
      new Response(null, { status: 204, headers: privateDidNotStartWithdrawalAdminHeaders }),
      configured.policy
    );
  } catch { return didNotStartWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

function withdrawalFailure(result: { status: string }): Response | undefined {
  if (result.status === "invalid-request") return didNotStartWithdrawalAdminFailure(400, "INVALID_REQUEST");
  if (result.status === "unauthorized") return didNotStartWithdrawalAdminFailure(401, "UNAUTHORIZED");
  if (result.status === "forbidden") return didNotStartWithdrawalAdminFailure(403, "FORBIDDEN");
  if (result.status === "not-found") return didNotStartWithdrawalAdminFailure(404, "NOT_FOUND");
  if (result.status === "conflict") return didNotStartWithdrawalAdminFailure(409, "CONFLICT");
  return undefined;
}

export async function didNotStartWithdrawalListRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listDidNotStartWithdrawalsAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = didNotStartWithdrawalAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    const failure = withdrawalFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return didNotStartWithdrawalAdminFailure(500, "INTERNAL_ERROR");
    return didNotStartWithdrawalAdminJson(didNotStartWithdrawalListResponseSchema.parse(result.response));
  } catch { return didNotStartWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function authenticatedDidNotStartWithdrawalRoute(
  db: Database,
  request: Request,
  raceId: string,
  entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  withdraw: Withdraw = withdrawDidNotStartAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedDidNotStartWithdrawalAdminOrigin(request, configured.policy)) {
    return didNotStartWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  const proof = didNotStartWithdrawalAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "WITHDRAW_DID_NOT_START",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return didNotStartWithdrawalAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return didNotStartWithdrawalAdminFailure(403, "FORBIDDEN");
  } catch { return didNotStartWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!didNotStartWithdrawalIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return didNotStartWithdrawalAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try { body = await readDidNotStartWithdrawalAdminJson(request); }
  catch { return didNotStartWithdrawalAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = didNotStartWithdrawalRequestSchema.safeParse(body);
  if (!parsed.success) return didNotStartWithdrawalAdminFailure(400, "INVALID_REQUEST");

  try {
    const result = await withdraw(db, { ...proof, raceId, entryId, idempotencyKey, request: parsed.data });
    const failure = withdrawalFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return didNotStartWithdrawalAdminFailure(500, "INTERNAL_ERROR");
    return didNotStartWithdrawalAdminJson(didNotStartWithdrawalResponseSchema.parse(result.response));
  } catch { return didNotStartWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}
