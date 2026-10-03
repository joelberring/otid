import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  canonicalJsonBytes,
  mapAssetPublishIdempotencyKeySchema, mapAssetPublishRequestSchema, mapAssetPublishResponseSchema,
  mapAssetReservationResponseSchema, mapAssetStorageReceiptSchema, mapAssetUploadIdempotencyKeySchema,
  mapAssetUploadRequestSchema, mapAssetWithdrawIdempotencyKeySchema, mapAssetWithdrawRequestSchema,
  mapAssetWithdrawResponseSchema, mapObjectManifestSchema, publicMapMetadataSchema, type PublicMapMetadata,
  adminMapAssetStateResponseSchema, type AdminMapAssetStateResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { authenticatePairingAdminSessionForMutation, authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { lockRaceForMutation } from "./concurrency";

type Auth = Omit<PairingAdminRequestAuthentication, "capability">;
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAP_UPLOAD_BODY_DEADLINE_MS = 60_000;

function sameIntent(stored: unknown, expected: unknown): boolean {
  try { return Buffer.from(canonicalJsonBytes(stored)).equals(Buffer.from(canonicalJsonBytes(expected))); }
  catch { return false; }
}

export type ActiveMapPublication = {
  publication: typeof schema.mapPublications.$inferSelect;
  manifest: typeof schema.mapObjectManifests.$inferSelect;
  reservation: typeof schema.mapUploadReservations.$inferSelect;
};

/** Resolve only the latest exact manifest; withdrawals and incomplete chains fail closed. */
export async function readActiveMapPublication(db: Database, raceId: string): Promise<ActiveMapPublication | null> {
  if (!uuid.test(raceId)) return null;
  const [publication] = await db.select().from(schema.mapPublications)
    .where(eq(schema.mapPublications.raceId, raceId)).orderBy(desc(schema.mapPublications.revision)).limit(1);
  if (!publication || publication.action !== "PUBLISH" || !publication.manifestId) return null;
  const [manifest] = await db.select().from(schema.mapObjectManifests)
    .where(and(eq(schema.mapObjectManifests.uploadId, publication.manifestId), eq(schema.mapObjectManifests.raceId, raceId)));
  if (!manifest || manifest.sha256 !== publication.sourceHash) return null;
  const [reservation] = await db.select().from(schema.mapUploadReservations)
    .where(and(eq(schema.mapUploadReservations.id, manifest.uploadId), eq(schema.mapUploadReservations.raceId, raceId)));
  if (!reservation || reservation.mediaType !== manifest.mediaType || reservation.sha256 !== manifest.sha256 || reservation.byteLength !== manifest.byteLength) return null;
  return { publication, manifest, reservation };
}

/** Public projection contains no storage identifiers or internal UUIDs. */
export async function readPublicMapMetadata(db: Database, raceId: string): Promise<{ status: "ok"; metadata: PublicMapMetadata } | { status: "not-found" }> {
  const active = await readActiveMapPublication(db, raceId);
  if (!active) return { status: "not-found" };
  return { status: "ok", metadata: publicMapMetadataSchema.parse({ formatVersion: 1, title: active.reservation.title,
    mediaType: active.manifest.mediaType, byteLength: active.manifest.byteLength, sha256: active.manifest.sha256,
    publishedAt: active.publication.decidedAt.toISOString() }) };
}

export type AdminMapAssetStateResult =
  | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" }
  | { status: "ok"; response: AdminMapAssetStateResponse };

export async function readMapAssetStateAsAdmin(db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf">,
  now = new Date()
): Promise<AdminMapAssetStateResult> {
  if (!uuid.test(input.raceId) || !Number.isFinite(now.getTime())) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      sessionToken: input.sessionToken, raceId: input.raceId, capability
    }, now);
    if (authorization.status !== "authenticated") return authorization;
    const raceId = authorization.principal.raceId;
    const [latest] = await tx.select().from(schema.mapPublications).where(eq(schema.mapPublications.raceId, raceId))
      .orderBy(desc(schema.mapPublications.revision)).limit(1);
    const manifests = await tx.select({ manifest: schema.mapObjectManifests, reservation: schema.mapUploadReservations })
      .from(schema.mapObjectManifests).innerJoin(schema.mapUploadReservations, eq(schema.mapUploadReservations.id, schema.mapObjectManifests.uploadId))
      .where(eq(schema.mapObjectManifests.raceId, raceId)).orderBy(desc(schema.mapObjectManifests.storedAt)).limit(100);
    const active = latest?.action === "PUBLISH" && latest.manifestId ? manifests.find(row => row.manifest.uploadId === latest.manifestId) : undefined;
    return { status: "ok", response: adminMapAssetStateResponseSchema.parse({ formatVersion: 1, raceId,
      latestPublicationRevision: latest?.revision ?? 0,
      activePublication: active && latest ? { publicationId: latest.id, revision: latest.revision, uploadId: active.manifest.uploadId,
        title: active.reservation.title, mediaType: active.manifest.mediaType, sha256: active.manifest.sha256,
        byteLength: active.manifest.byteLength, publishedAt: latest.decidedAt.toISOString() } : null,
      storedCandidates: manifests.map(row => ({ uploadId: row.manifest.uploadId, title: row.reservation.title,
        mediaType: row.manifest.mediaType, sha256: row.manifest.sha256, byteLength: row.manifest.byteLength,
        storedAt: row.manifest.storedAt.toISOString() })) }) };
  });
}

/** Resolve one stored candidate for a protected byte read; never expose this manifest to a client. */
export async function readStoredMapManifestAsAdmin(db: Database,
  input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf"> & { uploadId: string },
  now = new Date()
): Promise<
  | { status: "ok"; manifest: typeof schema.mapObjectManifests.$inferSelect }
  | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" }
> {
  if (!uuid.test(input.raceId) || !uuid.test(input.uploadId) || !Number.isFinite(now.getTime())) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const authorization = await authenticatePairingAdminSessionForProtectedRead(tx, {
      sessionToken: input.sessionToken, raceId: input.raceId, capability
    }, now);
    if (authorization.status !== "authenticated") return authorization;
    const [stored] = await tx.select({ manifest: schema.mapObjectManifests, reservation: schema.mapUploadReservations })
      .from(schema.mapObjectManifests)
      .innerJoin(schema.mapUploadReservations, and(
        eq(schema.mapUploadReservations.id, schema.mapObjectManifests.uploadId),
        eq(schema.mapUploadReservations.raceId, schema.mapObjectManifests.raceId)
      ))
      .where(and(
        eq(schema.mapObjectManifests.uploadId, input.uploadId),
        eq(schema.mapObjectManifests.raceId, authorization.principal.raceId)
      ));
    if (!stored || stored.reservation.mediaType !== stored.manifest.mediaType ||
      stored.reservation.sha256 !== stored.manifest.sha256 ||
      stored.reservation.byteLength !== stored.manifest.byteLength) return { status: "not-found" };
    return { status: "ok", manifest: stored.manifest };
  });
}

function reservationResponse(row: typeof schema.mapUploadReservations.$inferSelect, replayed: boolean) {
  return mapAssetReservationResponseSchema.parse({ formatVersion: 1, uploadId: row.id, requestId: row.requestId,
    raceId: row.raceId, reservedAt: row.reservedAt.toISOString(), replayed });
}
function storageResponse(row: typeof schema.mapObjectManifests.$inferSelect, replayed: boolean) {
  return mapAssetStorageReceiptSchema.parse({ formatVersion: 1, uploadId: row.uploadId, raceId: row.raceId,
    storedAt: row.storedAt.toISOString(), replayed });
}

export async function reserveMapAssetAsAdmin(db: Database, input: Auth & { idempotencyKey: string | null; request: unknown }, now = new Date()) {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const key = mapAssetUploadIdempotencyKeySchema.safeParse(input.idempotencyKey);
    const request = mapAssetUploadRequestSchema.safeParse(input.request);
    if (!key.success || !request.success || !uuid.test(input.raceId)) return { status: "invalid-request" as const };
    await lockRaceForMutation(tx, input.raceId);
    const requestId = key.data.slice("map-upload:".length), intent = request.data;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.mapUploadReservations).where(eq(schema.mapUploadReservations.requestId, requestId));
    if (existing) {
      if (existing.raceId !== input.raceId || existing.actorCredentialId !== auth.principal.accessCredentialId ||
        existing.title !== intent.title || existing.mediaType !== intent.mediaType || existing.sha256 !== intent.sha256 || existing.byteLength !== intent.byteLength) return { status: "conflict" as const };
      return { status: "reserved" as const, response: reservationResponse(existing, true) };
    }
    const rows = await tx.select({ slot: schema.mapUploadReservations.slot }).from(schema.mapUploadReservations).where(eq(schema.mapUploadReservations.raceId, input.raceId));
    const used = new Set(rows.map(row => row.slot)); let slot = 1; while (used.has(slot) && slot <= 100) slot++;
    if (slot > 100) return { status: "quota-exceeded" as const };
    const [saved] = await tx.insert(schema.mapUploadReservations).values({ id: randomUUID(), requestId, raceId: input.raceId,
      actorCredentialId: auth.principal.accessCredentialId, capability, slot, title: intent.title, mediaType: intent.mediaType,
      sha256: intent.sha256, byteLength: intent.byteLength, reservedAt: now }).returning();
    if (!saved) throw new Error("MAP_RESERVATION_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "map_upload", entityId: saved.id,
      action: "MAP_UPLOAD_RESERVED", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      requestId, after: { capability, mediaType: saved.mediaType, byteLength: saved.byteLength, sha256: saved.sha256 } });
    return { status: "reserved" as const, response: reservationResponse(saved, false) };
  });
}

export async function allocateMapUploadAttemptAsAdmin(db: Database, input: Auth & { uploadId: string }, now = new Date()) {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    if (!uuid.test(input.raceId) || !uuid.test(input.uploadId)) return { status: "invalid-request" as const };
    await lockRaceForMutation(tx, input.raceId);
    const [reservation] = await tx.select().from(schema.mapUploadReservations).where(and(eq(schema.mapUploadReservations.id, input.uploadId), eq(schema.mapUploadReservations.raceId, input.raceId), eq(schema.mapUploadReservations.actorCredentialId, auth.principal.accessCredentialId)));
    if (!reservation) return { status: "not-found" as const };
    const [manifest] = await tx.select().from(schema.mapObjectManifests).where(eq(schema.mapObjectManifests.uploadId, input.uploadId));
    if (manifest) return { status: "already-stored" as const, manifest };
    const attempts = await tx.select({ attemptNumber: schema.mapUploadAttempts.attemptNumber }).from(schema.mapUploadAttempts).where(eq(schema.mapUploadAttempts.uploadId, input.uploadId));
    const used = new Set(attempts.map(row => row.attemptNumber)); let attemptNumber = 1; while (used.has(attemptNumber) && attemptNumber <= 8) attemptNumber++;
    if (attemptNumber > 8) return { status: "quota-exceeded" as const };
    const [attempt] = await tx.insert(schema.mapUploadAttempts).values({ id: randomUUID(), uploadId: reservation.id, raceId: input.raceId, attemptNumber,
      mediaType: reservation.mediaType, sha256: reservation.sha256, byteLength: reservation.byteLength, chargedAt: now }).returning();
    if (!attempt) throw new Error("MAP_ATTEMPT_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "map_upload_attempt", entityId: attempt.id,
      action: "MAP_UPLOAD_ATTEMPT_CHARGED", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      requestId: reservation.requestId, after: { capability, uploadId: reservation.id, attemptNumber, byteLength: attempt.byteLength } });
    return { status: "allocated" as const, attempt };
  });
}

export interface MapUploadObjectStore {
  put(input: { raceId: string; attemptId: string; sha256: string; byteLength: number; mediaType: string }, bytes: Uint8Array): Promise<unknown>;
}

export async function transferMapAssetAsAdmin(db: Database, input: Auth & { uploadId: string; readBody: (signal: AbortSignal) => AsyncIterable<Uint8Array> }, store: MapUploadObjectStore, now = () => new Date()) {
  const allocation = await allocateMapUploadAttemptAsAdmin(db, input, now());
  if (allocation.status === "already-stored") return { status: "stored" as const, response: storageResponse(allocation.manifest, true) };
  if (allocation.status !== "allocated") return allocation;
  const { attempt } = allocation;
  const parts: Uint8Array[] = []; let size = 0;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), MAP_UPLOAD_BODY_DEADLINE_MS);
  try {
    for await (const part of input.readBody(controller.signal)) { if (!(part instanceof Uint8Array) || size + part.byteLength > attempt.byteLength) return { status: "invalid-body" as const }; parts.push(part); size += part.byteLength; }
  } catch { return { status: "invalid-body" as const }; } finally { clearTimeout(deadline); controller.abort(); }
  if (size !== attempt.byteLength) return { status: "invalid-body" as const };
  const bytes = Buffer.concat(parts.map(part => Buffer.from(part)));
  if (createHash("sha256").update(bytes).digest("hex") !== attempt.sha256) return { status: "invalid-body" as const };
  let parsed;
  try { parsed = mapObjectManifestSchema.parse(await store.put({ raceId: attempt.raceId, attemptId: attempt.id, sha256: attempt.sha256, byteLength: attempt.byteLength, mediaType: attempt.mediaType }, bytes)); } catch { return { status: "storage-unavailable" as const }; }
  if (parsed.key !== `map/${attempt.raceId}/${attempt.id}` || parsed.mediaType !== attempt.mediaType || parsed.sha256 !== attempt.sha256 || parsed.byteLength !== attempt.byteLength) return { status: "storage-unavailable" as const };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now());
    if (auth.status !== "authenticated") return auth;
    await lockRaceForMutation(tx, input.raceId);
    const [existing] = await tx.select().from(schema.mapObjectManifests).where(eq(schema.mapObjectManifests.uploadId, input.uploadId));
    if (existing) return { status: "stored" as const, response: storageResponse(existing, true) };
    const [saved] = await tx.insert(schema.mapObjectManifests).values({ uploadId: input.uploadId, attemptId: attempt.id, raceId: input.raceId, storeId: parsed.storeId, objectKey: parsed.key, versionId: parsed.versionId, mediaType: parsed.mediaType, sha256: parsed.sha256, byteLength: parsed.byteLength, storedAt: now() }).returning();
    if (!saved) throw new Error("MAP_MANIFEST_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "map_upload", entityId: saved.uploadId,
      action: "MAP_UPLOAD_STORED", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      requestId: (await tx.select({ requestId: schema.mapUploadReservations.requestId }).from(schema.mapUploadReservations).where(eq(schema.mapUploadReservations.id, saved.uploadId)).limit(1))[0]?.requestId ?? input.uploadId,
      after: { capability, attemptId: attempt.id, mediaType: saved.mediaType, byteLength: saved.byteLength, sha256: saved.sha256 } });
    return { status: "stored" as const, response: storageResponse(saved, false) };
  });
}

export async function publishMapAssetAsAdmin(db: Database, input: Auth & { idempotencyKey: string | null; request: unknown }, now = new Date()) {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const key = mapAssetPublishIdempotencyKeySchema.safeParse(input.idempotencyKey), request = mapAssetPublishRequestSchema.safeParse(input.request);
    if (!key.success || !request.success || !uuid.test(input.raceId)) return { status: "invalid-request" as const };
    await lockRaceForMutation(tx, input.raceId); const requestId = key.data.slice("map-publish:".length);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [prior] = await tx.select().from(schema.mapPublications).where(eq(schema.mapPublications.requestId, requestId));
    if (prior) { if (prior.raceId !== input.raceId || prior.actorCredentialId !== auth.principal.accessCredentialId || prior.action !== "PUBLISH" || prior.manifestId !== request.data.uploadId || !sameIntent(prior.intent, request.data)) return { status: "conflict" as const }; return { status: "published" as const, response: mapAssetPublishResponseSchema.parse({ formatVersion: 1, publicationId: prior.id, requestId: prior.requestId, raceId: prior.raceId, revision: prior.revision, action: "PUBLISH", manifestId: prior.manifestId, sourceHash: prior.sourceHash, decidedAt: prior.decidedAt.toISOString(), replayed: true }) }; }
    const [manifest] = await tx.select().from(schema.mapObjectManifests).where(and(eq(schema.mapObjectManifests.uploadId, request.data.uploadId), eq(schema.mapObjectManifests.raceId, input.raceId)));
    if (!manifest) return { status: "not-found" as const };
    const [latest] = await tx.select().from(schema.mapPublications).where(eq(schema.mapPublications.raceId, input.raceId)).orderBy(desc(schema.mapPublications.revision)).limit(1);
    const expected = request.data.expectedPublicationRevision; if ((latest?.revision ?? 0) !== expected) return { status: "conflict" as const };
    const revision = expected + 1, [saved] = await tx.insert(schema.mapPublications).values({ requestId, raceId: input.raceId, actorCredentialId: auth.principal.accessCredentialId, capability, revision, action: "PUBLISH", manifestId: manifest.uploadId, sourceHash: manifest.sha256, intent: request.data, decidedAt: now }).returning();
    if (!saved) throw new Error("MAP_PUBLICATION_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "map_publication", entityId: saved.id,
      action: "MAP_PUBLISHED", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      requestId, after: { capability, revision: saved.revision, manifestId: saved.manifestId, sourceHash: saved.sourceHash } });
    return { status: "published" as const, response: mapAssetPublishResponseSchema.parse({ formatVersion: 1, publicationId: saved.id, requestId, raceId: saved.raceId, revision, action: "PUBLISH", manifestId: saved.manifestId, sourceHash: saved.sourceHash, decidedAt: saved.decidedAt.toISOString(), replayed: false }) };
  });
}

export async function withdrawMapAssetAsAdmin(db: Database, input: Auth & { idempotencyKey: string | null; request: unknown }, now = new Date()) {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now); if (auth.status !== "authenticated") return auth;
    const key = mapAssetWithdrawIdempotencyKeySchema.safeParse(input.idempotencyKey), request = mapAssetWithdrawRequestSchema.safeParse(input.request); if (!key.success || !request.success || !uuid.test(input.raceId)) return { status: "invalid-request" as const };
    await lockRaceForMutation(tx, input.raceId); const requestId = key.data.slice("map-withdraw:".length);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [replayed] = await tx.select().from(schema.mapPublications).where(eq(schema.mapPublications.requestId, requestId));
    if (replayed) { if (replayed.raceId !== input.raceId || replayed.actorCredentialId !== auth.principal.accessCredentialId || replayed.action !== "WITHDRAW" || replayed.revision !== request.data.expectedPublicationRevision + 1 || !sameIntent(replayed.intent, request.data)) return { status: "conflict" as const }; return { status: "withdrawn" as const, response: mapAssetWithdrawResponseSchema.parse({ formatVersion: 1, publicationId: replayed.id, requestId, raceId: replayed.raceId, revision: replayed.revision, action: "WITHDRAW", decidedAt: replayed.decidedAt.toISOString(), replayed: true }) }; }
    const [latest] = await tx.select().from(schema.mapPublications).where(eq(schema.mapPublications.raceId, input.raceId)).orderBy(desc(schema.mapPublications.revision)).limit(1); if (!latest || latest.action !== "PUBLISH" || latest.id !== request.data.publicationId || latest.revision !== request.data.expectedPublicationRevision) return { status: "conflict" as const };
    const [saved] = await tx.insert(schema.mapPublications).values({ requestId, raceId: input.raceId, actorCredentialId: auth.principal.accessCredentialId, capability, revision: latest.revision + 1, action: "WITHDRAW", intent: request.data, decidedAt: now }).returning(); if (!saved) throw new Error("MAP_WITHDRAWAL_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "map_publication", entityId: saved.id,
      action: "MAP_WITHDRAWN", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId,
      requestId, after: { capability, revision: saved.revision, publicationId: request.data.publicationId } });
    return { status: "withdrawn" as const, response: mapAssetWithdrawResponseSchema.parse({ formatVersion: 1, publicationId: saved.id, requestId, raceId: saved.raceId, revision: saved.revision, action: "WITHDRAW", decidedAt: saved.decidedAt.toISOString(), replayed: false }) };
  });
}
