import {
  authenticatePairingAdminSession,
  listWithoutTimingWithdrawalsAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  withdrawWithoutTimingAsAdmin
} from "@o-tid/application";
import {
  withoutTimingWithdrawalAdminLoginRequestSchema,
  withoutTimingWithdrawalAdminLoginResponseSchema,
  withoutTimingWithdrawalIdempotencyKeySchema,
  withoutTimingWithdrawalListResponseSchema,
  withoutTimingWithdrawalRequestSchema,
  withoutTimingWithdrawalResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  WithoutTimingWithdrawalAdminConfigurationError,
  WithoutTimingWithdrawalAdminRequestError,
  clearWithoutTimingWithdrawalAdminCookies,
  hasExpectedWithoutTimingWithdrawalAdminOrigin,
  hasNoWithoutTimingWithdrawalAdminRequestBody,
  withoutTimingWithdrawalAdminFailure,
  withoutTimingWithdrawalAdminJson,
  withoutTimingWithdrawalAdminSecurityPolicy,
  withoutTimingWithdrawalAdminSessionProof,
  privateWithoutTimingWithdrawalAdminHeaders,
  readWithoutTimingWithdrawalAdminJson,
  setWithoutTimingWithdrawalAdminCookies
} from "./without-timing-withdrawal-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listWithoutTimingWithdrawalsAsAdmin;
type Withdraw = typeof withdrawWithoutTimingAsAdmin;

function policyOrFailure(environment: Environment) {
  try { return { policy: withoutTimingWithdrawalAdminSecurityPolicy(environment) } as const; }
  catch (error) {
    if (error instanceof WithoutTimingWithdrawalAdminConfigurationError) {
      return { response: withoutTimingWithdrawalAdminFailure(500, "INTERNAL_ERROR") } as const;
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
  if (result.status === "invalid-request") return withoutTimingWithdrawalAdminFailure(400, "INVALID_REQUEST");
  if (result.status === "unauthorized") return withoutTimingWithdrawalAdminFailure(401, "UNAUTHORIZED");
  if (result.status === "forbidden") return withoutTimingWithdrawalAdminFailure(403, "FORBIDDEN");
  if (result.status === "not-found") return withoutTimingWithdrawalAdminFailure(404, "NOT_FOUND");
  if (result.status === "conflict") return withoutTimingWithdrawalAdminFailure(409, "CONFLICT");
  return undefined;
}

export async function withoutTimingWithdrawalAdminLoginRoute(
  db: Database, request: Request, raceId: string, login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedWithoutTimingWithdrawalAdminOrigin(request, configured.policy)) return withoutTimingWithdrawalAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readWithoutTimingWithdrawalAdminJson(request); }
  catch (error) {
    return withoutTimingWithdrawalAdminFailure(error instanceof WithoutTimingWithdrawalAdminRequestError && /för stor|bodylängd/i.test(error.message) ? 413 : 400, "INVALID_REQUEST");
  }
  const parsed = withoutTimingWithdrawalAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) { const status = invalidLoginStatus(body); return withoutTimingWithdrawalAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST"); }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "WITHDRAW_WITHOUT_TIMING" });
    if (result.status === "unauthorized") return withoutTimingWithdrawalAdminFailure(401, "UNAUTHORIZED");
    const response = withoutTimingWithdrawalAdminLoginResponseSchema.parse(result.response);
    return setWithoutTimingWithdrawalAdminCookies(withoutTimingWithdrawalAdminJson(response), configured.policy, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
  } catch { return withoutTimingWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function withoutTimingWithdrawalAdminSessionStatusRoute(
  db: Database, request: Request, raceId: string, authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  const proof = withoutTimingWithdrawalAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "WITHDRAW_WITHOUT_TIMING" });
    if (result.status === "unauthorized") return withoutTimingWithdrawalAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return withoutTimingWithdrawalAdminFailure(403, "FORBIDDEN");
    return withoutTimingWithdrawalAdminJson(withoutTimingWithdrawalAdminLoginResponseSchema.parse({
      formatVersion: 1, raceId: result.principal.raceId, capability: result.principal.capability, expiresAt: result.principal.expiresAt
    }));
  } catch { return withoutTimingWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function withoutTimingWithdrawalAdminLogoutRoute(
  db: Database, request: Request, raceId: string, logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedWithoutTimingWithdrawalAdminOrigin(request, configured.policy)) return withoutTimingWithdrawalAdminFailure(403, "FORBIDDEN");
  const proof = withoutTimingWithdrawalAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, { ...proof, raceId, capability: "WITHDRAW_WITHOUT_TIMING", readBodyIsEmpty: () => hasNoWithoutTimingWithdrawalAdminRequestBody(request) });
    if (result.status === "unauthorized") return clearWithoutTimingWithdrawalAdminCookies(withoutTimingWithdrawalAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    if (result.status === "forbidden") return withoutTimingWithdrawalAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return withoutTimingWithdrawalAdminFailure(400, "INVALID_REQUEST");
    return clearWithoutTimingWithdrawalAdminCookies(new Response(null, { status: 204, headers: privateWithoutTimingWithdrawalAdminHeaders }), configured.policy);
  } catch { return withoutTimingWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function withoutTimingWithdrawalListRoute(
  db: Database, request: Request, raceId: string, list: List = listWithoutTimingWithdrawalsAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  const proof = withoutTimingWithdrawalAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    const failure = applicationFailure(result); if (failure) return failure;
    if (!("response" in result)) return withoutTimingWithdrawalAdminFailure(500, "INTERNAL_ERROR");
    return withoutTimingWithdrawalAdminJson(withoutTimingWithdrawalListResponseSchema.parse(result.response));
  } catch { return withoutTimingWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function authenticatedWithoutTimingWithdrawalRoute(
  db: Database, request: Request, raceId: string, entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  withdraw: Withdraw = withdrawWithoutTimingAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedWithoutTimingWithdrawalAdminOrigin(request, configured.policy)) return withoutTimingWithdrawalAdminFailure(403, "FORBIDDEN");
  const proof = withoutTimingWithdrawalAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, { ...proof, raceId, capability: "WITHDRAW_WITHOUT_TIMING", requireCsrf: true });
    if (authorization.status === "unauthorized") return withoutTimingWithdrawalAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return withoutTimingWithdrawalAdminFailure(403, "FORBIDDEN");
  } catch { return withoutTimingWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!withoutTimingWithdrawalIdempotencyKeySchema.safeParse(idempotencyKey).success) return withoutTimingWithdrawalAdminFailure(400, "INVALID_REQUEST");
  let body: unknown;
  try { body = await readWithoutTimingWithdrawalAdminJson(request); }
  catch (error) {
    return withoutTimingWithdrawalAdminFailure(error instanceof WithoutTimingWithdrawalAdminRequestError && /för stor|bodylängd/i.test(error.message) ? 413 : 400, "INVALID_REQUEST");
  }
  const parsed = withoutTimingWithdrawalRequestSchema.safeParse(body);
  if (!parsed.success) return withoutTimingWithdrawalAdminFailure(400, "INVALID_REQUEST");
  try {
    const result = await withdraw(db, { ...proof, raceId, entryId, idempotencyKey, request: parsed.data });
    const failure = applicationFailure(result); if (failure) return failure;
    if (!("response" in result)) return withoutTimingWithdrawalAdminFailure(500, "INTERNAL_ERROR");
    return withoutTimingWithdrawalAdminJson(withoutTimingWithdrawalResponseSchema.parse(result.response));
  } catch { return withoutTimingWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}
