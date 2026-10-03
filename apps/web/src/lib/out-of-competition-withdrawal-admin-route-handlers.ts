import {
  authenticatePairingAdminSession,
  listOutOfCompetitionWithdrawalsAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  withdrawOutOfCompetitionAsAdmin
} from "@o-tid/application";
import {
  outOfCompetitionWithdrawalAdminLoginRequestSchema,
  outOfCompetitionWithdrawalAdminLoginResponseSchema,
  outOfCompetitionWithdrawalIdempotencyKeySchema,
  outOfCompetitionWithdrawalListResponseSchema,
  outOfCompetitionWithdrawalRequestSchema,
  outOfCompetitionWithdrawalResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  OutOfCompetitionWithdrawalAdminConfigurationError,
  OutOfCompetitionWithdrawalAdminRequestError,
  clearOutOfCompetitionWithdrawalAdminCookies,
  hasExpectedOutOfCompetitionWithdrawalAdminOrigin,
  hasNoOutOfCompetitionWithdrawalAdminRequestBody,
  outOfCompetitionWithdrawalAdminFailure,
  outOfCompetitionWithdrawalAdminJson,
  outOfCompetitionWithdrawalAdminSecurityPolicy,
  outOfCompetitionWithdrawalAdminSessionProof,
  privateOutOfCompetitionWithdrawalAdminHeaders,
  readOutOfCompetitionWithdrawalAdminJson,
  setOutOfCompetitionWithdrawalAdminCookies
} from "./out-of-competition-withdrawal-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listOutOfCompetitionWithdrawalsAsAdmin;
type Withdraw = typeof withdrawOutOfCompetitionAsAdmin;

function policyOrFailure(environment: Environment) {
  try { return { policy: outOfCompetitionWithdrawalAdminSecurityPolicy(environment) } as const; }
  catch (error) {
    if (error instanceof OutOfCompetitionWithdrawalAdminConfigurationError) {
      return { response: outOfCompetitionWithdrawalAdminFailure(500, "INTERNAL_ERROR") } as const;
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
  if (result.status === "invalid-request") return outOfCompetitionWithdrawalAdminFailure(400, "INVALID_REQUEST");
  if (result.status === "unauthorized") return outOfCompetitionWithdrawalAdminFailure(401, "UNAUTHORIZED");
  if (result.status === "forbidden") return outOfCompetitionWithdrawalAdminFailure(403, "FORBIDDEN");
  if (result.status === "not-found") return outOfCompetitionWithdrawalAdminFailure(404, "NOT_FOUND");
  if (result.status === "conflict") return outOfCompetitionWithdrawalAdminFailure(409, "CONFLICT");
  return undefined;
}

export async function outOfCompetitionWithdrawalAdminLoginRoute(
  db: Database, request: Request, raceId: string,
  login: Login = loginPairingAdmin, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedOutOfCompetitionWithdrawalAdminOrigin(request, configured.policy)) {
    return outOfCompetitionWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  let body: unknown;
  try { body = await readOutOfCompetitionWithdrawalAdminJson(request); }
  catch (error) { return outOfCompetitionWithdrawalAdminFailure(error instanceof OutOfCompetitionWithdrawalAdminRequestError && /för stor|bodylängd/i.test(error.message) ? 413 : 400, "INVALID_REQUEST"); }
  const parsed = outOfCompetitionWithdrawalAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return outOfCompetitionWithdrawalAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, {
      expectedRaceId: raceId, expectedCapability: "WITHDRAW_OUT_OF_COMPETITION"
    });
    if (result.status === "unauthorized") return outOfCompetitionWithdrawalAdminFailure(401, "UNAUTHORIZED");
    const response = outOfCompetitionWithdrawalAdminLoginResponseSchema.parse(result.response);
    return setOutOfCompetitionWithdrawalAdminCookies(
      outOfCompetitionWithdrawalAdminJson(response), configured.policy,
      { sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt }
    );
  } catch { return outOfCompetitionWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function outOfCompetitionWithdrawalAdminSessionStatusRoute(
  db: Database, request: Request, raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  const proof = outOfCompetitionWithdrawalAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "WITHDRAW_OUT_OF_COMPETITION" });
    if (result.status === "unauthorized") return outOfCompetitionWithdrawalAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return outOfCompetitionWithdrawalAdminFailure(403, "FORBIDDEN");
    return outOfCompetitionWithdrawalAdminJson(outOfCompetitionWithdrawalAdminLoginResponseSchema.parse({
      formatVersion: 1, raceId: result.principal.raceId,
      capability: result.principal.capability, expiresAt: result.principal.expiresAt
    }));
  } catch { return outOfCompetitionWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function outOfCompetitionWithdrawalAdminLogoutRoute(
  db: Database, request: Request, raceId: string,
  logout: Logout = logoutPairingAdminSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedOutOfCompetitionWithdrawalAdminOrigin(request, configured.policy)) {
    return outOfCompetitionWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  const proof = outOfCompetitionWithdrawalAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof, raceId, capability: "WITHDRAW_OUT_OF_COMPETITION",
      readBodyIsEmpty: () => hasNoOutOfCompetitionWithdrawalAdminRequestBody(request)
    });
    if (result.status === "unauthorized") return clearOutOfCompetitionWithdrawalAdminCookies(
      outOfCompetitionWithdrawalAdminFailure(401, "UNAUTHORIZED"), configured.policy
    );
    if (result.status === "forbidden") return outOfCompetitionWithdrawalAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return outOfCompetitionWithdrawalAdminFailure(400, "INVALID_REQUEST");
    return clearOutOfCompetitionWithdrawalAdminCookies(
      new Response(null, { status: 204, headers: privateOutOfCompetitionWithdrawalAdminHeaders }), configured.policy
    );
  } catch { return outOfCompetitionWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function outOfCompetitionWithdrawalListRoute(
  db: Database, request: Request, raceId: string,
  list: List = listOutOfCompetitionWithdrawalsAsAdmin, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  const proof = outOfCompetitionWithdrawalAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    const failure = applicationFailure(result); if (failure) return failure;
    if (!("response" in result)) return outOfCompetitionWithdrawalAdminFailure(500, "INTERNAL_ERROR");
    return outOfCompetitionWithdrawalAdminJson(outOfCompetitionWithdrawalListResponseSchema.parse(result.response));
  } catch { return outOfCompetitionWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function authenticatedOutOfCompetitionWithdrawalRoute(
  db: Database, request: Request, raceId: string, entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  withdraw: Withdraw = withdrawOutOfCompetitionAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedOutOfCompetitionWithdrawalAdminOrigin(request, configured.policy)) {
    return outOfCompetitionWithdrawalAdminFailure(403, "FORBIDDEN");
  }
  const proof = outOfCompetitionWithdrawalAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof, raceId, capability: "WITHDRAW_OUT_OF_COMPETITION", requireCsrf: true
    });
    if (authorization.status === "unauthorized") return outOfCompetitionWithdrawalAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return outOfCompetitionWithdrawalAdminFailure(403, "FORBIDDEN");
  } catch { return outOfCompetitionWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!outOfCompetitionWithdrawalIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return outOfCompetitionWithdrawalAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try { body = await readOutOfCompetitionWithdrawalAdminJson(request); }
  catch (error) { return outOfCompetitionWithdrawalAdminFailure(error instanceof OutOfCompetitionWithdrawalAdminRequestError && /för stor|bodylängd/i.test(error.message) ? 413 : 400, "INVALID_REQUEST"); }
  const parsed = outOfCompetitionWithdrawalRequestSchema.safeParse(body);
  if (!parsed.success) return outOfCompetitionWithdrawalAdminFailure(400, "INVALID_REQUEST");
  try {
    const result = await withdraw(db, {
      ...proof, raceId, entryId, idempotencyKey, request: parsed.data
    });
    const failure = applicationFailure(result); if (failure) return failure;
    if (!("response" in result)) return outOfCompetitionWithdrawalAdminFailure(500, "INTERNAL_ERROR");
    return outOfCompetitionWithdrawalAdminJson(outOfCompetitionWithdrawalResponseSchema.parse(result.response));
  } catch { return outOfCompetitionWithdrawalAdminFailure(500, "INTERNAL_ERROR"); }
}
