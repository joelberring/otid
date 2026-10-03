import { bindPrivateRouteContextAsAdmin, readPrivateRouteContextStateAsAdmin, readMyPrivateRouteOverlay, resolveMyPrivateRouteMap } from "@o-tid/application";
import { adminPrivateRouteContextStateResponseSchema, mapObjectManifestSchema, participantPrivateRouteOverlayResponseSchema, privateRouteContextBindIdempotencyKeySchema, privateRouteContextBindRequestSchema, privateRouteContextBindResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { createConfiguredMapStore } from "./map-store";
import { RACE_ADMINISTRATOR_LOOPBACK_COOKIES, RACE_ADMINISTRATOR_PRODUCTION_COOKIES } from "./race-administrator-cookies";
import { entryClassAdminFailure, entryClassAdminJson, entryClassAdminSecurityPolicy, entryClassAdminSessionProof, hasExpectedEntryClassAdminOrigin, hasNoEntryClassAdminRequestBody, readEntryClassAdminJson } from "./entry-class-admin-security";
import { organizerFailure, organizerJson, organizerSecurityPolicy, organizerSessionProof, hasNoOrganizerRequestBody } from "./organizer-account-security";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
function adminFailure(status: 400 | 401 | 403 | 404 | 409 | 500) { return entryClassAdminFailure(status, status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR"); }
function accountFailure(status: 400 | 401 | 403 | 404 | 409 | 500) { return organizerFailure(status, status === 401 || status === 404 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 400 ? "INVALID_REQUEST" : status === 409 ? "CONFLICT" : "INTERNAL_ERROR"); }

function adminPolicy(environment: Environment) {
  const base = entryClassAdminSecurityPolicy(environment);
  return { ...base, cookieNames: base.secureCookies ? RACE_ADMINISTRATOR_PRODUCTION_COOKIES : RACE_ADMINISTRATOR_LOOPBACK_COOKIES };
}

export async function privateRouteContextStateRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  if (!uuid.test(raceId)) return adminFailure(400);
  try {
    const policy = adminPolicy(environment), proof = entryClassAdminSessionProof(request, policy, false);
    if (!await hasNoEntryClassAdminRequestBody(request)) return adminFailure(400);
    const routeUploadId = new URL(request.url).searchParams.get("routeUploadId");
    if (!routeUploadId || !uuid.test(routeUploadId)) return adminFailure(400);
    const result = await readPrivateRouteContextStateAsAdmin(db, { ...proof, raceId, routeUploadId });
    return result.status === "ok" ? entryClassAdminJson(adminPrivateRouteContextStateResponseSchema.parse(result.response)) : adminFailure(result.status === "unauthorized" ? 401 : result.status === "forbidden" ? 403 : result.status === "not-found" ? 404 : 400);
  } catch { return adminFailure(500); }
}

export async function bindPrivateRouteContextRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  if (!uuid.test(raceId)) return adminFailure(400);
  try {
    const policy = adminPolicy(environment);
    if (!hasExpectedEntryClassAdminOrigin(request, policy)) return adminFailure(403);
    const proof = entryClassAdminSessionProof(request, policy, true);
    let body: unknown; try { body = await readEntryClassAdminJson(request); } catch { return adminFailure(400); }
    const parsed = privateRouteContextBindRequestSchema.safeParse(body), key = privateRouteContextBindIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!parsed.success || !key.success) return adminFailure(400);
    const result = await bindPrivateRouteContextAsAdmin(db, { ...proof, requireCsrf: true, raceId, idempotencyKey: key.data, request: parsed.data });
    if (result.status === "bound") return entryClassAdminJson(privateRouteContextBindResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
    return adminFailure(result.status === "unauthorized" ? 401 : result.status === "forbidden" ? 403 : result.status === "not-found" ? 404 : result.status === "conflict" ? 409 : 400);
  } catch { return adminFailure(500); }
}

function participantProof(request: Request, environment: Environment) {
  return organizerSessionProof(request, organizerSecurityPolicy(environment), false);
}

export async function participantPrivateRouteOverlayRoute(db: Database, request: Request, routeUploadId: string, environment: Environment = process.env): Promise<Response> {
  if (!uuid.test(routeUploadId)) return accountFailure(404);
  try {
    if (!await hasNoOrganizerRequestBody(request)) return accountFailure(400);
    const result = await readMyPrivateRouteOverlay(db, participantProof(request, environment), routeUploadId);
    if (result.status !== "ok") return accountFailure(result.status === "unauthorized" ? 401 : result.status === "forbidden" ? 403 : result.status === "not-found" ? 404 : 400);
    return organizerJson(participantPrivateRouteOverlayResponseSchema.parse(result.response));
  } catch { return accountFailure(500); }
}

export async function participantPrivateRouteMapRoute(db: Database, request: Request, routeUploadId: string, environment: Environment = process.env): Promise<Response> {
  if (!uuid.test(routeUploadId)) return accountFailure(404);
  try {
    if (!await hasNoOrganizerRequestBody(request)) return accountFailure(400);
    const revisionValues = new URL(request.url).searchParams.getAll("contextRevision");
    if (revisionValues.length !== 1 || !/^[1-9]\d*$/.test(revisionValues[0] ?? "")) return accountFailure(400);
    const expectedContextRevision = Number(revisionValues[0]);
    if (!Number.isSafeInteger(expectedContextRevision)) return accountFailure(400);
    const proof = participantProof(request, environment);
    const result = await resolveMyPrivateRouteMap(db, proof, routeUploadId, expectedContextRevision);
    if (result.status !== "ok") return accountFailure(result.status === "unauthorized" ? 401 : result.status === "forbidden" ? 403 : result.status === "not-found" ? 404 : 400);
    const manifest = mapObjectManifestSchema.parse({ formatVersion: 1, storeId: result.response.storeId, key: result.response.objectKey, versionId: result.response.versionId, mediaType: result.response.mediaType, sha256: result.response.sha256, byteLength: result.response.byteLength });
    const bytes = await createConfiguredMapStore().read(manifest, request.signal);
    const current = await resolveMyPrivateRouteMap(db, proof, routeUploadId, expectedContextRevision);
    if (current.status !== "ok" || current.response.uploadId !== result.response.uploadId || current.response.versionId !== result.response.versionId || current.response.sha256 !== result.response.sha256) return accountFailure(404);
    return new Response(new Uint8Array(bytes), { headers: { "cache-control": "private, no-store", "content-security-policy": "default-src 'none'; frame-ancestors 'none'", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-type": manifest.mediaType, "content-length": String(bytes.byteLength) } });
  } catch { return accountFailure(404); }
}
