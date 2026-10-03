import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  routeObjectManifestSchema,
  routeUploadIdempotencyKeySchema,
  routeUploadReservationRequestSchema,
  routeUploadReservationResponseSchema,
  routeUploadStatusResponseSchema,
  routeUploadStorageReceiptSchema
} from "@o-tid/contracts";
import { GpxValidationError, parseGpxTrack } from "@o-tid/route-xml";
import { schema, type Database } from "@o-tid/database";
import { lockEntryForRevision } from "./concurrency";
import {
  authenticateRouteUploadSessionForMutation,
  authenticateRouteUploadSessionForRead,
  type RouteUploadSessionRequestAuthentication
} from "./route-upload-session";

const bodyDeadlineMs = 60_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Authentication = RouteUploadSessionRequestAuthentication;

export interface RouteUploadObjectStore {
  put(input: { raceId: string; attemptId: string; sha256: string; byteLength: number; mediaType: "application/gpx+xml" }, bytes: Uint8Array): Promise<unknown>;
}

function reservationResponse(row: typeof schema.routeUploadReservations.$inferSelect, replayed: boolean) {
  return routeUploadReservationResponseSchema.parse({ formatVersion: 1, uploadId: row.id, requestId: row.requestId,
    grantId: row.grantId, reservedAt: row.reservedAt.toISOString(), replayed });
}

function receipt(row: typeof schema.routeObjectManifests.$inferSelect, replayed: boolean) {
  return routeUploadStorageReceiptSchema.parse({ formatVersion: 1, uploadId: row.uploadId, storedAt: row.storedAt.toISOString(),
    pointCount: row.pointCount, segmentCount: row.segmentCount, firstRecordedAt: row.firstRecordedAt?.toISOString() ?? null,
    lastRecordedAt: row.lastRecordedAt?.toISOString() ?? null, replayed });
}

/**
 * Reads only a participant-safe receipt. The authenticated grant is the whole
 * lookup scope; client-supplied upload IDs are intentionally absent.
 */
export async function readRouteUploadStatusAsParticipant(
  db: Database,
  input: Authentication,
  now = new Date()
) {
  return db.transaction(async tx => {
    const auth = await authenticateRouteUploadSessionForRead(tx, { ...input, requireCsrf: false }, now);
    if (auth.status !== "authenticated") return auth;
    const [manifest] = await tx.select({
      storedAt: schema.routeObjectManifests.storedAt,
      pointCount: schema.routeObjectManifests.pointCount,
      segmentCount: schema.routeObjectManifests.segmentCount,
      firstRecordedAt: schema.routeObjectManifests.firstRecordedAt,
      lastRecordedAt: schema.routeObjectManifests.lastRecordedAt
    }).from(schema.routeObjectManifests).where(and(
      eq(schema.routeObjectManifests.grantId, auth.principal.grantId),
      eq(schema.routeObjectManifests.raceId, auth.principal.raceId),
      eq(schema.routeObjectManifests.entryId, auth.principal.entryId)
    )).limit(1);
    if (!manifest) {
      return { status: "ok" as const, response: routeUploadStatusResponseSchema.parse({ formatVersion: 1, status: "not-uploaded" }) };
    }
    return {
      status: "ok" as const,
      response: routeUploadStatusResponseSchema.parse({
        formatVersion: 1,
        status: "stored",
        receipt: {
          storedAt: manifest.storedAt.toISOString(),
          pointCount: manifest.pointCount,
          segmentCount: manifest.segmentCount,
          firstRecordedAt: manifest.firstRecordedAt?.toISOString() ?? null,
          lastRecordedAt: manifest.lastRecordedAt?.toISOString() ?? null
        }
      })
    };
  });
}

/** Participant-private reservation: the session's immutable grant decides the only possible entry and route. */
export async function reserveRouteUploadAsParticipant(
  db: Database,
  input: Authentication & { idempotencyKey: string | null; request: unknown },
  now = new Date()
) {
  return db.transaction(async tx => {
    const auth = await authenticateRouteUploadSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const key = routeUploadIdempotencyKeySchema.safeParse(input.idempotencyKey);
    const request = routeUploadReservationRequestSchema.safeParse(input.request);
    if (!key.success || !request.success || !Number.isFinite(now.getTime())) return { status: "invalid-request" as const };
    await lockEntryForRevision(tx, auth.principal.raceId, auth.principal.entryId);
    const requestId = key.data.slice("route-upload:".length), intent = request.data;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [existing] = await tx.select().from(schema.routeUploadReservations)
      .where(eq(schema.routeUploadReservations.requestId, requestId));
    if (existing) {
      if (existing.grantId !== auth.principal.grantId || existing.raceId !== auth.principal.raceId || existing.entryId !== auth.principal.entryId ||
        existing.fileName !== intent.fileName || existing.mediaType !== intent.mediaType || existing.sha256 !== intent.sha256 || existing.byteLength !== intent.byteLength) return { status: "conflict" as const };
      return { status: "reserved" as const, response: reservationResponse(existing, true) };
    }
    const [priorRoute] = await tx.select().from(schema.routeUploadReservations)
      .where(eq(schema.routeUploadReservations.grantId, auth.principal.grantId));
    if (priorRoute) return { status: "conflict" as const };
    const [saved] = await tx.insert(schema.routeUploadReservations).values({
      requestId, grantId: auth.principal.grantId, raceId: auth.principal.raceId, entryId: auth.principal.entryId,
      fileName: intent.fileName, mediaType: intent.mediaType, sha256: intent.sha256, byteLength: intent.byteLength, reservedAt: now
    }).returning();
    if (!saved) throw new Error("ROUTE_UPLOAD_RESERVATION_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: saved.raceId, entityType: "route_upload", entityId: saved.id,
      action: "ROUTE_UPLOAD_RESERVED", requestId, after: { grantId: saved.grantId, entryId: saved.entryId, byteLength: saved.byteLength, sha256: saved.sha256 } });
    return { status: "reserved" as const, response: reservationResponse(saved, false) };
  });
}

async function allocateAttempt(db: Database, input: Authentication & { uploadId: string }, now: Date) {
  return db.transaction(async tx => {
    const auth = await authenticateRouteUploadSessionForMutation(tx, { ...input, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    if (!uuid.test(input.uploadId)) return { status: "invalid-request" as const };
    await lockEntryForRevision(tx, auth.principal.raceId, auth.principal.entryId);
    const [reservation] = await tx.select().from(schema.routeUploadReservations).where(and(
      eq(schema.routeUploadReservations.id, input.uploadId), eq(schema.routeUploadReservations.grantId, auth.principal.grantId),
      eq(schema.routeUploadReservations.raceId, auth.principal.raceId), eq(schema.routeUploadReservations.entryId, auth.principal.entryId)
    ));
    if (!reservation) return { status: "not-found" as const };
    const [manifest] = await tx.select().from(schema.routeObjectManifests).where(eq(schema.routeObjectManifests.uploadId, reservation.id));
    if (manifest) return { status: "already-stored" as const, manifest };
    const rows = await tx.select({ attemptNumber: schema.routeUploadAttempts.attemptNumber }).from(schema.routeUploadAttempts)
      .where(eq(schema.routeUploadAttempts.uploadId, reservation.id));
    const used = new Set(rows.map(row => row.attemptNumber)); let attemptNumber = 1;
    while (used.has(attemptNumber) && attemptNumber <= 8) attemptNumber++;
    if (attemptNumber > 8) return { status: "quota-exceeded" as const };
    const [attempt] = await tx.insert(schema.routeUploadAttempts).values({ id: randomUUID(), uploadId: reservation.id,
      grantId: reservation.grantId, raceId: reservation.raceId, entryId: reservation.entryId, attemptNumber,
      mediaType: reservation.mediaType, sha256: reservation.sha256, byteLength: reservation.byteLength, chargedAt: now }).returning();
    if (!attempt) throw new Error("ROUTE_UPLOAD_ATTEMPT_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: attempt.raceId, entityType: "route_upload_attempt", entityId: attempt.id,
      action: "ROUTE_UPLOAD_ATTEMPT_CHARGED", requestId: reservation.requestId,
      after: { grantId: attempt.grantId, entryId: attempt.entryId, attemptNumber, byteLength: attempt.byteLength } });
    return { status: "allocated" as const, attempt };
  });
}

/** Reads a bounded body, validates GPX before storage and writes one immutable manifest plus source-order points. */
export async function transferRouteUploadAsParticipant(
  db: Database,
  input: Authentication & { uploadId: string; readBody: (signal: AbortSignal) => AsyncIterable<Uint8Array> },
  store: RouteUploadObjectStore,
  now = () => new Date()
) {
  const allocation = await allocateAttempt(db, input, now());
  if (allocation.status === "already-stored") return { status: "stored" as const, response: receipt(allocation.manifest, true) };
  if (allocation.status !== "allocated") return allocation;
  const { attempt } = allocation;
  const parts: Uint8Array[] = []; let size = 0;
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), bodyDeadlineMs);
  try {
    for await (const part of input.readBody(controller.signal)) {
      if (!(part instanceof Uint8Array) || size + part.byteLength > attempt.byteLength) return { status: "invalid-body" as const };
      parts.push(part); size += part.byteLength;
    }
  } catch { return { status: "invalid-body" as const }; }
  finally { clearTimeout(deadline); controller.abort(); }
  if (size !== attempt.byteLength) return { status: "invalid-body" as const };
  const bytes = Buffer.concat(parts.map(part => Buffer.from(part)), size);
  if (createHash("sha256").update(bytes).digest("hex") !== attempt.sha256) return { status: "invalid-body" as const };
  let parsedTrack;
  try { parsedTrack = parseGpxTrack(bytes); } catch (error) {
    if (error instanceof GpxValidationError) return { status: "invalid-body" as const };
    throw error;
  }
  let stored;
  try {
    stored = routeObjectManifestSchema.parse(await store.put({ raceId: attempt.raceId, attemptId: attempt.id,
      sha256: attempt.sha256, byteLength: attempt.byteLength, mediaType: "application/gpx+xml" }, bytes));
  } catch { return { status: "storage-unavailable" as const }; }
  if (stored.key !== `route/${attempt.raceId}/${attempt.id}` || stored.mediaType !== attempt.mediaType ||
    stored.sha256 !== attempt.sha256 || stored.byteLength !== attempt.byteLength) return { status: "storage-unavailable" as const };
  const dated = parsedTrack.points.filter((point): point is typeof point & { recordedAt: string } => point.recordedAt !== undefined);
  const firstRecordedAt = dated[0] ? new Date(dated[0].recordedAt) : null;
  const lastPoint = dated.at(-1);
  const lastRecordedAt = lastPoint ? new Date(lastPoint.recordedAt) : null;
  return db.transaction(async tx => {
    const auth = await authenticateRouteUploadSessionForMutation(tx, { ...input, requireCsrf: true }, now());
    if (auth.status !== "authenticated") return auth;
    if (auth.principal.grantId !== attempt.grantId || auth.principal.raceId !== attempt.raceId || auth.principal.entryId !== attempt.entryId) return { status: "forbidden" as const };
    await lockEntryForRevision(tx, attempt.raceId, attempt.entryId);
    const [existing] = await tx.select().from(schema.routeObjectManifests).where(eq(schema.routeObjectManifests.uploadId, input.uploadId));
    if (existing) return { status: "stored" as const, response: receipt(existing, true) };
    const [saved] = await tx.insert(schema.routeObjectManifests).values({ uploadId: input.uploadId, attemptId: attempt.id,
      grantId: attempt.grantId, raceId: attempt.raceId, entryId: attempt.entryId, storeId: stored.storeId, objectKey: stored.key,
      versionId: stored.versionId, mediaType: stored.mediaType, sha256: stored.sha256, byteLength: stored.byteLength,
      pointCount: parsedTrack.points.length, segmentCount: parsedTrack.segmentCount, firstRecordedAt, lastRecordedAt,
      parser: parsedTrack.parser, storedAt: now() }).returning();
    if (!saved) throw new Error("ROUTE_OBJECT_MANIFEST_NOT_STORED");
    for (let offset = 0; offset < parsedTrack.points.length; offset += 1_000) {
      await tx.insert(schema.routePoints).values(parsedTrack.points.slice(offset, offset + 1_000).map((point, index) => ({
        uploadId: saved.uploadId, sequence: offset + index, segment: point.segment, latitude: point.latitude, longitude: point.longitude,
        elevationMeters: point.elevationMeters ?? null, recordedAt: point.recordedAt ? new Date(point.recordedAt) : null
      })));
    }
    await tx.insert(schema.auditEvents).values({ raceId: saved.raceId, entityType: "route_upload", entityId: saved.uploadId,
      action: "ROUTE_UPLOAD_STORED", requestId: (await tx.select({ requestId: schema.routeUploadReservations.requestId })
        .from(schema.routeUploadReservations).where(eq(schema.routeUploadReservations.id, saved.uploadId)).limit(1))[0]?.requestId ?? saved.uploadId,
      after: { grantId: saved.grantId, entryId: saved.entryId, pointCount: saved.pointCount, segmentCount: saved.segmentCount, sha256: saved.sha256 } });
    return { status: "stored" as const, response: receipt(saved, false) };
  });
}
