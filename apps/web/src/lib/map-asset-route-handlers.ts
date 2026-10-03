import {
  authenticatePairingAdminSession,
  publishMapAssetAsAdmin,
  readMapAssetStateAsAdmin,
  readStoredMapManifestAsAdmin,
  reserveMapAssetAsAdmin,
  transferMapAssetAsAdmin,
  withdrawMapAssetAsAdmin
} from "@o-tid/application";
import {
  adminMapAssetStateResponseSchema,
  mapAssetPublishRequestSchema,
  mapAssetReservationResponseSchema,
  mapAssetStorageReceiptSchema,
  mapAssetUploadRequestSchema,
  mapAssetWithdrawRequestSchema,
  mapAssetPublishResponseSchema,
  mapAssetWithdrawResponseSchema,
  mapObjectManifestSchema
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { createConfiguredMapStore } from "./map-store";
import { RACE_ADMINISTRATOR_LOOPBACK_COOKIES, RACE_ADMINISTRATOR_PRODUCTION_COOKIES } from "./race-administrator-cookies";
import {
  entryClassAdminFailure,
  entryClassAdminJson,
  entryClassAdminSecurityPolicy,
  entryClassAdminSessionProof,
  hasExpectedEntryClassAdminOrigin,
  hasNoEntryClassAdminRequestBody,
  privateEntryClassAdminHeaders,
  readEntryClassAdminJson
} from "./entry-class-admin-security";

const strictUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Environment = Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "O_TID_PUBLIC_ORIGIN">>;

function policy(environment: Environment) {
  const base = entryClassAdminSecurityPolicy(environment);
  return { ...base, cookieNames: base.secureCookies ? RACE_ADMINISTRATOR_PRODUCTION_COOKIES : RACE_ADMINISTRATOR_LOOPBACK_COOKIES };
}

function failure(status: 400 | 401 | 403 | 404 | 409 | 500) {
  return entryClassAdminFailure(status, status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" :
    status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR");
}

async function authorize(db: Database, request: Request, raceId: string, write: boolean, environment: Environment) {
  if (!strictUuid.test(raceId)) return { response: failure(400) } as const;
  let configured;
  try { configured = policy(environment); } catch { return { response: failure(500) } as const; }
  if (write && !hasExpectedEntryClassAdminOrigin(request, configured)) return { response: failure(403) } as const;
  const proof = entryClassAdminSessionProof(request, configured, write);
  const auth = await authenticatePairingAdminSession(db, { ...proof, raceId, capability: "MANAGE_RACE", requireCsrf: write });
  if (auth.status !== "authenticated") return { response: failure(auth.status === "forbidden" ? 403 : 401) } as const;
  return { proof } as const;
}

function idempotency(request: Request, prefix: string): string | null {
  const value = request.headers.get("idempotency-key");
  return value?.startsWith(prefix) ? value : null;
}

async function* requestBytes(request: Request, signal: AbortSignal): AsyncIterable<Uint8Array> {
  if (!request.body) return;
  const reader = request.body.getReader();
  const cancel = () => void reader.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
  }
}

/** Private MANAGE_RACE adapter. It deliberately has no object-store identifiers in responses. */
export async function mapAssetStateRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  const access = await authorize(db, request, raceId, false, environment);
  if ("response" in access) return access.response;
  if (!await hasNoEntryClassAdminRequestBody(request)) return failure(400);
  const result = await readMapAssetStateAsAdmin(db, { ...access.proof, raceId });
  if (result.status !== "ok") return failure(result.status === "not-found" ? 404 : result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : 400);
  return entryClassAdminJson(adminMapAssetStateResponseSchema.parse(result.response));
}

const previewHeaders = { ...privateEntryClassAdminHeaders, "cross-origin-resource-policy": "same-origin" } as const;

function previewFailure(status: 400 | 401 | 403 | 404 | 503): Response {
  const response = status === 503 ? entryClassAdminJson({ formatVersion: 1, error: "INTERNAL_ERROR" }, 503) : failure(status);
  response.headers.set("cross-origin-resource-policy", "same-origin");
  return response;
}

/** Private, exact-version candidate image. Publication state does not gate this protected read. */
export async function mapAssetPreviewRoute(db: Database, request: Request, raceId: string, uploadId: string, environment: Environment = process.env): Promise<Response> {
  if (!strictUuid.test(raceId) || !strictUuid.test(uploadId)) return previewFailure(400);
  try {
    const access = await authorize(db, request, raceId, false, environment);
    if ("response" in access) {
      access.response.headers.set("cross-origin-resource-policy", "same-origin");
      return access.response;
    }
    if (!await hasNoEntryClassAdminRequestBody(request)) return previewFailure(400);
    const input = { ...access.proof, raceId, uploadId };
    const first = await readStoredMapManifestAsAdmin(db, input);
    if (first.status !== "ok") return previewFailure(first.status === "invalid-request" ? 400 : first.status === "unauthorized" ? 401 : first.status === "forbidden" ? 403 : 404);
    const manifest = mapObjectManifestSchema.parse({ formatVersion: 1, storeId: first.manifest.storeId,
      key: first.manifest.objectKey, versionId: first.manifest.versionId, mediaType: first.manifest.mediaType,
      sha256: first.manifest.sha256, byteLength: first.manifest.byteLength });
    const bytes = await createConfiguredMapStore().read(manifest, request.signal);
    const second = await readStoredMapManifestAsAdmin(db, input);
    if (second.status !== "ok") return previewFailure(second.status === "unauthorized" ? 401 : second.status === "forbidden" ? 403 : second.status === "invalid-request" ? 400 : 404);
    const current = second.manifest;
    if (current.storeId !== first.manifest.storeId || current.objectKey !== first.manifest.objectKey ||
      current.versionId !== first.manifest.versionId || current.mediaType !== first.manifest.mediaType ||
      current.sha256 !== first.manifest.sha256 || current.byteLength !== first.manifest.byteLength) return previewFailure(503);
    return new Response(new Uint8Array(bytes), { headers: { ...previewHeaders,
      "content-type": manifest.mediaType, "content-length": String(bytes.byteLength) } });
  } catch { return previewFailure(503); }
}

export async function mapAssetReservationRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  const access = await authorize(db, request, raceId, true, environment);
  if ("response" in access) return access.response;
  let body: unknown;
  try { body = await readEntryClassAdminJson(request); } catch { return failure(400); }
  const parsed = mapAssetUploadRequestSchema.safeParse(body), key = idempotency(request, "map-upload:");
  if (!parsed.success || !key) return failure(400);
  const result = await reserveMapAssetAsAdmin(db, { ...access.proof, raceId, idempotencyKey: key, request: parsed.data });
  if (result.status === "reserved") return entryClassAdminJson(mapAssetReservationResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
  if (result.status === "conflict") return failure(409);
  if (result.status === "unauthorized" || result.status === "forbidden" || result.status === "invalid-request") return failure(result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : 400);
  return failure(500);
}

export async function mapAssetTransferRoute(db: Database, request: Request, raceId: string, uploadId: string, environment: Environment = process.env): Promise<Response> {
  const access = await authorize(db, request, raceId, true, environment);
  if ("response" in access) return access.response;
  if (!strictUuid.test(uploadId) || !["image/png", "image/jpeg"].includes(request.headers.get("content-type") ?? "")) return failure(400);
  let store;
  try { store = createConfiguredMapStore(); } catch { return entryClassAdminJson({ formatVersion: 1, error: "INTERNAL_ERROR" }, 503); }
  const result = await transferMapAssetAsAdmin(db, { ...access.proof, raceId, uploadId,
    readBody: (signal) => requestBytes(request, signal) }, store);
  if (result.status === "stored") return entryClassAdminJson(mapAssetStorageReceiptSchema.parse(result.response), result.response.replayed ? 200 : 201);
  if (result.status === "not-found") return failure(404);
  if (result.status === "unauthorized" || result.status === "forbidden" || result.status === "invalid-request" || result.status === "invalid-body") return failure(result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : 400);
  if (result.status === "quota-exceeded") return entryClassAdminJson({ formatVersion: 1, error: "INTERNAL_ERROR" }, 429);
  return entryClassAdminJson({ formatVersion: 1, error: "INTERNAL_ERROR" }, 503);
}

export async function mapAssetPublishRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  const access = await authorize(db, request, raceId, true, environment);
  if ("response" in access) return access.response;
  let body: unknown;
  try { body = await readEntryClassAdminJson(request); } catch { return failure(400); }
  const parsed = mapAssetPublishRequestSchema.safeParse(body), key = idempotency(request, "map-publish:");
  if (!parsed.success || !key) return failure(400);
  const result = await publishMapAssetAsAdmin(db, { ...access.proof, raceId, idempotencyKey: key, request: parsed.data });
  if (result.status === "published") return entryClassAdminJson(mapAssetPublishResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
  if (result.status === "not-found") return failure(404);
  if (result.status === "conflict") return failure(409);
  return failure(result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : 400);
}

export async function mapAssetWithdrawRoute(db: Database, request: Request, raceId: string, environment: Environment = process.env): Promise<Response> {
  const access = await authorize(db, request, raceId, true, environment);
  if ("response" in access) return access.response;
  let body: unknown;
  try { body = await readEntryClassAdminJson(request); } catch { return failure(400); }
  const parsed = mapAssetWithdrawRequestSchema.safeParse(body), key = idempotency(request, "map-withdraw:");
  if (!parsed.success || !key) return failure(400);
  const result = await withdrawMapAssetAsAdmin(db, { ...access.proof, raceId, idempotencyKey: key, request: parsed.data });
  if (result.status === "withdrawn") return entryClassAdminJson(mapAssetWithdrawResponseSchema.parse(result.response), result.response.replayed ? 200 : 201);
  if (result.status === "conflict") return failure(409);
  return failure(result.status === "forbidden" ? 403 : result.status === "unauthorized" ? 401 : 400);
}

export const mapAssetPrivateHeaders = privateEntryClassAdminHeaders;
