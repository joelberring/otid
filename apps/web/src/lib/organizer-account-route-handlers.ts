import {
  authenticateUserAccountSession,
  createOrganizerEvent,
  listMyEvents,
  loginUserAccount,
  logoutUserAccountSession,
  registerUserAccount
} from "@o-tid/application";
import {
  organizerAccountLoginRequestSchema,
  organizerAccountLoginResponseSchema,
  organizerEventCreateIdempotencyKeySchema,
  organizerEventCreateResponseSchema,
  organizerEventCreateRequestSchema,
  organizerMyEventsResponseSchema,
  organizerAccountSessionStatusSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  SecurityConfigurationError,
  accountFailure,
  clearSessionCookies,
  clientAddress,
  hasExpectedOrigin,
  hasNoRequestBody,
  organizerFailure,
  privateHeaders,
  privateJson,
  readJsonBody,
  securityPolicy,
  sessionProof,
  setSessionCookies
} from "./security-policy";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN" | "OTID_REGISTRATION_LIMIT_PER_HOUR">>;
type Login = typeof loginUserAccount;
type Register = typeof registerUserAccount;
type Authenticate = typeof authenticateUserAccountSession;
type Logout = typeof logoutUserAccountSession;
type Create = typeof createOrganizerEvent;
type List = typeof listMyEvents;

function policy(environment: Environment) {
  try { return { value: securityPolicy(environment) } as const; }
  catch (error) {
    if (error instanceof SecurityConfigurationError) return { response: organizerFailure(500, "INTERNAL_ERROR") } as const;
    throw error;
  }
}

function authenticationFailure(status: string): Response {
  return status === "unauthorized" ? organizerFailure(401, "UNAUTHORIZED") : organizerFailure(403, "FORBIDDEN");
}

function requestFailure(status: string): Response {
  switch (status) {
    case "unauthorized": return organizerFailure(401, "UNAUTHORIZED");
    case "forbidden": return organizerFailure(403, "FORBIDDEN");
    case "invalid-request": return organizerFailure(400, "INVALID_REQUEST");
    case "conflict": return organizerFailure(409, "CONFLICT");
    case "not-found": return organizerFailure(404, "UNAUTHORIZED");
    default: return organizerFailure(500, "INTERNAL_ERROR");
  }
}

export async function organizerLoginRoute(
  db: Database, request: Request, login: Login = loginUserAccount, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const parsed = organizerAccountLoginRequestSchema.safeParse(body);
  if (!parsed.success) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await login(db, parsed.data);
    if (result.status !== "authenticated") {
      return result.status === "rate-limited" ? accountFailure(429, "RATE_LIMITED")
        : result.status === "blocked" ? accountFailure(403, "ACCOUNT_BLOCKED") : organizerFailure(401, "UNAUTHORIZED");
    }
    const response = organizerAccountLoginResponseSchema.parse(result.response);
    return setSessionCookies(privateJson(response), configured.value, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

/** Antal registreringar per IP och timme (`OTID_REGISTRATION_LIMIT_PER_HOUR`, förval 10). */
export function registrationsPerHour(environment: Environment): number | undefined {
  const value = environment.OTID_REGISTRATION_LIMIT_PER_HOUR?.trim();
  return value && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : undefined;
}

/** Öppen registrering (ADR-0172): skapar konto och loggar in direkt, med spärr per IP. */
export async function organizerRegisterRoute(
  db: Database, request: Request, register: Register = registerUserAccount, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  try {
    const limit = registrationsPerHour(environment);
    const result = await register(db, body, { clientKey: clientAddress(request), ...(limit ? { registrationsPerHour: limit } : {}) });
    if (result.status === "rate-limited") return accountFailure(429, "RATE_LIMITED");
    if (result.status !== "authenticated") return requestFailure(result.status);
    const response = organizerAccountLoginResponseSchema.parse(result.response);
    return setSessionCookies(privateJson(response, 201), configured.value, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerSessionStatusRoute(
  db: Database, request: Request, authenticate: Authenticate = authenticateUserAccountSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!await hasNoRequestBody(request)) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await authenticate(db, sessionProof(request, configured.value, false));
    // Frågan "är jag inloggad?" är ett normalt svar, inte ett fel: inget 401 i webbläsarens konsol (PLAN.md steg 22).
    if (result.status === "unauthorized") return privateJson(organizerAccountSessionStatusSchema.parse({ formatVersion: 1, authenticated: false }));
    if (result.status !== "authenticated") return authenticationFailure(result.status);
    return privateJson(organizerAccountSessionStatusSchema.parse({
      formatVersion: 1, accountId: result.principal.accountId, email: result.principal.email,
      displayName: result.principal.displayName, superadmin: result.principal.superadmin, expiresAt: result.principal.expiresAt
    }));
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerLogoutRoute(
  db: Database, request: Request, logout: Logout = logoutUserAccountSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  if (!await hasNoRequestBody(request)) return organizerFailure(400, "INVALID_REQUEST");
  const proof = sessionProof(request, configured.value, true);
  try {
    const result = await logout(db, { ...proof, requireCsrf: true }, undefined);
    if (result.status === "unauthorized") return clearSessionCookies(organizerFailure(401, "UNAUTHORIZED"), configured.value);
    if (result.status === "forbidden") return organizerFailure(403, "FORBIDDEN");
    return clearSessionCookies(new Response(null, { status: 204, headers: privateHeaders }), configured.value);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerEventsListRoute(
  db: Database, request: Request, list: List = listMyEvents,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (request.method !== "GET" || !await hasNoRequestBody(request)) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await list(db, sessionProof(request, configured.value, false));
    if (result.status !== "ok") return authenticationFailure(result.status);
    return privateJson(organizerMyEventsResponseSchema.parse(result.response));
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerEventCreateRoute(
  db: Database, request: Request, authenticate: Authenticate = authenticateUserAccountSession,
  create: Create = createOrganizerEvent, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  const proof = sessionProof(request, configured.value, true);
  try {
    const auth = await authenticate(db, { ...proof, requireCsrf: true });
    if (auth.status !== "authenticated") return authenticationFailure(auth.status);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!organizerEventCreateIdempotencyKeySchema.safeParse(idempotencyKey).success) return organizerFailure(400, "INVALID_REQUEST");
  let body: unknown;
  try { body = await readJsonBody(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const parsed = organizerEventCreateRequestSchema.safeParse(body);
  if (!parsed.success) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await create(db, { ...proof, requireCsrf: true, idempotencyKey,
      readBody: async () => parsed.data });
    if (result.status !== "created") return requestFailure(result.status);
    const response = organizerEventCreateResponseSchema.parse(result.response);
    return privateJson(response, response.replayed ? 200 : 201);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

