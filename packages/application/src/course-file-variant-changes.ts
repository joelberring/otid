import type { SyncConsequence } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { entryCourseVersionId, sameControlCodes } from "@o-tid/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { leastUsedVariantForClass } from "./course-variants";
import { loadRaceSnapshot } from "./snapshot";
import type { CourseFileAction, CurrentState, PlannedRow } from "./source-sync-model";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type CourseFileVariantChange = NonNullable<SyncConsequence["variantChanges"]>[number];

/**
 * ADR-0175, tillägg 2026-11-12 (c): löpare (och stafettsträckor) med en tilldelad variant vars kontroller ändras av banfilen
 * ("Överför till tävlingen" eller en ny banfil), eller vars kod inte finns i filen. Löparen behåller koden (den står på den
 * tryckta kartan), så beskedet säger namn, kod och kontrollerna före och efter innan något sparas. Bara admin når beskedet.
 */
export async function courseFileVariantChanges(tx: Transaction, raceId: string, rows: readonly PlannedRow<CourseFileAction>[], state: CurrentState)
  : Promise<CourseFileVariantChange[]> {
  const changed = new Map<string, { before: CurrentState["courses"][number]["variants"]; after: readonly { code: string; controlCodes: readonly number[] }[];
    renames: Readonly<Record<string, string | null>> }>();
  for (const { action } of rows) {
    if (action.type !== "CHANGE_COURSE") continue;
    const course = state.courses.find(row => row.id === action.courseId);
    if (course && course.variants.length > 0) changed.set(course.versionId, { before: course.variants, after: action.variants, renames: action.codeRenames ?? {} });
  }
  if (changed.size === 0) return [];
  const snapshot = await loadRaceSnapshot(tx, raceId);
  const classes = new Map(snapshot.classes.map(row => [row.id, row]));
  const result: (CourseFileVariantChange & { entryId: string })[] = [];
  for (const entry of snapshot.entries) {
    const code = entry.courseVariantCode;
    const raceClass = classes.get(entry.classId);
    if (code === undefined || !raceClass) continue;
    const course = changed.get(entryCourseVersionId(entry, raceClass));
    const before = course?.before.find(variant => variant.code === code)?.controlCodes;
    if (!course || !before) continue;
    // Tillägg 2026-11-21 (b): en kod som bytts i banläggningen (AG → AC) jämförs med den nya koden.
    const next = renamedCode(course.renames, code);
    const after = next === null ? null : course.after.find(variant => variant.code === next)?.controlCodes ?? null;
    if (after && sameControlCodes(before, after)) continue;
    // Ägaren 2026-11-17: en löpare vars kod försvinner och som inte läst ut får en ny variant (`reassignVanishedVariants`).
    const reassigned = after === null && reassignable(state, entry.id, entry.courseVersionId);
    result.push({ entryId: entry.id, displayName: `${entry.givenName} ${entry.familyName}`.trim() || "?", className: raceClass.name, code,
      beforeControls: [...before], afterControls: after ? [...after] : null, ...(reassigned ? { reassigned: true } : {}),
      ...(after && next !== null && next !== code ? { codeAfter: next } : {}) });
  }
  if (result.length === 0) return [];
  const legs = new Map((await tx.select({ id: schema.entries.id, leg: schema.entries.relayLeg }).from(schema.entries)
    .where(inArray(schema.entries.id, result.map(row => row.entryId)))).map(row => [row.id, row.leg]));
  return result.map(row => { const leg = legs.get(row.entryId); return leg === null || leg === undefined ? row : { ...row, leg }; })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "sv-SE") || (left.entryId < right.entryId ? -1 : 1)).slice(0, 10_000);
}

/** Koden efter banläggningens översättning (null = varianten finns inte kvar); utan översättning samma kod. */
export const renamedCode = (renames: Readonly<Record<string, string | null>>, code: string): string | null =>
  Object.hasOwn(renames, code) ? renames[code]! : code;

/**
 * ADR-0175, tillägg 2026-11-21 (b): banläggningens nycklar har ordnats om sedan förra överföringen. Löpare och stafettsträckor
 * vars kod bytts får den nya koden (de behåller sina kontroller; en tryckt karta med den gamla koden har samma kontroller).
 * Det gäller också den som läst ut (grenen är densamma, bara bokstaven är ny). En kod vars gren inte finns kvar (null) rörs
 * inte här: löparen får en ny variant av `reassignVanishedVariants` (om den inte läst ut), också när den gamla koden råkar
 * finnas bland de nya. Körs efter att banornas versioner sparats och före
 * fördelningen. Ger antalet löpare som fick en ny kod.
 */
export async function renameTransferredVariants(tx: Transaction, raceId: string, rows: readonly PlannedRow<CourseFileAction>[])
  : Promise<{ renamed: number; vanished: ReadonlySet<string> }> {
  const renames = new Map<string, Readonly<Record<string, string | null>>>();
  for (const { action } of rows) if (action.type === "CHANGE_COURSE" && action.codeRenames) renames.set(action.courseId, action.codeRenames);
  if (renames.size === 0) return { renamed: 0, vanished: new Set() };
  const snapshot = await loadRaceSnapshot(tx, raceId);
  const classes = new Map(snapshot.classes.map(row => [row.id, row]));
  const courseOfVersion = new Map(snapshot.courses.flatMap(course => course.versions.map(version => [version.id, course.id] as const)));
  let renamed = 0;
  const vanished = new Set<string>();
  for (const entry of snapshot.entries) {
    const code = entry.courseVariantCode, raceClass = classes.get(entry.classId);
    if (code === undefined || !raceClass) continue;
    const table = renames.get(courseOfVersion.get(entryCourseVersionId(entry, raceClass)) ?? "");
    if (!table || !Object.hasOwn(table, code)) continue;
    const next = table[code];
    if (next === null || next === undefined) { vanished.add(entry.id); continue; }
    await tx.update(schema.entries).set({ courseVariantCode: next, version: sql`${schema.entries.version} + 1` })
      .where(and(eq(schema.entries.id, entry.id), eq(schema.entries.raceId, raceId)));
    renamed += 1;
  }
  // Stafettsträckornas fasta variant (relay_leg) för klasser med banan.
  const legs = await tx.select({ classId: schema.relayLegs.classId, leg: schema.relayLegs.leg, code: schema.relayLegs.courseVariantCode,
    courseVersionId: schema.relayLegs.courseVersionId }).from(schema.relayLegs).where(eq(schema.relayLegs.raceId, raceId));
  for (const leg of legs) {
    const raceClass = classes.get(leg.classId);
    if (leg.code === null || !raceClass) continue;
    const table = renames.get(courseOfVersion.get(leg.courseVersionId ?? raceClass.courseVersionId) ?? "");
    const next = table && Object.hasOwn(table, leg.code) ? table[leg.code] : undefined;
    if (next === undefined) continue;
    await tx.update(schema.relayLegs).set({ courseVariantCode: next })
      .where(and(eq(schema.relayLegs.raceId, raceId), eq(schema.relayLegs.classId, leg.classId), eq(schema.relayLegs.leg, leg.leg)));
  }
  return { renamed, vanished };
}

/** Individuell löpare (inte stafett, ingen egen bana) som inte läst ut och inte har något resultat. */
function reassignable(state: CurrentState, entryId: string, ownCourse: string | undefined): boolean {
  const entry = state.entries.find(row => row.id === entryId);
  return !!entry && ownCourse === undefined && entry.relayLeg === null && entry.teamId === null && !entry.readOut && !entry.hasResult;
}

/**
 * Ägaren 2026-11-17 («de samlade gafflingskombinationerna ska ändras»): efter en överföring (eller ny banfil) som tar bort
 * varianter får en löpare vars kod inte längre finns den minst använda av klassens varianter. Löpare vars kod finns kvar
 * behåller den (den står på kartan), och den som läst ut eller har ett resultat rörs aldrig; stafetten fördelas som förut.
 * Bara klasser vars bana ändrades i den här överföringen. Ger antalet löpare som fick en ny variant.
 */
export async function reassignVanishedVariants(tx: Transaction, raceId: string, state: CurrentState, changedCourseIds: ReadonlySet<string>,
  /** Tillägg 2026-11-21 (b): löpare vars gren inte finns kvar enligt banläggningens översättning. */
  vanished: ReadonlySet<string> = new Set()): Promise<number> {
  if (changedCourseIds.size === 0) return 0;
  const snapshot = await loadRaceSnapshot(tx, raceId);
  const classes = new Map(snapshot.classes.map(row => [row.id, row]));
  const versions = new Map(snapshot.courses.flatMap(course => course.versions.map(version =>
    [version.id, { courseId: course.id, codes: new Set((version.variants ?? []).map(variant => variant.code)) }] as const)));
  let count = 0;
  for (const entry of snapshot.entries) {
    const code = entry.courseVariantCode, raceClass = classes.get(entry.classId);
    if (code === undefined || !raceClass || !reassignable(state, entry.id, entry.courseVersionId)) continue;
    const version = versions.get(raceClass.courseVersionId);
    if (!version || !changedCourseIds.has(version.courseId) || version.codes.size === 0 || (version.codes.has(code) && !vanished.has(entry.id))) continue;
    const next = await leastUsedVariantForClass(tx, raceId, entry.classId);
    await tx.update(schema.entries).set({ courseVariantCode: next, version: sql`${schema.entries.version} + 1` })
      .where(and(eq(schema.entries.id, entry.id), eq(schema.entries.raceId, raceId)));
    count += 1;
  }
  return count;
}
