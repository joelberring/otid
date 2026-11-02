import { eq } from "drizzle-orm";
import { defaultStartRule } from "@o-tid/contracts";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

/** ADR-0188 beslut 4: startsättet för klasser som skapas från en banfil eller Eventor, efter tävlingstypen. */
export async function raceDefaultStartRule(tx: DbExecutor, raceId: string): Promise<"FIXED" | "PUNCH"> {
  const [race] = await tx.select({ raceType: schema.races.raceType }).from(schema.races).where(eq(schema.races.id, raceId));
  return race ? defaultStartRule(race.raceType) : "PUNCH";
}
