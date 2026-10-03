import { and, asc, desc, eq } from "drizzle-orm";
import { deriveRasterGeoreference, invertRasterCoordinate, RasterGeoreferenceError } from "@o-tid/domain";
import { privateRoutePreviewCandidatesResponseSchema, privateRoutePreviewQuerySchema, privateRoutePreviewResponseSchema, type PrivateRoutePreviewCandidatesResponse, type PrivateRoutePreviewResponse } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { authenticatePairingAdminSessionForProtectedRead, type PairingAdminRequestAuthentication } from "./pairing-admin";

const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type ReadInput = Omit<PairingAdminRequestAuthentication, "capability" | "requireCsrf">;
type Outcome<T> = { status: "ok"; response: T } | { status: "unauthorized" | "forbidden" | "not-found" | "invalid-request" | "invalid-preview" };

function sameTransform(left: Record<string, number>, right: Record<string, number>): boolean {
  return ["a", "b", "c", "d", "e", "f"].every(key => Number.isFinite(left[key]) && Math.abs((left[key] ?? Number.NaN) - (right[key] ?? Number.NaN)) <= 1e-12);
}

export async function resolveCalibration(tx: Parameters<Database["transaction"]>[0] extends (arg: infer T) => unknown ? T : never, raceId: string, mapManifestId: string, georeferenceId: string) {
  const [map] = await tx.select().from(schema.mapObjectManifests).where(and(eq(schema.mapObjectManifests.uploadId, mapManifestId), eq(schema.mapObjectManifests.raceId, raceId)));
  const [georeference] = await tx.select().from(schema.mapGeoreferences).where(and(eq(schema.mapGeoreferences.id, georeferenceId), eq(schema.mapGeoreferences.raceId, raceId)));
  if (!map || !georeference || georeference.manifestId !== map.uploadId || georeference.sourceHash !== map.sha256) return null;
  try {
    const derived = deriveRasterGeoreference({ imageWidth: georeference.imageWidth, imageHeight: georeference.imageHeight, tiePoints: georeference.tiePoints as Parameters<typeof deriveRasterGeoreference>[0]["tiePoints"] });
    if (georeference.crs !== "EPSG:4326" || !sameTransform(georeference.transform, derived.transform)) return null;
    return { map, georeference, transform: derived.transform };
  } catch (error) {
    if (error instanceof RasterGeoreferenceError) return null;
    throw error;
  }
}

async function authorize(tx: Parameters<Database["transaction"]>[0] extends (arg: infer T) => unknown ? T : never, input: ReadInput, now: Date) {
  return authenticatePairingAdminSessionForProtectedRead(tx, { sessionToken: input.sessionToken, raceId: input.raceId, capability }, now);
}

export async function listPrivateRoutePreviewCandidatesAsAdmin(db: Database, input: ReadInput, now = new Date()): Promise<Outcome<PrivateRoutePreviewCandidatesResponse>> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authorize(tx, input, now); if (auth.status !== "authenticated") return auth;
    const rows = await tx.select({ uploadId: schema.routeObjectManifests.uploadId, givenName: schema.entries.givenName,
      familyName: schema.entries.familyName, storedAt: schema.routeObjectManifests.storedAt, pointCount: schema.routeObjectManifests.pointCount,
      segmentCount: schema.routeObjectManifests.segmentCount }).from(schema.routeObjectManifests)
      .innerJoin(schema.entries, and(eq(schema.entries.id, schema.routeObjectManifests.entryId), eq(schema.entries.raceId, schema.routeObjectManifests.raceId)))
      .where(eq(schema.routeObjectManifests.raceId, auth.principal.raceId)).orderBy(desc(schema.routeObjectManifests.storedAt)).limit(100);
    return { status: "ok", response: privateRoutePreviewCandidatesResponseSchema.parse({ formatVersion: 1, raceId: auth.principal.raceId,
      routes: rows.map(row => ({ routeUploadId: row.uploadId, displayName: `${row.givenName} ${row.familyName}`.trim(), storedAt: row.storedAt.toISOString(), pointCount: row.pointCount, segmentCount: row.segmentCount })) }) };
  });
}

/** Private, pixel-only projection. WGS84 never reaches the browser. */
export async function readPrivateRoutePreviewAsAdmin(db: Database, input: ReadInput & { query: unknown }, now = new Date()): Promise<Outcome<PrivateRoutePreviewResponse>> {
  const parsed = privateRoutePreviewQuerySchema.safeParse(input.query);
  if (!uuid.test(input.raceId) || !parsed.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authorize(tx, input, now); if (auth.status !== "authenticated") return auth;
    const resolved = await resolveCalibration(tx, auth.principal.raceId, parsed.data.mapManifestId, parsed.data.georeferenceId);
    if (!resolved) return { status: "not-found" };
    const [route] = await tx.select().from(schema.routeObjectManifests).where(and(eq(schema.routeObjectManifests.uploadId, parsed.data.routeUploadId), eq(schema.routeObjectManifests.raceId, auth.principal.raceId)));
    if (!route) return { status: "not-found" };
    const points = await tx.select({ latitude: schema.routePoints.latitude, longitude: schema.routePoints.longitude, segment: schema.routePoints.segment })
      .from(schema.routePoints).where(eq(schema.routePoints.uploadId, route.uploadId)).orderBy(asc(schema.routePoints.sequence));
    if (points.length !== route.pointCount || points.length < 2) return { status: "invalid-preview" };
    const projected = points.map(point => ({ ...invertRasterCoordinate(resolved.transform, point.longitude, point.latitude), segment: point.segment }));
    if (projected.some(point => !Number.isFinite(point.pixelX) || !Number.isFinite(point.pixelY) || point.pixelX < 0 || point.pixelX >= resolved.georeference.imageWidth || point.pixelY < 0 || point.pixelY >= resolved.georeference.imageHeight)) return { status: "invalid-preview" };
    return { status: "ok", response: privateRoutePreviewResponseSchema.parse({ formatVersion: 1, raceId: auth.principal.raceId,
      imageWidth: resolved.georeference.imageWidth, imageHeight: resolved.georeference.imageHeight, mapSourceHash: resolved.map.sha256,
      points: projected.map(point => ({ x: point.pixelX, y: point.pixelY, segment: point.segment })) }) };
  });
}

/** Server-only manifest resolution for the protected map-byte adapter. */
export async function resolvePrivateRoutePreviewMapAsAdmin(db: Database, input: ReadInput & { query: unknown }, now = new Date()): Promise<Outcome<typeof schema.mapObjectManifests.$inferSelect>> {
  const query = privateRoutePreviewQuerySchema.pick({ mapManifestId: true, georeferenceId: true }).passthrough().safeParse(input.query);
  if (!uuid.test(input.raceId) || !query.success) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authorize(tx, input, now); if (auth.status !== "authenticated") return auth;
    const resolved = await resolveCalibration(tx, auth.principal.raceId, query.data.mapManifestId, query.data.georeferenceId);
    return resolved ? { status: "ok", response: resolved.map } : { status: "not-found" };
  });
}
