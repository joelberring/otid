import {
  issueRouteUploadGrantAsAdmin,
  listRouteUploadGrantsAsAdmin,
  revokeRouteUploadGrantAsAdmin
} from "@o-tid/application";
import {
  routeUploadGrantIssueRequestSchema,
  routeUploadGrantIssueResponseSchema,
  routeUploadGrantListResponseSchema,
  routeUploadGrantRevokeRequestSchema,
  routeUploadGrantRevokeResponseSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { RACE_ADMINISTRATOR_LOOPBACK_COOKIES, RACE_ADMINISTRATOR_PRODUCTION_COOKIES } from "./race-administrator-cookies";
import {
  entryClassAdminFailure, entryClassAdminJson, entryClassAdminSecurityPolicy,
  entryClassAdminSessionProof, hasExpectedEntryClassAdminOrigin,
  hasNoEntryClassAdminRequestBody, readEntryClassAdminJson
} from "./entry-class-admin-security";

type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function security(environment: Environment) {
  const base = entryClassAdminSecurityPolicy(environment);
  return { ...base, cookieNames: base.secureCookies ? RACE_ADMINISTRATOR_PRODUCTION_COOKIES : RACE_ADMINISTRATOR_LOOPBACK_COOKIES };
}
function failure(status: 400 | 401 | 403 | 404 | 409 | 500) {
  return entryClassAdminFailure(status, status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" :
    status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR");
}
function configuration(environment: Environment) {
  try { return { policy: security(environment) } as const; }
  catch { return { response: failure(500) } as const; }
}

/** Private MANAGE_RACE grant history, separate from public results and participant upload endpoints. */
export async function routeUploadGrantListRoute(
  db: Database, request: Request, raceId: string,
  list: typeof listRouteUploadGrantsAsAdmin = listRouteUploadGrantsAsAdmin, environment: Environment = process.env
): Promise<Response> {
  if (!uuid.test(raceId)) return failure(400);
  const configured = configuration(environment); if ("response" in configured) return configured.response;
  if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400);
  const result = await list(db, { ...entryClassAdminSessionProof(request, configured.policy, false), raceId });
  if (result.status === "unauthorized") return failure(401);
  if (result.status === "forbidden") return failure(403);
  if (result.status !== "ok") return failure(500);
  return entryClassAdminJson(routeUploadGrantListResponseSchema.parse(result.response));
}

export async function routeUploadGrantIssueRoute(
  db: Database, request: Request, raceId: string,
  issue: typeof issueRouteUploadGrantAsAdmin = issueRouteUploadGrantAsAdmin, environment: Environment = process.env
): Promise<Response> {
  if (!uuid.test(raceId)) return failure(400);
  const configured = configuration(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedEntryClassAdminOrigin(request, configured.policy)) return failure(403);
  let body: unknown; try { body = await readEntryClassAdminJson(request); } catch { return failure(400); }
  const parsed = routeUploadGrantIssueRequestSchema.safeParse(body), key = request.headers.get("idempotency-key");
  if (!parsed.success || !key) return failure(400);
  const result = await issue(db, { ...entryClassAdminSessionProof(request, configured.policy, true), raceId, idempotencyKey: key, request: parsed.data });
  if (result.status === "unauthorized") return failure(401);
  if (result.status === "forbidden") return failure(403);
  if (result.status === "invalid-request") return failure(400);
  if (result.status === "conflict") return failure(409);
  if (result.status !== "issued") return failure(500);
  return entryClassAdminJson(routeUploadGrantIssueResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
}

export async function routeUploadGrantRevokeRoute(
  db: Database, request: Request, raceId: string, grantId: string,
  revoke: typeof revokeRouteUploadGrantAsAdmin = revokeRouteUploadGrantAsAdmin, environment: Environment = process.env
): Promise<Response> {
  if (!uuid.test(raceId) || !uuid.test(grantId)) return failure(400);
  const configured = configuration(environment); if ("response" in configured) return configured.response;
  if (!hasExpectedEntryClassAdminOrigin(request, configured.policy)) return failure(403);
  let body: unknown; try { body = await readEntryClassAdminJson(request); } catch { return failure(400); }
  const parsed = routeUploadGrantRevokeRequestSchema.safeParse(body), key = request.headers.get("idempotency-key");
  if (!parsed.success || parsed.data.grantId !== grantId || !key) return failure(400);
  const result = await revoke(db, { ...entryClassAdminSessionProof(request, configured.policy, true), raceId, idempotencyKey: key, request: parsed.data });
  if (result.status === "unauthorized") return failure(401);
  if (result.status === "forbidden") return failure(403);
  if (result.status === "invalid-request") return failure(400);
  if (result.status === "not-found") return failure(404);
  if (result.status === "conflict") return failure(409);
  if (result.status !== "revoked") return failure(500);
  return entryClassAdminJson(routeUploadGrantRevokeResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
}
