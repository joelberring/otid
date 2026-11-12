import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { schema } from "@o-tid/database";
import {
  courseVariantForReadout, linkVariantChange, withProposedEntryVariants, type LinkVariantChange, type NormalizedCardReadout, type RaceSnapshot
} from "@o-tid/domain";
import { latestResultReadAt } from "./readout-lookup";
import type { DbExecutor } from "./snapshot";

/**
 * Varianten när en okänd bricka kopplas till en löpare i en gafflad klass: avläsningen bedöms mot varianten som
 * stämplingarna passar, och den sparas på löparen (ADR-0169 beslut 2, användartestet 2026-11-12). Ger ögonblicksbilden
 * med den sparade varianten och, när löparen hade en annan tilldelad variant, bytet (`change`) så att det kan visas.
 * Utan gafflad bana eller när varianten redan är den rätta ändras inget.
 */
export async function useFittingVariant(tx: DbExecutor, snapshot: RaceSnapshot, readout: NormalizedCardReadout, entryId: string):
  Promise<{ snapshot: RaceSnapshot; change?: LinkVariantChange }> {
  const current = snapshot.entries.find((entry) => entry.id === entryId)?.courseVariantCode;
  const detected = courseVariantForReadout(readout, withProposedEntryVariants(snapshot, new Map([[entryId, null]])));
  if (!detected || detected.code === current) return { snapshot };
  const change = linkVariantChange(readout, snapshot, entryId);
  await tx.update(schema.entries).set({ courseVariantCode: detected.code }).where(eq(schema.entries.id, entryId));
  return { snapshot: withProposedEntryVariants(snapshot, new Map([[entryId, detected.code]])), ...(change ? { change } : {}) };
}

/**
 * Brickan fick sin löpare genom avläsningsvyn (direktanmälan, CREATED, eller koppling till en anmäld, LINKED), och löparen
 * har ännu inget resultat från en avläsning: avläsningen som nu kommer är den som anmälan gällde. Utan nät skickas anmälan
 * före avläsningen, och då ska varianten väljas och sparas här precis som när avläsningen kom först (`linkUnresolvedReadout`).
 */
export async function registeredAtReadout(tx: DbExecutor, raceId: string, entryId: string, cardNumber: string):
  Promise<"CREATED" | "LINKED" | undefined> {
  const [row] = await tx.select({ outcome: schema.readoutRegistrations.outcome }).from(schema.readoutRegistrations)
    .where(and(eq(schema.readoutRegistrations.raceId, raceId), eq(schema.readoutRegistrations.entryId, entryId),
      eq(schema.readoutRegistrations.cardNumber, cardNumber), inArray(schema.readoutRegistrations.outcome, ["CREATED", "LINKED"])))
    .orderBy(desc(schema.readoutRegistrations.createdAt)).limit(1);
  if (!row || await latestResultReadAt(tx, entryId) !== null) return undefined;
  return row.outcome === "CREATED" ? "CREATED" : "LINKED";
}

/** Löparens senaste bricka före `cardNumber` (en släppt koppling), för historiken "bricka före → efter". */
export async function previousCardOf(tx: DbExecutor, raceId: string, entryId: string, cardNumber: string): Promise<string | null> {
  const [row] = await tx.select({ cardNumber: schema.cardAssignments.cardNumber }).from(schema.cardAssignments)
    .where(and(eq(schema.cardAssignments.raceId, raceId), eq(schema.cardAssignments.entryId, entryId),
      ne(schema.cardAssignments.cardNumber, cardNumber), eq(schema.cardAssignments.active, false)))
    .orderBy(desc(schema.cardAssignments.createdAt), desc(schema.cardAssignments.id)).limit(1);
  return row?.cardNumber ?? null;
}
