import { authenticatePairingAdminSession, readPublicParticipantRoutePublicationStateAsAdmin, releasePublicParticipantRouteAsAdmin, withdrawPublicParticipantRouteAsAdmin } from "@o-tid/application";
import { adminPublicParticipantRoutePublicationStateSchema, publicParticipantRouteReleaseIdempotencyKeySchema, publicParticipantRouteReleaseRequestSchema, publicParticipantRouteReleaseResponseSchema, publicParticipantRouteWithdrawIdempotencyKeySchema, publicParticipantRouteWithdrawRequestSchema, publicParticipantRouteWithdrawResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { RACE_ADMINISTRATOR_LOOPBACK_COOKIES, RACE_ADMINISTRATOR_PRODUCTION_COOKIES } from "./race-administrator-cookies";
import { entryClassAdminFailure, entryClassAdminJson, entryClassAdminSecurityPolicy, entryClassAdminSessionProof, hasExpectedEntryClassAdminOrigin, readEntryClassAdminJson } from "./entry-class-admin-security";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
function fail(status: 400 | 401 | 403 | 404 | 409 | 500) { return entryClassAdminFailure(status, status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR"); }
async function access(db: Database, request: Request, raceId: string, environment: Environment) {
  if (!uuid.test(raceId)) return { response: fail(400) } as const;
  try {
    const base = entryClassAdminSecurityPolicy(environment), policy = { ...base, cookieNames: base.secureCookies ? RACE_ADMINISTRATOR_PRODUCTION_COOKIES : RACE_ADMINISTRATOR_LOOPBACK_COOKIES };
    if (!hasExpectedEntryClassAdminOrigin(request, policy)) return { response: fail(403) } as const;
    const proof = entryClassAdminSessionProof(request, policy, true), auth = await authenticatePairingAdminSession(db, { ...proof, raceId, capability: "MANAGE_RACE", requireCsrf: true });
    return auth.status === "authenticated" ? { proof } as const : { response: fail(auth.status === "forbidden" ? 403 : 401) } as const;
  } catch { return { response: fail(500) } as const; }
}
export async function publicParticipantRoutePublicationStateRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  if (!uuid.test(raceId)) return fail(400);
  const routeUploadId = new URL(request.url).searchParams.get("routeUploadId"); if (!routeUploadId || !uuid.test(routeUploadId)) return fail(400);
  try {
    const base = entryClassAdminSecurityPolicy(environment), policy = { ...base, cookieNames: base.secureCookies ? RACE_ADMINISTRATOR_PRODUCTION_COOKIES : RACE_ADMINISTRATOR_LOOPBACK_COOKIES };
    const proof = entryClassAdminSessionProof(request, policy, false), result = await readPublicParticipantRoutePublicationStateAsAdmin(db, { ...proof, raceId, routeUploadId });
    return result.status === "ok" ? entryClassAdminJson(adminPublicParticipantRoutePublicationStateSchema.parse(result.response)) : fail(result.status === "not-found" ? 404 : result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : 400);
  } catch { return fail(500); }
}
export async function publicParticipantRouteReleaseRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  const authorized = await access(db, request, raceId, environment); if ("response" in authorized) return authorized.response;
  let body: unknown; try { body = await readEntryClassAdminJson(request); } catch { return fail(400); }
  const parsed = publicParticipantRouteReleaseRequestSchema.safeParse(body), key = publicParticipantRouteReleaseIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  if (!parsed.success || !key.success) return fail(400);
  const result = await releasePublicParticipantRouteAsAdmin(db, { ...authorized.proof, raceId, idempotencyKey: key.data, request: parsed.data });
  if (result.status === "released") return entryClassAdminJson(publicParticipantRouteReleaseResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
  return fail(result.status === "conflict" ? 409 : result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : 400);
}
export async function publicParticipantRouteWithdrawRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  const authorized = await access(db, request, raceId, environment); if ("response" in authorized) return authorized.response;
  let body: unknown; try { body = await readEntryClassAdminJson(request); } catch { return fail(400); }
  const parsed = publicParticipantRouteWithdrawRequestSchema.safeParse(body), key = publicParticipantRouteWithdrawIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  if (!parsed.success || !key.success) return fail(400);
  const result = await withdrawPublicParticipantRouteAsAdmin(db, { ...authorized.proof, raceId, idempotencyKey: key.data, request: parsed.data });
  if (result.status === "withdrawn") return entryClassAdminJson(publicParticipantRouteWithdrawResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
  return fail(result.status === "conflict" ? 409 : result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : 400);
}
