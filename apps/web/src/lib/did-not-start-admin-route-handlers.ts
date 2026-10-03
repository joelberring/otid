import {
  authenticatePairingAdminSession,
  decideDidNotStartAsAdmin,
  listDidNotStartCandidatesAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  didNotStartAdminLoginRequestSchema,
  didNotStartAdminLoginResponseSchema,
  didNotStartCandidateResponseSchema,
  didNotStartIdempotencyKeySchema,
  didNotStartRequestSchema,
  didNotStartResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  DidNotStartAdminConfigurationError,
  clearDidNotStartAdminCookies,
  didNotStartAdminFailure,
  didNotStartAdminJson,
  didNotStartAdminSecurityPolicy,
  didNotStartAdminSessionProof,
  hasExpectedDidNotStartAdminOrigin,
  hasNoDidNotStartAdminRequestBody,
  readDidNotStartAdminJson,
  setDidNotStartAdminCookies
} from "./did-not-start-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listDidNotStartCandidatesAsAdmin;
type Decide = typeof decideDidNotStartAsAdmin;

function policyOrFailure(environment: Environment) {
  try { return { policy: didNotStartAdminSecurityPolicy(environment) } as const; }
  catch (error) {
    if (error instanceof DidNotStartAdminConfigurationError) return { response: didNotStartAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function didNotStartAdminLoginRoute(db: Database, request: Request, raceId: string,
  login: Login = loginPairingAdmin, environment: Environment = process.env): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedDidNotStartAdminOrigin(request, configured.policy)) return didNotStartAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readDidNotStartAdminJson(request); } catch { return didNotStartAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = didNotStartAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return didNotStartAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "DECIDE_DID_NOT_START" });
    if (result.status === "unauthorized") return didNotStartAdminFailure(401, "UNAUTHORIZED");
    const responseBody = didNotStartAdminLoginResponseSchema.parse(result.response);
    return setDidNotStartAdminCookies(didNotStartAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: responseBody.expiresAt
    });
  } catch { return didNotStartAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function didNotStartAdminSessionStatusRoute(db: Database, request: Request, raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession, environment: Environment = process.env): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = didNotStartAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "DECIDE_DID_NOT_START" });
    if (result.status === "unauthorized") return didNotStartAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return didNotStartAdminFailure(403, "FORBIDDEN");
    return didNotStartAdminJson(didNotStartAdminLoginResponseSchema.parse({
      formatVersion: 1, raceId: result.principal.raceId, capability: result.principal.capability, expiresAt: result.principal.expiresAt
    }));
  } catch { return didNotStartAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function didNotStartAdminLogoutRoute(db: Database, request: Request, raceId: string,
  logout: Logout = logoutPairingAdminSession, environment: Environment = process.env): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedDidNotStartAdminOrigin(request, configured.policy)) return didNotStartAdminFailure(403, "FORBIDDEN");
  const proof = didNotStartAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, { ...proof, raceId, capability: "DECIDE_DID_NOT_START", readBodyIsEmpty: () => hasNoDidNotStartAdminRequestBody(request) });
    if (result.status === "unauthorized") return clearDidNotStartAdminCookies(didNotStartAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    if (result.status === "forbidden") return didNotStartAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return didNotStartAdminFailure(400, "INVALID_REQUEST");
    return clearDidNotStartAdminCookies(new Response(null, { status: 204, headers: {
      ...({ "cache-control": "private, no-store", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" })
    } }), configured.policy);
  } catch { return didNotStartAdminFailure(500, "INTERNAL_ERROR"); }
}

function didNotStartFailure(result: { status: string }): Response | undefined {
  if (result.status === "invalid-request") return didNotStartAdminFailure(400, "INVALID_REQUEST");
  if (result.status === "unauthorized") return didNotStartAdminFailure(401, "UNAUTHORIZED");
  if (result.status === "forbidden") return didNotStartAdminFailure(403, "FORBIDDEN");
  if (result.status === "not-found") return didNotStartAdminFailure(404, "NOT_FOUND");
  if (result.status === "conflict") return didNotStartAdminFailure(409, "CONFLICT");
  return undefined;
}

export async function didNotStartCandidateRoute(db: Database, request: Request, raceId: string,
  list: List = listDidNotStartCandidatesAsAdmin, environment: Environment = process.env): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = didNotStartAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    const failure = didNotStartFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return didNotStartAdminFailure(500, "INTERNAL_ERROR");
    return didNotStartAdminJson(didNotStartCandidateResponseSchema.parse(result.response));
  } catch { return didNotStartAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function authenticatedDidNotStartRoute(db: Database, request: Request, raceId: string, entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession, decide: Decide = decideDidNotStartAsAdmin,
  environment: Environment = process.env): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedDidNotStartAdminOrigin(request, configured.policy)) return didNotStartAdminFailure(403, "FORBIDDEN");
  const proof = didNotStartAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, { ...proof, raceId, capability: "DECIDE_DID_NOT_START", requireCsrf: true });
    if (authorization.status === "unauthorized") return didNotStartAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return didNotStartAdminFailure(403, "FORBIDDEN");
  } catch { return didNotStartAdminFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!didNotStartIdempotencyKeySchema.safeParse(idempotencyKey).success) return didNotStartAdminFailure(400, "INVALID_REQUEST");
  let body: unknown;
  try { body = await readDidNotStartAdminJson(request); } catch { return didNotStartAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = didNotStartRequestSchema.safeParse(body);
  if (!parsed.success) return didNotStartAdminFailure(400, "INVALID_REQUEST");
  try {
    const result = await decide(db, { ...proof, raceId, entryId, idempotencyKey, request: parsed.data });
    const failure = didNotStartFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return didNotStartAdminFailure(500, "INTERNAL_ERROR");
    return didNotStartAdminJson(didNotStartResponseSchema.parse(result.response));
  } catch { return didNotStartAdminFailure(500, "INTERNAL_ERROR"); }
}
