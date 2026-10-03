import {
  authenticatePairingAdminSession,
  getReadoutHistoryAsAdmin,
  listReadoutHistoryAsAdmin,
  listEntryReadoutHistoryAsAdmin,
  loginPairingAdmin,
  logoutPairingAdminSession
} from "@o-tid/application";
import {
  readoutHistoryDetailQuerySchema,
  entryReadoutHistoryResponseSchema,
  readoutHistoryDetailResponseSchema,
  readoutHistoryListQuerySchema,
  readoutHistoryListResponseSchema,
  readoutResultHistoryAdminLoginRequestSchema,
  readoutResultHistoryAdminLoginResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import {
  ReadoutResultHistoryAdminConfigurationError,
  clearReadoutResultHistoryAdminCookies,
  hasExpectedReadoutResultHistoryAdminOrigin,
  hasNoReadoutResultHistoryAdminRequestBody,
  privateReadoutResultHistoryAdminHeaders,
  readoutResultHistoryAdminFailure,
  readoutResultHistoryAdminJson,
  readoutResultHistoryAdminSecurityPolicy,
  readoutResultHistoryAdminSessionProof,
  readReadoutResultHistoryAdminJson,
  setReadoutResultHistoryAdminCookies
} from "./readout-result-history-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;

function policyOrFailure(environment: Environment) {
  try { return { policy: readoutResultHistoryAdminSecurityPolicy(environment) } as const; } catch (error) {
    if (error instanceof ReadoutResultHistoryAdminConfigurationError) {
      return { response: readoutResultHistoryAdminFailure(500, "INTERNAL_ERROR") } as const;
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

export async function readoutResultHistoryAdminLoginRoute(
  db: Database, request: Request, raceId: string,
  login = loginPairingAdmin, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedReadoutResultHistoryAdminOrigin(request, configured.policy)) {
    return readoutResultHistoryAdminFailure(403, "FORBIDDEN");
  }
  let body: unknown;
  try { body = await readReadoutResultHistoryAdminJson(request); } catch {
    return readoutResultHistoryAdminFailure(400, "INVALID_REQUEST");
  }
  const parsed = readoutResultHistoryAdminLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    const status = invalidLoginStatus(body);
    return readoutResultHistoryAdminFailure(status, status === 401 ? "UNAUTHORIZED" : "INVALID_REQUEST");
  }
  try {
    const result = await login(db, parsed.data, {
      expectedRaceId: raceId,
      expectedCapability: "VIEW_READOUT_RESULT_HISTORY"
    });
    if (result.status === "unauthorized") return readoutResultHistoryAdminFailure(401, "UNAUTHORIZED");
    const response = readoutResultHistoryAdminLoginResponseSchema.parse(result.response);
    return setReadoutResultHistoryAdminCookies(readoutResultHistoryAdminJson(response), configured.policy, {
      sessionToken: result.sessionToken, csrfToken: result.csrfToken, expiresAt: response.expiresAt
    });
  } catch { return readoutResultHistoryAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function readoutResultHistoryAdminSessionStatusRoute(
  db: Database, request: Request, raceId: string,
  authenticate = authenticatePairingAdminSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const proof = readoutResultHistoryAdminSessionProof(request, configured.policy, false);
  try {
    const result = await authenticate(db, { ...proof, raceId, capability: "VIEW_READOUT_RESULT_HISTORY" });
    if (result.status === "unauthorized") return readoutResultHistoryAdminFailure(401, "UNAUTHORIZED");
    if (result.status === "forbidden") return readoutResultHistoryAdminFailure(403, "FORBIDDEN");
    return readoutResultHistoryAdminJson(readoutResultHistoryAdminLoginResponseSchema.parse({
      formatVersion: 1, raceId: result.principal.raceId,
      capability: result.principal.capability, expiresAt: result.principal.expiresAt
    }));
  } catch { return readoutResultHistoryAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function readoutResultHistoryAdminLogoutRoute(
  db: Database, request: Request, raceId: string,
  logout = logoutPairingAdminSession, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  if (!hasExpectedReadoutResultHistoryAdminOrigin(request, configured.policy)) {
    return readoutResultHistoryAdminFailure(403, "FORBIDDEN");
  }
  const proof = readoutResultHistoryAdminSessionProof(request, configured.policy, true);
  try {
    const result = await logout(db, {
      ...proof, raceId, capability: "VIEW_READOUT_RESULT_HISTORY",
      readBodyIsEmpty: () => hasNoReadoutResultHistoryAdminRequestBody(request)
    });
    if (result.status === "unauthorized") return clearReadoutResultHistoryAdminCookies(
      readoutResultHistoryAdminFailure(401, "UNAUTHORIZED"), configured.policy
    );
    if (result.status === "forbidden") return readoutResultHistoryAdminFailure(403, "FORBIDDEN");
    if (result.status === "invalid-request") return readoutResultHistoryAdminFailure(400, "INVALID_REQUEST");
    return clearReadoutResultHistoryAdminCookies(
      new Response(null, { status: 204, headers: privateReadoutResultHistoryAdminHeaders }), configured.policy
    );
  } catch { return readoutResultHistoryAdminFailure(500, "INTERNAL_ERROR"); }
}

function queryInput(request: Request): { cursor?: string; limit?: string } | undefined {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) if (key !== "cursor" && key !== "limit") return undefined;
  if (params.getAll("cursor").length > 1 || params.getAll("limit").length > 1) return undefined;
  const cursor = params.get("cursor");
  const limit = params.get("limit");
  return { ...(cursor === null ? {} : { cursor }), ...(limit === null ? {} : { limit }) };
}

function privateResultFailure(result: { status: string }): Response | undefined {
  if (result.status === "invalid-request") return readoutResultHistoryAdminFailure(400, "INVALID_REQUEST");
  if (result.status === "unauthorized") return readoutResultHistoryAdminFailure(401, "UNAUTHORIZED");
  if (result.status === "forbidden") return readoutResultHistoryAdminFailure(403, "FORBIDDEN");
  if (result.status === "not-found") return readoutResultHistoryAdminFailure(404, "NOT_FOUND");
  return undefined;
}

export async function readoutHistoryListRoute(
  db: Database, request: Request, raceId: string,
  list = listReadoutHistoryAsAdmin, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const rawQuery = queryInput(request);
  const query = rawQuery && readoutHistoryListQuerySchema.safeParse(rawQuery);
  if (!query || !query.success) return readoutResultHistoryAdminFailure(400, "INVALID_REQUEST");
  const proof = readoutResultHistoryAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, {
      sessionToken: proof.sessionToken, raceId, limit: query.data.limit,
      ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor })
    });
    const failure = privateResultFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return readoutResultHistoryAdminFailure(500, "INTERNAL_ERROR");
    return readoutResultHistoryAdminJson(readoutHistoryListResponseSchema.parse(result.response));
  } catch { return readoutResultHistoryAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function readoutHistoryDetailRoute(
  db: Database, request: Request, raceId: string, readoutId: string,
  getDetail = getReadoutHistoryAsAdmin, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const rawQuery = queryInput(request);
  const query = rawQuery && readoutHistoryDetailQuerySchema.safeParse(rawQuery);
  if (!query || !query.success) return readoutResultHistoryAdminFailure(400, "INVALID_REQUEST");
  const proof = readoutResultHistoryAdminSessionProof(request, configured.policy, false);
  try {
    const result = await getDetail(db, {
      sessionToken: proof.sessionToken, raceId, readoutId, limit: query.data.limit,
      ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor })
    });
    const failure = privateResultFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return readoutResultHistoryAdminFailure(500, "INTERNAL_ERROR");
    return readoutResultHistoryAdminJson(readoutHistoryDetailResponseSchema.parse(result.response));
  } catch { return readoutResultHistoryAdminFailure(500, "INTERNAL_ERROR"); }
}

export async function entryReadoutHistoryListRoute(
  db: Database, request: Request, raceId: string, entryId: string,
  list = listEntryReadoutHistoryAsAdmin, environment: Environment = process.env
): Promise<Response> {
  const configured = policyOrFailure(environment);
  if ("response" in configured) return configured.response;
  const rawQuery = queryInput(request);
  const query = rawQuery && readoutHistoryListQuerySchema.safeParse(rawQuery);
  if (!query || !query.success) return readoutResultHistoryAdminFailure(400, "INVALID_REQUEST");
  const proof = readoutResultHistoryAdminSessionProof(request, configured.policy, false);
  try {
    const result = await list(db, { sessionToken: proof.sessionToken, raceId, entryId, limit: query.data.limit,
      ...(query.data.cursor === undefined ? {} : { cursor: query.data.cursor }) });
    const failure = privateResultFailure(result);
    if (failure) return failure;
    if (!("response" in result)) return readoutResultHistoryAdminFailure(500, "INTERNAL_ERROR");
    const response = entryReadoutHistoryResponseSchema.parse(result.response);
    if (response.raceId !== raceId || response.entry.id !== entryId) return readoutResultHistoryAdminFailure(500, "INTERNAL_ERROR");
    return readoutResultHistoryAdminJson(response);
  } catch { return readoutResultHistoryAdminFailure(500, "INTERNAL_ERROR"); }
}
