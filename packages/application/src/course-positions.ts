import { and, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import { geoLengthMeters, type ForkingGeoPoint } from "@o-tid/domain";
import type { GeoPosition, MapPositionImport } from "@o-tid/iof-xml";
import type { StoredCourseVariant } from "./course-variants";

/**
 * Steg 49: kontrollernas, startens och målets lägen ur banfilen (IOF Control/Position). De påverkar inga resultat
 * och sparas därför direkt vid inläsningen: varianternas längd när filen saknar Length och banan på kartan.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/** Sparar kontrollernas lägen (en kontroll som saknas skapas, som när en bana sparas). */
export async function storeControlPositions(tx: Executor, raceId: string, positions: readonly ({ code: number } & GeoPosition)[]): Promise<void> {
  for (const position of positions) {
    await tx.insert(schema.controls).values({ raceId, code: position.code, latitude: position.latitude, longitude: position.longitude })
      .onConflictDoUpdate({ target: [schema.controls.raceId, schema.controls.code],
        set: { latitude: position.latitude, longitude: position.longitude } });
  }
}

/**
 * Steg 52: kontrollernas lägen på kartan (IOF MapPosition, mm) och kartans skala, för kontrollkartan när WGS 84 saknas.
 * En kontroll som saknas skapas, som för lägena i WGS 84.
 */
export async function storeControlMapPositions(tx: Executor, raceId: string, positions: readonly ({ code: number } & MapPositionImport)[],
  scale: number | undefined): Promise<void> {
  for (const position of positions) {
    await tx.insert(schema.controls).values({ raceId, code: position.code, mapX: position.x, mapY: position.y })
      .onConflictDoUpdate({ target: [schema.controls.raceId, schema.controls.code], set: { mapX: position.x, mapY: position.y } });
  }
  if (scale !== undefined) await tx.update(schema.races).set({ courseMapScale: scale }).where(eq(schema.races.id, raceId));
}

/** Startens och målets lägen på en bana (WGS 84 och på kartan); ett läge som filen inte har står kvar. */
export async function storeCourseEnds(tx: Executor, raceId: string, courseId: string,
  ends: { startPosition?: GeoPosition | undefined; finishPosition?: GeoPosition | undefined;
    startMapPosition?: MapPositionImport | undefined; finishMapPosition?: MapPositionImport | undefined }): Promise<void> {
  if (!ends.startPosition && !ends.finishPosition && !ends.startMapPosition && !ends.finishMapPosition) return;
  await tx.update(schema.courses).set({ ...(ends.startPosition ? { startPosition: ends.startPosition } : {}),
    ...(ends.finishPosition ? { finishPosition: ends.finishPosition } : {}),
    ...(ends.startMapPosition ? { startMapPosition: { x: ends.startMapPosition.x, y: ends.startMapPosition.y } } : {}),
    ...(ends.finishMapPosition ? { finishMapPosition: { x: ends.finishMapPosition.x, y: ends.finishMapPosition.y } } : {}) })
    .where(and(eq(schema.courses.id, courseId), eq(schema.courses.raceId, raceId)));
}

export interface CoursePositions {
  readonly controls: ReadonlyMap<number, ForkingGeoPoint>;
  readonly start?: ForkingGeoPoint | undefined;
  readonly finish?: ForkingGeoPoint | undefined;
}

/** Lägena för en banas kontroller, start och mål (tomma när banfilen saknar dem). */
export async function loadCoursePositions(tx: Executor, raceId: string, courseId: string, codes: readonly number[]): Promise<CoursePositions> {
  const [course] = await tx.select({ start: schema.courses.startPosition, finish: schema.courses.finishPosition }).from(schema.courses)
    .where(and(eq(schema.courses.id, courseId), eq(schema.courses.raceId, raceId)));
  const rows = codes.length === 0 ? [] : await tx.select({ code: schema.controls.code, latitude: schema.controls.latitude,
    longitude: schema.controls.longitude }).from(schema.controls)
    .where(and(eq(schema.controls.raceId, raceId), inArray(schema.controls.code, [...new Set(codes)])));
  const controls = new Map<number, ForkingGeoPoint>();
  for (const row of rows) if (row.latitude !== null && row.longitude !== null) controls.set(row.code, { latitude: row.latitude, longitude: row.longitude });
  return { controls, start: course?.start ?? undefined, finish: course?.finish ?? undefined };
}

/** Steg 59: kartlägena (IOF MapPosition, mm) för en banas kontroller, start och mål. */
export interface CourseMapPositions {
  readonly controls: ReadonlyMap<number, { x: number; y: number }>;
  readonly start?: { x: number; y: number } | undefined;
  readonly finish?: { x: number; y: number } | undefined;
}

export async function loadCourseMapPositions(tx: Executor, raceId: string, courseId: string, codes: readonly number[]): Promise<CourseMapPositions> {
  const [course] = await tx.select({ start: schema.courses.startMapPosition, finish: schema.courses.finishMapPosition }).from(schema.courses)
    .where(and(eq(schema.courses.id, courseId), eq(schema.courses.raceId, raceId)));
  const rows = codes.length === 0 ? [] : await tx.select({ code: schema.controls.code, x: schema.controls.mapX, y: schema.controls.mapY })
    .from(schema.controls).where(and(eq(schema.controls.raceId, raceId), inArray(schema.controls.code, [...new Set(codes)])));
  const controls = new Map<number, { x: number; y: number }>();
  for (const row of rows) if (row.x !== null && row.y !== null) controls.set(row.code, { x: row.x, y: row.y });
  return { controls, start: course?.start ?? undefined, finish: course?.finish ?? undefined };
}

/** Kontrollföljden som lägen: start, kontroller, mål (undefined där läget saknas). */
export function coursePoints(positions: CoursePositions, controlCodes: readonly number[]): (ForkingGeoPoint | undefined)[] {
  return [positions.start, ...controlCodes.map(code => positions.controls.get(code)), positions.finish];
}

/** Varianterna med längd: banfilens längd, annars räknad ur lägena när alla är kända. */
export function withPositionLengths<T extends StoredCourseVariant>(variants: readonly T[], positions: CoursePositions): T[] {
  return variants.map(variant => variant.lengthMeters != null ? variant
    : { ...variant, lengthMeters: geoLengthMeters(coursePoints(positions, variant.controlCodes)) });
}
