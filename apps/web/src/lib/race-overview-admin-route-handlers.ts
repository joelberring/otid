import {
  authenticatePairingAdminSession,
  getRaceOverviewAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  raceOverviewAdminLoginRequestSchema,
  raceOverviewAdminLoginResponseSchema,
  raceOverviewResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  RaceOverviewAdminConfigurationError,
  clearRaceOverviewAdminCookies,
  hasExpectedRaceOverviewAdminOrigin,
  hasNoRaceOverviewAdminRequestBody,
  privateRaceOverviewAdminHeaders,
  raceOverviewAdminFailure,
  raceOverviewAdminJson,
  raceOverviewAdminSecurityPolicy,
  raceOverviewAdminSessionProof,
  readRaceOverviewAdminJson,
  setRaceOverviewAdminCookies
} from "./race-overview-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type GetOverview = typeof getRaceOverviewAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: raceOverviewAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof RaceOverviewAdminConfigurationError) {
      return { response: raceOverviewAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function raceOverviewAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedRaceOverviewAdminOrigin(request, configured.policy)) {
    return raceOverviewAdminFailure(403, "FORBIDDEN");
  }
  let body: unknown;
  try {
    body = await readRaceOverviewAdminJson(request);
  } catch {
    return raceOverviewAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = raceOverviewAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return raceOverviewAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, {
      expectedRaceId: raceId,
      expectedCapability: "VIEW_RACE_OVERVIEW"
    });
    if (result.status === "unauthorized") return raceOverviewAdminFailure(401, "UNAUTHORIZED");
    const responseBody = raceOverviewAdminLoginResponseSchema.parse(result.response);
    return setRaceOverviewAdminCookies(raceOverviewAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: responseBody.expiresAt
    });
  } catch {
    return raceOverviewAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function raceOverviewAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = raceOverviewAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "VIEW_RACE_OVERVIEW" });
    if (result.status === "unauthorized") return raceOverviewAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return raceOverviewAdminFailure(403, "FORBIDDEN");
    return raceOverviewAdminJson(raceOverviewAdminLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return raceOverviewAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function raceOverviewAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedRaceOverviewAdminOrigin(request, configured.policy)) {
    return raceOverviewAdminFailure(403, "FORBIDDEN");
  }
  const proof = raceOverviewAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "VIEW_RACE_OVERVIEW",
      readBodyIsEmpty: () => hasNoRaceOverviewAdminRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearRaceOverviewAdminCookies(
        raceOverviewAdminFailure(401, "UNAUTHORIZED"),
        configured.policy
      );
    }
    if (result.status === "forbidden") return raceOverviewAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return raceOverviewAdminFailure(400, "INVALID_REQUEST");
    return clearRaceOverviewAdminCookies(
      new Response(null, { status: 204, headers: privateRaceOverviewAdminHeaders }),
      configured.policy
    );
  } catch {
    return raceOverviewAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function raceOverviewAdminDataRoute(
  db: Database,
  request: Request,
  raceId: string,
  getOverview: GetOverview = getRaceOverviewAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = raceOverviewAdminSessionProof(request, configured.policy, false);
  try {
    const result = await getOverview(db, { sessionToken: proof.sessionToken, raceId });
    if (result.status === "unauthorized") return raceOverviewAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return raceOverviewAdminFailure(403, "FORBIDDEN");
    if (result.status === "not-found") return raceOverviewAdminFailure(404, "NOT_FOUND");
    if (!("response" in result)) return raceOverviewAdminFailure(500, "INTERNAL_ERROR");
    return raceOverviewAdminJson(raceOverviewResponseSchema.parse(result.response));
  } catch {
    return raceOverviewAdminFailure(500, "INTERNAL_ERROR");
  }
}
