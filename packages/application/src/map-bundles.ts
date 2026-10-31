import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  mapBundleResponseSchema, mapPrintRequestSchema, mapPrintResponseSchema, mapReserveRequestSchema, mapReserveResponseSchema,
  printedMapStateSchema, type MapBundleResponse, type MapPrintList
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import {
  DEFAULT_MAP_RESERVE, mapPrintChanges, planMapBundles, printedMapState, type MapBundleClassInput, type MapBundlePlan, type MapReserve
} from "@o-tid/domain";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { loadCourseVersionVariants } from "./course-variants";
import { loadStartListFacts } from "./start-draw-basis";
import type { DbExecutor } from "./snapshot";
import { canonicalHash, UUID_PATTERN as uuid } from "./serialization";

/**
 * Kartor till starten (PLAN.md steg 61): tryckantal per variant, kartbuntslistan och baksidorna ur domänens
 * `planMapBundles`, plus senaste utskriften per lista (`map_print`) och vad som ändrats sedan dess. Funktionären vid
 * starten läser och skriver ut; reserven ställs in av administratören. Stafettklasser ingår inte (sträckorna har egna
 * starter och bana per lag).
 */
type Authentication = RaceSessionProof;
const notRelayClass = sql`not exists (select 1 from relay_leg rl where rl.class_id = ${schema.classes.id})`;

interface MapBundleBasis {
  readonly race: { eventName: string; raceName: string; raceDate: string; timeZone: string; snapshotVersion: number };
  readonly reserve: MapReserve;
  readonly classes: readonly MapBundleClassInput[];
  readonly plan: MapBundlePlan;
}

async function loadBasis(tx: DbExecutor, raceId: string): Promise<MapBundleBasis | undefined> {
  const [race] = await tx.select({ eventName: schema.events.name, raceName: schema.races.name, raceDate: schema.races.raceDate,
    timeZone: schema.events.timeZone, snapshotVersion: schema.races.snapshotVersion, reserve: schema.races.mapReserve })
    .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
  if (!race) return undefined;
  const classRows = await tx.select({ id: schema.classes.id, name: schema.classes.name, startRule: schema.classes.startRule,
    courseVersionId: schema.classes.courseVersionId, courseName: schema.courses.name }).from(schema.classes)
    .innerJoin(schema.courseVersions, eq(schema.courseVersions.id, schema.classes.courseVersionId))
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(and(eq(schema.classes.raceId, raceId), notRelayClass, isNull(schema.classes.rogainingTimeLimitSeconds)))
    .orderBy(asc(schema.classes.name), asc(schema.classes.id)).limit(1001);
  if (classRows.length > 1000) throw new Error("För många klasser");
  const variants = await loadCourseVersionVariants(tx, classRows.map(row => row.courseVersionId));
  const facts = await loadStartListFacts(tx, raceId);
  const classes: MapBundleClassInput[] = classRows.map(row => {
    const fact = facts.get(row.id);
    const startMode = row.startRule === "PUNCH" ? "FREE" : fact?.drawMethod === "MASS" ? "MASS" : "MINUTE";
    return { id: row.id, name: row.name, courseVersionId: row.courseVersionId, courseName: row.courseName,
      variantCodes: (variants.get(row.courseVersionId) ?? []).map(variant => variant.code), startMode,
      vacancies: startMode === "MINUTE" ? fact?.vacancies ?? [] : [] };
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
  const plan = planMapBundles({ classes, reserve, entries: entries.map(row => ({ id: row.id, name: `${row.givenName} ${row.familyName}`.trim(),
    club: row.club, classId: row.classId, variantCode: row.variantCode,
    startTime: startRule.get(row.classId) === "FIXED" ? row.startTime?.toISOString() ?? null : null })) });
  return { race, reserve, classes, plan };
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
        startMode: row.startMode })),
      groups: plan.groups.map(group => ({ courseName: group.courseName, variantCode: group.variantCode, items: group.items,
        runnerCount: group.runnerCount, vacancyCount: group.vacancyCount, reserveCount: group.reserveCount, printCount: group.printCount })), rows: plan.rows, missingVariant: plan.missingVariant, prints }) };
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
