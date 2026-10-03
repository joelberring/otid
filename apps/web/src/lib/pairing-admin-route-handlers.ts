import {
  issuePairingGrantAsAdmin,
  listPairingGrantsAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession,
  revokePairingGrantAsAdmin
} from "@o-tid/application";
import {
  pairingAdminGrantIssueResponseSchema,
  pairingAdminGrantListResponseSchema,
  pairingAdminGrantRevokeResponseSchema,
  pairingAdminLoginRequestSchema,
  pairingAdminLoginResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  PairingAdminConfigurationError,
  clearPairingAdminCookies,
  hasExpectedPairingAdminOrigin,
  hasNoRequestBody,
  pairingAdminFailure,
  pairingAdminJson,
  pairingAdminSecurityPolicy,
  pairingAdminSessionProof,
  readPairingAdminJson,
  setPairingAdminCookies
} from "./pairing-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Logout = typeof logoutPairingAdminSession;
type Issue = typeof issuePairingGrantAsAdmin;
type List = typeof listPairingGrantsAsAdmin;
type Revoke = typeof revokePairingGrantAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: pairingAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof PairingAdminConfigurationError) return { response: pairingAdminFailure(503) } as const;
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

export async function pairingAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedPairingAdminOrigin(request, configured.policy)) return pairingAdminFailure(403);

  let body: unknown;
  try {
    body = await readPairingAdminJson(request);
  } catch {
    return pairingAdminFailure(400);
  }
  const parsed = pairingAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) return pairingAdminFailure(invalidLoginStatus(body));
  try {
    const result = await login(db, parsed.data, {
      expectedRaceId: raceId,
      expectedCapability: "PAIR_STATION"
    });
    if (result.status === "unauthorized") return pairingAdminFailure(401);
    const responseBody = pairingAdminLoginResponseSchema.parse(result.response);
    return setPairingAdminCookies(pairingAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: responseBody.expiresAt
    });
  } catch {
    return pairingAdminFailure(500);
  }
}

export async function pairingAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedPairingAdminOrigin(request, configured.policy)) return pairingAdminFailure(403);
  const proof = pairingAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "PAIR_STATION",
      readBodyIsEmpty: () => hasNoRequestBody(request)
    });
    if (result.status === "unauthorized") {
      return clearPairingAdminCookies(pairingAdminFailure(401), configured.policy);
    }
    if (result.status === "forbidden") return pairingAdminFailure(403);
    if (result.status === "invalid-request") return pairingAdminFailure(400);
    return clearPairingAdminCookies(new Response(null, {
      status: 204,
      headers: {
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff"
      }
    }), configured.policy);
  } catch {
    return pairingAdminFailure(500);
  }
}

export async function pairingAdminGrantListRoute(
  db: Database,
  request: Request,
  raceId: string,
  list: List = listPairingGrantsAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = pairingAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, {
      ...proof,
      raceId,
      capability: "PAIR_STATION"
    });
    if (result.status === "unauthorized") return pairingAdminFailure(401);
    if (result.status === "forbidden") return pairingAdminFailure(403);
    if (!("response" in result)) return pairingAdminFailure(500);
    return pairingAdminJson(pairingAdminGrantListResponseSchema.parse(result.response));
  } catch {
    return pairingAdminFailure(500);
  }
}

export async function pairingAdminGrantIssueRoute(
  db: Database,
  request: Request,
  raceId: string,
  issue: Issue = issuePairingGrantAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedPairingAdminOrigin(request, configured.policy)) return pairingAdminFailure(403);
  const proof = pairingAdminSessionProof(request, configured.policy, true);
  try {
    const result = await issue(db, {
      ...proof,
      raceId,
      capability: "PAIR_STATION",
      idempotencyKey: request.headers.get("idempotency-key"),
      readBody: () => readPairingAdminJson(request)
    });
    if (result.status === "unauthorized") return pairingAdminFailure(401);
    if (result.status === "forbidden") return pairingAdminFailure(403);
    if (result.status === "invalid-request") return pairingAdminFailure(400);
    if (result.status === "conflict") return pairingAdminFailure(409);
    if (!("response" in result)) return pairingAdminFailure(500);
    const responseBody = pairingAdminGrantIssueResponseSchema.parse(result.response);
    return pairingAdminJson(responseBody, result.status === "stored" ? 201 : 200);
  } catch {
    return pairingAdminFailure(500);
  }
}

export async function pairingAdminGrantRevokeRoute(
  db: Database,
  request: Request,
  raceId: string,
  grantId: string,
  revoke: Revoke = revokePairingGrantAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedPairingAdminOrigin(request, configured.policy)) return pairingAdminFailure(403);
  const proof = pairingAdminSessionProof(request, configured.policy, true);
  try {
    const result = await revoke(db, {
      ...proof,
      raceId,
      grantId,
      capability: "PAIR_STATION",
      readBodyIsEmpty: () => hasNoRequestBody(request)
    });
    if (result.status === "unauthorized") return pairingAdminFailure(401);
    if (result.status === "forbidden") return pairingAdminFailure(403);
    if (result.status === "invalid-request") return pairingAdminFailure(400);
    if (result.status === "not-found") return pairingAdminFailure(404);
    if (!("response" in result)) return pairingAdminFailure(500);
    return pairingAdminJson(pairingAdminGrantRevokeResponseSchema.parse(result.response));
  } catch {
    return pairingAdminFailure(500);
  }
}
