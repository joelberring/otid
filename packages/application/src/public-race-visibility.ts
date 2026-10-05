import { and, eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Vilka tävlingar som syns på de publika sidorna (ADR-0172). En tävling som superadmin har dolt syns inte.
 * Steg 19 lägger till arrangörens publicering: synlig = publicerad OCH inte dold. Alla publika sidor och
 * API:er frågar här, så att villkoret bara finns på ett ställe.
 */
export const publicRaceCondition = () => eq(schema.races.hiddenBySuperadmin, false);

export async function isRacePubliclyVisible(db: DbExecutor, raceId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(raceId)) return false;
  const [race] = await db.select({ id: schema.races.id }).from(schema.races)
    .where(and(eq(schema.races.id, raceId), publicRaceCondition())).limit(1);
  return !!race;
}
