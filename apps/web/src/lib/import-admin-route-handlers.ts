import {
  authenticatePairingAdminSession,
  importIofXmlAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  iofImportIdempotencyKeySchema,
  iofImportLoginRequestSchema,
  iofImportLoginResponseSchema,
  iofImportResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  ImportAdminConfigurationError,
  clearImportAdminCookies,
  hasExpectedImportAdminOrigin,
  hasNoImportAdminRequestBody,
  importAdminFailure,
  importAdminJson,
  importAdminSecurityPolicy,
  importAdminSessionProof,
  privateImportAdminHeaders,
  readImportAdminJson,
  readIofImportBody,
  setImportAdminCookies
} from "./import-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
type Login = typeof loginPairingAdmin;
type Authenticate = typeof authenticatePairingAdminSession;
type Logout = typeof logoutPairingAdminSession;
type Import = typeof importIofXmlAsAdmin;

function policyOrFailure(environment: Environment) {
  try {
    return { policy: importAdminSecurityPolicy(environment) } as const;
  } catch (error) {
    if (error instanceof ImportAdminConfigurationError) {
      return { response: importAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function importAdminLoginRoute(
  db: Database,
  request: Request,
  raceId: string,
  login: Login = loginPairingAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedImportAdminOrigin(request, configured.policy)) return importAdminFailure(403, "FORBIDDEN");
  let body: unknown;
  try {
    body = await readImportAdminJson(request);
  } catch {
    return importAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = iofImportLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return importAdminFailure(invalidLoginStatus(body), invalidLoginStatus(body) === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, { expectedRaceId: raceId, expectedCapability: "IMPORT_IOF" });
    if (result.status === "unauthorized") return importAdminFailure(401, "UNAUTHORIZED");
    const responseBody = iofImportLoginResponseSchema.parse(result.response);
    return setImportAdminCookies(importAdminJson(responseBody), configured.policy, {
      sessionToken: result.sessionToken,
      csrfToken: result.csrfToken,
      expiresAt: responseBody.expiresAt
    });
  } catch {
    return importAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function importAdminSessionStatusRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = importAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "IMPORT_IOF" });
    if (result.status === "unauthorized") return importAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return importAdminFailure(403, "FORBIDDEN");
    return importAdminJson(iofImportLoginResponseSchema.parse({
      formatVersion: 1,
      raceId: result.principal.raceId,
      capability: result.principal.capability,
      expiresAt: result.principal.expiresAt
    }));
  } catch {
    return importAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function importAdminLogoutRoute(
  db: Database,
  request: Request,
  raceId: string,
  logout: Logout = logoutPairingAdminSession,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedImportAdminOrigin(request, configured.policy)) return importAdminFailure(403, "FORBIDDEN");
  const proof = importAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof,
      raceId,
      capability: "IMPORT_IOF",
      readBodyIsEmpty: () => hasNoImportAdminRequestBody(request)
    });
    if (result.status === "unauthorized") return clearImportAdminCookies(importAdminFailure(401, "UNAUTHORIZED"), configured.policy);
    if (result.status === "forbidden") return importAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return importAdminFailure(400, "INVALID_REQUEST");
    return clearImportAdminCookies(new Response(null, { status: 204, headers: privateImportAdminHeaders }), configured.policy);
  } catch {
    return importAdminFailure(500, "INTERNAL_ERROR");
  }
}

export async function authenticatedIofImportRoute(
  db: Database,
  request: Request,
  raceId: string,
  authenticate: Authenticate = authenticatePairingAdminSession,
  runImport: Import = importIofXmlAsAdmin,
  environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedImportAdminOrigin(request, configured.policy)) return importAdminFailure(403, "FORBIDDEN");
  const proof = importAdminSessionProof(request, configured.policy, true);

  try {
    const authorization = await authenticate(db, {
      ...proof,
      raceId,
      capability: "IMPORT_IOF",
      requireCsrf: true
    });
    if (authorization.status === "unauthorized") return importAdminFailure(401, "UNAUTHORIZED");
    if (authorization.status === "forbidden") return importAdminFailure(403, "FORBIDDEN");
  } catch {
    return importAdminFailure(500, "INTERNAL_ERROR");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!iofImportIdempotencyKeySchema.safeParse(idempotencyKey).success) {
    return importAdminFailure(400, "INVALID_REQUEST");
  }
  let xmlBytes: Uint8Array;
  try {
    ({ bytes: xmlBytes } = await readIofImportBody(request));
  } catch {
    return importAdminFailure(400, "INVALID_REQUEST");
  }

  try {
    const result = await runImport(db, { ...proof, raceId, idempotencyKey, xmlBytes });
    if (result.status === "unauthorized") return importAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return importAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return importAdminFailure(400, "INVALID_REQUEST");
    if (result.status === "invalid-iof-xml") return importAdminFailure(422, "INVALID_IOF_XML");
    if (result.status === "conflict") return importAdminFailure(409, "CONFLICT");
    if (!("response" in result)) return importAdminFailure(500, "INTERNAL_ERROR");
    return importAdminJson(iofImportResponseSchema.parse(result.response), result.status === "stored" ? 201 : 200);
  } catch {
    return importAdminFailure(500, "INTERNAL_ERROR");
  }
}
