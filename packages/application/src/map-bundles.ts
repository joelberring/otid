import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  mapBundleResponseSchema, mapPrintRequestSchema, mapPrintResponseSchema, mapReserveRequestSchema, mapReserveResponseSchema,
  printedMapStateSchema, type MapBundleResponse, type MapPrintList
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  DEFAULT_MAP_RESERVE, mapPrintChanges, planMapBundles, printedMapState, type MapBundleClassInput, type MapBundleEntryInput, type MapBundlePlan,
  type MapReserve
} from "@o-tid/domain";
import { classLayoutMap } from "@o-tid/course-setting";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { loadCourseVersionVariants } from "./course-variants";
import { loadStartListFacts } from "./start-draw-basis";
import type { DbExecutor } from "./snapshot";
import { canonicalHash, UUID_PATTERN as uuid } from "./serialization";

/**
 * Kartor till starten (PLAN.md steg 61): tryckantal per variant, kartbuntslistan och baksidorna ur domänens
 * `planMapBundles`, plus senaste utskriften per lista (`map_print`) och vad som ändrats sedan dess. Funktionären vid
 * starten läser och skriver ut; reserven ställs in av administratören. Stafett (ADR-0213): en klass per sträcka med
 * sträckans bana och lagens varianter (lagens gafflingar, eller sträckans fasta variant), efter de individuella.
 * Rogaining ingår som ogafflade grupper (poängbanan är en karta per löpare; varianter används inte).
 */
type Authentication = RaceSessionProof;
const notRelayClass = sql`not exists (select 1 from relay_leg rl where rl.class_id = ${schema.classes.id})`;

interface MapBundleBasis {
  readonly race: { eventName: string; raceName: string; raceDate: string; timeZone: string; snapshotVersion: number };
  readonly reserve: MapReserve;
  readonly classes: readonly MapBundleClassInput[];
  readonly plan: MapBundlePlan;
  /** Banläggningens baksida (ADR-0213) som texter, om den är inställd. */
  readonly runnerBack?: { text: string; sizeMm: number; bold: boolean; align: "left" | "center" | "right" }[] | undefined;
}

async function loadBasis(tx: DbExecutor, raceId: string): Promise<MapBundleBasis | undefined> {
  const [race] = await tx.select({ eventName: schema.events.name, raceName: schema.races.name, raceDate: schema.races.raceDate,
    timeZone: schema.events.timeZone, snapshotVersion: schema.races.snapshotVersion, reserve: schema.races.mapReserve })
    .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
  if (!race) return undefined;
  const classRows = await tx.select({ id: schema.classes.id, name: schema.classes.name, startRule: schema.classes.startRule,
    courseVersionId: schema.classes.courseVersionId, courseName: schema.courses.name,
    rogaining: sql<boolean>`${schema.classes.rogainingTimeLimitSeconds} is not null` }).from(schema.classes)
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(and(eq(schema.classes.raceId, raceId), notRelayClass))
    .orderBy(asc(schema.classes.name), asc(schema.classes.id)).limit(1001);
  if (classRows.length > 1000) throw new Error("För många klasser");
  const variants = await loadCourseVersionVariants(tx, classRows.map(row => row.courseVersionId));
  const facts = await loadStartListFacts(tx, raceId);
  // ADR-0217: klassens layout i banläggningen; grupperna delas per layout (reserverna följer klassen).
  const [setting] = await tx.select({ document: schema.courseSettings.document }).from(schema.courseSettings).where(eq(schema.courseSettings.raceId, raceId));
  const layouts = classLayoutMap(setting?.document);
  const layoutOf = (name: string) => { const found = layouts.get(name); return found ? { layout: found } : {}; };
  const classes: MapBundleClassInput[] = classRows.map(row => {
    const fact = facts.get(row.id);
    const startMode = row.startRule === "PUNCH" ? "FREE" : fact?.drawMethod === "MASS" ? "MASS" : "MINUTE";
    return { id: row.id, name: row.name, courseVersionId: row.courseVersionId, courseName: row.courseName,
      variantCodes: row.rogaining ? [] : (variants.get(row.courseVersionId) ?? []).map(variant => variant.code), startMode,
      vacancies: startMode === "MINUTE" ? fact?.vacancies ?? [] : [], ...layoutOf(row.name) };
  });
  const ids = new Set(classes.map(row => row.id));
  const entries = (await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
    club: schema.entries.organisationName, classId: schema.entries.classId, startTime: schema.entries.fixedStartTime,
    variantCode: schema.entries.courseVariantCode }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.struckAt), isNull(schema.entries.teamId))).limit(20_001))
    .filter(row => ids.has(row.classId));
  if (entries.length > 20_000) throw new Error("För många deltagare");
  const startRule = new Map(classRows.map(row => [row.id, row.startRule]));
  const reserve = race.reserve ?? DEFAULT_MAP_RESERVE;
  const relay = await loadRelayBasis(tx, raceId, layoutOf);
  const plan = planMapBundles({ classes: [...classes, ...relay.classes], reserve, entries: [...entries.map(row => ({ id: row.id, name: `${row.givenName} ${row.familyName}`.trim(),
    club: row.club, classId: row.classId, variantCode: row.variantCode,
    startTime: startRule.get(row.classId) === "FIXED" ? row.startTime?.toISOString() ?? null : null })), ...relay.entries] });
  return { race, reserve, classes: [...classes, ...relay.classes], plan, runnerBack: runnerBackTexts(setting?.document) };
}

/** Banläggningens baksida (ADR-0213) som texter uppifrån, eller inget om den inte är inställd. */
function runnerBackTexts(document: unknown): { text: string; sizeMm: number; bold: boolean; align: "left" | "center" | "right" }[] | undefined {
  const items = (document as { event?: { runnerBack?: { items?: unknown } } } | null | undefined)?.event?.runnerBack?.items;
  if (!Array.isArray(items)) return undefined;
  return (items as { kind?: string; hide?: boolean; text?: unknown; sizeMm?: unknown; bold?: unknown; align?: unknown; at?: { y?: unknown } }[])
    .filter(item => item.kind === "TEXT" && !item.hide && typeof item.text === "string" && typeof item.sizeMm === "number" && item.sizeMm > 0)
    .sort((a, b) => (typeof a.at?.y === "number" ? a.at.y : 0) - (typeof b.at?.y === "number" ? b.at.y : 0))
    .slice(0, 40)
    .map(item => ({ text: (item.text as string).slice(0, 2000), sizeMm: Math.min(100, item.sizeMm as number), bold: item.bold === true,
      align: item.align === "left" || item.align === "center" ? item.align : "right" as const }));
}

/**
 * Stafettens sträckor som klasser (ADR-0213): sträckans bana (eller klassens), dess varianter och sträckans fasta variant;
 * löparna med lag, sträcka och lagets variant. Masstartens tid för sträckor med masstart; växling och omstart har ingen
 * lottad tid. Rogaining ingår som ogafflade sträckor (som de individuella).
 */
async function loadRelayBasis(tx: DbExecutor, raceId: string, layoutOf: (name: string) => Pick<MapBundleClassInput, "layout">):
  Promise<{ classes: MapBundleClassInput[]; entries: MapBundleEntryInput[] }> {
  const legs = await tx.select({ classId: schema.relayLegs.classId, leg: schema.relayLegs.leg, startMethod: schema.relayLegs.startMethod,
    startTime: schema.relayLegs.startTime, fixedVariant: schema.relayLegs.courseVariantCode, legCourseVersionId: schema.relayLegs.courseVersionId,
    className: schema.classes.name, classCourseVersionId: schema.classes.courseVersionId,
    rogaining: sql<boolean>`${schema.classes.rogainingTimeLimitSeconds} is not null` })
    .from(schema.relayLegs).innerJoin(schema.classes, eq(schema.classes.id, schema.relayLegs.classId))
    .where(eq(schema.relayLegs.raceId, raceId))
    .orderBy(asc(schema.classes.name), asc(schema.relayLegs.leg)).limit(2001);
  if (legs.length === 0) return { classes: [], entries: [] };
  if (legs.length > 2000) throw new Error("För många sträckor");
  const versionOf = (leg: typeof legs[number]) => leg.legCourseVersionId ?? leg.classCourseVersionId;
  const versionIds = [...new Set(legs.map(versionOf))];
  const names = new Map((await tx.select({ id: schema.courseVersions.id, name: schema.courses.name }).from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId)).where(inArray(schema.courseVersions.id, versionIds)))
    .map(row => [row.id, row.name]));
  const variants = await loadCourseVersionVariants(tx, versionIds);
  const classes: MapBundleClassInput[] = legs.flatMap(leg => {
    const courseName = names.get(versionOf(leg));
    if (!courseName) return [];
    const codes = leg.rogaining ? [] : (variants.get(versionOf(leg)) ?? []).map(variant => variant.code);
    return [{ id: leg.classId, name: leg.className, courseVersionId: versionOf(leg), courseName, leg: leg.leg,
      variantCodes: leg.fixedVariant !== null && codes.includes(leg.fixedVariant) ? [leg.fixedVariant] : codes,
      startMode: leg.startMethod === "MASS_START" ? "MASS" as const : "FREE" as const, vacancies: [], ...layoutOf(leg.className) }];
  });
  const legOf = new Map(legs.map(leg => [`${leg.classId}:${leg.leg}`, leg]));
  const rows = await tx.select({ id: schema.entries.id, givenName: schema.entries.givenName, familyName: schema.entries.familyName,
    club: schema.entries.organisationName, classId: schema.entries.classId, leg: schema.entries.relayLeg, legOrder: schema.entries.relayLegOrder,
    variantCode: schema.entries.courseVariantCode, teamNumber: schema.teams.number, teamName: schema.teams.name, teamClub: schema.teams.organisationName })
    .from(schema.entries).innerJoin(schema.teams, eq(schema.teams.id, schema.entries.teamId))
    .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.struckAt), isNull(schema.teams.struckAt), isNotNull(schema.entries.relayLeg)))
    .limit(20_001);
  if (rows.length > 20_000) throw new Error("För många deltagare");
  const entries: MapBundleEntryInput[] = rows.flatMap(row => {
    const leg = legOf.get(`${row.classId}:${row.leg}`);
    if (!leg || row.leg === null) return [];
    return [{ id: row.id, name: `${row.givenName} ${row.familyName}`.trim(), club: row.club ?? row.teamClub, classId: row.classId, leg: row.leg,
      legOrder: row.legOrder ?? 1, team: { number: row.teamNumber, name: row.teamName },
      // Lagets variant (lagets gafflingar); en sträcka med fast variant ger den.
      variantCode: row.variantCode ?? leg.fixedVariant, startTime: leg.startMethod === "MASS_START" ? leg.startTime?.toISOString() ?? null : null }];
  });
  return { classes, entries };
}

const stateHash = (basis: MapBundleBasis) => canonicalHash({ reserve: basis.reserve, groups: basis.plan.groups, rows: basis.plan.rows });

export type MapBundleResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" }
  | { status: "ok"; response: MapBundleResponse };

/** Planen med tryckantal, kartbuntslistan, baksidorna och ändringar sedan varje lista skrevs ut. */
export async function readMapBundlesAsAdmin(db: Database, input: Authentication, now = new Date()): Promise<MapBundleResult> {
  if (!uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const basis = await loadBasis(tx, raceId);
    if (!basis) return { status: "not-found" };
    const current = printedMapState(basis.plan);
    const prints: Partial<Record<MapPrintList, { printedAt: string; changes: ReturnType<typeof mapPrintChanges> }>> = {};
    for (const row of await tx.select().from(schema.mapPrints).where(eq(schema.mapPrints.raceId, raceId))) {
      const printed = printedMapStateSchema.safeParse(row.state);
      if (!printed.success) continue;
      prints[row.list] = { printedAt: row.printedAt.toISOString(), changes: mapPrintChanges(printed.data, current, { counts: row.list === "BACKS" }) };
    }
    const { race, reserve, classes, plan } = basis;
    return { status: "ok", response: mapBundleResponseSchema.parse({ formatVersion: 1, raceId, snapshotVersion: race.snapshotVersion,
      eventName: race.eventName, raceName: race.raceName, raceDate: race.raceDate, timeZone: race.timeZone, reserve, stateHash: stateHash(basis),
      classes: classes.map(row => ({ classId: row.id, name: row.name, courseName: row.courseName, variantCodes: row.variantCodes,
        startMode: row.startMode, ...(row.leg !== undefined ? { leg: row.leg } : {}), ...(row.layout ? { layout: row.layout } : {}) })),
      groups: plan.groups.map(group => ({ courseName: group.courseName, variantCode: group.variantCode, items: group.items,
        runnerCount: group.runnerCount, vacancyCount: group.vacancyCount, reserveCount: group.reserveCount, printCount: group.printCount,
        ...(group.layout ? { layout: group.layout } : {}) })), rows: plan.rows, missingVariant: plan.missingVariant, prints,
      ...(basis.runnerBack ? { runnerBack: basis.runnerBack } : {}) }) };
  }, { isolationLevel: "repeatable read" });
}

export type MapPrintResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" | "conflict" }
  | { status: "printed"; response: ReturnType<typeof mapPrintResponseSchema.parse> };

/**
 * "Skriv ut": sparar läget som listan visade (samma hash), så att senare ändringar syns överst. Har läget ändrats sedan
 * listan lästes blir det en konflikt; sidan läser då om listan och visar ändringarna innan den skrivs ut.
 */
export async function recordMapPrintAsAdmin(db: Database, input: Authentication & { request: unknown }, now = new Date()): Promise<MapPrintResult> {
  const parsed = mapPrintRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "FUNCTIONARY", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    await tx.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.id, raceId)).for("update");
    const basis = await loadBasis(tx, raceId);
    if (!basis) return { status: "not-found" };
    if (stateHash(basis) !== parsed.data.stateHash) return { status: "conflict" };
    const state = printedMapState(basis.plan);
    await tx.insert(schema.mapPrints).values({ raceId, list: parsed.data.list, printedAt: now, state: { ...state } })
      .onConflictDoUpdate({ target: [schema.mapPrints.raceId, schema.mapPrints.list], set: { printedAt: now, state: { ...state } } });
    return { status: "printed", response: mapPrintResponseSchema.parse({ formatVersion: 1, raceId, list: parsed.data.list,
      printedAt: now.toISOString() }) };
  });
}

export type MapReserveResult =
  | { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" }
  | { status: "saved"; response: ReturnType<typeof mapReserveResponseSchema.parse> };

/** Reserven för tryckantalet (procent eller antal per variant). Påverkar inga resultat; sparas direkt. */
export async function saveMapReserveAsAdmin(db: Database, input: Authentication & { request: unknown }, now = new Date()): Promise<MapReserveResult> {
  const parsed = mapReserveRequestSchema.safeParse(input.request);
  if (!parsed.success || !uuid.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN", requireCsrf: true }, now, "update");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const [before] = await tx.select({ reserve: schema.races.mapReserve }).from(schema.races).where(eq(schema.races.id, raceId)).for("update");
    if (!before) return { status: "not-found" };
    const reserve = parsed.data.reserve;
    if (JSON.stringify(before.reserve ?? DEFAULT_MAP_RESERVE) !== JSON.stringify(reserve)) {
      await tx.update(schema.races).set({ mapReserve: reserve }).where(eq(schema.races.id, raceId));
      await tx.insert(schema.auditEvents).values({ raceId, entityType: "race", entityId: raceId, action: "MAP_RESERVE_CHANGED_BY_ADMIN",
        actorKind: "USER_ACCOUNT", actorId: auth.principal.accountId, before: { reserve: before.reserve }, after: { reserve }, createdAt: now });
    }
    return { status: "saved", response: mapReserveResponseSchema.parse({ formatVersion: 1, raceId, reserve }) };
  });
}
