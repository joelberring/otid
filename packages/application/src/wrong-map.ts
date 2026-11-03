import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { excludedVariantsFitting, wrongMapVariants } from "@o-tid/domain";
import { loadRaceSnapshot, type DbExecutor } from "./snapshot";
import { normalizedReadout } from "./result-revisions";

/**
 * Fel karta vid starten (PLAN.md steg 61): för felstämplade löpare med tilldelad variant, varianterna av samma bana som
 * löparens senast bedömda avläsning passar utan fel. Regeln är domänens `wrongMapVariants`; här läses bara avläsningen och
 * ögonblicksbilden för löparna. Arbetsytans lista och deltagarkortet visar beskedet; inget byts.
 */
export type WrongMap = { readonly assignedCode: string; readonly fittingCodes: readonly string[] };
/** ADR-0197: stämplingarna passar en bortvald variant (`excludedVariantsFitting`). */
export type WrongMaps = { readonly wrongMaps: Map<string, WrongMap>; readonly excluded: Map<string, readonly string[]> };

export async function loadWrongMaps(tx: DbExecutor, raceId: string, entryIds: readonly string[]): Promise<WrongMaps> {
  const result: WrongMaps = { wrongMaps: new Map(), excluded: new Map() };
  if (entryIds.length === 0) return result;
  // ADR-0197: en löpare utan variant (eller med en bortvald kod) kan också ha sprungit en bortvald variant, så alla
  // felstämplade på banversioner med bortvalda varianter läses; annars bara de med variant.
  const rows = await tx.select({ id: schema.entries.id, code: schema.entries.courseVariantCode }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), inArray(schema.entries.id, [...entryIds])));
  const pruned = (await tx.select({ id: schema.courseVersions.id }).from(schema.courseVersions)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseVersions.courseId))
    .where(and(eq(schema.courses.raceId, raceId), isNotNull(schema.courseVersions.excludedVariants))).limit(1)).length > 0;
  const ids = rows.filter(row => pruned || row.code !== null).map(row => row.id);
  if (ids.length === 0) return result;
  const readouts = await tx.selectDistinctOn([schema.resultRevisions.entryId], { entryId: schema.resultRevisions.entryId,
    readout: schema.cardReadouts }).from(schema.resultRevisions)
    .innerJoin(schema.cardReadouts, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, ids)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision));
  if (readouts.length === 0) return result;
  const snapshot = await loadRaceSnapshot(tx, raceId, { entryIds: readouts.map(row => row.entryId) });
  for (const row of readouts) {
    const readout = normalizedReadout(row.readout);
    const found = wrongMapVariants(readout, snapshot, row.entryId);
    if (found) result.wrongMaps.set(row.entryId, found);
    const excluded = pruned ? excludedVariantsFitting(readout, snapshot, row.entryId) : undefined;
    if (excluded) result.excluded.set(row.entryId, excluded);
  }
  return result;
}
