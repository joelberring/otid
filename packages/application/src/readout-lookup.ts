import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/** Uppslag av avläsningar som delas av brickkopplingarna (`card-assignment.ts`) och direktanmälan. */
/** Den senaste avläsningen av brickan som togs emot som okänd och ännu inte gett något resultat. */
export async function latestUnresolvedReadout(tx: DbExecutor, raceId: string, cardNumber: string) {
  const [row] = await tx.select({ readout: schema.cardReadouts }).from(schema.cardReadouts)
    .innerJoin(schema.deviceIngestOutcomes, eq(schema.deviceIngestOutcomes.rawMessageId, schema.cardReadouts.rawMessageId))
    .leftJoin(schema.resultRevisions, eq(schema.resultRevisions.readoutId, schema.cardReadouts.id))
    .leftJoin(schema.unknownReadoutResolutions, eq(schema.unknownReadoutResolutions.readoutId, schema.cardReadouts.id))
    .where(and(eq(schema.cardReadouts.raceId, raceId), eq(schema.cardReadouts.cardNumber, cardNumber),
      sql`${schema.deviceIngestOutcomes.serverResult}->>'status' = 'UNKNOWN_CARD'`, isNull(schema.resultRevisions.id),
      isNull(schema.unknownReadoutResolutions.requestId)))
    .orderBy(desc(schema.cardReadouts.readAt), desc(schema.cardReadouts.id)).limit(1);
  return row?.readout;
}

/** Läsningstiden för deltagarens senaste avläsning med resultat, eller null. */
export async function latestResultReadAt(tx: DbExecutor, entryId: string): Promise<Date | null> {
  const [row] = await tx.select({ readAt: schema.cardReadouts.readAt }).from(schema.resultRevisions)
    .innerJoin(schema.cardReadouts, eq(schema.cardReadouts.id, schema.resultRevisions.readoutId))
    .where(eq(schema.resultRevisions.entryId, entryId)).orderBy(desc(schema.cardReadouts.readAt)).limit(1);
  return row?.readAt ?? null;
}

/** Avläsningar som redan har ett resultat räknas inte som okända (direktanmälan kopplar utan resolutionsjournal). */
export async function readoutsWithResults(tx: DbExecutor, readoutIds: readonly string[]): Promise<Set<string>> {
  if (readoutIds.length === 0) return new Set();
  const rows = await tx.selectDistinct({ readoutId: schema.resultRevisions.readoutId }).from(schema.resultRevisions)
    .where(inArray(schema.resultRevisions.readoutId, [...readoutIds])).orderBy(asc(schema.resultRevisions.readoutId));
  return new Set(rows.flatMap((row) => row.readoutId ? [row.readoutId] : []));
}
