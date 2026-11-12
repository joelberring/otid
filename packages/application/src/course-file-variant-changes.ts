import type { SyncConsequence } from "@o-tid/contracts";
import { schema, type Database } from "@o-tid/database";
import { entryCourseVersionId, sameControlCodes } from "@o-tid/domain";
import { inArray } from "drizzle-orm";
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
  const changed = new Map<string, { before: CurrentState["courses"][number]["variants"]; after: readonly { code: string; controlCodes: readonly number[] }[] }>();
  for (const { action } of rows) {
    if (action.type !== "CHANGE_COURSE") continue;
    const course = state.courses.find(row => row.id === action.courseId);
    if (course && course.variants.length > 0) changed.set(course.versionId, { before: course.variants, after: action.variants });
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
    const after = course.after.find(variant => variant.code === code)?.controlCodes ?? null;
    if (after && sameControlCodes(before, after)) continue;
    result.push({ entryId: entry.id, displayName: `${entry.givenName} ${entry.familyName}`.trim() || "?", className: raceClass.name, code,
      beforeControls: [...before], afterControls: after ? [...after] : null });
  }
  if (result.length === 0) return [];
  const legs = new Map((await tx.select({ id: schema.entries.id, leg: schema.entries.relayLeg }).from(schema.entries)
    .where(inArray(schema.entries.id, result.map(row => row.entryId)))).map(row => [row.id, row.leg]));
  return result.map(row => { const leg = legs.get(row.entryId); return leg === null || leg === undefined ? row : { ...row, leg }; })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "sv-SE") || (left.entryId < right.entryId ? -1 : 1)).slice(0, 10_000);
}
