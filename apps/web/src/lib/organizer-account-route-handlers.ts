import {
  authenticateUserAccountSession,
  createEventAsUserAccount,
  enterRaceAsUserAccount,
  listMyEventsAsUserAccount,
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
  organizerRaceEnterResponseSchema,
  organizerAccountSessionStatusSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  OrganizerConfigurationError,
  accountFailure,
  clearOrganizerAccountCookies,
  clientAddress,
  hasExpectedOrganizerOrigin,
  hasNoOrganizerRequestBody,
  organizerFailure,
  organizerJson,
  organizerSecurityPolicy,
  organizerSessionProof,
  privateOrganizerHeaders,
  readOrganizerJson,
  setOrganizerAccountCookies,
  setOrganizerRaceCookies
} from "./organizer-account-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN" | "OTID_REGISTRATION_LIMIT_PER_HOUR">>;
type Login = typeof loginUserAccount;
type Register = typeof registerUserAccount;
type Authenticate = typeof authenticateUserAccountSession;
type Logout = typeof logoutUserAccountSession;
type Create = typeof createEventAsUserAccount;
type List = typeof listMyEventsAsUserAccount;
type Enter = typeof enterRaceAsUserAccount;
const raceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function policy(environment: Environment) {
  try { return { value: organizerSecurityPolicy(environment) } as const; }
  catch (error) {
    if (error instanceof OrganizerConfigurationError) return { response: organizerFailure(500, "INTERNAL_ERROR") } as const;
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
  if (!hasExpectedOrganizerOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readOrganizerJson(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const parsed = organizerAccountLoginRequestSchema.safeParse(body);
  if (!parsed.success) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await login(db, parsed.data);
    if (result.status !== "authenticated") {
      return result.status === "rate-limited" ? accountFailure(429, "RATE_LIMITED")
        : result.status === "blocked" ? accountFailure(403, "ACCOUNT_BLOCKED") : organizerFailure(401, "UNAUTHORIZED");
    }
    const response = organizerAccountLoginResponseSchema.parse(result.response);
    return setOrganizerAccountCookies(organizerJson(response), configured.value, {
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
  if (!hasExpectedOrganizerOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readOrganizerJson(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  try {
    const limit = registrationsPerHour(environment);
    const result = await register(db, body, { clientKey: clientAddress(request), ...(limit ? { registrationsPerHour: limit } : {}) });
    if (result.status === "rate-limited") return accountFailure(429, "RATE_LIMITED");
    if (result.status !== "authenticated") return requestFailure(result.status);
    const response = organizerAccountLoginResponseSchema.parse(result.response);
    return setOrganizerAccountCookies(organizerJson(response, 201), configured.value, {
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
  if (!await hasNoOrganizerRequestBody(request)) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await authenticate(db, organizerSessionProof(request, configured.value, false));
    if (result.status !== "authenticated") return authenticationFailure(result.status);
    return organizerJson(organizerAccountSessionStatusSchema.parse({
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
  if (!hasExpectedOrganizerOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  if (!await hasNoOrganizerRequestBody(request)) return organizerFailure(400, "INVALID_REQUEST");
  const proof = organizerSessionProof(request, configured.value, true);
  try {
    const result = await logout(db, { ...proof, requireCsrf: true }, undefined);
    if (result.status === "unauthorized") return clearOrganizerAccountCookies(organizerFailure(401, "UNAUTHORIZED"), configured.value);
    if (result.status === "forbidden") return organizerFailure(403, "FORBIDDEN");
    return clearOrganizerAccountCookies(new Response(null, { status: 204, headers: privateOrganizerHeaders }), configured.value);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerEventsListRoute(
  db: Database, request: Request, list: List = listMyEventsAsUserAccount,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (request.method !== "GET" || !await hasNoOrganizerRequestBody(request)) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await list(db, organizerSessionProof(request, configured.value, false));
    if (result.status !== "ok") return authenticationFailure(result.status);
    return organizerJson(organizerMyEventsResponseSchema.parse(result.response));
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerEventCreateRoute(
  db: Database, request: Request, authenticate: Authenticate = authenticateUserAccountSession,
  create: Create = createEventAsUserAccount, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrganizerOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  const proof = organizerSessionProof(request, configured.value, true);
  try {
    const auth = await authenticate(db, { ...proof, requireCsrf: true });
    if (auth.status !== "authenticated") return authenticationFailure(auth.status);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!organizerEventCreateIdempotencyKeySchema.safeParse(idempotencyKey).success) return organizerFailure(400, "INVALID_REQUEST");
  let body: unknown;
  try { body = await readOrganizerJson(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const parsed = organizerEventCreateRequestSchema.safeParse(body);
  if (!parsed.success) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await create(db, { ...proof, requireCsrf: true, idempotencyKey,
      readBody: async () => parsed.data });
    if (result.status !== "created") return requestFailure(result.status);
    const response = organizerEventCreateResponseSchema.parse(result.response);
    return organizerJson(response, response.replayed ? 200 : 201);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerRaceEnterRoute(
  db: Database, request: Request, raceId: string, enter: Enter = enterRaceAsUserAccount,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrganizerOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  if (!raceIdPattern.test(raceId) || !await hasNoOrganizerRequestBody(request)) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await enter(db, { ...organizerSessionProof(request, configured.value, true), requireCsrf: true, raceId });
    if (result.status !== "entered") return requestFailure(result.status);
    const response = organizerRaceEnterResponseSchema.parse(result.response);
    if (response.raceId !== raceId) return organizerFailure(500, "INTERNAL_ERROR");
    return setOrganizerRaceCookies(organizerJson(response), configured.value, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}
