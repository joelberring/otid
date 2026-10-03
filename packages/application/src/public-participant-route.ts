import { and, asc, desc, eq, sql } from "drizzle-orm";
import { deriveRasterGeoreference, deriveRouteMetadata, invertRasterCoordinate, RasterGeoreferenceError, RouteMetadataError } from "@o-tid/domain";
import { adminPublicParticipantRoutePublicationStateSchema, canonicalJsonBytes, publicParticipantRouteComparisonQuerySchema, publicParticipantRouteComparisonResponseSchema, publicParticipantRouteReleaseIdempotencyKeySchema, publicParticipantRouteReleaseRequestSchema, publicParticipantRouteReleaseResponseSchema, publicParticipantRouteViewResponseSchema, publicParticipantRouteWithdrawIdempotencyKeySchema, publicParticipantRouteWithdrawRequestSchema, publicParticipantRouteWithdrawResponseSchema, type AdminPublicParticipantRoutePublicationState, type PublicParticipantRouteComparisonResponse, type PublicParticipantRouteViewResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { authenticatePairingAdminSessionForMutation, type PairingAdminRequestAuthentication } from "./pairing-admin";
import { resolvePublicActiveResultHead } from "./results";

const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Tx = Parameters<Database["transaction"]>[0] extends (argument: infer T) => unknown ? T : never;
type AdminInput = Omit<PairingAdminRequestAuthentication, "capability"> & { idempotencyKey: string | null; request: unknown };
type PublicControl = { sequence: number; controlCode: number; x: number; y: number };
type PublicAccess = { publication: typeof schema.routePublications.$inferSelect; route: typeof schema.routeObjectManifests.$inferSelect; map: typeof schema.mapObjectManifests.$inferSelect; courseVersionId: string; participant: { givenName: string; familyName: string }; resultSplits: { status: "AVAILABLE"; splits: Array<{ controlCode: number; occurrence: number; legMs: number; elapsedMs: number }> } | { status: "UNAVAILABLE" }; transform: { a: number; b: number; c: number; d: number; e: number; f: number }; imageWidth: number; imageHeight: number; controls: readonly PublicControl[] };

function sameIntent(left: unknown, right: unknown): boolean { try { return Buffer.from(canonicalJsonBytes(left)).equals(Buffer.from(canonicalJsonBytes(right))); } catch { return false; } }
function sameTransform(left: Record<string, number>, right: Record<string, number>): boolean { return ["a", "b", "c", "d", "e", "f"].every(key => Number.isFinite(left[key]) && Math.abs((left[key] ?? Number.NaN) - (right[key] ?? Number.NaN)) <= 1e-12); }

function releaseResponse(row: typeof schema.routePublications.$inferSelect, replayed: boolean) { return publicParticipantRouteReleaseResponseSchema.parse({ formatVersion: 1, publicationId: row.id, requestId: row.requestId, raceId: row.raceId, entryId: row.entryId, revision: row.revision, action: "RELEASE", routeUploadId: row.routeManifestId, mapManifestId: row.mapManifestId, georeferenceId: row.georeferenceId, decidedAt: row.decidedAt.toISOString(), replayed }); }
function withdrawResponse(row: typeof schema.routePublications.$inferSelect, replayed: boolean) { return publicParticipantRouteWithdrawResponseSchema.parse({ formatVersion: 1, publicationId: row.id, requestId: row.requestId, raceId: row.raceId, entryId: row.entryId, revision: row.revision, action: "WITHDRAW", decidedAt: row.decidedAt.toISOString(), replayed }); }

export async function readPublicParticipantRoutePublicationStateAsAdmin(db: Database, input: Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf"> & { routeUploadId: string }, now = new Date()): Promise<{ status: "ok"; response: AdminPublicParticipantRoutePublicationState } | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" }> {
  if (!uuid.test(input.raceId) || !uuid.test(input.routeUploadId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: false }, now);
    if (auth.status !== "authenticated") return auth;
    const [route] = await tx.select({ entryId: schema.routeObjectManifests.entryId }).from(schema.routeObjectManifests).where(and(eq(schema.routeObjectManifests.uploadId, input.routeUploadId), eq(schema.routeObjectManifests.raceId, auth.principal.raceId)));
    if (!route) return { status: "not-found" as const };
    const [latest] = await tx.select().from(schema.routePublications).where(eq(schema.routePublications.entryId, route.entryId)).orderBy(desc(schema.routePublications.revision)).limit(1);
    const active = latest?.action === "RELEASE" && latest.routeManifestId === input.routeUploadId && latest.mapManifestId && latest.georeferenceId ? latest : undefined;
    return { status: "ok" as const, response: adminPublicParticipantRoutePublicationStateSchema.parse({ formatVersion: 1, raceId: auth.principal.raceId, routeUploadId: input.routeUploadId, latestPublicationRevision: latest?.revision ?? 0, activePublication: active ? { publicationId: active.id, revision: active.revision, mapManifestId: active.mapManifestId, georeferenceId: active.georeferenceId, releasedAt: active.decidedAt.toISOString() } : null }) };
  });
}

async function exactEligible(tx: Tx, raceId: string, routeId: string, mapId: string, georeferenceId: string) {
  const [route] = await tx.select().from(schema.routeObjectManifests).where(and(eq(schema.routeObjectManifests.uploadId, routeId), eq(schema.routeObjectManifests.raceId, raceId)));
  const [map] = await tx.select().from(schema.mapObjectManifests).where(and(eq(schema.mapObjectManifests.uploadId, mapId), eq(schema.mapObjectManifests.raceId, raceId)));
  const [geo] = await tx.select().from(schema.mapGeoreferences).where(and(eq(schema.mapGeoreferences.id, georeferenceId), eq(schema.mapGeoreferences.raceId, raceId)));
  const [consent] = route ? await tx.select().from(schema.routePublicationConsents).where(eq(schema.routePublicationConsents.manifestId, route.uploadId)).orderBy(desc(schema.routePublicationConsents.revision)).limit(1) : [];
  const [activeMap] = await tx.select().from(schema.mapPublications).where(eq(schema.mapPublications.raceId, raceId)).orderBy(desc(schema.mapPublications.revision)).limit(1);
  if (!route || !map || !geo || !consent || consent.decision !== "GRANT" || consent.sourceHash !== route.sha256 || geo.manifestId !== map.uploadId || geo.sourceHash !== map.sha256 || !activeMap || activeMap.action !== "PUBLISH" || activeMap.manifestId !== map.uploadId || activeMap.sourceHash !== map.sha256) return null;
  try {
    const derived = deriveRasterGeoreference({ imageWidth: geo.imageWidth, imageHeight: geo.imageHeight, tiePoints: geo.tiePoints as Parameters<typeof deriveRasterGeoreference>[0]["tiePoints"] });
    if (geo.crs !== "EPSG:4326" || !sameTransform(geo.transform, derived.transform)) return null;
    return { route, map, geo, transform: derived.transform };
  } catch (error) { if (error instanceof RasterGeoreferenceError) return null; throw error; }
}

/**
 * A public course overlay is valid only when all historical controls have one
 * exact point in a geometry revision bound to the released map/calibration.
 * This never falls back to the current class, a newer map or a partial set.
 */
export async function exactHistoricalControls(
  tx: Tx,
  raceId: string,
  courseVersionId: string,
  mapManifestId: string,
  georeferenceId: string,
  mapSourceHash: string,
  imageWidth: number,
  imageHeight: number,
  geometryRevisionId?: string
): Promise<readonly PublicControl[] | null> {
  const [geometry] = await tx.select().from(schema.courseControlGeometryRevisions).where(and(
    eq(schema.courseControlGeometryRevisions.raceId, raceId),
    eq(schema.courseControlGeometryRevisions.courseVersionId, courseVersionId),
    eq(schema.courseControlGeometryRevisions.mapManifestId, mapManifestId),
    eq(schema.courseControlGeometryRevisions.georeferenceId, georeferenceId),
    eq(schema.courseControlGeometryRevisions.sourceHash, mapSourceHash),
    ...(geometryRevisionId ? [eq(schema.courseControlGeometryRevisions.id, geometryRevisionId)] : [])
  )).orderBy(desc(schema.courseControlGeometryRevisions.revision)).limit(1);
  if (!geometry) return null;
  const [courseVersion] = await tx.select({ id: schema.courseVersions.id }).from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courseVersions.courseId, schema.courses.id))
    .where(and(eq(schema.courseVersions.id, courseVersionId), eq(schema.courses.raceId, raceId)));
  if (!courseVersion) return null;
  const [controls, points] = await Promise.all([
    tx.select({ id: schema.courseControls.id, sequence: schema.courseControls.sequence, controlCode: schema.controls.code })
      .from(schema.courseControls)
      .innerJoin(schema.controls, eq(schema.courseControls.controlId, schema.controls.id))
      .where(eq(schema.courseControls.courseVersionId, courseVersion.id))
      .orderBy(asc(schema.courseControls.sequence)),
    tx.select({ courseControlId: schema.courseControlGeometryPoints.courseControlId, sequence: schema.courseControlGeometryPoints.sequence, x: schema.courseControlGeometryPoints.pixelX, y: schema.courseControlGeometryPoints.pixelY })
      .from(schema.courseControlGeometryPoints)
      .where(and(eq(schema.courseControlGeometryPoints.revisionId, geometry.id), eq(schema.courseControlGeometryPoints.courseVersionId, courseVersion.id)))
      .orderBy(asc(schema.courseControlGeometryPoints.sequence))
  ]);
  if (controls.length === 0 || controls.length !== points.length ||
    new Set(controls.map(control => control.id)).size !== controls.length ||
    new Set(points.map(point => point.courseControlId)).size !== points.length ||
    new Set(points.map(point => point.sequence)).size !== points.length) return null;
  const pointByControl = new Map(points.map(point => [point.courseControlId, point]));
  const projected = controls.map((control) => {
    const point = pointByControl.get(control.id);
    if (!point || point.sequence !== control.sequence || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      point.x < 0 || point.x >= imageWidth || point.y < 0 || point.y >= imageHeight) return null;
    return { sequence: control.sequence, controlCode: control.controlCode, x: point.x, y: point.y };
  });
  if (projected.some((point) => point === null)) return null;
  return projected as PublicControl[];
}

export async function releasePublicParticipantRouteAsAdmin(db: Database, input: AdminInput, now = new Date()) {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now); if (auth.status !== "authenticated") return auth;
    const key = publicParticipantRouteReleaseIdempotencyKeySchema.safeParse(input.idempotencyKey), request = publicParticipantRouteReleaseRequestSchema.safeParse(input.request);
    if (!key.success || !request.success || !uuid.test(input.raceId)) return { status: "invalid-request" as const };
    await lockRaceForMutation(tx, input.raceId); const requestId = key.data.slice("route-publication-release:".length); await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [prior] = await tx.select().from(schema.routePublications).where(eq(schema.routePublications.requestId, requestId));
    if (prior) {
      const same = prior.raceId === input.raceId && prior.actorCredentialId === auth.principal.accessCredentialId && prior.action === "RELEASE" && prior.routeManifestId === request.data.routeUploadId && prior.mapManifestId === request.data.mapManifestId && prior.georeferenceId === request.data.georeferenceId && sameIntent(prior.intent, request.data);
      return same ? { status: "released" as const, response: releaseResponse(prior, true) } : { status: "conflict" as const };
    }
    const eligible = await exactEligible(tx, input.raceId, request.data.routeUploadId, request.data.mapManifestId, request.data.georeferenceId); if (!eligible) return { status: "conflict" as const };
    const [latest] = await tx.select().from(schema.routePublications).where(eq(schema.routePublications.entryId, eligible.route.entryId)).orderBy(desc(schema.routePublications.revision)).limit(1);
    if ((latest?.revision ?? 0) !== request.data.expectedPublicationRevision) return { status: "conflict" as const };
    const [saved] = await tx.insert(schema.routePublications).values({ requestId, raceId: input.raceId, entryId: eligible.route.entryId, actorCredentialId: auth.principal.accessCredentialId, capability, revision: request.data.expectedPublicationRevision + 1, action: "RELEASE", routeManifestId: eligible.route.uploadId, routeSourceHash: eligible.route.sha256, mapManifestId: eligible.map.uploadId, mapSourceHash: eligible.map.sha256, georeferenceId: eligible.geo.id, intent: request.data, decidedAt: now }).returning();
    if (!saved) throw new Error("ROUTE_PUBLICATION_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "route_publication", entityId: saved.id, action: "ROUTE_RELEASED", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, requestId, after: { capability, revision: saved.revision, routeSourceHash: saved.routeSourceHash, mapSourceHash: saved.mapSourceHash } });
    return { status: "released" as const, response: releaseResponse(saved, false) };
  });
}

export async function withdrawPublicParticipantRouteAsAdmin(db: Database, input: AdminInput, now = new Date()) {
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now); if (auth.status !== "authenticated") return auth;
    const key = publicParticipantRouteWithdrawIdempotencyKeySchema.safeParse(input.idempotencyKey), request = publicParticipantRouteWithdrawRequestSchema.safeParse(input.request);
    if (!key.success || !request.success || !uuid.test(input.raceId)) return { status: "invalid-request" as const };
    await lockRaceForMutation(tx, input.raceId); const requestId = key.data.slice("route-publication-withdraw:".length); await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const [prior] = await tx.select().from(schema.routePublications).where(eq(schema.routePublications.requestId, requestId));
    if (prior) { const same = prior.raceId === input.raceId && prior.actorCredentialId === auth.principal.accessCredentialId && prior.action === "WITHDRAW" && sameIntent(prior.intent, request.data); return same ? { status: "withdrawn" as const, response: withdrawResponse(prior, true) } : { status: "conflict" as const }; }
    const [target] = await tx.select().from(schema.routePublications).where(and(eq(schema.routePublications.id, request.data.publicationId), eq(schema.routePublications.raceId, input.raceId)));
    const [latest] = target ? await tx.select().from(schema.routePublications).where(eq(schema.routePublications.entryId, target.entryId)).orderBy(desc(schema.routePublications.revision)).limit(1) : [];
    if (!latest || latest.action !== "RELEASE" || latest.id !== request.data.publicationId || latest.revision !== request.data.expectedPublicationRevision) return { status: "conflict" as const };
    const [saved] = await tx.insert(schema.routePublications).values({ requestId, raceId: input.raceId, entryId: latest.entryId, actorCredentialId: auth.principal.accessCredentialId, capability, revision: latest.revision + 1, action: "WITHDRAW", intent: request.data, decidedAt: now }).returning();
    if (!saved) throw new Error("ROUTE_PUBLICATION_WITHDRAW_NOT_STORED");
    await tx.insert(schema.auditEvents).values({ raceId: input.raceId, entityType: "route_publication", entityId: saved.id, action: "ROUTE_WITHDRAWN", actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId: auth.principal.accessCredentialId, requestId, after: { capability, revision: saved.revision } });
    return { status: "withdrawn" as const, response: withdrawResponse(saved, false) };
  });
}

async function accessForPublicResult(tx: Tx, raceId: string, publicResultId: string): Promise<PublicAccess | null> {
  const resultHead = await resolvePublicActiveResultHead(tx, raceId, publicResultId);
  if (!resultHead) return null;
  const [release] = await tx.select().from(schema.routePublications).where(and(eq(schema.routePublications.raceId, raceId), eq(schema.routePublications.entryId, resultHead.entryId))).orderBy(desc(schema.routePublications.revision)).limit(1);
  if (!release || release.action !== "RELEASE" || !release.routeManifestId || !release.mapManifestId || !release.georeferenceId) return null;
  const eligible = await exactEligible(tx, raceId, release.routeManifestId, release.mapManifestId, release.georeferenceId); if (!eligible || eligible.route.sha256 !== release.routeSourceHash || eligible.map.sha256 !== release.mapSourceHash) return null;
  const controls = await exactHistoricalControls(tx, raceId, resultHead.courseVersionId, release.mapManifestId, release.georeferenceId, release.mapSourceHash, eligible.geo.imageWidth, eligible.geo.imageHeight);
  return controls ? { publication: release, route: eligible.route, map: eligible.map, courseVersionId: resultHead.courseVersionId, participant: { givenName: resultHead.givenName, familyName: resultHead.familyName }, resultSplits: resultHead.resultSplits, transform: eligible.transform, imageWidth: eligible.geo.imageWidth, imageHeight: eligible.geo.imageHeight, controls } : null;
}

async function publicRouteView(tx: Tx, access: PublicAccess): Promise<PublicParticipantRouteViewResponse | null> {
  const points = await tx.select({ latitude: schema.routePoints.latitude, longitude: schema.routePoints.longitude, segment: schema.routePoints.segment, recordedAt: schema.routePoints.recordedAt }).from(schema.routePoints).where(eq(schema.routePoints.uploadId, access.route.uploadId)).orderBy(asc(schema.routePoints.sequence));
  if (points.length !== access.route.pointCount || points.length < 2) return null;
  let metadata: ReturnType<typeof deriveRouteMetadata>;
  try { metadata = deriveRouteMetadata(points); } catch (error) { if (error instanceof RouteMetadataError) return null; throw error; }
  const projected = points.map(point => ({ ...invertRasterCoordinate(access.transform, point.longitude, point.latitude), segment: point.segment }));
  if (projected.some(point => !Number.isFinite(point.pixelX) || !Number.isFinite(point.pixelY) || point.pixelX < 0 || point.pixelX >= access.imageWidth || point.pixelY < 0 || point.pixelY >= access.imageHeight)) return null;
  const playback = metadata.timing.status === "AVAILABLE"
    ? (() => {
      const startedAt = metadata.timing.startedAt.getTime();
      return { status: "AVAILABLE" as const, pointElapsedMilliseconds: points.map((point) => {
      if (point.recordedAt === null) throw new Error("ROUTE_PLAYBACK_MISSING_TIMESTAMP");
      return point.recordedAt.getTime() - startedAt;
    }) };
    })()
    : { status: "UNAVAILABLE" as const };
  return publicParticipantRouteViewResponseSchema.parse({ formatVersion: 2, imageWidth: access.imageWidth, imageHeight: access.imageHeight, points: projected.map(point => ({ x: point.pixelX, y: point.pixelY, segment: point.segment })), controls: access.controls, metadata: { distanceMeters: metadata.distanceMeters, pointCount: metadata.pointCount, segmentCount: metadata.segmentCount, timing: metadata.timing.status === "AVAILABLE" ? { status: "AVAILABLE", startedAt: metadata.timing.startedAt.toISOString(), finishedAt: metadata.timing.finishedAt.toISOString(), durationMilliseconds: metadata.timing.durationMilliseconds } : { status: "UNAVAILABLE" } }, playback, notice: "ROUTE_NOT_GPS_VERIFIED" });
}

/** Owner-only facts for one selected immutable route; public availability uses the actual public gate. */
export async function exactRouteSharingForOwner(
  tx: Tx, raceId: string, entryId: string, publicResultId: string,
  routeUploadId: string, routeSourceHash: string
) {
  const [consent] = await tx.select({ decision: schema.routePublicationConsents.decision, sourceHash: schema.routePublicationConsents.sourceHash })
    .from(schema.routePublicationConsents)
    .where(and(eq(schema.routePublicationConsents.manifestId, routeUploadId), eq(schema.routePublicationConsents.raceId, raceId), eq(schema.routePublicationConsents.entryId, entryId)))
    .orderBy(desc(schema.routePublicationConsents.revision)).limit(1);
  const consentGranted = consent?.decision === "GRANT" && consent.sourceHash === routeSourceHash;
  const [release] = await tx.select().from(schema.routePublications)
    .where(and(eq(schema.routePublications.raceId, raceId), eq(schema.routePublications.entryId, entryId)))
    .orderBy(desc(schema.routePublications.revision)).limit(1);
  const exactRelease = release?.action === "RELEASE" && release.routeManifestId === routeUploadId &&
    release.routeSourceHash === routeSourceHash && release.mapManifestId && release.mapSourceHash && release.georeferenceId
    ? release : null;
  const [mapRelease] = exactRelease ? await tx.select({ action: schema.mapPublications.action, manifestId: schema.mapPublications.manifestId, sourceHash: schema.mapPublications.sourceHash })
    .from(schema.mapPublications).where(eq(schema.mapPublications.raceId, raceId))
    .orderBy(desc(schema.mapPublications.revision)).limit(1) : [];
  const adminReleaseActive = !!exactRelease && mapRelease?.action === "PUBLISH" &&
    mapRelease.manifestId === exactRelease.mapManifestId && mapRelease.sourceHash === exactRelease.mapSourceHash;
  if (consentGranted && adminReleaseActive) {
    const access = await accessForPublicResult(tx, raceId, publicResultId);
    if (access?.publication.id === exactRelease.id && access.route.uploadId === routeUploadId &&
      access.route.sha256 === routeSourceHash && await publicRouteView(tx, access)) {
      return { consent: "GRANTED" as const, adminRelease: "ACTIVE" as const,
        publicRoute: { status: "AVAILABLE" as const, publicResultId } };
    }
  }
  return { consent: consentGranted ? "GRANTED" as const : "NOT_GRANTED" as const,
    adminRelease: adminReleaseActive ? "ACTIVE" as const : "INACTIVE" as const,
    publicRoute: { status: "UNAVAILABLE" as const } };
}

async function comparisonAccess(tx: Tx, raceId: string, firstPublicResultId: string, secondPublicResultId: string, thirdPublicResultId?: string): Promise<readonly PublicAccess[] | null> {
  const request = publicParticipantRouteComparisonQuerySchema.safeParse({ first: firstPublicResultId, second: secondPublicResultId, ...(thirdPublicResultId === undefined ? {} : { third: thirdPublicResultId }) });
  if (!request.success) return null;
  const ids = request.data.third === undefined ? [request.data.first, request.data.second] : [request.data.first, request.data.second, request.data.third];
  const accesses = await Promise.all(ids.map((publicResultId) => accessForPublicResult(tx, raceId, publicResultId)));
  if (accesses.some((access) => access === null)) return null;
  const verified = accesses as PublicAccess[];
  const first = verified[0];
  if (!first || verified.some((access) =>
    access.map.uploadId !== first.map.uploadId ||
    access.publication.georeferenceId !== first.publication.georeferenceId ||
    access.courseVersionId !== first.courseVersionId ||
    access.imageWidth !== first.imageWidth || access.imageHeight !== first.imageHeight
  )) return null;
  return verified;
}

export async function readPublicParticipantRoute(db: Database, raceId: string, publicResultId: string): Promise<{ status: "ok"; response: PublicParticipantRouteViewResponse } | { status: "not-found" }> {
  if (!uuid.test(raceId)) return { status: "not-found" };
  return db.transaction(async tx => {
    await lockRaceForSnapshot(tx, raceId);
    const access = await accessForPublicResult(tx, raceId, publicResultId);
    const response = access ? await publicRouteView(tx, access) : null;
    return response ? { status: "ok" as const, response } : { status: "not-found" as const };
  });
}

export async function readPublicParticipantRouteComparison(db: Database, raceId: string, firstPublicResultId: string, secondPublicResultId: string, thirdPublicResultId?: string): Promise<{ status: "ok"; response: PublicParticipantRouteComparisonResponse } | { status: "not-found" }> {
  if (!uuid.test(raceId)) return { status: "not-found" };
  return db.transaction(async tx => {
    await lockRaceForSnapshot(tx, raceId);
    const accesses = await comparisonAccess(tx, raceId, firstPublicResultId, secondPublicResultId, thirdPublicResultId);
    if (!accesses) return { status: "not-found" as const };
    const routes = await Promise.all(accesses.map((access) => publicRouteView(tx, access)));
    const first = routes[0];
    if (!first || routes.some((route) => !route || JSON.stringify(route.controls) !== JSON.stringify(first.controls))) return { status: "not-found" as const };
    const sourceSplits = accesses.map((access) => access.resultSplits);
    const firstSourceSplits = sourceSplits[0];
    const compatibleSplits = firstSourceSplits?.status === "AVAILABLE" && sourceSplits.every((splits) =>
      splits.status === "AVAILABLE" && splits.splits.length === firstSourceSplits.splits.length &&
      splits.splits.every((split, index) => split.controlCode === firstSourceSplits.splits[index]?.controlCode && split.occurrence === firstSourceSplits.splits[index]?.occurrence)
    );
    const responseRoutes = routes.map((route, index) => {
      if (!route) throw new Error("PUBLIC_ROUTE_COMPARISON_ROUTE_MISSING");
      return { participant: accesses[index]?.participant, resultSplits: compatibleSplits ? accesses[index]?.resultSplits : { status: "UNAVAILABLE" }, points: route.points, metadata: route.metadata, playback: route.playback };
    });
    return { status: "ok" as const, response: publicParticipantRouteComparisonResponseSchema.parse({ formatVersion: accesses.length === 3 ? 3 : 2, imageWidth: first.imageWidth, imageHeight: first.imageHeight, routes: responseRoutes, controls: first.controls, notice: "ROUTE_COMPARISON_NOT_GPS_VERIFIED" }) };
  });
}

export async function resolvePublicParticipantRouteMap(db: Database, raceId: string, publicResultId: string) {
  if (!uuid.test(raceId)) return { status: "not-found" as const };
  return db.transaction(async tx => { await lockRaceForSnapshot(tx, raceId); const access = await accessForPublicResult(tx, raceId, publicResultId); return access ? { status: "ok" as const, manifest: access.map, publicationId: access.publication.id } : { status: "not-found" as const }; });
}

export async function resolvePublicParticipantRouteComparisonMap(db: Database, raceId: string, firstPublicResultId: string, secondPublicResultId: string, thirdPublicResultId?: string) {
  if (!uuid.test(raceId)) return { status: "not-found" as const };
  return db.transaction(async tx => {
    await lockRaceForSnapshot(tx, raceId);
    const accesses = await comparisonAccess(tx, raceId, firstPublicResultId, secondPublicResultId, thirdPublicResultId);
    const first = accesses?.[0];
    return first ? { status: "ok" as const, manifest: first.map, publicationIds: accesses.map((access) => access.publication.id) } : { status: "not-found" as const };
  });
}
