import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  adminRaceMapStateSchema, publicLegRoutesSchema, raceMapGeoreferenceRequestSchema, participantRouteUploadResponseSchema,
  legKeySchema, type AdminRaceMapState, type ParticipantRouteUploadResponse, type PublicLegRoutes, type RaceMapProblem
} from "@o-tid/contracts";
import { deriveRasterGeoreference, projectRoute, RasterGeoreferenceError, routeLegs, routeSegment, runnerLegs, timedRoutePoints,
  type RoutePoint } from "@o-tid/domain";
import { schema, type Database } from "@o-tid/database";
import { GpxValidationError, parseGpxTrack } from "@o-tid/route-xml";
import { lockRaceForMutation, lockRaceForSnapshot } from "./concurrency";
import { authenticatePairingAdminSessionForMutation, authenticatePairingAdminSessionForProtectedRead,
  type PairingAdminRequestAuthentication } from "./pairing-admin";
import { publicResultTimings, type PublicResultTiming } from "./results";
import { imageDimensions } from "./image-dimensions";

/**
 * Karta och vägval (ADR-0171, PLAN.md steg 16). Kartbilden och GPX-filerna sparas i PostgreSQL. Bara admin
 * skriver (samma serverkontroll som resten av arbetsytan, ADR-0168 beslut 4). Det publika läser bara kartan när
 * den är georefererad och bara rutternas delar mellan stämplingarna för en sträcka, aldrig hela rutten.
 */
type Authentication = Omit<PairingAdminRequestAuthentication, "capability">;
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" };
type Problem = { status: "problem"; problem: RaceMapProblem };
const capability = "MANAGE_RACE" as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fileName = (value: string, fallback: string) => value.replace(/\p{Cc}/gu, "").trim().slice(0, 200) || fallback;
const iso = (value: Date) => value.toISOString();

/** Sträckorna som rutten har ett vägval på, och hur många sträckor löparen har. */
function coverage(points: readonly RoutePoint[], timing: PublicResultTiming | undefined): { coveredLegs: number; legs: number; covered: string[] } {
  if (!timing || timing.startMs === null) return { coveredLegs: 0, legs: 0, covered: [] };
  const legs = runnerLegs(timing.splits, timing.elapsedMs);
  const covered = routeLegs(points, timing.startMs, legs);
  return { coveredLegs: covered.length, legs: legs.length, covered };
}

async function adminRead<T>(db: Database, input: Authentication, now: Date, read: (tx: DatabaseTransaction) => Promise<T>): Promise<Failure | T> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForProtectedRead(tx, { ...input, capability }, now);
    if (auth.status !== "authenticated") return auth;
    return read(tx);
  });
}

async function adminWrite<T>(db: Database, input: Authentication, now: Date,
  write: (tx: DatabaseTransaction, actorId: string) => Promise<T>): Promise<Failure | T> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await authenticatePairingAdminSessionForMutation(tx, { ...input, capability, requireCsrf: true }, now);
    if (auth.status !== "authenticated") return auth;
    await lockRaceForMutation(tx, input.raceId);
    return write(tx, auth.principal.accessCredentialId);
  });
}

async function audit(tx: DatabaseTransaction, raceId: string, entityId: string, actorId: string, action: string, after: Record<string, unknown>) {
  await tx.insert(schema.auditEvents).values({ raceId, entityType: "race_map", entityId, action,
    actorKind: "RACE_ADMIN_ACCESS_CREDENTIAL", actorId, after });
}

/** Kartan (utan bilden), löparna som kan få rutt och de uppladdade rutterna med hur många sträckor de täcker. */
export async function readRaceMapStateAsAdministrator(db: Database, input: Authentication, now = new Date())
  : Promise<Failure | { status: "ok"; response: AdminRaceMapState }> {
  return adminRead(db, input, now, async tx => {
    const raceId = input.raceId;
    const [map] = await tx.select({ fileName: schema.raceMaps.fileName, mediaType: schema.raceMaps.mediaType, width: schema.raceMaps.width,
      height: schema.raceMaps.height, byteLength: schema.raceMaps.byteLength, uploadedAt: schema.raceMaps.uploadedAt,
      tiePoints: schema.raceMaps.tiePoints, georeferencedAt: schema.raceMaps.georeferencedAt })
      .from(schema.raceMaps).where(eq(schema.raceMaps.raceId, raceId));
    const runners = await tx.select({ entryId: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
      club: schema.entries.organisationName, className: schema.classes.name })
      .from(schema.entries).innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
      .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.teamId)))
      .orderBy(asc(schema.classes.name), asc(schema.entries.familyName), asc(schema.entries.givenName));
    const routes = await tx.select({ entryId: schema.participantRoutes.entryId, fileName: schema.participantRoutes.fileName,
      pointCount: schema.participantRoutes.pointCount, startsAt: schema.participantRoutes.startsAt, endsAt: schema.participantRoutes.endsAt,
      uploadedAt: schema.participantRoutes.uploadedAt, points: schema.participantRoutes.points })
      .from(schema.participantRoutes).where(eq(schema.participantRoutes.raceId, raceId));
    const timings = routes.length === 0 ? new Map<string, PublicResultTiming>()
      : new Map((await publicResultTimings(tx, raceId)).map(timing => [timing.entryId, timing]));
    return { status: "ok" as const, response: adminRaceMapStateSchema.parse({
      formatVersion: 1, raceId,
      map: map ? { fileName: map.fileName, mediaType: map.mediaType, width: map.width, height: map.height, byteLength: map.byteLength,
        uploadedAt: iso(map.uploadedAt), tiePoints: map.tiePoints, georeferencedAt: map.georeferencedAt ? iso(map.georeferencedAt) : null } : null,
      runners: runners.map(runner => ({ entryId: runner.entryId, name: `${runner.givenName} ${runner.familyName}`, className: runner.className,
        club: runner.club?.trim() || null })),
      routes: routes.map(route => {
        const { coveredLegs, legs } = coverage(route.points, timings.get(route.entryId));
        return { entryId: route.entryId, fileName: route.fileName, pointCount: route.pointCount, startsAt: iso(route.startsAt),
          endsAt: iso(route.endsAt), uploadedAt: iso(route.uploadedAt), coveredLegs, legs };
      })
    }) };
  });
}

/** Kartbilden för georeferensen i arbetsytan (även innan den är georefererad). */
export async function readRaceMapImageAsAdministrator(db: Database, input: Authentication, now = new Date())
  : Promise<Failure | { status: "ok"; mediaType: string; image: Buffer }> {
  return adminRead(db, input, now, async tx => {
    const [map] = await tx.select({ mediaType: schema.raceMaps.mediaType, image: schema.raceMaps.image })
      .from(schema.raceMaps).where(eq(schema.raceMaps.raceId, input.raceId));
    return map ? { status: "ok" as const, mediaType: map.mediaType, image: map.image } : { status: "not-found" as const };
  });
}

/** Ny eller utbytt kartbild (PNG eller JPEG). En ny bild måste georefereras igen. */
export async function saveRaceMapAsAdministrator(db: Database, input: Authentication & { bytes: Uint8Array; fileName: string }, now = new Date())
  : Promise<Failure | Problem | { status: "ok" }> {
  const image = imageDimensions(input.bytes);
  if (!image) return { status: "problem", problem: "INVALID_IMAGE" };
  return adminWrite(db, input, now, async (tx, actorId) => {
    const values = { fileName: fileName(input.fileName, "karta"), mediaType: image.mediaType, image: Buffer.from(input.bytes),
      sha256: sha256(input.bytes), byteLength: input.bytes.byteLength, width: image.width, height: image.height,
      tiePoints: null, transform: null, uploadedAt: now, georeferencedAt: null };
    await tx.insert(schema.raceMaps).values({ raceId: input.raceId, ...values })
      .onConflictDoUpdate({ target: schema.raceMaps.raceId, set: values });
    await audit(tx, input.raceId, input.raceId, actorId, "RACE_MAP_SAVED", { fileName: values.fileName, sha256: values.sha256,
      width: image.width, height: image.height });
    return { status: "ok" as const };
  });
}

/** Georeferens med tre punkter (pixel och WGS84). Domänen räknar ut och kontrollerar den affina transformen. */
export async function georeferenceRaceMapAsAdministrator(db: Database, input: Authentication & { request: unknown }, now = new Date())
  : Promise<Failure | Problem | { status: "ok" }> {
  const request = raceMapGeoreferenceRequestSchema.safeParse(input.request);
  if (!request.success) return { status: "invalid-request" };
  return adminWrite(db, input, now, async (tx, actorId) => {
    const [map] = await tx.select({ width: schema.raceMaps.width, height: schema.raceMaps.height })
      .from(schema.raceMaps).where(eq(schema.raceMaps.raceId, input.raceId));
    if (!map) return { status: "problem" as const, problem: "NO_MAP" as const };
    let derived;
    try {
      derived = deriveRasterGeoreference({ imageWidth: map.width, imageHeight: map.height, tiePoints: request.data.tiePoints });
    } catch (error) {
      if (error instanceof RasterGeoreferenceError) return { status: "problem" as const, problem: "INVALID_GEOREFERENCE" as const };
      throw error;
    }
    await tx.update(schema.raceMaps).set({ tiePoints: request.data.tiePoints, transform: { ...derived.transform }, georeferencedAt: now })
      .where(eq(schema.raceMaps.raceId, input.raceId));
    await audit(tx, input.raceId, input.raceId, actorId, "RACE_MAP_GEOREFERENCED", { tiePoints: request.data.tiePoints });
    return { status: "ok" as const };
  });
}

/** Tar bort kartan. Rutterna finns kvar men visas inte förrän en ny karta är georefererad. */
export async function removeRaceMapAsAdministrator(db: Database, input: Authentication, now = new Date()): Promise<Failure | { status: "ok" }> {
  return adminWrite(db, input, now, async (tx, actorId) => {
    const removed = await tx.delete(schema.raceMaps).where(eq(schema.raceMaps.raceId, input.raceId)).returning({ raceId: schema.raceMaps.raceId });
    if (removed.length === 0) return { status: "not-found" as const };
    await audit(tx, input.raceId, input.raceId, actorId, "RACE_MAP_REMOVED", {});
    return { status: "ok" as const };
  });
}

/** Löparens GPX-rutt; ersätter en tidigare. Bara punkter med tid sparas, eftersom de kopplas till stämplingarna. */
export async function saveParticipantRouteAsAdministrator(db: Database,
  input: Authentication & { entryId: string; bytes: Uint8Array; fileName: string }, now = new Date())
  : Promise<Failure | Problem | { status: "ok"; response: ParticipantRouteUploadResponse }> {
  if (!uuid.test(input.entryId)) return { status: "invalid-request" };
  let points: RoutePoint[];
  try {
    points = timedRoutePoints(parseGpxTrack(input.bytes).points);
  } catch (error) {
    if (error instanceof GpxValidationError) return { status: "problem", problem: "INVALID_GPX" };
    throw error;
  }
  if (points.length < 2) return { status: "problem", problem: "ROUTE_WITHOUT_TIMES" };
  return adminWrite(db, input, now, async (tx, actorId) => {
    const [entry] = await tx.select({ teamId: schema.entries.teamId }).from(schema.entries)
      .where(and(eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, input.raceId)));
    if (!entry) return { status: "not-found" as const };
    if (entry.teamId !== null) return { status: "problem" as const, problem: "NOT_INDIVIDUAL" as const };
    const values = { raceId: input.raceId, fileName: fileName(input.fileName, "rutt.gpx"), gpx: Buffer.from(input.bytes),
      sha256: sha256(input.bytes), byteLength: input.bytes.byteLength, points, pointCount: points.length,
      startsAt: new Date(points[0]![0]), endsAt: new Date(points.at(-1)![0]), uploadedAt: now };
    await tx.insert(schema.participantRoutes).values({ entryId: input.entryId, ...values })
      .onConflictDoUpdate({ target: schema.participantRoutes.entryId, set: values });
    await audit(tx, input.raceId, input.entryId, actorId, "PARTICIPANT_ROUTE_SAVED", { fileName: values.fileName, sha256: values.sha256,
      pointCount: values.pointCount });
    const timing = (await publicResultTimings(tx, input.raceId)).find(row => row.entryId === input.entryId);
    const { coveredLegs, legs } = coverage(points, timing);
    return { status: "ok" as const, response: participantRouteUploadResponseSchema.parse({ formatVersion: 1, raceId: input.raceId,
      entryId: input.entryId, pointCount: points.length, coveredLegs, legs }) };
  });
}

export async function removeParticipantRouteAsAdministrator(db: Database, input: Authentication & { entryId: string }, now = new Date())
  : Promise<Failure | { status: "ok" }> {
  if (!uuid.test(input.entryId)) return { status: "invalid-request" };
  return adminWrite(db, input, now, async (tx, actorId) => {
    const removed = await tx.delete(schema.participantRoutes).where(and(eq(schema.participantRoutes.entryId, input.entryId),
      eq(schema.participantRoutes.raceId, input.raceId))).returning({ entryId: schema.participantRoutes.entryId });
    if (removed.length === 0) return { status: "not-found" as const };
    await audit(tx, input.raceId, input.entryId, actorId, "PARTICIPANT_ROUTE_REMOVED", {});
    return { status: "ok" as const };
  });
}

/** Publikt läsande i en ögonblicksbild av loppet; ett okänt lopp ger undefined. */
async function publicRead<T>(db: Database, raceId: string, read: (tx: DatabaseTransaction) => Promise<T>): Promise<T | undefined> {
  if (!uuid.test(raceId)) return undefined;
  return db.transaction(async tx => {
    const [race] = await tx.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.id, raceId));
    if (!race) return undefined;
    await lockRaceForSnapshot(tx, raceId);
    return read(tx);
  }, { isolationLevel: "repeatable read" });
}

async function georeferencedMap(tx: DatabaseTransaction, raceId: string) {
  const [map] = await tx.select({ width: schema.raceMaps.width, height: schema.raceMaps.height, sha256: schema.raceMaps.sha256,
    transform: schema.raceMaps.transform }).from(schema.raceMaps).where(eq(schema.raceMaps.raceId, raceId));
  return map?.transform ? { ...map, transform: map.transform } : undefined;
}

/** Kartbilden publikt, bara när den är georefererad (annars finns inga vägval att visa). */
export async function readPublicRaceMapImage(db: Database, raceId: string)
  : Promise<{ mediaType: string; image: Buffer; sha256: string } | undefined> {
  return publicRead(db, raceId, async tx => {
    const [map] = await tx.select({ mediaType: schema.raceMaps.mediaType, image: schema.raceMaps.image, sha256: schema.raceMaps.sha256,
      transform: schema.raceMaps.transform }).from(schema.raceMaps).where(eq(schema.raceMaps.raceId, raceId));
    return map?.transform ? { mediaType: map.mediaType, image: map.image, sha256: map.sha256 } : undefined;
  });
}

/** Vilka sträckor varje löpare (publikt resultat-id) har vägval på. Tomt utan georefererad karta. */
export type PublicRouteIndex = { legs: Record<string, string[]> };

export async function readPublicRouteIndex(db: Database, raceId: string): Promise<PublicRouteIndex> {
  return await publicRead(db, raceId, async tx => {
    if (!await georeferencedMap(tx, raceId)) return { legs: {} };
    const routes = await tx.select({ entryId: schema.participantRoutes.entryId, points: schema.participantRoutes.points })
      .from(schema.participantRoutes).where(eq(schema.participantRoutes.raceId, raceId));
    if (routes.length === 0) return { legs: {} };
    const timings = new Map((await publicResultTimings(tx, raceId)).map(timing => [timing.entryId, timing]));
    const legs: Record<string, string[]> = {};
    for (const route of routes) {
      const timing = timings.get(route.entryId);
      const { covered } = coverage(route.points, timing);
      if (timing && covered.length > 0) legs[timing.publicResultId] = covered;
    }
    return { legs };
  }) ?? { legs: {} };
}

/** Andra löpares vägval som visas för jämförelse på samma sträcka (snabbast först). */
const MAX_COMPARED_ROUTES = 50;

/**
 * Vägvalen på en sträcka: den valda löparens del av rutten och andra löpares (alla klasser) på samma sträcka,
 * dvs. samma från- och till-kontroll, som pixlar på kartan. Undefined om löparen saknar vägval på sträckan.
 */
export async function readPublicLegRoutes(db: Database, raceId: string, publicResultId: string, leg: string)
  : Promise<PublicLegRoutes | undefined> {
  if (!uuid.test(publicResultId) || !legKeySchema.safeParse(leg).success) return undefined;
  return publicRead(db, raceId, async tx => {
    const map = await georeferencedMap(tx, raceId);
    if (!map) return undefined;
    const routes = await tx.select({ entryId: schema.participantRoutes.entryId, points: schema.participantRoutes.points })
      .from(schema.participantRoutes).where(eq(schema.participantRoutes.raceId, raceId));
    const timings = new Map((await publicResultTimings(tx, raceId)).map(timing => [timing.entryId, timing]));
    const classes = new Map((await tx.select({ id: schema.classes.id, name: schema.classes.name }).from(schema.classes)
      .where(eq(schema.classes.raceId, raceId))).map(row => [row.id, row.name]));
    const runners = routes.flatMap(route => {
      const timing = timings.get(route.entryId);
      if (!timing || timing.startMs === null) return [];
      const match = runnerLegs(timing.splits, timing.elapsedMs).find(candidate => candidate.leg === leg);
      const segment = match ? routeSegment(route.points, timing.startMs + match.fromElapsedMs, timing.startMs + match.toElapsedMs) : [];
      if (!match || segment.length < 2) return [];
      return [{ publicResultId: timing.publicResultId, name: `${timing.givenName} ${timing.familyName}`,
        className: classes.get(timing.classId) ?? "", legMs: match.toElapsedMs - match.fromElapsedMs,
        selected: timing.publicResultId === publicResultId, points: projectRoute(map.transform, segment) }];
    });
    const selected = runners.find(runner => runner.selected);
    if (!selected) return undefined;
    const others = runners.filter(runner => !runner.selected).sort((a, b) => a.legMs - b.legMs).slice(0, MAX_COMPARED_ROUTES);
    return publicLegRoutesSchema.parse({ formatVersion: 1, raceId, leg, map: { width: map.width, height: map.height,
      version: map.sha256.slice(0, 16) }, runners: [selected, ...others] });
  });
}
