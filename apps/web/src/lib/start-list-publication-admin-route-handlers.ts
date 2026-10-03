import {
  authenticatePairingAdminSession,
  decideStartListPublicationAsAdmin,
  getStartListPublicationPreviewAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  startListPublicationPreviewResponseSchema,
  startListPublicationAdminLoginRequestSchema,
  startListPublicationAdminLoginResponseSchema,
  startListPublicationIdempotencyKeySchema,
  startListPublicationRequestSchema,
  startListPublicationResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  StartListPublicationAdminConfigurationError,
  clearStartListPublicationAdminCookies,
  startListPublicationAdminFailure,
  startListPublicationAdminJson,
  startListPublicationAdminSecurityPolicy,
  startListPublicationAdminSessionProof,
  hasExpectedStartListPublicationAdminOrigin,
  hasNoStartListPublicationAdminRequestBody,
  privateStartListPublicationAdminHeaders,
  readStartListPublicationAdminJson,
  setStartListPublicationAdminCookies
} from "./start-list-publication-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof getStartListPublicationPreviewAsAdmin;
type Change = typeof decideStartListPublicationAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: startListPublicationAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof StartListPublicationAdminConfigurationError) {
      return { response: startListPublicationAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function startListPublicationAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedStartListPublicationAdminOrigin(request, configured.policy)) return startListPublicationAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try {
    body = await readStartListPublicationAdminJson(request);
  } catch {
    return startListPublicationAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = startListPublicationAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return startListPublicationAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "PUBLISH_START_LIST" });
    if (result.status === "unauthorized") return startListPublicationAdminFailure(401, "UNAUTHORIZED");
    const responseBody = startListPublicationAdminLoginResponseSchema.parse(result.response);
    return setStartListPublicationAdminCookies(startListPublicationAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: responseBody.expiresAt
    });
  } catch {
    return startListPublicationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function startListPublicationAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = startListPublicationAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "PUBLISH_START_LIST" });
    if (result.status === "unauthorized") return startListPublicationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return startListPublicationAdminFailure(403, "FORBIDDEN");
    return startListPublicationAdminJson(startListPublicationAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return startListPublicationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function startListPublicationAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedStartListPublicationAdminOrigin(request, configured.policy)) return startListPublicationAdminFailure(403, "FORBIDDEN");
  const proof = startListPublicationAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "PUBLISH_START_LIST",
      readBodyIsEmpty: () => hasNoStartListPublicationAdminRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearStartListPublicationAdminCookies(startListPublicationAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    }
    if (result.status === "forbidden") return startListPublicationAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return startListPublicationAdminFailure(400, "INVALID_REQUEST");
    return clearStartListPublicationAdminCookies(new Response(null, { status: 204, headers: privateStartListPublicationAdminHeaders }), configured.policy);
  } catch {
    return startListPublicationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function startListPublicationAdminPreviewRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = getStartListPublicationPreviewAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = startListPublicationAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    if (result.status === "unauthorized") return startListPublicationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return startListPublicationAdminFailure(403, "FORBIDDEN");
    if (!("response" in result)) return startListPublicationAdminFailure(500, "INTERNAL_ERROR");
    return startListPublicationAdminJson(startListPublicationPreviewResponseSchema.parse(result.response));
  } catch {
    return startListPublicationAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function authenticatedStartListPublicationRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  change: Change = decideStartListPublicationAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedStartListPublicationAdminOrigin(request, configured.policy)) return startListPublicationAdminFailure(403, "FORBIDDEN");
  const proof = startListPublicationAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "PUBLISH_START_LIST",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return startListPublicationAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return startListPublicationAdminFailure(403, "FORBIDDEN");
  } catch {
    return startListPublicationAdminFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!startListPublicationIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return startListPublicationAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try {
    body = await readStartListPublicationAdminJson(request);
  } catch {
    return startListPublicationAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = startListPublicationRequestSchema.safeParse(body);
  if (!parsed.success) return startListPublicationAdminFailure(400, "INVALID_REQUEST");

  try {
    const result = await change(db, {
      ...proof,
      raceId,
      idempotencyKey,
      request: parsed.data
    });
    if (result.status === "unauthorized") return startListPublicationAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return startListPublicationAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return startListPublicationAdminFailure(400, "INVALID_REQUEST");
    if (result.status === "conflict") return startListPublicationAdminFailure(409, "CONFLICT");
    if (!("response" in result)) return startListPublicationAdminFailure(500, "INTERNAL_ERROR");
    return startListPublicationAdminJson(startListPublicationResponseSchema.parse(result.response));
  } catch {
    return startListPublicationAdminFailure(500, "INTERNAL_ERROR");
  }
}
