import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  BINGO_NAME_MAX, bingoAdminViewSchema, bingoLeaderboardSchema, bingoProgressRequestSchema, bingoProgressResponseSchema, bingoSettingRequestSchema,
  type BingoAdminView, type BingoGroup, type BingoLeaderboard, type BingoMode, type BingoProgressResponse
} from "@o-tid/contracts";
import { bingoCells, type CourseSettingDocument } from "@o-tid/course-setting";
import { schema, type Database } from "@o-tid/database";
import {
  bingoGroupSeed, bingoSeconds, judgeShots, mergeBingoProgress, mergeShots, normalizeSelfRegistrationName, placeGroupShips, placeShips, rankBingo, rankShips, scoreShots,
  selfRegistrationDay, shipSplitFor, shotCellCounts, type BingoProgress, type JudgedShot, type Ship, type ShipScore
} from "@o-tid/domain";
import type { MapGeoreference } from "@o-tid/map-file";
import { consumeAccountRequestAllowance } from "./account-throttle";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { UUID_PATTERN as uuid } from "./serialization";
import type { DbExecutor } from "./snapshot";

/**
 * Bingoorientering med telefonen (ADR-0225). Grupperna och rutnätet står i banläggningens dokument (`CourseTraining.bingo`,
 * banor med rutnät); `bingo_race` säger att telefonen får användas. Löparna anmäler sig på plats utan konto och skickar hela
 * sitt läge (idempotent på tävling + telefonens id). Topplistan (namn, antal rutor, tid, sträcka) är publik bara på
 * träningsdagen; spåren läser bara admin.
 */
export const BINGO_POSTS_PER_IP = 3000;
export const BINGO_IP_WINDOW_MS = 10 * 60 * 1000;
export const BINGO_RUNNERS_PER_RACE_AND_DAY = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

interface BingoRaceFacts {
  raceId: string; eventName: string; raceName: string; raceDate: string; timeZone: string; shortCode: string;
  published: boolean; enabled: boolean; mode: BingoMode;
}

async function raceFacts(tx: DbExecutor, raceId: string): Promise<BingoRaceFacts | undefined> {
  const [race] = await tx.select({ raceId: schema.races.id, eventName: schema.events.name, raceName: schema.races.name, raceDate: schema.races.raceDate,
    timeZone: schema.events.timeZone, shortCode: schema.races.shortCode, publishedAt: schema.races.publishedAt, hidden: schema.races.hiddenBySuperadmin,
    enabledAt: schema.bingoRaces.enabledAt, mode: schema.bingoRaces.mode })
    .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .leftJoin(schema.bingoRaces, eq(schema.bingoRaces.raceId, schema.races.id)).where(eq(schema.races.id, raceId));
  if (!race) return undefined;
  const { publishedAt, hidden, enabledAt, mode, ...facts } = race;
  return { ...facts, published: publishedAt !== null && !hidden, enabled: enabledAt !== null, mode: mode ?? "BINGO" };
}

/** Kartbilden i kartans mm (`render`: bildens övre vänstra hörn och pixlar per mm) för kartan efter målgången. */
export interface BingoMapImage { originX: number; originY: number; pxPerMm: number; width: number; height: number }
/** `metersPerMm`: kartans meter per mm (georeferensens skala, annars kartans), samma som telefonen räknar med. */
export interface BingoSetup { groups: BingoGroup[]; mapScale: number; metersPerMm: number; georeference: MapGeoreference | null; image: BingoMapImage | null }

const metersPerMm = (georeference: MapGeoreference | null, mapScale: number) =>
  georeference ? (georeference.scale / 1000) * georeference.combinedScaleFactor : mapScale / 1000;

/** Grupperna (banorna med rutnät) ur banläggningens dokument, rutorna och kartans georeferens. */
export async function loadBingoSetup(tx: DbExecutor, raceId: string): Promise<BingoSetup> {
  const [row] = await tx.select({ document: schema.courseSettings.document }).from(schema.courseSettings).where(eq(schema.courseSettings.raceId, raceId));
  const [map] = await tx.select({ georeference: schema.raceMapSources.georeference, render: schema.raceMapSources.render,
    width: schema.raceMaps.width, height: schema.raceMaps.height }).from(schema.raceMapSources)
    .leftJoin(schema.raceMaps, eq(schema.raceMaps.raceId, schema.raceMapSources.raceId)).where(eq(schema.raceMapSources.raceId, raceId));
  const georeference = (map?.georeference ?? null) as MapGeoreference | null;
  const image = map?.render && map.width && map.height ? { originX: map.render.originX, originY: map.render.originY, pxPerMm: map.render.pxPerMm,
    width: map.width, height: map.height } : null;
  if (!row) return { groups: [], mapScale: 10_000, metersPerMm: metersPerMm(georeference, 10_000), georeference, image };
  const document = row.document as unknown as CourseSettingDocument;
  const mapScale = document.event?.mapScale ?? 10_000;
  const training = document.training?.courses ?? {};
  const groups = (document.courses ?? []).flatMap(course => {
    const bingo = training[course.id]?.bingo;
    if (!bingo) return [];
    const cells = bingoCells(bingo, mapScale).map(cell => ({ name: cell.name, rect: cell.rect }));
    const split = shipSplitFor(cells.length, bingo.sharedShips, bingo.ships);
    return [{ course: course.id, name: course.name, cellMeters: bingo.cellMeters, ships: split.own, sharedShips: split.shared,
      sharedSeed: bingo.sharedSeed ?? bingoGroupSeed(raceId, course.id), cells }];
  });
  return { groups, mapScale, metersPerMm: metersPerMm(georeference, mapScale), georeference, image };
}

const toProgress = (row: typeof schema.bingoRunners.$inferSelect): BingoProgress => ({
  status: row.status, startedAt: row.startedAt.getTime(), finishedAt: row.finishedAt?.getTime() ?? null, distanceM: row.distanceM,
  taken: row.taken, track: row.track, gaps: row.gaps
});

/** Löparens skepp och bedömda skott i Sänka skepp (tomt utan frö). */
function shipsOf(row: typeof schema.bingoRunners.$inferSelect, group: BingoGroup | undefined, perMm: number): { ships: Ship[]; judged: JudgedShot[]; score: ShipScore } {
  const ships = group && row.seed !== null ? placeGroupShips(group.cells.map(cell => cell.name), { shared: group.sharedShips, own: group.ships },
    group.sharedSeed, row.seed) : [];
  const judged = group ? judgeShots(row.shots, group.cells, ships, perMm) : [];
  return { ships, judged, score: scoreShots(judged) };
}

async function leaderboard(tx: DbExecutor, raceId: string, mode: BingoMode, setup: BingoSetup): Promise<BingoLeaderboard> {
  const rows = await tx.select().from(schema.bingoRunners).where(eq(schema.bingoRunners.raceId, raceId)).orderBy(asc(schema.bingoRunners.createdAt));
  return bingoLeaderboardSchema.parse({ formatVersion: 1, mode, groups: setup.groups.map(group => {
    const members = rows.filter(row => row.groupCourse === group.course);
    const judged = mode === "SHIPS" ? members.map(row => shipsOf(row, group, setup.metersPerMm)) : [];
    const standings = members.map((row, index) => ({ name: row.name, cells: row.taken.length, status: row.status,
      seconds: bingoSeconds(toProgress(row)), distanceM: Math.round(row.distanceM), ...(judged[index]?.score ?? {}) }));
    if (mode !== "SHIPS") return { course: group.course, name: group.name, cells: group.cells.length, runners: rankBingo(standings) };
    // Prickarna: bara antalet löpare per ruta som stått i den, inga namn och inga positioner.
    return { course: group.course, name: group.name, cells: group.cells.length, shotCells: shotCellCounts(judged.map(item => item.judged)), cellNames: group.cells.map(cell => cell.name),
      runners: rankShips(standings.map(row => ({ points: 0, hits: 0, sunk: 0, wrong: 0, water: 0, sharedSunk: 0, lastShotAt: null, ...row }))) };
  }) });
}

/** Bingon är öppen: påslagen och träningsdagen i tävlingens tidszon (arrangören och funktionären kan prova alla dagar). */
const openToday = (race: BingoRaceFacts, staff: boolean, now: Date) =>
  race.enabled && (staff || selfRegistrationDay({ raceDate: race.raceDate, timeZone: race.timeZone, party: false, now }));

export type BingoPublicRead =
  | { status: "not-found" }
  | { status: "closed"; raceDate: string; eventName: string; raceName: string; mode: BingoMode }
  | { status: "ok"; race: Omit<BingoRaceFacts, "enabled" | "published" | "timeZone">; setup: BingoSetup; leaderboard: BingoLeaderboard };

/**
 * Löparens sida. Anroparen har redan släppt igenom tävlingen (`publicRaceAccess`: publicerad, eller förhandsvisning för
 * arrangören). `staff` = den inloggade är arrangör eller funktionär på tävlingen.
 */
export async function readBingoPublic(db: Database, input: { raceId: string; staff: boolean }, now = new Date()): Promise<BingoPublicRead> {
  if (!uuid.test(input.raceId)) return { status: "not-found" };
  return db.transaction(async tx => {
    const race = await raceFacts(tx, input.raceId);
    if (!race || !race.enabled) return { status: "not-found" as const };
    if (!openToday(race, input.staff, now)) return { status: "closed" as const, raceDate: race.raceDate, eventName: race.eventName, raceName: race.raceName, mode: race.mode };
    const setup = await loadBingoSetup(tx, race.raceId);
    const shown = { raceId: race.raceId, eventName: race.eventName, raceName: race.raceName, raceDate: race.raceDate, shortCode: race.shortCode,
      mode: race.mode };
    return { status: "ok" as const, race: shown, setup, leaderboard: await leaderboard(tx, race.raceId, race.mode, setup) };
  }, { isolationLevel: "repeatable read" });
}

/** Topplistan (publik på träningsdagen). Undefined när bingon inte är öppen. */
export async function readBingoLeaderboard(db: Database, input: { raceId: string; staff: boolean }, now = new Date()): Promise<BingoLeaderboard | undefined> {
  const read = await readBingoPublic(db, input, now);
  return read.status === "ok" ? read.leaderboard : undefined;
}

export type BingoProgressResult =
  | { status: "not-found" | "closed" | "rate-limited" | "invalid-request" }
  | { status: "ok"; response: BingoProgressResponse };

/**
 * Telefonens läge. Kräver att tävlingen syns publikt (eller att den som skickar är arrangör eller funktionär) och att bingon
 * är öppen. En ny löpare räknas mot spärren per tävling; varje sändning mot spärren per IP (hashad).
 */
export async function receiveBingoProgress(db: Database, input: { raceId: string; clientKey: string; request: unknown; staff: boolean },
  now = new Date()): Promise<BingoProgressResult> {
  if (!uuid.test(input.raceId)) return { status: "not-found" };
  const parsed = bingoProgressRequestSchema.safeParse(input.request);
  if (!parsed.success) return { status: "invalid-request" };
  const request = parsed.data;
  const name = normalizeSelfRegistrationName(request.name, BINGO_NAME_MAX);
  if (!name) return { status: "invalid-request" };
  // Fälla mot robotar: ett ifyllt dolt fält ger ett kvitto, men inget sparas.
  if (request.website?.trim()) return { status: "ok", response: bingoProgressResponseSchema.parse({ formatVersion: 1, runnerId: request.runnerId, cells: 0 }) };
  return db.transaction(async tx => {
    const race = await raceFacts(tx, input.raceId);
    if (!race || !race.enabled || (!race.published && !input.staff)) return { status: "not-found" as const };
    if (!openToday(race, input.staff, now)) return { status: "closed" as const };
    if (!await consumeAccountRequestAllowance(tx, { scope: "BINGO_IP", key: input.clientKey, limit: BINGO_POSTS_PER_IP, windowMs: BINGO_IP_WINDOW_MS }, now)) {
      return { status: "rate-limited" as const };
    }
    const setup = await loadBingoSetup(tx, race.raceId);
    const group = setup.groups.find(item => item.course === request.group);
    if (!group) return { status: "invalid-request" as const };
    const where = and(eq(schema.bingoRunners.raceId, race.raceId), eq(schema.bingoRunners.clientId, request.runnerId));
    const [current] = await tx.select().from(schema.bingoRunners).where(where).for("update");
    if (!current && !await consumeAccountRequestAllowance(tx, { scope: "BINGO_RACE", key: race.raceId, limit: BINGO_RUNNERS_PER_RACE_AND_DAY,
      windowMs: DAY_MS }, now)) return { status: "rate-limited" as const };
    const incoming: BingoProgress = { status: request.status, startedAt: request.startedAt, finishedAt: request.finishedAt, distanceM: request.distanceM,
      taken: request.taken, track: request.track.map(([x, y, t]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100, t] as const),
      gaps: request.gaps };
    const merged = mergeBingoProgress(current ? toProgress(current) : undefined, incoming, new Set(group.cells.map(cell => cell.name)));
    const names = new Set(group.cells.map(cell => cell.name));
    const shots = mergeShots(current?.shots ?? [], (request.shots ?? []).filter(item => names.has(item.cell))).slice(0, 2000);
    const seed = current?.seed ?? request.seed ?? null;
    const values = { name, groupCourse: group.course, groupName: group.name.slice(0, 200), status: merged.status, startedAt: new Date(merged.startedAt),
      finishedAt: merged.finishedAt === null ? null : new Date(merged.finishedAt), distanceM: Math.round(merged.distanceM),
      taken: merged.taken.map(row => ({ ...row })), track: merged.track.map(point => [...point] as [number, number, number]),
      gaps: merged.gaps.map(gap => [...gap] as [number, number]), seed, shots: shots.map(item => ({ ...item })), updatedAt: now };
    if (current) await tx.update(schema.bingoRunners).set(values).where(eq(schema.bingoRunners.id, current.id));
    else await tx.insert(schema.bingoRunners).values({ id: randomUUID(), raceId: race.raceId, clientId: request.runnerId, createdAt: now, ...values });
    return { status: "ok" as const, response: bingoProgressResponseSchema.parse({ formatVersion: 1, runnerId: request.runnerId, cells: merged.taken.length,
      ...(seed !== null ? { seed } : {}) }) };
  });
}

type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" };
export type BingoAdminResult = Failure | { status: "ok"; response: BingoAdminView };

async function adminView(tx: DbExecutor, raceId: string): Promise<BingoAdminView | undefined> {
  const race = await raceFacts(tx, raceId);
  if (!race) return undefined;
  const setup = await loadBingoSetup(tx, raceId);
  const rows = await tx.select().from(schema.bingoRunners).where(eq(schema.bingoRunners.raceId, raceId)).orderBy(asc(schema.bingoRunners.createdAt));
  return bingoAdminViewSchema.parse({ formatVersion: 1, enabled: race.enabled, mode: race.mode, published: race.published, shortCode: race.shortCode,
    raceDate: race.raceDate,
    mapScale: setup.mapScale, image: setup.image,
    // Bara ledaren: gruppens gemensamma skepp, redan innan någon har startat.
    groups: setup.groups.map(group => ({ ...group, sharedCells: placeShips(group.cells.map(cell => cell.name), group.sharedShips, group.sharedSeed)
      .map(ship => [...ship.cells]) })),
    runners: rows.map(row => ({ id: row.id, name: row.name, course: row.groupCourse, groupName: row.groupName, status: row.status,
      startedAt: row.startedAt.getTime(), finishedAt: row.finishedAt?.getTime() ?? null, updatedAt: row.updatedAt.getTime(), distanceM: row.distanceM,
      seconds: bingoSeconds(toProgress(row)), taken: row.taken, track: row.track, gaps: row.gaps,
      ...(() => {
        const result = shipsOf(row, setup.groups.find(group => group.course === row.groupCourse), setup.metersPerMm);
        return { ships: result.ships.map(ship => [...ship.cells]), sharedShips: result.ships.filter(ship => ship.shared).length,
          shots: result.judged, points: result.score.points, sunk: result.score.sunk,
          hits: result.score.hits, wrong: result.score.wrong, water: result.score.water, sharedSunk: result.score.sharedSunk };
      })() })) });
}

/** Ledarens vy: grupperna, alla löpare och spåren. Bara administratören. */
export async function readBingoAsAdmin(db: Database, input: RaceSessionProof, now = new Date()): Promise<BingoAdminResult> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const view = await adminView(tx, auth.principal.raceId);
    return view ? { status: "ok" as const, response: view } : { status: "not-found" as const };
  }, { isolationLevel: "repeatable read" });
}

/** Slår på eller av bingon med telefonen (auditpost). Löparna som redan finns står kvar. */
export async function setBingoAsAdmin(db: Database, input: RaceSessionProof & { request: unknown }, now = new Date()): Promise<BingoAdminResult> {
  const parsed = bingoSettingRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    if (auth.principal.guest) return { status: "forbidden" as const };
    const raceId = auth.principal.raceId;
    if (parsed.data.enabled) {
      const mode = parsed.data.mode;
      await tx.insert(schema.bingoRaces).values({ raceId, enabledAt: now, enabledBy: auth.principal.accountId, mode: mode ?? "BINGO" })
        .onConflictDoUpdate({ target: schema.bingoRaces.raceId, set: mode ? { mode } : { raceId } });
    } else {
      await tx.delete(schema.bingoRaces).where(eq(schema.bingoRaces.raceId, raceId));
    }
    await tx.insert(schema.auditEvents).values({ raceId, entityType: "bingo", entityId: raceId, actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId,
      action: parsed.data.enabled ? "BINGO_ENABLED" : "BINGO_DISABLED", before: null, after: { enabled: parsed.data.enabled, ...(parsed.data.mode ? { mode: parsed.data.mode } : {}) }, createdAt: now });
    const view = await adminView(tx, raceId);
    return view ? { status: "ok" as const, response: view } : { status: "not-found" as const };
  });
}
