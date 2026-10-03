import {
  authenticatePairingAdminSession,
  listStartListAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  startListAdminListResponseSchema,
  startListAdminLoginRequestSchema,
  startListAdminLoginResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  StartListAdminConfigurationError,
  clearStartListAdminCookies,
  startListAdminFailure,
  startListAdminJson,
  startListAdminSecurityPolicy,
  startListAdminSessionProof,
  hasExpectedStartListAdminOrigin,
  hasNoStartListAdminRequestBody,
  privateStartListAdminHeaders,
  readStartListAdminJson,
  setStartListAdminCookies
} from "./start-list-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type List = typeof listStartListAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: startListAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof StartListAdminConfigurationError) {
      return { response: startListAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function startListAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedStartListAdminOrigin(request, configured.policy)) return startListAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try {
    body = await readStartListAdminJson(request);
  } catch {
    return startListAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = startListAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return startListAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "VIEW_START_LIST" });
    if (result.status === "unauthorized") return startListAdminFailure(401, "UNAUTHORIZED");
    const responseBody = startListAdminLoginResponseSchema.parse(result.response);
    return setStartListAdminCookies(startListAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: responseBody.expiresAt
    });
  } catch {
    return startListAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function startListAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = startListAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "VIEW_START_LIST" });
    if (result.status === "unauthorized") return startListAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return startListAdminFailure(403, "FORBIDDEN");
    return startListAdminJson(startListAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return startListAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function startListAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedStartListAdminOrigin(request, configured.policy)) return startListAdminFailure(403, "FORBIDDEN");
  const proof = startListAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "VIEW_START_LIST",
      readBodyIsEmpty: () => hasNoStartListAdminRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearStartListAdminCookies(startListAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    }
    if (result.status === "forbidden") return startListAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return startListAdminFailure(400, "INVALID_REQUEST");
    return clearStartListAdminCookies(new Response(null, { status: 204, headers: privateStartListAdminHeaders }), configured.policy);
  } catch {
    return startListAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function startListAdminListRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listStartListAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = startListAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { ...proof, raceId });
    if (result.status === "unauthorized") return startListAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return startListAdminFailure(403, "FORBIDDEN");
    if (!("response" in result)) return startListAdminFailure(500, "INTERNAL_ERROR");
    return startListAdminJson(startListAdminListResponseSchema.parse(result.response));
  } catch {
    return startListAdminFailure(500, "INTERNAL_ERROR");
  }
}
