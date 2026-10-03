import {
  authenticatePairingAdminSession,
  commitClassStartDrawAsAdmin,
  previewClassStartDrawAsAdmin,
  listClassStartDrawClassesAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  classStartDrawClassesResponseSchema,
  classStartDrawPreviewRequestSchema,
  classStartDrawPreviewResponseSchema,
  classStartDrawAdminLoginRequestSchema,
  classStartDrawAdminLoginResponseSchema,
  classStartDrawIdempotencyKeySchema,
  classStartDrawRequestSchema,
  classStartDrawResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  ClassStartDrawAdminConfigurationError,
  clearClassStartDrawAdminCookies,
  classStartDrawAdminFailure,
  classStartDrawAdminJson,
  classStartDrawAdminSecurityPolicy,
  classStartDrawAdminSessionProof,
  hasExpectedClassStartDrawAdminOrigin,
  hasNoClassStartDrawAdminRequestBody,
  privateClassStartDrawAdminHeaders,
  readClassStartDrawAdminJson,
  setClassStartDrawAdminCookies
} from "./class-start-draw-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listClassStartDrawClassesAsAdmin;
type Change = typeof commitClassStartDrawAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: classStartDrawAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof ClassStartDrawAdminConfigurationError) {
      return { response: classStartDrawAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function classStartDrawAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedClassStartDrawAdminOrigin(request, configured.policy)) return classStartDrawAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try {
    body = await readClassStartDrawAdminJson(request);
  } catch {
    return classStartDrawAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = classStartDrawAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return classStartDrawAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "DRAW_CLASS_START_TIMES" });
    if (result.status === "unauthorized") return classStartDrawAdminFailure(401, "UNAUTHORIZED");
    const responseBody = classStartDrawAdminLoginResponseSchema.parse(result.response);
    return setClassStartDrawAdminCookies(classStartDrawAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: responseBody.expiresAt
    });
  } catch {
    return classStartDrawAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function classStartDrawAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = classStartDrawAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "DRAW_CLASS_START_TIMES" });
    if (result.status === "unauthorized") return classStartDrawAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return classStartDrawAdminFailure(403, "FORBIDDEN");
    return classStartDrawAdminJson(classStartDrawAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return classStartDrawAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function classStartDrawAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedClassStartDrawAdminOrigin(request, configured.policy)) return classStartDrawAdminFailure(403, "FORBIDDEN");
  const proof = classStartDrawAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "DRAW_CLASS_START_TIMES",
      readBodyIsEmpty: () => hasNoClassStartDrawAdminRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearClassStartDrawAdminCookies(classStartDrawAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    }
    if (result.status === "forbidden") return classStartDrawAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return classStartDrawAdminFailure(400, "INVALID_REQUEST");
    return clearClassStartDrawAdminCookies(new Response(null, { status: 204, headers: privateClassStartDrawAdminHeaders }), configured.policy);
  } catch {
    return classStartDrawAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function classStartDrawAdminClassesRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listClassStartDrawClassesAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = classStartDrawAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    if (result.status === "unauthorized") return classStartDrawAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return classStartDrawAdminFailure(403, "FORBIDDEN");
    if (result.status === "not-found") return classStartDrawAdminFailure(404, "NOT_FOUND");
    if (!("response" in result)) return classStartDrawAdminFailure(500, "INTERNAL_ERROR");
    return classStartDrawAdminJson(classStartDrawClassesResponseSchema.parse(result.response));
  } catch {
    return classStartDrawAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function authenticatedClassStartDrawRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  change: Change = commitClassStartDrawAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedClassStartDrawAdminOrigin(request, configured.policy)) return classStartDrawAdminFailure(403, "FORBIDDEN");
  const proof = classStartDrawAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "DRAW_CLASS_START_TIMES",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return classStartDrawAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return classStartDrawAdminFailure(403, "FORBIDDEN");
  } catch {
    return classStartDrawAdminFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!classStartDrawIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return classStartDrawAdminFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try {
    body = await readClassStartDrawAdminJson(request);
  } catch {
    return classStartDrawAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = classStartDrawRequestSchema.safeParse(body);
  if (!parsed.success) return classStartDrawAdminFailure(400, "INVALID_REQUEST");

  try {
    const result = await change(db, {
      ...proof,
      raceId,
      idempotencyKey,
      request: parsed.data
    });
    if (result.status === "unauthorized") return classStartDrawAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return classStartDrawAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return classStartDrawAdminFailure(400, "INVALID_REQUEST");
    if (result.status === "conflict") return classStartDrawAdminFailure(409, "CONFLICT");
    if (result.status === "not-found") return classStartDrawAdminFailure(404, "NOT_FOUND");
    if (!("response" in result)) return classStartDrawAdminFailure(500, "INTERNAL_ERROR");
    return classStartDrawAdminJson(classStartDrawResponseSchema.parse(result.response));
  } catch {
    return classStartDrawAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function classStartDrawAdminPreviewRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  change: typeof previewClassStartDrawAsAdmin = previewClassStartDrawAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedClassStartDrawAdminOrigin(request, configured.policy)) return classStartDrawAdminFailure(403, "FORBIDDEN");
  const proof = classStartDrawAdminSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "DRAW_CLASS_START_TIMES",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return classStartDrawAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return classStartDrawAdminFailure(403, "FORBIDDEN");
  } catch {
    return classStartDrawAdminFailure(500, "INTERNAL_ERROR");
  }

  let body: unknown;
  try {
    body = await readClassStartDrawAdminJson(request);
  } catch {
    return classStartDrawAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = classStartDrawPreviewRequestSchema.safeParse(body);
  if (!parsed.success) return classStartDrawAdminFailure(400, "INVALID_REQUEST");

  try {
    const result = await change(db, {
      ...proof,
      raceId,
      request: parsed.data
    });
    if (result.status === "unauthorized") return classStartDrawAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return classStartDrawAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return classStartDrawAdminFailure(400, "INVALID_REQUEST");
    if (result.status === "conflict") return classStartDrawAdminFailure(409, "CONFLICT");
    if (result.status === "not-found") return classStartDrawAdminFailure(404, "NOT_FOUND");
    if (!("response" in result)) return classStartDrawAdminFailure(500, "INTERNAL_ERROR");
    return classStartDrawAdminJson(classStartDrawPreviewResponseSchema.parse(result.response));
  } catch {
    return classStartDrawAdminFailure(500, "INTERNAL_ERROR");
  }
}
