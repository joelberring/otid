import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import {
  controlMapResponseSchema, runnerControlMapSchema, type ControlMapResponse, type RunnerControlMap, type RunnerControlMapLeg
} from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { controlCodesOutOfOrder, controlLoads, layoutControlMap, runnerControlMarks, type ControlMapLayout, type ControlMapPlace } from "@o-tid/domain";
import { loadCourseForMap } from "./course-edit";
import { loadMapFileFrame } from "./map-file-frame";
import { courseForkingView } from "./course-forking";
import { coursesArePublic } from "./course-secrecy";
import { requireRaceRole, type RaceSessionProof } from "./race-session";
import { publicResults } from "./results";
import { loadRaceSnapshot, type DbExecutor } from "./snapshot";
import { UUID_PATTERN } from "./serialization";

/**
 * Steg 52 (ADR-0176): kontrollkartan. Arbetsytan får alla banor med kontrollernas lägen, belastningen per kontroll och
 * kartbildens storlek; deltagarkortet och den publika deltagarsidan får löparens bana med stämplingarna. Det publika
 * svaret finns bara när banorna är publika (eller för arrangören och funktionärerna) och har inga andra löpares data.
 */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Failure = { status: "unauthorized" | "forbidden" | "invalid-request" | "not-found" };
const PLACEHOLDER = { externalSource: "EVENTOR", externalId: "otid:placeholder-course" } as const;

interface RacePlaces {
  readonly controls: Map<number, ControlMapPlace>;
  readonly ends: Map<string, { start?: ControlMapPlace; finish?: ControlMapPlace }>;
  readonly map: { transform: NonNullable<typeof schema.raceMaps.$inferSelect.transform>; width: number; height: number; version: string } | undefined;
  readonly scale: number | null;
  /** Steg 59: kartfilen som kartbilden är ritad ur, när bilden är georefererad. */
  readonly mapFile: Awaited<ReturnType<typeof loadMapFileFrame>>;
}

async function loadPlaces(tx: DbExecutor, raceId: string): Promise<RacePlaces> {
  const rows = await tx.select({ code: schema.controls.code, latitude: schema.controls.latitude, longitude: schema.controls.longitude,
    mapX: schema.controls.mapX, mapY: schema.controls.mapY }).from(schema.controls).where(eq(schema.controls.raceId, raceId));
  const controls = new Map(rows.map(row => [row.code, { key: `c${row.code}`,
    geo: row.latitude !== null && row.longitude !== null ? { latitude: row.latitude, longitude: row.longitude } : undefined,
    paper: row.mapX !== null && row.mapY !== null ? { x: row.mapX, y: row.mapY } : undefined }]));
  const courseRows = await tx.select({ id: schema.courses.id, start: schema.courses.startPosition, finish: schema.courses.finishPosition,
    startMap: schema.courses.startMapPosition, finishMap: schema.courses.finishMapPosition }).from(schema.courses)
    .where(eq(schema.courses.raceId, raceId));
  const ends = new Map(courseRows.map(row => {
    const place = (key: string, geo: { latitude: number; longitude: number } | null, paper: { x: number; y: number } | null) =>
      geo || paper ? { key, geo: geo ?? undefined, paper: paper ?? undefined } : undefined;
    const start = place(`s${row.id}`, row.start, row.startMap), finish = place(`f${row.id}`, row.finish, row.finishMap);
    return [row.id, { ...(start ? { start } : {}), ...(finish ? { finish } : {}) }];
  }));
  const [map] = await tx.select({ width: schema.raceMaps.width, height: schema.raceMaps.height, sha256: schema.raceMaps.sha256,
    transform: schema.raceMaps.transform }).from(schema.raceMaps).where(eq(schema.raceMaps.raceId, raceId));
  const [race] = await tx.select({ scale: schema.races.courseMapScale }).from(schema.races).where(eq(schema.races.id, raceId));
  const mapFile = map?.transform ? await loadMapFileFrame(tx, raceId) : undefined;
  return { controls, ends, scale: race?.scale ?? null, mapFile,
    map: map?.transform ? { transform: map.transform, width: map.width, height: map.height, version: map.sha256.slice(0, 16) } : undefined };
}

function layoutFor(places: RacePlaces, keys: readonly ControlMapPlace[]): ControlMapLayout {
  return layoutControlMap({ places: keys, map: places.map, scale: places.scale, mapFile: places.mapFile });
}

const layoutFields = (layout: ControlMapLayout, places: RacePlaces) => ({ frame: layout.frame, metersPerUnit: layout.metersPerUnit,
  map: layout.frame === "MAP" && places.map ? { width: places.map.width, height: places.map.height, version: places.map.version } : null,
  bounds: layout.bounds, mapFile: layout.mapFile });

/** Arbetsytans kontrollkarta: alla banor, kontroller och belastningen. Arrangören och funktionärerna. */
export async function readControlMapAsAdmin(db: Database, input: Omit<RaceSessionProof, "csrfCookie" | "csrfHeader">, now = new Date())
  : Promise<Failure | { status: "ok"; response: ControlMapResponse }> {
  if (!UUID_PATTERN.test(input.raceId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const courseRows = await tx.select({ id: schema.courses.id, externalSource: schema.courses.externalSource, externalId: schema.courses.externalId })
      .from(schema.courses).where(eq(schema.courses.raceId, raceId));
    const courses = [];
    for (const row of courseRows) {
      const course = await loadCourseForMap(tx, raceId, row.id);
      if (!course) continue;
      if (row.externalSource === PLACEHOLDER.externalSource && row.externalId === PLACEHOLDER.externalId && course.classes.length === 0) continue;
      courses.push(course);
    }
    courses.sort((left, right) => left.name.localeCompare(right.name, "sv-SE") || (left.id < right.id ? -1 : 1));
    // Löparna per bana och variant (stafettsträckans egen bana eller klassens).
    const entries = await tx.select({ id: schema.entries.id, classId: schema.entries.classId, relayLeg: schema.entries.relayLeg,
      variantCode: schema.entries.courseVariantCode }).from(schema.entries)
      .where(and(eq(schema.entries.raceId, raceId), isNull(schema.entries.struckAt)));
    const legRows = await tx.select({ classId: schema.relayLegs.classId, leg: schema.relayLegs.leg, courseVersionId: schema.relayLegs.courseVersionId })
      .from(schema.relayLegs).where(eq(schema.relayLegs.raceId, raceId));
    const legVersion = new Map(legRows.flatMap(row => row.courseVersionId ? [[`${row.classId}:${row.leg}`, row.courseVersionId] as const] : []));
    const classVersion = new Map((await tx.select({ id: schema.classes.id, courseVersionId: schema.classes.courseVersionId }).from(schema.classes)
      .where(eq(schema.classes.raceId, raceId))).map(row => [row.id, row.courseVersionId]));
    const courseOfVersion = new Map(courses.map(course => [course.version.id, course.id]));
    const entryCourses = entries.flatMap(entry => {
      const version = (entry.relayLeg === null ? undefined : legVersion.get(`${entry.classId}:${entry.relayLeg}`)) ?? classVersion.get(entry.classId);
      const courseId = version ? courseOfVersion.get(version) : undefined;
      return courseId ? [{ entryId: entry.id, courseId, variantCode: entry.variantCode }] : [];
    });
    // Stämplade kontroller per avläst löpare: sträcktiderna i senaste resultatrevisionen.
    const heads = await tx.selectDistinctOn([schema.resultRevisions.entryId], { entryId: schema.resultRevisions.entryId,
      evaluation: schema.resultRevisions.evaluation }).from(schema.resultRevisions)
      .innerJoin(schema.entries, and(eq(schema.entries.id, schema.resultRevisions.entryId), isNull(schema.entries.struckAt)))
      .where(eq(schema.resultRevisions.raceId, raceId))
      .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision));
    const punched = heads.map(head => splitsOf(head.evaluation).map(split => split.controlCode));
    const loadCourses = courses.map(course => ({ courseId: course.id, variants: course.variants.length > 0
      ? course.variants.map(variant => ({ code: variant.code, controlCodes: variant.controlCodes }))
      : [{ code: null, controlCodes: course.controlCodes }] }));
    const loads = controlLoads(loadCourses, entryCourses, punched);
    const outOfOrder = controlCodesOutOfOrder(await loadRaceSnapshot(tx, raceId));
    const places = await loadPlaces(tx, raceId);
    const used = new Set(loads.map(load => load.code));
    const keys = [...[...used].flatMap(code => places.controls.get(code) ? [places.controls.get(code)!] : []),
      ...courses.flatMap(course => { const end = places.ends.get(course.id); return [end?.start, end?.finish].filter(place => place !== undefined); })];
    const layout = layoutFor(places, keys);
    const at = (key: string) => layout.points.get(key) ?? null;
    return { status: "ok" as const, response: controlMapResponseSchema.parse({ formatVersion: 1, raceId, ...layoutFields(layout, places),
      controls: loads.map(load => ({ ...load, position: at(`c${load.code}`), outOfOrder: outOfOrder.has(load.code) })),
      courses: courses.map(course => {
        const ownEntries = entryCourses.filter(entry => entry.courseId === course.id);
        const view = courseForkingView(course.variants, course.forking);
        return { courseId: course.id, name: course.name, classNames: course.classes.map(row => row.name),
          start: at(`s${course.id}`), finish: at(`f${course.id}`),
          variants: course.variants.length > 0
            ? course.variants.map(variant => ({ code: variant.code, controlCodes: [...variant.controlCodes],
              entryCount: ownEntries.filter(entry => entry.variantCode === variant.code).length }))
            : [{ code: null, controlCodes: course.controlCodes, entryCount: ownEntries.length }],
          forking: view ? { items: view.items, variants: view.variants } : null };
      }) }) };
  }, { isolationLevel: "repeatable read" });
}

type Evaluation = { splits?: { controlCode: number; occurrence: number }[]; extraPunches?: number[] };
function splitsOf(evaluation: unknown): { controlCode: number; occurrence: number }[] {
  const value = evaluation as Evaluation | null;
  return Array.isArray(value?.splits) ? value.splits.filter(split => Number.isInteger(split.controlCode) && Number.isInteger(split.occurrence)) : [];
}
function extrasOf(evaluation: unknown): number[] {
  const value = evaluation as Evaluation | null;
  return Array.isArray(value?.extraPunches) ? value.extraPunches.filter(code => Number.isInteger(code)) : [];
}

interface RunnerLegSource {
  readonly leg: number | null;
  readonly courseVersionId: string;
  readonly variantCode: string | null;
  /** Bedömningens sträcktider och extra stämplingar; undefined = ingen avläsning än. */
  readonly evaluation: { splits: readonly { controlCode: number; occurrence: number }[]; extraPunches: readonly number[] } | undefined;
}

/** Löparens karta ur en eller flera sträckor: bara löparens egna kontroller, start och mål. */
async function runnerMap(tx: Transaction, raceId: string, name: string, sources: readonly RunnerLegSource[]): Promise<RunnerControlMap | undefined> {
  const outOfOrder = controlCodesOutOfOrder(await loadRaceSnapshot(tx, raceId));
  const places = await loadPlaces(tx, raceId);
  const legs: (Omit<RunnerControlMapLeg, "start" | "finish"> & { courseId: string })[] = [];
  for (const source of sources) {
    const [version] = await tx.select({ courseId: schema.courseVersions.courseId }).from(schema.courseVersions)
      .where(eq(schema.courseVersions.id, source.courseVersionId));
    if (!version) continue;
    const course = await loadCourseForMap(tx, raceId, version.courseId);
    if (!course) continue;
    const variant = source.variantCode ? course.variants.find(row => row.code === source.variantCode) : undefined;
    const codes = variant ? [...variant.controlCodes] : course.variants.length > 0 ? [] : course.controlCodes;
    legs.push({ courseId: course.id, leg: source.leg, courseName: course.name, variantCode: variant?.code ?? null, controlCodes: codes,
      marks: source.evaluation ? runnerControlMarks(codes, source.evaluation.splits, source.evaluation.extraPunches, outOfOrder) : null });
  }
  if (legs.length === 0) return undefined;
  const codes = [...new Set(legs.flatMap(leg => leg.controlCodes))];
  const keys = [...codes.flatMap(code => places.controls.get(code) ? [places.controls.get(code)!] : []),
    ...[...new Set(legs.map(leg => leg.courseId))].flatMap(id => { const end = places.ends.get(id); return [end?.start, end?.finish].filter(place => place !== undefined); })];
  const layout = layoutFor(places, keys);
  const at = (key: string) => layout.points.get(key) ?? null;
  return runnerControlMapSchema.parse({ formatVersion: 1, raceId, ...layoutFields(layout, places), name,
    controls: codes.sort((left, right) => left - right).map(code => ({ code, position: at(`c${code}`) })),
    legs: legs.map(({ courseId, ...leg }) => ({ ...leg, start: at(`s${courseId}`), finish: at(`f${courseId}`) })) });
}

/**
 * Deltagarkortets "Visa på kartan": löparens bana (variant) med stämplade, saknade och i fel ordning. En stafettlöpare
 * får sin sträcka; en teamsprintlöpare alla sina sträckor (samma bricka).
 */
export async function readEntryControlMapAsAdmin(db: Database, input: Omit<RaceSessionProof, "csrfCookie" | "csrfHeader"> & { entryId: string },
  now = new Date()): Promise<Failure | { status: "ok"; response: RunnerControlMap }> {
  if (!UUID_PATTERN.test(input.raceId) || !UUID_PATTERN.test(input.entryId)) return { status: "invalid-request" };
  return db.transaction(async tx => {
    const auth = await requireRaceRole(tx, { ...input, role: "ADMIN" }, now, "share");
    if (auth.status !== "authenticated") return auth;
    const raceId = auth.principal.raceId;
    const [entry] = await tx.select().from(schema.entries).where(and(eq(schema.entries.id, input.entryId), eq(schema.entries.raceId, raceId)));
    if (!entry) return { status: "not-found" as const };
    const cardEntryId = entry.relayCardEntryId ?? entry.id;
    const own = entry.teamId === null ? [entry] : await tx.select().from(schema.entries).where(and(eq(schema.entries.raceId, raceId),
      eq(schema.entries.teamId, entry.teamId), or(eq(schema.entries.id, cardEntryId), eq(schema.entries.relayCardEntryId, cardEntryId))))
      .orderBy(asc(schema.entries.relayLeg));
    const sources: RunnerLegSource[] = [];
    for (const leg of own) {
      const [classRow] = await tx.select({ courseVersionId: schema.classes.courseVersionId }).from(schema.classes).where(eq(schema.classes.id, leg.classId));
      const [legRow] = leg.relayLeg === null ? [] : await tx.select({ courseVersionId: schema.relayLegs.courseVersionId }).from(schema.relayLegs)
        .where(and(eq(schema.relayLegs.classId, leg.classId), eq(schema.relayLegs.leg, leg.relayLeg)));
      const courseVersionId = legRow?.courseVersionId ?? classRow?.courseVersionId;
      if (!courseVersionId) continue;
      // Markeringarna bara när resultatet bygger på en avläsning (ett beslut utan avläsning har inga stämplingar).
      const [head] = await tx.select({ evaluation: schema.resultRevisions.evaluation, readoutId: schema.resultRevisions.readoutId })
        .from(schema.resultRevisions).where(eq(schema.resultRevisions.entryId, leg.id)).orderBy(desc(schema.resultRevisions.revision)).limit(1);
      const evaluation = head?.readoutId ? { splits: splitsOf(head.evaluation), extraPunches: extrasOf(head.evaluation) } : undefined;
      sources.push({ leg: leg.relayLeg, courseVersionId, variantCode: leg.courseVariantCode, evaluation });
    }
    const map = await runnerMap(tx, raceId, `${entry.givenName} ${entry.familyName}`, sources);
    return map ? { status: "ok" as const, response: map } : { status: "not-found" as const };
  }, { isolationLevel: "repeatable read" });
}

/**
 * Publikt på deltagarsidan ("Visa på kartan"): bara när banorna är publika (eller för arrangören och funktionärerna), och
 * bara ur löparens publicerade resultat (variant, sträcktider och extra stämplingar). Ingen belastning.
 */
export async function readPublicRunnerControlMap(db: Database, raceId: string, publicResultId: string, options: { readonly staff?: boolean } = {})
  : Promise<RunnerControlMap | undefined> {
  if (!UUID_PATTERN.test(raceId) || !UUID_PATTERN.test(publicResultId)) return undefined;
  const list = await publicResults(db, raceId, options);
  const result = list.results.find(row => "publicResultId" in row && row.publicResultId === publicResultId);
  if (!result || !("publicResultId" in result)) return undefined;
  return db.transaction(async tx => {
    if (options.staff !== true && !await coursesArePublic(tx, raceId)) return undefined;
    const [classRow] = await tx.select({ courseVersionId: schema.classes.courseVersionId }).from(schema.classes)
      .where(and(eq(schema.classes.raceId, raceId), eq(schema.classes.name, result.className)));
    if (!classRow) return undefined;
    const variantCode = "courseVariantCode" in result ? result.courseVariantCode ?? null : null;
    const splits = "splits" in result ? result.splits ?? [] : [];
    const extraPunches = "extraPunches" in result ? result.extraPunches : [];
    return runnerMap(tx, raceId, `${result.givenName} ${result.familyName}`, [{ leg: null, courseVersionId: classRow.courseVersionId, variantCode,
      evaluation: { splits, extraPunches } }]);
  }, { isolationLevel: "repeatable read" });
}

