import {
  authenticatePairingAdminSession,
  decideWithoutTimingAsAdmin,
  listWithoutTimingCandidatesAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  withoutTimingAdminLoginRequestSchema,
  withoutTimingAdminLoginResponseSchema,
  withoutTimingCandidateResponseSchema,
  withoutTimingIdempotencyKeySchema,
  withoutTimingRequestSchema,
  withoutTimingResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  clearWithoutTimingAdminCookies,
  hasExpectedWithoutTimingAdminOrigin,
  hasNoWithoutTimingAdminRequestBody,
  privateWithoutTimingAdminHeaders,
  readWithoutTimingAdminJson,
  setWithoutTimingAdminCookies,
  withoutTimingAdminFailure,
  withoutTimingAdminJson,
  withoutTimingAdminSecurityPolicy,
  withoutTimingAdminSessionProof
} from "./without-timing-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Authenticate = typeof authenticatePairingAdminSession;

function policyOrFailure(environment: Environment) {
  try { return { policy: withoutTimingAdminSecurityPolicy(environment) } as const; }
  catch { return { response: withoutTimingAdminFailure(500, "INTERNAL_ERROR") } as const; }
}

function applicationFailure(result: { status: string }): Response | undefined {
  if (result.status === "invalid-request") return withoutTimingAdminFailure(400, "INVALID_REQUEST");
  if (result.status === "unauthorized") return withoutTimingAdminFailure(401, "UNAUTHORIZED");
  if (result.status === "forbidden") return withoutTimingAdminFailure(403, "FORBIDDEN");
  if (result.status === "not-found") return withoutTimingAdminFailure(404, "NOT_FOUND");
  if (result.status === "conflict") return withoutTimingAdminFailure(409, "CONFLICT");
  return undefined;
}

function invalidLoginStatus(value: unknown): 400 | 401 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return 400;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === 2 && keys[0] === "accessCredential" && keys[1] === "formatVersion" &&
    record.formatVersion === 1 && typeof record.accessCredential === "string" ? 401 : 400;
}

export async function withoutTimingAdminLoginRoute(
  db: Database, request: Request, raceId: string,
  login: typeof loginPairingAdmin = loginPairingAdmin, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedWithoutTimingAdminOrigin(request, configured.policy)) return withoutTimingAdminFailure(403, "FORBIDDEN");
  let body: unknown; try { body = await readWithoutTimingAdminJson(request); } catch { return withoutTimingAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = withoutTimingAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return withoutTimingAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "DECIDE_WITHOUT_TIMING" });
    if (result.status === "unauthorized") return withoutTimingAdminFailure(401, "UNAUTHORIZED");
    const response = withoutTimingAdminLoginResponseSchema.parse(result.response);
    return setWithoutTimingAdminCookies(withoutTimingAdminJson(response), configured.policy, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
  } catch { return withoutTimingAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function withoutTimingAdminSessionStatusRoute(
  db: Database, request: Request, raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  const proof = withoutTimingAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "DECIDE_WITHOUT_TIMING" });
    if (result.status === "unauthorized") return withoutTimingAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return withoutTimingAdminFailure(403, "FORBIDDEN");
    return withoutTimingAdminJson(withoutTimingAdminLoginResponseSchema.parse({
      formatVersion: 1, raceId: result.principal.raceId, capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch { return withoutTimingAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function withoutTimingAdminLogoutRoute(
  db: Database, request: Request, raceId: string,
  logout: typeof logoutPairingAdminSession = logoutPairingAdminSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedWithoutTimingAdminOrigin(request, configured.policy)) return withoutTimingAdminFailure(403, "FORBIDDEN");
  const proof = withoutTimingAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, { ...proof, raceId, capability: "DECIDE_WITHOUT_TIMING",
      readBodyIsEmpty: () => hasNoWithoutTimingAdminRequestBody(request) });
    if (result.status === "unauthorized") return clearWithoutTimingAdminCookies(withoutTimingAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    if (result.status === "forbidden") return withoutTimingAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return withoutTimingAdminFailure(400, "INVALID_REQUEST");
    return clearWithoutTimingAdminCookies(new Response(null, { status: 204, headers: privateWithoutTimingAdminHeaders }), configured.policy);
  } catch { return withoutTimingAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function withoutTimingCandidateListRoute(
  db: Database, request: Request, raceId: string, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  const proof = withoutTimingAdminSessionProof(request, configured.policy, false);
  try {
    const result = await listWithoutTimingCandidatesAsAdmin(db, { ...proof, raceId });
    const failure = applicationFailure(result); if (failure) return failure;
    if (!("response" in result)) return withoutTimingAdminFailure(500, "INTERNAL_ERROR");
    return withoutTimingAdminJson(withoutTimingCandidateResponseSchema.parse(result.response));
  } catch { return withoutTimingAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function authenticatedWithoutTimingRoute(
  db: Database, request: Request, raceId: string, entryId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  decide: typeof decideWithoutTimingAsAdmin = decideWithoutTimingAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedWithoutTimingAdminOrigin(request, configured.policy)) return withoutTimingAdminFailure(403, "FORBIDDEN");
  const proof = withoutTimingAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, { ...proof, raceId, capability: "DECIDE_WITHOUT_TIMING", requireCsrf: true });
    if (authorization.status === "unauthorized") return withoutTimingAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return withoutTimingAdminFailure(403, "FORBIDDEN");
  } catch { return withoutTimingAdminFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!withoutTimingIdempotencyKeySchema.safeParse(idempotencyKey).success) return withoutTimingAdminFailure(400, "INVALID_REQUEST");
  let body: unknown; try { body = await readWithoutTimingAdminJson(request); } catch { return withoutTimingAdminFailure(400, "INVALID_REQUEST"); }
  const parsed = withoutTimingRequestSchema.safeParse(body); if (!parsed.success) return withoutTimingAdminFailure(400, "INVALID_REQUEST");
  try {
    const result = await decide(db, { ...proof, raceId, entryId, idempotencyKey, request: parsed.data });
    const failure = applicationFailure(result); if (failure) return failure;
    if (!("response" in result)) return withoutTimingAdminFailure(500, "INTERNAL_ERROR");
    return withoutTimingAdminJson(withoutTimingResponseSchema.parse(result.response));
  } catch { return withoutTimingAdminFailure(500, "INTERNAL_ERROR"); }
}
