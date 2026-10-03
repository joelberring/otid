import {
  authenticateEventCreationAdminSession,
  createEventAsAdmin,
  loginEventCreationAdmin,
  logoutEventCreationAdminSession
} from "@o-tid/application";
import {
  eventCreationIdempotencyKeySchema,
  eventCreationLoginRequestSchema,
  eventCreationLoginResponseSchema,
  eventCreationRequestSchema,
  eventCreationResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  EventCreationConfigurationError,
  clearEventCreationCookies,
  eventCreationFailure,
  eventCreationJson,
  eventCreationSecurityPolicy,
  eventCreationSessionProof,
  hasExpectedEventCreationOrigin,
  hasNoEventCreationRequestBody,
  privateEventCreationHeaders,
  readEventCreationJson,
  setEventCreationCookies
} from "./event-creation-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginEventCreationAdmin;
type Authenticate = typeof authenticateEventCreationAdminSession;
type Logout = typeof logoutEventCreationAdminSession;
type Create = typeof createEventAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: eventCreationSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof EventCreationConfigurationError) {
      return { response: eventCreationFailure(500, "INTERNAL_ERROR") } as const;
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

export async function eventCreationLoginRoute(
  db: Database,
  request: Request,
  login: Login = loginEventCreationAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEventCreationOrigin(request, configured.policy)) {
    return eventCreationFailure(403, "FORBIDDEN");
  }
  let body: unknown;
  try {
    body = await readEventCreationJson(request);
  } catch {
    return eventCreationFailure(400, "INVALID_REQUEST");
  }
  const parsed = eventCreationLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return eventCreationFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data);
    if (result.status === "unauthorized") return eventCreationFailure(401, "UNAUTHORIZED");
    const response = eventCreationLoginResponseSchema.parse(result.response);
    return setEventCreationCookies(eventCreationJson(response), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: response.expiresAt
    });
  } catch {
    return eventCreationFailure(500, "INTERNAL_ERROR");
  }
}

export async function eventCreationSessionStatusRoute(
  db: Database,
  request: Request,
  authenticate: Authenticate = authenticateEventCreationAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = eventCreationSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, proof);
    if (result.status === "unauthorized") return eventCreationFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return eventCreationFailure(403, "FORBIDDEN");
    return eventCreationJson(eventCreationLoginResponseSchema.parse({
      formatVersion: 1,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return eventCreationFailure(500, "INTERNAL_ERROR");
  }
}

export async function eventCreationLogoutRoute(
  db: Database,
  request: Request,
  logout: Logout = logoutEventCreationAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEventCreationOrigin(request, configured.policy)) {
    return eventCreationFailure(403, "FORBIDDEN");
  }
  const proof = eventCreationSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      readBodyIsEmpty: () => hasNoEventCreationRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearEventCreationCookies(eventCreationFailure(401, "UNAUTHORIZED"), configured.policy);
    }
    if (result.status === "forbidden") return eventCreationFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return eventCreationFailure(400, "INVALID_REQUEST");
    return clearEventCreationCookies(
      new Response(null, { status: 204, headers: privateEventCreationHeaders }),
      configured.policy
    );
  } catch {
    return eventCreationFailure(500, "INTERNAL_ERROR");
  }
}

export async function authenticatedEventCreationRoute(
  db: Database,
  request: Request,
  authenticate: Authenticate = authenticateEventCreationAdminSession,
  create: Create = createEventAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedEventCreationOrigin(request, configured.policy)) {
    return eventCreationFailure(403, "FORBIDDEN");
  }
  const proof = eventCreationSessionProof(request, configured.policy, true);
  try {
    const authorization = await authenticate(db, { ...proof, requireCsrf: true });
    if (authorization.status === "unauthorized") return eventCreationFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return eventCreationFailure(403, "FORBIDDEN");
  } catch {
    return eventCreationFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!eventCreationIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return eventCreationFailure(400, "INVALID_REQUEST");
  }
  let body: unknown;
  try {
    body = await readEventCreationJson(request);
  } catch {
    return eventCreationFailure(400, "INVALID_REQUEST");
  }
  const parsed = eventCreationRequestSchema.safeParse(body);
  if (!parsed.success) return eventCreationFailure(400, "INVALID_REQUEST");

  try {
    const result = await create(db, {
      ...proof,
      requireCsrf: true,
      idempotencyKey,
      readBody: async () => parsed.data
    });
    if (result.status === "unauthorized") return eventCreationFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return eventCreationFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return eventCreationFailure(400, "INVALID_REQUEST");
    if (result.status === "conflict") return eventCreationFailure(409, "CONFLICT");
    if (!("response" in result)) return eventCreationFailure(500, "INTERNAL_ERROR");
    return eventCreationJson(eventCreationResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
  } catch {
    return eventCreationFailure(500, "INTERNAL_ERROR");
  }
}
