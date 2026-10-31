import { and, eq } from "drizzle-orm";
import {
  adminRouteChoiceSchema, routeChoiceCalibrationRoutesSchema, routeChoicePublishRequestSchema, routeChoiceSettingsRequestSchema,
  type AdminRouteChoice, type RouteChoiceCalibrationRoutes, type RouteChoiceProblem, type RouteChoiceSettingsDto
} from "@o-tid/contracts";
import { schema, type Database, type RouteChoicePublished } from "@o-tid/database";
import { routeSegment, runnerLegs } from "@o-tid/domain";
import { isSupportedEpsg, mapPointToWgs84, wgs84ToMapPoint, type MapGeoreference } from "@o-tid/map-file";
import { lockRaceForMutation } from "./concurrency";
import { loadCourseForMap } from "./course-edit";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { publicResultTimings } from "./results";
import type { DbExecutor } from "./snapshot";
import { UUID_PATTERN as uuid } from "./serialization";

/**
 * Steg 60 (ADR-0179 beslut 7–13): vägvalsanalysen. Analysen räknas i arrangörens webbläsare ur kartfilen (ADR-0177);
 * servern sparar bara tävlingens inställningar och de bästa vägar som arrangören publicerar, med kartfilen (sha256) som de
 * räknades på. Bara admin läser och skriver. Kalibreringen får rutternas delar per sträcka (samma klipp som den publika
 * sträcktidsanalysen) utan namn.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" };
type Problem = { status: "problem"; problem: RouteChoiceProblem };
type ReadProof = Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">;

const EMPTY_SETTINGS: RouteChoiceSettingsDto = { version: 1 };
/** Kartlägen får ligga så långt utanför kartans yta och så långt från banfilens Position (samma som kontrollkartan). */
const MARGIN_MM = 10, MAX_DEVIATION_M = 10;

async function adminRead<T>(db: Database, input: ReadProof, now: Date, read: (tx: Transaction, raceId: string) => Promise<T>): Promise<Failure | T> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    return read(tx, auth.principal.raceId);
  }, { isolationLevel: "repeatable read" });
}

async function adminWrite<T>(db: Database, input: RaceSessionProof, now: Date, write: (tx: Transaction, raceId: string, actorId: string) => Promise<T>)
  : Promise<Failure | T> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    await lockRaceForMutation(tx, auth.principal.raceId);
    return write(tx, auth.principal.raceId, auth.principal.accountId);
  });
}

async function audit(tx: Transaction, raceId: string, actorId: string, action: string, after: Record<string, unknown>) {
  await tx.insert(schema.auditEvents).values({ raceId, entityType: "race_route_choice", entityId: raceId, action, actorKind: "USER_ACCOUNT",
    actorId, after });
}

async function loadRow(tx: DbExecutor, raceId: string) {
  const [row] = await tx.select().from(schema.raceRouteChoices).where(eq(schema.raceRouteChoices.raceId, raceId));
  return row;
}

async function loadSource(tx: DbExecutor, raceId: string) {
  const [row] = await tx.select({ sha256: schema.raceMapSources.sha256, scale: schema.raceMapSources.scale, render: schema.raceMapSources.render,
    bounds: schema.raceMapSources.bounds, georeference: schema.raceMapSources.georeference, width: schema.raceMaps.width, height: schema.raceMaps.height })
    .from(schema.raceMapSources).innerJoin(schema.raceMaps, eq(schema.raceMaps.raceId, schema.raceMapSources.raceId))
    .where(eq(schema.raceMapSources.raceId, raceId));
  return row;
}

type Paper = { x: number; y: number };
type Geo = { latitude: number; longitude: number };
const round = (value: number) => Math.round(value * 100) / 100;

function geoDistance(from: Geo, to: Geo): number {
  const rad = Math.PI / 180, dLat = (to.latitude - from.latitude) * rad, dLng = (to.longitude - from.longitude) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.latitude * rad) * Math.cos(to.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Kartfilens georeferens när O-Tid kan räkna om dess koordinatsystem. */
function usableGeoreference(georeference: MapGeoreference | null): MapGeoreference | undefined {
  return georeference && georeference.crs.kind === "EPSG" && isSupportedEpsg(georeference.crs.code) ? georeference : undefined;
}

/**
 * Kontrollernas lägen i kartfilens mm. Banfilens kartlägen används när alla ligger på kartan och stämmer med banfilens
 * Position (som kontrollkartan, ADR-0179 beslut 5); annars räknas Position om med kartfilens georeferens.
 */
function placeOnMapFile(source: NonNullable<Awaited<ReturnType<typeof loadSource>>>,
  places: readonly { key: string; paper?: Paper | undefined; geo?: Geo | undefined }[]) {
  const georeference = usableGeoreference(source.georeference);
  const onPaper = places.filter(place => place.paper);
  const { bounds } = source;
  const fits = onPaper.length > 0 && onPaper.every(place => {
    const paper = place.paper!;
    if (paper.x < bounds.minX - MARGIN_MM || paper.x > bounds.maxX + MARGIN_MM || paper.y < bounds.minY - MARGIN_MM || paper.y > bounds.maxY + MARGIN_MM) return false;
    if (!place.geo || !georeference) return true;
    const expected = mapPointToWgs84(georeference, paper);
    return Number.isFinite(expected.latitude) && geoDistance(expected, place.geo) <= MAX_DEVIATION_M;
  });
  const points = new Map<string, Paper>();
  if (fits) {
    for (const place of places) if (place.paper) points.set(place.key, { x: round(place.paper.x), y: round(place.paper.y) });
  }
  if (georeference) {
    for (const place of places) {
      if (points.has(place.key) || !place.geo) continue;
      const paper = wgs84ToMapPoint(georeference, place.geo);
      if (Number.isFinite(paper.x) && Number.isFinite(paper.y)) points.set(place.key, { x: round(paper.x), y: round(paper.y) });
    }
  }
  const placement: "PAPER" | "GEO" | "NONE" = fits ? "PAPER" : points.size > 0 ? "GEO" : "NONE";
  return { points, placement, mismatch: onPaper.length > 0 && !fits };
}

/** Individuella löpare per bana med publicerat resultat och uppladdad GPS-rutt. */
async function routeRunnersPerCourse(tx: Transaction, raceId: string): Promise<Map<string, number>> {
  const routes = await tx.select({ entryId: schema.participantRoutes.entryId, courseId: schema.courseVersions.courseId,
    relayLeg: schema.entries.relayLeg }).from(schema.participantRoutes)
    .innerJoin(schema.entries, eq(schema.entries.id, schema.participantRoutes.entryId))
    .innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .where(eq(schema.participantRoutes.raceId, raceId));
  const counts = new Map<string, number>();
  if (routes.length === 0) return counts;
  const timed = new Set((await publicResultTimings(tx, raceId)).filter(timing => timing.startMs !== null).map(timing => timing.entryId));
  for (const route of routes) {
    if (route.relayLeg !== null || !timed.has(route.entryId)) continue;
    counts.set(route.courseId, (counts.get(route.courseId) ?? 0) + 1);
  }
  return counts;
}

/** Publicerade banor med kartfilen de räknades på (tomt när inget är publicerat). */
function publishedCourses(published: RouteChoicePublished | null | undefined) {
  return (published?.courses ?? []).map(course => ({ courseId: course.courseId, variantCode: course.variantCode,
    legs: Object.keys(course.legs).length, publishedAt: course.publishedAt }));
}

/** Arbetsytans vägvalsläge: inställningar, kartfilen, kontrollernas lägen i kartfilens mm och det som är publicerat. */
export async function readRouteChoiceAsAdmin(db: Database, input: ReadProof, now = new Date())
  : Promise<Failure | { status: "ok"; response: AdminRouteChoice }> {
  return adminRead(db, input, now, async (tx, raceId) => {
    const row = await loadRow(tx, raceId);
    const source = await loadSource(tx, raceId);
    const settings = routeChoiceSettingsRequestSchema.shape.settings.safeParse(row?.settings);
    const base = { formatVersion: 1 as const, raceId, settings: settings.success ? settings.data : EMPTY_SETTINGS,
      published: publishedCourses(row?.published), publishedMapSha256: row?.published?.mapSha256 ?? null };
    if (!source) return { status: "ok" as const, response: adminRouteChoiceSchema.parse({ ...base, mapFile: null, controls: [], courses: [] }) };
    const controls = await tx.select({ code: schema.controls.code, latitude: schema.controls.latitude, longitude: schema.controls.longitude,
      mapX: schema.controls.mapX, mapY: schema.controls.mapY }).from(schema.controls).where(eq(schema.controls.raceId, raceId));
    const courses = await tx.select({ id: schema.courses.id, start: schema.courses.startPosition, finish: schema.courses.finishPosition,
      startMap: schema.courses.startMapPosition, finishMap: schema.courses.finishMapPosition }).from(schema.courses)
      .where(eq(schema.courses.raceId, raceId));
    const place = (key: string, paper: Paper | null, geo: Geo | null) => ({ key, paper: paper ?? undefined, geo: geo ?? undefined });
    const places = [
      ...controls.map(control => place(`c${control.code}`, control.mapX !== null && control.mapY !== null ? { x: control.mapX, y: control.mapY } : null,
        control.latitude !== null && control.longitude !== null ? { latitude: control.latitude, longitude: control.longitude } : null)),
      ...courses.flatMap(course => [place(`s${course.id}`, course.startMap, course.start), place(`f${course.id}`, course.finishMap, course.finish)])
    ].filter(item => item.paper || item.geo);
    const layout = placeOnMapFile(source, places);
    const at = (key: string) => layout.points.get(key) ?? null;
    const routeRunners = await routeRunnersPerCourse(tx, raceId);
    return { status: "ok" as const, response: adminRouteChoiceSchema.parse({ ...base,
      mapFile: { sha256: source.sha256, scale: source.scale, render: source.render, georeference: source.georeference,
        image: { width: source.width, height: source.height }, placement: layout.placement, mismatch: layout.mismatch },
      controls: controls.map(control => ({ code: control.code, at: at(`c${control.code}`) })).sort((left, right) => left.code - right.code),
      courses: courses.map(course => ({ courseId: course.id, start: at(`s${course.id}`), finish: at(`f${course.id}`),
        routeRunners: routeRunners.get(course.id) ?? 0 })) }) };
  });
}

/** Sparar inställningarna (klass per symbol, farter, ekvidistans, stigningsfaktor, referensfart). */
export async function saveRouteChoiceSettingsAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | { status: "ok"; settings: RouteChoiceSettingsDto }> {
  const parsed = routeChoiceSettingsRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  return adminWrite(db, input, now, async (tx, raceId, actorId) => {
    const settings = parsed.data.settings;
    await tx.insert(schema.raceRouteChoices).values({ raceId, settings, published: null, updatedAt: now })
      .onConflictDoUpdate({ target: schema.raceRouteChoices.raceId, set: { settings, updatedAt: now } });
    await audit(tx, raceId, actorId, "ROUTE_CHOICE_SETTINGS_SAVED", { settings });
    return { status: "ok" as const, settings };
  });
}

/** Sträcknycklarna för en bana eller variant: S-31.1, 31.1-32.1 … 36.1-F (samma som sträcktidstabellen). */
export function courseLegKeys(controlCodes: readonly number[]): string[] {
  const seen = new Map<number, number>();
  const points = ["S", ...controlCodes.map(code => { const count = (seen.get(code) ?? 0) + 1; seen.set(code, count); return `${code}.${count}`; }), "F"];
  return points.slice(1).map((to, index) => `${points[index]}-${to}`);
}

/**
 * "Visa bästa vägval publikt": sparar bästa vägen per sträcka för en bana eller variant (ersätter det som fanns för den),
 * eller tar bort den (WITHDRAW). Linjerna räknades på kartfilen `mapSha256`; har kartfilen bytts sedan dess avvisas
 * publiceringen, och linjer från en äldre kartfil tas bort.
 */
export async function publishRouteChoiceAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date())
  : Promise<Failure | Problem | { status: "ok"; published: number }> {
  const parsed = routeChoicePublishRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const request = parsed.data;
  return adminWrite(db, input, now, async (tx, raceId, actorId) => {
    const source = await loadSource(tx, raceId);
    if (!source) return { status: "problem" as const, problem: "NO_MAP_FILE" as const };
    const course = await loadCourseForMap(tx, raceId, request.courseId);
    if (!course) return { status: "problem" as const, problem: "UNKNOWN_COURSE" as const };
    const variant = request.variantCode === null ? undefined : course.variants.find(row => row.code === request.variantCode);
    if (request.variantCode !== null && !variant) return { status: "problem" as const, problem: "UNKNOWN_COURSE" as const };
    const row = await loadRow(tx, raceId);
    // Linjer från en annan kartfil gäller inte längre.
    const kept = row?.published?.mapSha256 === source.sha256 ? row.published.courses : [];
    const others = kept.filter(item => item.courseId !== request.courseId || item.variantCode !== request.variantCode);
    if (request.kind === "PUBLISH") {
      if (request.mapSha256 !== source.sha256) return { status: "problem" as const, problem: "MAP_FILE_CHANGED" as const };
      const keys = new Set(courseLegKeys(variant ? variant.controlCodes : course.controlCodes));
      if (request.legs.some(leg => !keys.has(leg.key))) return { status: "problem" as const, problem: "UNKNOWN_LEG" as const };
      const legs = Object.fromEntries(request.legs.map(leg => [leg.key, leg.points.map(([x, y]) => [round(x), round(y)] as [number, number])]));
      others.push({ courseId: request.courseId, variantCode: request.variantCode, publishedAt: now.toISOString(), legs });
    }
    const published: RouteChoicePublished | null = others.length > 0 ? { mapSha256: source.sha256, courses: others } : null;
    await tx.insert(schema.raceRouteChoices).values({ raceId, settings: EMPTY_SETTINGS, published, updatedAt: now })
      .onConflictDoUpdate({ target: schema.raceRouteChoices.raceId, set: { published, updatedAt: now } });
    await audit(tx, raceId, actorId, request.kind === "PUBLISH" ? "ROUTE_CHOICE_PUBLISHED" : "ROUTE_CHOICE_WITHDRAWN",
      { courseId: request.courseId, variantCode: request.variantCode, mapSha256: source.sha256,
        legs: request.kind === "PUBLISH" ? request.legs.length : 0 });
    return { status: "ok" as const, published: published?.courses.length ?? 0 };
  });
}

/**
 * Kalibreringen: GPS-rutternas delar per sträcka för löpare med publicerat resultat på banan, utan namn. Samma klipp som
 * den publika sträcktidsanalysen (`runnerLegs`, `routeSegment`), så att inget räknas på tiden före start eller efter mål.
 */
export async function readRouteChoiceCalibrationAsAdmin(db: Database, input: ReadProof & { courseId: string }, now = new Date())
  : Promise<Failure | { status: "ok"; response: RouteChoiceCalibrationRoutes }> {
  if (!uuid.test(input.courseId)) return { status: "invalid-request" };
  return adminRead(db, input, now, async (tx, raceId) => {
    const course = await loadCourseForMap(tx, raceId, input.courseId);
    if (!course) return { status: "not-found" as const };
    const routes = await tx.select({ entryId: schema.participantRoutes.entryId, points: schema.participantRoutes.points })
      .from(schema.participantRoutes).where(eq(schema.participantRoutes.raceId, raceId));
    if (routes.length === 0) return { status: "ok" as const, response: routeChoiceCalibrationRoutesSchema.parse({ formatVersion: 1, raceId,
      courseId: course.id, runners: [] }) };
    const entries = new Map((await tx.select({ id: schema.entries.id, classId: schema.entries.classId, variantCode: schema.entries.courseVariantCode,
      relayLeg: schema.entries.relayLeg }).from(schema.entries).where(eq(schema.entries.raceId, raceId))).map(row => [row.id, row]));
    const classIds = new Set(course.classCourseIds);
    const timings = new Map((await publicResultTimings(tx, raceId)).map(timing => [timing.entryId, timing]));
    const runners = routes.flatMap(route => {
      const entry = entries.get(route.entryId), timing = timings.get(route.entryId);
      if (!entry || entry.relayLeg !== null || !classIds.has(entry.classId) || !timing || timing.startMs === null) return [];
      const legs = runnerLegs(timing.splits, timing.elapsedMs).flatMap(leg => {
        const segment = routeSegment(route.points, timing.startMs! + leg.fromElapsedMs, timing.startMs! + leg.toElapsedMs);
        const milliseconds = leg.toElapsedMs - leg.fromElapsedMs;
        return segment.length >= 2 && milliseconds > 0
          ? [{ key: leg.leg, milliseconds, points: segment.map(point => [point[1], point[2]] as [number, number]) }] : [];
      });
      return legs.length > 0 ? [{ variantCode: entry.variantCode, legs }] : [];
    });
    return { status: "ok" as const, response: routeChoiceCalibrationRoutesSchema.parse({ formatVersion: 1, raceId, courseId: course.id, runners }) };
  });
}

/**
 * Publikt (ADR-0171 beslut 5, ADR-0176): bästa vägen för en sträcka på en bana eller variant som kartbildens pixlar, bara
 * när kartfilen är densamma som linjerna räknades på. Den som anropar avgör banhemligheten och att sträckan hör till ett
 * publicerat resultat.
 */
export async function loadPublishedBestRoute(tx: DbExecutor, raceId: string, course: { courseId: string; variantCode: string | null },
  leg: string): Promise<[number, number][] | undefined> {
  const [row] = await tx.select({ published: schema.raceRouteChoices.published }).from(schema.raceRouteChoices)
    .where(eq(schema.raceRouteChoices.raceId, raceId));
  if (!row?.published) return undefined;
  const source = await loadSource(tx, raceId);
  if (!source || source.sha256 !== row.published.mapSha256) return undefined;
  // Löparens variant först; samma sträcka (samma två kontroller) i en annan variant av banan är samma väg.
  const own = row.published.courses.filter(item => item.courseId === course.courseId);
  const line = (own.find(item => item.variantCode === course.variantCode && item.legs[leg]) ?? own.find(item => item.legs[leg]))?.legs[leg];
  if (!line) return undefined;
  const { pxPerMm, originX, originY } = source.render;
  return line.map(([x, y]) => [Math.round((x - originX) * pxPerMm * 10) / 10, Math.round((originY - y) * pxPerMm * 10) / 10]);
}

/** Banan och varianten som löparen sprang (för den publika linjen). */
export async function runnerCourseOf(tx: DbExecutor, raceId: string, entryId: string): Promise<{ courseId: string; variantCode: string | null } | undefined> {
  const [row] = await tx.select({ courseId: schema.courseVersions.courseId, variantCode: schema.entries.courseVariantCode }).from(schema.entries)
    .innerJoin(schema.classes, eq(schema.classes.id, schema.entries.classId))
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .where(and(eq(schema.entries.id, entryId), eq(schema.entries.raceId, raceId)));
  return row;
}
