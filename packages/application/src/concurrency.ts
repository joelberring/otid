import { and, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

export async function lockRaceForSnapshot(tx: DbExecutor, raceId: string) {
  const [race] = await tx.select({
    id: schema.races.id,
    snapshotVersion: schema.races.snapshotVersion
  }).from(schema.races).where(eq(schema.races.id, raceId)).for("share");
  if (!race) throw new Error("Loppet finns inte");
  return race;
}

export async function lockRaceForMutation(tx: DbExecutor, raceId: string) {
  const [race] = await tx.select({
    id: schema.races.id,
    snapshotVersion: schema.races.snapshotVersion
  }).from(schema.races).where(eq(schema.races.id, raceId)).for("update");
  if (!race) throw new Error("Loppet finns inte");
  return race;
}

export async function lockEntryForRevision(tx: DbExecutor, raceId: string, entryId: string) {
  const [entry] = await tx.select().from(schema.entries).where(and(
    eq(schema.entries.id, entryId),
    eq(schema.entries.raceId, raceId)
  )).for("update");
  if (!entry) throw new Error("Deltagaren finns inte");
  return entry;
}
