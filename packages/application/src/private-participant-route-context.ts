import { and, asc, desc, eq, sql } from "drizzle-orm";
import { deriveRouteMetadata, invertRasterCoordinate, RouteMetadataError } from "@o-tid/domain";
import {
  adminPrivateRouteContextStateResponseSchema,
  canonicalJsonBytes,
  participantPrivateRouteOverlayResponseSchema,
  privateRouteContextBindIdempotencyKeySchema,
  privateRouteContextBindRequestSchema,
  privateRouteContextBindResponseSchema,
  type AdminPrivateRouteContextStateResponse,
  type ParticipantPrivateRouteOverlayResponse,
  type PrivateRouteContextBindResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { activeClaimForEntry } from "./participant-private-route";
import { authenticatePairingAdminSessionForMutation, authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { resolveCalibration } from "./private-route-preview";
import { exactHistoricalControls } from "./public-participant-route";
import { resolvePublicActiveResultHead } from "./results";
import { authenticateUserAccountSessionForProtectedRead, type UserAccountSessionProof } from "./user-account";

const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type AdminRead = Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf">;
type AdminWrite = Omit<PairingAdminRequestAuthentication, "capability"> & { idempotencyKey: string | null; request: unknown };
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" };
type Verified = {
  contextRevision: number;
  route: typeof schema.routeObjectManifests.$inferSelect;
  map: typeof schema.mapObjectManifests.$inferSelect;
  geometry: readonly { sequence: number; controlCode: number; x: number; y: number }[];
  imageWidth: number;
  imageHeight: number;
  points: { x: number; y: number; segment: number }[];
  metadata: ReturnType<typeof deriveRouteMetadata>;
  playback: { status: "AVAILABLE"; pointElapsedMilliseconds: number[] } | { status: "UNAVAILABLE" };
  resultSplits: ParticipantPrivateRouteOverlayResponse["resultSplits"];
  resultStart: ParticipantPrivateRouteOverlayResponse["resultStart"];
};

function sameIntent(left: unknown, right: unknown): boolean {
  try { return Buffer.from(canonicalJsonBytes(left)).equals(Buffer.from(canonicalJsonBytes(right))); }
  catch { return false; }
}

function bindResponse(row: typeof schema.privateRouteContexts.$inferSelect, replayed: boolean): PrivateRouteContextBindResponse {
  return privateRouteContextBindResponseSchema.parse({
    formatVersion: 1, contextId: row.id, requestId: row.requestId, raceId: row.raceId,
    routeUploadId: row.routeManifestId, revision: row.revision,
    mapManifestId: row.mapManifestId, georeferenceId: row.georeferenceId,
    geometryRevisionId: row.geometryRevisionId, courseVersionId: row.courseVersionId,
    boundAt: row.decidedAt.toISOString(), replayed
  });
}

async function routeForRace(tx: Tx, raceId: string, routeUploadId: string) {
  const [route] = await tx.select().from(schema.routeObjectManifests)
    .where(and(eq(schema.routeObjectManifests.uploadId, routeUploadId), eq(schema.routeObjectManifests.raceId, raceId)));
  return route ?? null;
}

async function publishedHeadForRoute(tx: Tx, route: typeof schema.routeObjectManifests.$inferSelect) {
  const [entry] = await tx.select({ publicResultId: schema.entries.publicResultId }).from(schema.entries)
    .where(and(eq(schema.entries.id, route.entryId), eq(schema.entries.raceId, route.raceId)));
  if (!entry) return null;
  const head = await resolvePublicActiveResultHead(tx, route.raceId, entry.publicResultId);
  return head?.entryId === route.entryId ? head : null;
}

async function projectedRoute(tx: Tx, route: typeof schema.routeObjectManifests.$inferSelect, calibration: NonNullable<Awaited<ReturnType<typeof resolveCalibration>>>) {
  const rows = await tx.select({ latitude: schema.routePoints.latitude, longitude: schema.routePoints.longitude,
    segment: schema.routePoints.segment, recordedAt: schema.routePoints.recordedAt })
    .from(schema.routePoints).where(eq(schema.routePoints.uploadId, route.uploadId))
    .orderBy(asc(schema.routePoints.sequence));
  if (rows.length !== route.pointCount || rows.length < 2) return null;
  try {
    const metadata = deriveRouteMetadata(rows);
    if (metadata.segmentCount !== route.segmentCount) return null;
    const playback = metadata.timing.status === "AVAILABLE"
      ? (() => {
        const startedAt = metadata.timing.startedAt.getTime();
        return { status: "AVAILABLE" as const, pointElapsedMilliseconds: rows.map(point => {
          if (point.recordedAt === null) throw new Error("PRIVATE_ROUTE_PLAYBACK_MISSING_TIMESTAMP");
          return point.recordedAt.getTime() - startedAt;
        }) };
      })()
      : { status: "UNAVAILABLE" as const };
    const points = rows.map(point => ({ ...invertRasterCoordinate(calibration.transform, point.longitude, point.latitude), segment: point.segment }));
    if (points.some(point => !Number.isFinite(point.pixelX) || !Number.isFinite(point.pixelY) ||
      point.pixelX < 0 || point.pixelX >= calibration.georeference.imageWidth ||
      point.pixelY < 0 || point.pixelY >= calibration.georeference.imageHeight)) return null;
    return { metadata, playback, points: points.map(point => ({ x: point.pixelX, y: point.pixelY, segment: point.segment })) };
  } catch (error) { if (error instanceof RouteMetadataError) return null; throw error; }
}

/** One explicit context revision may be read only while its exact source proof remains valid. */
async function verifiedContext(tx: Tx, route: typeof schema.routeObjectManifests.$inferSelect,
  context: typeof schema.privateRouteContexts.$inferSelect): Promise<Verified | null> {
  if (context.raceId !== route.raceId || context.entryId !== route.entryId ||
    context.routeManifestId !== route.uploadId || context.routeSourceHash !== route.sha256) return null;
  const calibration = await resolveCalibration(tx, route.raceId, context.mapManifestId, context.georeferenceId);
  if (!calibration || calibration.map.sha256 !== context.mapSourceHash) return null;
  const [source] = await tx.select({ id: schema.resultRevisions.id }).from(schema.resultRevisions)
    .where(and(eq(schema.resultRevisions.id, context.sourceResultRevisionId),
      eq(schema.resultRevisions.raceId, route.raceId), eq(schema.resultRevisions.entryId, route.entryId),
      eq(schema.resultRevisions.revision, context.sourceResultRevision),
      eq(schema.resultRevisions.courseVersionId, context.courseVersionId),
      eq(schema.resultRevisions.published, true)));
  if (!source) return null;
  const head = await publishedHeadForRoute(tx, route);
  if (!head || head.courseVersionId !== context.courseVersionId) return null;
  const resultSplits: Verified["resultSplits"] = head.resultSplits.status === "AVAILABLE"
    ? { status: "AVAILABLE", resultRevision: head.resultRevision, splits: head.resultSplits.splits }
    : { status: "UNAVAILABLE" };
  const resultStart: Verified["resultStart"] = head.resultStart.status === "AVAILABLE"
    ? { status: "AVAILABLE", resultRevision: head.resultRevision, startedAt: head.resultStart.startedAt }
    : { status: "UNAVAILABLE" };
  const geometry = await exactHistoricalControls(tx, route.raceId, context.courseVersionId,
    context.mapManifestId, context.georeferenceId, context.mapSourceHash,
    calibration.georeference.imageWidth, calibration.georeference.imageHeight, context.geometryRevisionId);
  if (!geometry) return null;
  const projection = await projectedRoute(tx, route, calibration);
  return projection ? { contextRevision: context.revision, route, map: calibration.map, geometry,
    imageWidth: calibration.georeference.imageWidth, imageHeight: calibration.georeference.imageHeight,
    points: projection.points, metadata: projection.metadata, playback: projection.playback, resultSplits, resultStart } : null;
}

export async function readPrivateRouteContextStateAsAdmin(db: Database, input: AdminRead & { routeUploadId: string }, now = new Date()):
  Promise<Failure | { status: "ok"; response: AdminPrivateRouteContextStateResponse }> {
  if (!uuid.test(input.raceId) || !uuid.test(input.routeUploadId) || !Number.isFinite(now.getTime())) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability, requireCsrf: false }, now);
    if (auth.status !== "authenticated") return auth;
    const route = await routeForRace(tx, input.raceId, input.routeUploadId);
    if (!route) return { status: "not-found" } as const;
    const [latest] = await tx.select().from(schema.privateRouteContexts)
      .where(eq(schema.privateRouteContexts.routeManifestId, route.uploadId))
      .orderBy(desc(schema.privateRouteContexts.revision)).limit(1);
    return { status: "ok", response: adminPrivateRouteContextStateResponseSchema.parse({
      formatVersion: 1, raceId: route.raceId, routeUploadId: route.uploadId,
      latestContextRevision: latest?.revision ?? 0,
      activeContext: latest ? { contextId: latest.id, revision: latest.revision,
        mapManifestId: latest.mapManifestId, georeferenceId: latest.georeferenceId,
        geometryRevisionId: latest.geometryRevisionId, courseVersionId: latest.courseVersionId,
        boundAt: latest.decidedAt.toISOString() } : null
    }) } as const;
  });
}

/** A separately confirmed MANAGE_RACE decision; preview selection alone does not write proof. */
export async function bindPrivateRouteContextAsAdmin(db: Database, input: AdminWrite, now = new Date()):
  Promise<Failure | { status: "bound"; response: PrivateRouteContextBindResponse }> {
  if (!uuid.test(input.raceId) || !Number.isFinite(now.getTime())) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    const key = privateRouteContextBindIdempotencyKeySchema.safeParse(input.idempotencyKey);
    const request = privateRouteContextBindRequestSchema.safeParse(input.request);
    if (!key.success || !request.success) return { status: "invalid-request" } as const;
    await lockRaceForMutation(tx, input.raceId);
    const requestId = key.data.slice("private-route-context-bind:".length);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [prior] = await tx.select().from(schema.privateRouteContexts).where(eq(schema.privateRouteContexts.requestId, requestId));
    if (prior) {
      const same = prior.raceId === input.raceId && prior.actorCredentialId === auth.principal.accessCredentialId &&
        sameIntent(prior.intent, request.data);
      return same ? { status: "bound" as const, response: bindResponse(prior, true) } : { status: "conflict" as const };
    }
    const route = await routeForRace(tx, input.raceId, request.data.routeUploadId);
    if (!route) return { status: "not-found" } as const;
    const [latest] = await tx.select().from(schema.privateRouteContexts)
      .where(eq(schema.privateRouteContexts.routeManifestId, route.uploadId))
      .orderBy(desc(schema.privateRouteContexts.revision)).limit(1);
    if ((latest?.revision ?? 0) !== request.data.expectedContextRevision) return { status: "conflict" } as const;
    const calibration = await resolveCalibration(tx, input.raceId, request.data.mapManifestId, request.data.georeferenceId);
    const head = await publishedHeadForRoute(tx, route);
    if (!calibration || !head) return { status: "conflict" } as const;
    const geometry = await exactHistoricalControls(tx, input.raceId, head.courseVersionId,
      calibration.map.uploadId, calibration.georeference.id, calibration.map.sha256,
      calibration.georeference.imageWidth, calibration.georeference.imageHeight,
      request.data.geometryRevisionId);
    const projection = geometry ? await projectedRoute(tx, route, calibration) : null;
    if (!geometry || !projection) return { status: "conflict" } as const;
    const [saved] = await tx.insert(schema.privateRouteContexts).values({
      requestId, raceId: input.raceId, entryId: route.entryId,
      routeManifestId: route.uploadId, routeSourceHash: route.sha256,
      mapManifestId: calibration.map.uploadId, mapSourceHash: calibration.map.sha256,
      georeferenceId: calibration.georeference.id,
      geometryRevisionId: request.data.geometryRevisionId,
      sourceResultRevisionId: head.resultRevisionId, sourceResultRevision: head.resultRevision,
      courseVersionId: head.courseVersionId,
      actorCredentialId: auth.principal.accessCredentialId, capability,
      revision: request.data.expectedContextRevision + 1,
      intent: request.data, decidedAt: now
    }).returning();
    if (!saved) throw new Error("PRIVATE_ROUTE_CONTEXT_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId,
      entityType: "private_route_context", entityId: saved.id,
      action: "PRIVATE_ROUTE_CONTEXT_BOUND", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL",
      actorId: auth.principal.accessCredentialId, requestId,
      after: { revision: saved.revision, routeSourceHash: saved.routeSourceHash,
        mapSourceHash: saved.mapSourceHash, courseVersionId: saved.courseVersionId,
        sourceResultRevision: saved.sourceResultRevision } });
    return { status: "bound", response: bindResponse(saved, false) } as const;
  });
}

async function ownerContext(tx: Tx, proof: UserAccountSessionProof, routeUploadId: string, now: Date, expectedContextRevision?: number):
  Promise<Failure | { status: "ok"; verified: Verified }> {
  const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
  if (auth.status !== "authenticated") return auth;
  const [route] = await tx.select().from(schema.routeObjectManifests)
    .where(eq(schema.routeObjectManifests.uploadId, routeUploadId));
  if (!route) return { status: "not-found" };
  await lockRaceForSnapshot(tx, route.raceId);
  if (!await activeClaimForEntry(tx, auth.principal.accountId, route.raceId, route.entryId)) return { status: "not-found" };
  const [context] = await tx.select().from(schema.privateRouteContexts)
    .where(eq(schema.privateRouteContexts.routeManifestId, route.uploadId))
    .orderBy(desc(schema.privateRouteContexts.revision)).limit(1);
  if (!context || (expectedContextRevision !== undefined && context.revision !== expectedContextRevision)) return { status: "not-found" };
  const verified = await verifiedContext(tx, route, context);
  return verified ? { status: "ok", verified } : { status: "not-found" };
}

/** Only a claimed owner sees pixel coordinates; the browser never receives storage or WGS84 data. */
export async function readMyPrivateRouteOverlay(db: Database, proof: UserAccountSessionProof, routeUploadId: string, now = new Date()):
  Promise<Failure | { status: "ok"; response: ParticipantPrivateRouteOverlayResponse }> {
  if (!uuid.test(routeUploadId) || !Number.isFinite(now.getTime())) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const result = await ownerContext(tx, proof, routeUploadId, now);
    if (result.status !== "ok") return result;
    const item = result.verified;
    return { status: "ok", response: participantPrivateRouteOverlayResponseSchema.parse({
      formatVersion: 4, routeUploadId, contextRevision: item.contextRevision,
      imageWidth: item.imageWidth, imageHeight: item.imageHeight,
      points: item.points, controls: item.geometry, playback: item.playback, resultSplits: item.resultSplits,
      resultStart: item.resultStart,
      metadata: { distanceMeters: item.metadata.distanceMeters,
        pointCount: item.metadata.pointCount, segmentCount: item.metadata.segmentCount,
        timing: item.metadata.timing.status === "AVAILABLE" ? {
          status: "AVAILABLE", startedAt: item.metadata.timing.startedAt.toISOString(),
          finishedAt: item.metadata.timing.finishedAt.toISOString(),
          durationMilliseconds: item.metadata.timing.durationMilliseconds
        } : { status: "UNAVAILABLE" } }, notice: "ROUTE_NOT_GPS_VERIFIED"
    }) } as const;
  });
}

/** Storage manifest stays server-side for a separately authenticated image request. */
export async function resolveMyPrivateRouteMap(db: Database, proof: UserAccountSessionProof,
  routeUploadId: string, expectedContextRevision: number, now = new Date()):
  Promise<Failure | { status: "ok"; response: typeof schema.mapObjectManifests.$inferSelect }> {
  if (!uuid.test(routeUploadId) || !Number.isSafeInteger(expectedContextRevision) ||
    expectedContextRevision < 1 || !Number.isFinite(now.getTime())) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const result = await ownerContext(tx, proof, routeUploadId, now, expectedContextRevision);
    return result.status === "ok" ? { status: "ok", response: result.verified.map } : result;
  });
}
