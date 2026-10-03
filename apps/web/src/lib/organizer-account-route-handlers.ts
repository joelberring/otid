import {
  authenticateUserAccountSession,
  createEventAsUserAccount,
  enterRaceAsUserAccount,
  grantEventAdministratorAsUserAccount,
  listEventAdministratorsAsUserAccount,
  listMyEventsAsUserAccount,
  loginUserAccount,
  logoutUserAccountSession,
  registerUserAccount,
  revokeEventAdministratorAsUserAccount
} from "@o-tid/application";
import {
  organizerAccountLoginRequestSchema,
  organizerAccountLoginResponseSchema,
  organizerEventCreateIdempotencyKeySchema,
  organizerEventCreateResponseSchema,
  organizerEventCreateRequestSchema,
  organizerMyEventsResponseSchema,
  organizerRaceEnterResponseSchema,
  organizerAccountSessionStatusSchema,
  organizerAdminGrantIdempotencyKeySchema,
  organizerAdminGrantRequestSchema,
  organizerAdminGrantResponseSchema,
  organizerAdminListRequestSchema,
  organizerAdminListResponseSchema,
  organizerAdminRevokeIdempotencyKeySchema,
  organizerAdminRevokeRequestSchema,
  organizerAdminRevokeResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  OrganizerConfigurationError,
  clearOrganizerAccountCookies,
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

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginUserAccount;
type Register = typeof registerUserAccount;
type Authenticate = typeof authenticateUserAccountSession;
type Logout = typeof logoutUserAccountSession;
type Create = typeof createEventAsUserAccount;
type List = typeof listMyEventsAsUserAccount;
type Enter = typeof enterRaceAsUserAccount;
type AdminGrant = typeof grantEventAdministratorAsUserAccount;
type AdminList = typeof listEventAdministratorsAsUserAccount;
type AdminRevoke = typeof revokeEventAdministratorAsUserAccount;
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
    if (result.status === "unauthorized") return organizerFailure(401, "UNAUTHORIZED");
    const response = organizerAccountLoginResponseSchema.parse(result.response);
    return setOrganizerAccountCookies(organizerJson(response), configured.value, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

/** Självregistrering (ADR-0168): skapar konto och loggar in direkt. */
export async function organizerRegisterRoute(
  db: Database, request: Request, register: Register = registerUserAccount, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrganizerOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  let body: unknown;
  try { body = await readOrganizerJson(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  try {
    const result = await register(db, body);
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
      formatVersion: 1, accountId: result.principal.accountId,
      displayName: result.principal.displayName, expiresAt: result.principal.expiresAt
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

export async function organizerEventAdministratorsListRoute(
  db: Database, request: Request, eventId: string, list: AdminList = listEventAdministratorsAsUserAccount,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (request.method !== "GET" || !raceIdPattern.test(eventId) || !await hasNoOrganizerRequestBody(request)) {
    return organizerFailure(400, "INVALID_REQUEST");
  }
  const parsed = organizerAdminListRequestSchema.safeParse({ formatVersion: 1, eventId });
  if (!parsed.success) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await list(db, { ...organizerSessionProof(request, configured.value, false), eventId });
    if (result.status !== "ok") return requestFailure(result.status);
    const response = organizerAdminListResponseSchema.parse(result.response);
    if (response.eventId !== eventId) return organizerFailure(500, "INTERNAL_ERROR");
    return organizerJson(response);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerEventAdministratorGrantRoute(
  db: Database, request: Request, eventId: string, grant: AdminGrant = grantEventAdministratorAsUserAccount,
  authenticate: Authenticate = authenticateUserAccountSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrganizerOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  if (!raceIdPattern.test(eventId)) return organizerFailure(400, "INVALID_REQUEST");
  const proof = organizerSessionProof(request, configured.value, true);
  try {
    const auth = await authenticate(db, { ...proof, requireCsrf: true });
    if (auth.status !== "authenticated") return authenticationFailure(auth.status);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!organizerAdminGrantIdempotencyKeySchema.safeParse(idempotencyKey).success) return organizerFailure(400, "INVALID_REQUEST");
  let body: unknown;
  try { body = await readOrganizerJson(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const parsed = organizerAdminGrantRequestSchema.safeParse(body);
  if (!parsed.success || parsed.data.eventId !== eventId) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await grant(db, { ...proof, requireCsrf: true, idempotencyKey,
      readBody: async () => parsed.data });
    if (result.status !== "granted") return requestFailure(result.status);
    const response = organizerAdminGrantResponseSchema.parse(result.response);
    if (response.eventId !== eventId || response.requestId !== parsed.data.requestId) return organizerFailure(500, "INTERNAL_ERROR");
    return organizerJson(response, response.replayed ? 200 : 201);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}

export async function organizerEventAdministratorRevokeRoute(
  db: Database, request: Request, eventId: string, grantId: string,
  revoke: AdminRevoke = revokeEventAdministratorAsUserAccount,
  authenticate: Authenticate = authenticateUserAccountSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policy(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedOrganizerOrigin(request, configured.value)) return organizerFailure(403, "FORBIDDEN");
  if (!raceIdPattern.test(eventId) || !raceIdPattern.test(grantId)) return organizerFailure(400, "INVALID_REQUEST");
  const proof = organizerSessionProof(request, configured.value, true);
  try {
    const auth = await authenticate(db, { ...proof, requireCsrf: true });
    if (auth.status !== "authenticated") return authenticationFailure(auth.status);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!organizerAdminRevokeIdempotencyKeySchema.safeParse(idempotencyKey).success) return organizerFailure(400, "INVALID_REQUEST");
  let body: unknown;
  try { body = await readOrganizerJson(request); } catch { return organizerFailure(400, "INVALID_REQUEST"); }
  const parsed = organizerAdminRevokeRequestSchema.safeParse(body);
  if (!parsed.success || parsed.data.eventId !== eventId || parsed.data.grantId !== grantId) return organizerFailure(400, "INVALID_REQUEST");
  try {
    const result = await revoke(db, { ...proof, requireCsrf: true, idempotencyKey, grantId,
      readBody: async () => parsed.data });
    if (result.status !== "revoked") return requestFailure(result.status);
    const response = organizerAdminRevokeResponseSchema.parse(result.response);
    if (response.eventId !== eventId || response.grantId !== grantId || response.requestId !== parsed.data.requestId) return organizerFailure(500, "INTERNAL_ERROR");
    return organizerJson(response);
  } catch { return organizerFailure(500, "INTERNAL_ERROR"); }
}
