import { and, count, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

export class ClassCapacityConflictError extends Error {}

/**
 * Caller holds this race's mutation lock until commit, including every entry write.
 * Falskt för stafettklasser: där anmäls lag, inte enskilda deltagare.
 */
export async function canAddClassEntry(tx: DbExecutor, raceId: string, classId: string): Promise<boolean> {
  const [raceClass] = await tx.select({ maxEntries: schema.classes.maxEntries }).from(schema.classes)
    .where(and(eq(schema.classes.id, classId), eq(schema.classes.raceId, raceId)));
  if (!raceClass) return false;
  // Stafettklass (ADR-0169 beslut 3): sträcklöpare läggs till som lag, aldrig som enskilda deltagare.
  const [relayLeg] = await tx.select({ leg: schema.relayLegs.leg }).from(schema.relayLegs)
    .where(and(eq(schema.relayLegs.classId, classId), eq(schema.relayLegs.raceId, raceId))).limit(1);
  if (relayLeg) return false;
  if (raceClass.maxEntries === null) return true;
  const [occupancy] = await tx.select({ entries: count() }).from(schema.entries)
    .where(and(eq(schema.entries.raceId, raceId), eq(schema.entries.classId, classId)));
  return occupancy !== undefined && occupancy.entries < raceClass.maxEntries;
}

/** Validate the final roster, allowing a full-class swap inside one atomic import. */
export async function assertRaceClassCapacities(tx: DbExecutor, raceId: string): Promise<void> {
  const classes = await tx.select({ id: schema.classes.id, maxEntries: schema.classes.maxEntries })
    .from(schema.classes).where(eq(schema.classes.raceId, raceId));
  const counts = await tx.select({ classId: schema.entries.classId, entries: count() }).from(schema.entries)
    .where(eq(schema.entries.raceId, raceId)).groupBy(schema.entries.classId);
  const occupancy = new Map(counts.map(row => [row.classId, row.entries]));
  if (classes.some(row => row.maxEntries !== null && (occupancy.get(row.id) ?? 0) > row.maxEntries)) {
    throw new ClassCapacityConflictError("Klassens deltagargräns överskrids");
  }
}
