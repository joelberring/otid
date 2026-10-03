import { authenticatePairingAdminSession, listPrivateRoutePreviewCandidatesAsAdmin, readPrivateRoutePreviewAsAdmin, resolvePrivateRoutePreviewMapAsAdmin } from "@o-tid/application";
import { mapObjectManifestSchema, privateRoutePreviewCandidatesResponseSchema, privateRoutePreviewQuerySchema, privateRoutePreviewResponseSchema } from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { createConfiguredMapStore } from "./map-store";
import { RACE_ADMINISTRATOR_LOOPBACK_COOKIES, RACE_ADMINISTRATOR_PRODUCTION_COOKIES } from "./race-administrator-cookies";
import { entryClassAdminFailure, entryClassAdminJson, entryClassAdminSecurityPolicy, entryClassAdminSessionProof, hasNoEntryClassAdminRequestBody, privateEntryClassAdminHeaders } from "./entry-class-admin-security";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;
function fail(status: 400 | 401 | 403 | 404 | 500) { return entryClassAdminFailure(status, status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR"); }
async function access(db: Database, request: Request, raceId: string, environment: Environment) {
  if (!uuid.test(raceId)) return { response: fail(400) } as const;
  try {
    const base = entryClassAdminSecurityPolicy(environment);
    const policy = { ...base, cookieNames: base.secureCookies ? RACE_ADMINISTRATOR_PRODUCTION_COOKIES : RACE_ADMINISTRATOR_LOOPBACK_COOKIES };
    const proof = entryClassAdminSessionProof(request, policy, false);
    const auth = await authenticatePairingAdminSession(db, { ...proof, raceId, capability: "MANAGE_RACE", requireCsrf: false });
    return auth.status === "authenticated" ? { proof } as const : { response: fail(auth.status === "forbidden" ? 403 : 401) } as const;
  } catch { return { response: fail(500) } as const; }
}
function query(request: Request): unknown { const url = new URL(request.url); return { routeUploadId: url.searchParams.get("routeUploadId"), mapManifestId: url.searchParams.get("mapManifestId"), georeferenceId: url.searchParams.get("georeferenceId") }; }

export async function privateRoutePreviewCandidatesRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  const authorized = await access(db, request, raceId, environment); if ("response" in authorized || !await hasNoEntryClassAdminRequestBody(request)) return "response" in authorized ? authorized.response : fail(400);
  const result = await listPrivateRoutePreviewCandidatesAsAdmin(db, { ...authorized.proof, raceId });
  return result.status === "ok" ? entryClassAdminJson(privateRoutePreviewCandidatesResponseSchema.parse(result.response)) : fail(result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : result.status === "not-found" ? 404 : 400);
}
export async function privateRoutePreviewRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  const authorized = await access(db, request, raceId, environment); const parsed = privateRoutePreviewQuerySchema.safeParse(query(request));
  if ("response" in authorized || !await hasNoEntryClassAdminRequestBody(request) || !parsed.success) return "response" in authorized ? authorized.response : fail(400);
  const result = await readPrivateRoutePreviewAsAdmin(db, { ...authorized.proof, raceId, query: parsed.data });
  return result.status === "ok" ? entryClassAdminJson(privateRoutePreviewResponseSchema.parse(result.response)) : fail(result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : result.status === "not-found" ? 404 : 400);
}
export async function privateRoutePreviewMapRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  const authorized = await access(db, request, raceId, environment); const raw = query(request);
  const ids = privateRoutePreviewQuerySchema.pick({ mapManifestId: true, georeferenceId: true }).passthrough().safeParse(raw);
  if ("response" in authorized || !await hasNoEntryClassAdminRequestBody(request) || !ids.success) return "response" in authorized ? authorized.response : fail(400);
  const result = await resolvePrivateRoutePreviewMapAsAdmin(db, { ...authorized.proof, raceId, query: ids.data });
  if (result.status !== "ok") return fail(result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : result.status === "not-found" ? 404 : 400);
  try {
    const manifest = mapObjectManifestSchema.parse({ formatVersion: 1, storeId: result.response.storeId, key: result.response.objectKey, versionId: result.response.versionId, mediaType: result.response.mediaType, sha256: result.response.sha256, byteLength: result.response.byteLength });
    const bytes = await createConfiguredMapStore().read(manifest);
    return new Response(new Uint8Array(bytes), { headers: { ...privateEntryClassAdminHeaders, "content-type": manifest.mediaType, "content-length": String(bytes.byteLength) } });
  } catch { return fail(500); }
}
