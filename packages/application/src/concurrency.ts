import { eq } from "drizzle-orm";
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
