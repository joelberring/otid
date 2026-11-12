import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@o-tid/database";
import { courseVariantForReadout, withProposedEntryVariants, type NormalizedCardReadout, type RaceSnapshot } from "@o-tid/domain";
import { latestResultReadAt } from "./readout-lookup";
import type { DbExecutor } from "./snapshot";

/**
 * Varianten när en okänd bricka kopplas till en löpare i en gafflad klass: avläsningen bedöms mot varianten som
 * stämplingarna passar, och den sparas på löparen (ADR-0169 beslut 2, användartestet 2026-11-12). Ger ögonblicksbilden
 * med den sparade varianten. Utan gafflad bana eller när varianten redan är den rätta ändras inget.
 */
export async function useFittingVariant(tx: DbExecutor, snapshot: RaceSnapshot, readout: NormalizedCardReadout, entryId: string):
  Promise<RaceSnapshot> {
  const current = snapshot.entries.find((entry) => entry.id === entryId)?.courseVariantCode;
  const detected = courseVariantForReadout(readout, withProposedEntryVariants(snapshot, new Map([[entryId, null]])));
  if (!detected || detected.code === current) return snapshot;
  await tx.update(schema.entries).set({ courseVariantCode: detected.code }).where(eq(schema.entries.id, entryId));
  return withProposedEntryVariants(snapshot, new Map([[entryId, detected.code]]));
}

/**
 * Brickan fick sin löpare genom en direktanmälan i avläsningsvyn, och löparen har ännu inget resultat från en avläsning:
 * avläsningen som nu kommer är den som anmälan gällde. Utan nät skickas anmälan före avläsningen, och då ska varianten
 * väljas och sparas här precis som när avläsningen kom först (`linkUnresolvedReadout`).
 */
export async function registeredAtReadout(tx: DbExecutor, raceId: string, entryId: string, cardNumber: string): Promise<boolean> {
  const [row] = await tx.select({ requestId: schema.readoutRegistrations.requestId }).from(schema.readoutRegistrations)
    .where(and(eq(schema.readoutRegistrations.raceId, raceId), eq(schema.readoutRegistrations.entryId, entryId),
      eq(schema.readoutRegistrations.cardNumber, cardNumber), inArray(schema.readoutRegistrations.outcome, ["CREATED"]))).limit(1);
  return row !== undefined && await latestResultReadAt(tx, entryId) === null;
}
