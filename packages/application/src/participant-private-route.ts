import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { deriveRouteMetadata, RouteMetadataError } from "@o-tid/domain";
import {
  participantPrivateRouteDetailResponseSchema,
  participantPrivateRouteListResponseSchema,
  type ParticipantPrivateRouteDetailResponse,
  type ParticipantPrivateRouteListResponse
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { lockRaceForSnapshot } from "./concurrency";
import { exactRouteSharingForOwner } from "./public-participant-route";
import { authenticateUserAccountSessionForProtectedRead, type UserAccountSessionProof } from "./user-account";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "invalid-route" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const maxRoutes = 10_000;

function validNow(now: Date): boolean { return Number.isFinite(now.getTime()); }

export async function activeClaimForEntry(tx: DatabaseTransaction, accountId: string, raceId: string, entryId: string): Promise<boolean> {
  // An administrative revocation locks the same entry for update. Check the
  // journal only after this shared lock to avoid returning stale private data.
  const [entry] = await tx.select({ id: schema.entries.id }).from(schema.entries)
    .where(and(eq(schema.entries.id, entryId), eq(schema.entries.raceId, raceId))).for("share");
  if (!entry) return false;
  const [claim] = await tx.select({ id: schema.participantEntryClaimIssues.id })
    .from(schema.participantEntryClaimIssues)
    .innerJoin(schema.participantEntryClaimRedemptions,
      eq(schema.participantEntryClaimRedemptions.claimId, schema.participantEntryClaimIssues.id))
    .leftJoin(schema.participantEntryClaimRevocations,
      eq(schema.participantEntryClaimRevocations.claimId, schema.participantEntryClaimIssues.id))
    .where(and(
      eq(schema.participantEntryClaimIssues.raceId, raceId),
      eq(schema.participantEntryClaimIssues.entryId, entryId),
      eq(schema.participantEntryClaimRedemptions.accountId, accountId),
      isNull(schema.participantEntryClaimRevocations.id)
    )).limit(1);
  return !!claim;
}

/** Account-owned index of immutable private GPX versions; no result publication is required. */
export async function listMyPrivateRoutes(
  db: Database, proof: UserAccountSessionProof, now = new Date()
): Promise<Failure | { status: "ok"; response: ParticipantPrivateRouteListResponse }> {
  if (!validNow(now)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    const candidates = await tx.select({
      routeUploadId: schema.routeObjectManifests.uploadId,
      raceId: schema.routeObjectManifests.raceId,
      entryId: schema.routeObjectManifests.entryId,
      eventName: schema.events.name,
      raceName: schema.races.name,
      storedAt: schema.routeObjectManifests.storedAt,
      pointCount: schema.routeObjectManifests.pointCount,
      segmentCount: schema.routeObjectManifests.segmentCount
    }).from(schema.routeObjectManifests)
      .innerJoin(schema.participantEntryClaimIssues, and(
        eq(schema.participantEntryClaimIssues.raceId, schema.routeObjectManifests.raceId),
        eq(schema.participantEntryClaimIssues.entryId, schema.routeObjectManifests.entryId)))
      .innerJoin(schema.participantEntryClaimRedemptions,
        eq(schema.participantEntryClaimRedemptions.claimId, schema.participantEntryClaimIssues.id))
      .leftJoin(schema.participantEntryClaimRevocations,
        eq(schema.participantEntryClaimRevocations.claimId, schema.participantEntryClaimIssues.id))
      .innerJoin(schema.races, eq(schema.races.id, schema.routeObjectManifests.raceId))
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(and(eq(schema.participantEntryClaimRedemptions.accountId, auth.principal.accountId),
        isNull(schema.participantEntryClaimRevocations.id)))
      .orderBy(desc(schema.routeObjectManifests.storedAt), asc(schema.routeObjectManifests.uploadId))
      .limit(maxRoutes + 1);
    if (candidates.length > maxRoutes) return { status: "invalid-route" } as const;
    const items: ParticipantPrivateRouteListResponse["items"] = [];
    const checked = new Map<string, boolean>();
    const seen = new Set<string>();
    for (const row of candidates) {
      const entryKey = `${row.raceId}:${row.entryId}`;
      let active = checked.get(entryKey);
      if (active === undefined) {
        active = await activeClaimForEntry(tx, auth.principal.accountId, row.raceId, row.entryId);
        checked.set(entryKey, active);
      }
      if (!active || seen.has(row.routeUploadId)) continue;
      seen.add(row.routeUploadId);
      items.push({ routeUploadId: row.routeUploadId, raceId: row.raceId,
        eventName: row.eventName, raceName: row.raceName, storedAt: row.storedAt.toISOString(),
        pointCount: row.pointCount, segmentCount: row.segmentCount });
    }
    return { status: "ok", response: participantPrivateRouteListResponseSchema.parse({ formatVersion: 1, items }) } as const;
  });
}

/** A route selector never grants access: resolve its exact entry through a live account claim. */
export async function readMyPrivateRoute(
  db: Database, proof: UserAccountSessionProof, routeUploadId: string, now = new Date()
): Promise<Failure | { status: "ok"; response: ParticipantPrivateRouteDetailResponse }> {
  if (!uuid.test(routeUploadId) || !validNow(now)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, proof, now);
    if (auth.status !== "authenticated") return auth;
    const [route] = await tx.select({
      routeUploadId: schema.routeObjectManifests.uploadId,
      raceId: schema.routeObjectManifests.raceId,
      entryId: schema.routeObjectManifests.entryId,
      sourceHash: schema.routeObjectManifests.sha256,
      publicResultId: schema.entries.publicResultId,
      eventName: schema.events.name,
      raceName: schema.races.name,
      storedAt: schema.routeObjectManifests.storedAt,
      pointCount: schema.routeObjectManifests.pointCount,
      segmentCount: schema.routeObjectManifests.segmentCount
    }).from(schema.routeObjectManifests)
      .innerJoin(schema.entries, and(eq(schema.entries.id, schema.routeObjectManifests.entryId), eq(schema.entries.raceId, schema.routeObjectManifests.raceId)))
      .innerJoin(schema.races, eq(schema.races.id, schema.routeObjectManifests.raceId))
      .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
      .where(eq(schema.routeObjectManifests.uploadId, routeUploadId)).limit(1);
    if (!route) return { status: "not-found" } as const;
    await lockRaceForSnapshot(tx, route.raceId);
    if (!await activeClaimForEntry(tx, auth.principal.accountId, route.raceId, route.entryId)) {
      return { status: "not-found" } as const;
    }
    const points = await tx.select({
      segment: schema.routePoints.segment,
      latitude: schema.routePoints.latitude,
      longitude: schema.routePoints.longitude,
      recordedAt: schema.routePoints.recordedAt
    }).from(schema.routePoints).where(eq(schema.routePoints.uploadId, routeUploadId))
      .orderBy(asc(schema.routePoints.sequence));
    if (points.length !== route.pointCount) return { status: "invalid-route" } as const;
    try {
      const metadata = deriveRouteMetadata(points);
      if (metadata.segmentCount !== route.segmentCount) return { status: "invalid-route" } as const;
      const sharing = await exactRouteSharingForOwner(tx, route.raceId, route.entryId,
        route.publicResultId, route.routeUploadId, route.sourceHash);
      return { status: "ok", response: participantPrivateRouteDetailResponseSchema.parse({
        formatVersion: 2, routeUploadId: route.routeUploadId, raceId: route.raceId,
        eventName: route.eventName, raceName: route.raceName, storedAt: route.storedAt.toISOString(),
        metadata: { distanceMeters: metadata.distanceMeters, pointCount: metadata.pointCount,
          segmentCount: metadata.segmentCount,
          timing: metadata.timing.status === "AVAILABLE" ? {
            status: "AVAILABLE", startedAt: metadata.timing.startedAt.toISOString(),
            finishedAt: metadata.timing.finishedAt.toISOString(),
            durationMilliseconds: metadata.timing.durationMilliseconds
          } : { status: "UNAVAILABLE" } },
        sharing
      }) } as const;
    } catch (error) {
      if (error instanceof RouteMetadataError) return { status: "invalid-route" } as const;
      throw error;
    }
  });
}
