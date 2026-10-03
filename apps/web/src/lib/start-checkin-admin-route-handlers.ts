import {
  authenticatePairingAdminSession,
  listStartCheckinRosterAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  registerStartCheckinDeviceAsAdmin,
  syncStartCheckinAsAdmin
} from "@o-tid/application";
import {
  finishForestWatchAdminLoginRequestSchema,
  finishForestWatchAdminLoginResponseSchema,
  startCheckinAdminLoginRequestSchema,
  startCheckinAdminLoginResponseSchema,
  startCheckinDeviceRegistrationResponseSchema,
  StartCheckinReceiptSchema,
  StartCheckinRosterResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  StartCheckinAdminConfigurationError,
  clearStartCheckinAdminCookies,
  hasExpectedStartCheckinAdminOrigin,
  hasNoStartCheckinAdminRequestBody,
  privateStartCheckinAdminHeaders,
  readStartCheckinAdminJson,
  setStartCheckinAdminCookies,
  startCheckinAdminFailure,
  startCheckinAdminJson,
  startCheckinAdminSecurityPolicy,
  startCheckinAdminSessionProof,
  type StartCheckinCapability
} from "./start-checkin-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type Roster = typeof listStartCheckinRosterAsAdmin;
type Device = typeof registerStartCheckinDeviceAsAdmin;
type Sync = typeof syncStartCheckinAsAdmin;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validRaceId(raceId: string): boolean {
  return CANONICAL_UUID.test(raceId);
}

function policyOrFailure(capability: StartCheckinCapability, environment: Environment) {
  try {
    return { policy: startCheckinAdminSecurityPolicy(capability, environment) } as const;
  } catch (error) {
    if (error instanceof StartCheckinAdminConfigurationError) {
      return { response: startCheckinAdminFailure(500, "INTERNAL_ERROR") } as const;
    }
    throw error;
  }
}

function loginSchemas(capability: StartCheckinCapability) {
  return capability === "START_CHECKIN"
    ? { request: startCheckinAdminLoginRequestSchema, response: startCheckinAdminLoginResponseSchema }
    : { request: finishForestWatchAdminLoginRequestSchema, response: finishForestWatchAdminLoginResponseSchema };
}

function invalidLoginStatus(value: unknown): 400 | 401 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return 400;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === 2 && keys[0] === "accessCredential" && keys[1] === "formatVersion" &&
    record.formatVersion === 1 && typeof record.accessCredential === "string" ? 401 : 400;
}

function applicationFailure(result: { status: string }): Response | null {
  switch (result.status) {
    case "unauthorized": return startCheckinAdminFailure(401, "UNAUTHORIZED");
    case "forbidden": return startCheckinAdminFailure(403, "FORBIDDEN");
    case "invalid-request": return startCheckinAdminFailure(400, "INVALID_REQUEST");
    case "not-found": return startCheckinAdminFailure(404, "NOT_FOUND");
    case "conflict": return startCheckinAdminFailure(409, "CONFLICT");
    case "too-large": return startCheckinAdminFailure(413, "TOO_LARGE");
    default: return null;
  }
}

function hasExpectedScope(
  response: { raceId: string; capability?: StartCheckinCapability }, raceId: string, capability: StartCheckinCapability
): boolean {
  return response.raceId === raceId && (response.capability === undefined || response.capability === capability);
}

export async function startCheckinAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  capability: StartCheckinCapability,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  if (!validRaceId(raceId)) return startCheckinAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(capability, environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedStartCheckinAdminOrigin(request, configured.policy)) return startCheckinAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try {
    body = await readStartCheckinAdminJson(request);
  } catch {
    return startCheckinAdminFailure(400, "INVALID_REQUEST");
  }
  const schemas = loginSchemas(capability), parsed = schemas.request.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return startCheckinAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: capability });
    if (result.status === "unauthorized") return startCheckinAdminFailure(401, "UNAUTHORIZED");
    const responseBody = schemas.response.parse(result.response);
    if (!hasExpectedScope(responseBody, raceId, capability)) return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    return setStartCheckinAdminCookies(startCheckinAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: responseBody.expiresAt
    });
  } catch {
    return startCheckinAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function startCheckinAdminSessionStatusRoute(
  db: Database, request: Request, raceId: string, capability: StartCheckinCapability,
  authenticate: Authenticate = authenticatePairingAdminSession, environment: Environment = process.env
): Promise<Response> {
  if (!validRaceId(raceId)) return startCheckinAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(capability, environment);
  if ("response" in configured) return configured.response;
  const proof = startCheckinAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability });
    if (result.status === "unauthorized") return startCheckinAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return startCheckinAdminFailure(403, "FORBIDDEN");
    const responseBody = loginSchemas(capability).response.parse({ formatVersion: 1, raceId: result.principal.raceId,
      capability: result.principal.capability, expiresAt: result.principal.expiresAt });
    if (!hasExpectedScope(responseBody, raceId, capability)) return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    return startCheckinAdminJson(responseBody);
  } catch {
    return startCheckinAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function startCheckinAdminLogoutRoute(
  db: Database, request: Request, raceId: string, capability: StartCheckinCapability,
  logout: Logout = logoutPairingAdminSession, environment: Environment = process.env
): Promise<Response> {
  if (!validRaceId(raceId)) return startCheckinAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(capability, environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedStartCheckinAdminOrigin(request, configured.policy)) return startCheckinAdminFailure(403, "FORBIDDEN");
  const proof = startCheckinAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, { ...proof, raceId, capability,
      readBodyIsEmpty: () => hasNoStartCheckinAdminRequestBody(request) });
    if (result.status === "unauthorized") return clearStartCheckinAdminCookies(startCheckinAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    const failure = applicationFailure(result);
    if (failure) return failure;
    return clearStartCheckinAdminCookies(new Response(null, { status: 204, headers: privateStartCheckinAdminHeaders }), configured.policy);
  } catch {
    return startCheckinAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function startCheckinAdminRosterRoute(
  db: Database, request: Request, raceId: string, capability: StartCheckinCapability,
  roster: Roster = listStartCheckinRosterAsAdmin, environment: Environment = process.env
): Promise<Response> {
  if (!validRaceId(raceId)) return startCheckinAdminFailure(400, "INVALID_REQUEST");
  const query = new URL(request.url).search;
  if (query !== "" && query !== "?reviewDetails=1") return startCheckinAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(capability, environment);
  if ("response" in configured) return configured.response;
  const proof = startCheckinAdminSessionProof(request, configured.policy, false);
  try {
    const result = await roster(db, { ...proof, raceId, capability, ...(query ? { reviewDetails: true } : {}) });
    const failure = applicationFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    const responseBody = StartCheckinRosterResponseSchema.parse(result.response);
    if (!hasExpectedScope(responseBody, raceId, capability)) return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    return startCheckinAdminJson(responseBody);
  } catch {
    return startCheckinAdminFailure(500, "INTERNAL_ERROR");
  }
}

async function authenticatedBodyRoute(
  db: Database, request: Request, raceId: string, capability: StartCheckinCapability,
  service: Device | Sync, environment: Environment, responseSchema: typeof startCheckinDeviceRegistrationResponseSchema | typeof StartCheckinReceiptSchema
): Promise<Response> {
  if (!validRaceId(raceId)) return startCheckinAdminFailure(400, "INVALID_REQUEST");
  const configured = policyOrFailure(capability, environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedStartCheckinAdminOrigin(request, configured.policy)) return startCheckinAdminFailure(403, "FORBIDDEN");
  const proof = startCheckinAdminSessionProof(request, configured.policy, true);
  let readError = false;
  try {
    const result = await service(db, { ...proof, raceId, capability, readBody: async () => {
      try { return await readStartCheckinAdminJson(request); } catch (error) { readError = true; throw error; }
    } });
    const failure = applicationFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    const responseBody = responseSchema.parse(result.response);
    if (!hasExpectedScope(responseBody, raceId, capability)) return startCheckinAdminFailure(500, "INTERNAL_ERROR");
    return startCheckinAdminJson(responseBody);
  } catch {
    return readError ? startCheckinAdminFailure(400, "INVALID_REQUEST") : startCheckinAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function startCheckinAdminDeviceRoute(
  db: Database, request: Request, raceId: string, capability: StartCheckinCapability,
  register: Device = registerStartCheckinDeviceAsAdmin, environment: Environment = process.env
): Promise<Response> {
  return authenticatedBodyRoute(db, request, raceId, capability, register, environment, startCheckinDeviceRegistrationResponseSchema);
}

export async function startCheckinAdminSyncRoute(
  db: Database, request: Request, raceId: string, capability: StartCheckinCapability,
  sync: Sync = syncStartCheckinAsAdmin, environment: Environment = process.env
): Promise<Response> {
  return authenticatedBodyRoute(db, request, raceId, capability, sync, environment, StartCheckinReceiptSchema);
}
