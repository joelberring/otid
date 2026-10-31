import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { wrongMapVariants } from "@o-tid/domain";
import { loadRaceSnapshot, type DbExecutor } from "./snapshot";
import { normalizedReadout } from "./result-revisions";

/**
 * Fel karta vid starten (PLAN.md steg 61): för felstämplade löpare med tilldelad variant, varianterna av samma bana som
 * löparens senast bedömda avläsning passar utan fel. Regeln är domänens `wrongMapVariants`; här läses bara avläsningen och
 * ögonblicksbilden för löparna. Arbetsytans lista och deltagarkortet visar beskedet; inget byts.
 */
export type WrongMap = { readonly assignedCode: string; readonly fittingCodes: readonly string[] };

export async function loadWrongMaps(tx: DbExecutor, raceId: string, entryIds: readonly string[]): Promise<Map<string, WrongMap>> {
  const result = new Map<string, WrongMap>();
  if (entryIds.length === 0) return result;
  const forked = await tx.select({ id: schema.entries.id }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), inArray(schema.entries.id, [...entryIds]), isNotNull(schema.entries.courseVariantCode)));
  if (forked.length === 0) return result;
  const ids = forked.map(row => row.id);
  const readouts = await tx.selectDistinctOn([schema.resultRevisions.entryId], { entryId: schema.resultRevisions.entryId,
    readout: schema.cardReadouts }).from(schema.resultRevisions)
    .innerJoin(schema.cardReadouts, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
    .where(and(eq(schema.resultRevisions.raceId, raceId), inArray(schema.resultRevisions.entryId, ids)))
    .orderBy(asc(schema.resultRevisions.entryId), desc(schema.resultRevisions.revision));
  if (readouts.length === 0) return result;
  const snapshot = await loadRaceSnapshot(tx, raceId, { entryIds: readouts.map(row => row.entryId) });
  for (const row of readouts) {
    const found = wrongMapVariants(normalizedReadout(row.readout), snapshot, row.entryId);
    if (found) result.set(row.entryId, found);
  }
  return result;
}
