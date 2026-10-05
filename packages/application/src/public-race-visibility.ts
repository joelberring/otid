import { and, eq, isNotNull } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { activeEventAdministrationGrant } from "./organizer-events";
import { authenticateUserAccountSessionForProtectedRead } from "./user-account";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Vilka tävlingar som syns på de publika sidorna (ADR-0172 beslut 4): admin har publicerat tävlingen OCH
 * superadmin har inte dolt den. Alla publika sidor, API:er, resultatströmmen och exporterna frågar här
 * (via `publicRaceAccess`), så att villkoret bara finns på ett ställe.
 */
export const publicRaceCondition = () => and(isNotNull(schema.races.publishedAt), eq(schema.races.hiddenBySuperadmin, false));

export async function isRacePubliclyVisible(db: DbExecutor, raceId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(raceId)) return false;
  const [race] = await db.select({ id: schema.races.id }).from(schema.races)
    .where(and(eq(schema.races.id, raceId), publicRaceCondition())).limit(1);
  return !!race;
}

/**
 * PUBLIC: alla ser tävlingen. PREVIEW: tävlingen är inte publicerad, men den inloggade är ägare, administratör
 * eller funktionär på tävlingen och ser de publika sidorna som förhandsvisning. NONE: syns inte (opublicerad,
 * dold av superadmin eller okänd). En tävling som superadmin har dolt förhandsvisas inte.
 */
export type PublicRaceAccess = "PUBLIC" | "PREVIEW" | "NONE";

export async function publicRaceAccess(db: Database, raceId: string, accountSessionToken: string | null,
  now = new Date()): Promise<PublicRaceAccess> {
  if (!UUID_PATTERN.test(raceId)) return "NONE";
  const [race] = await db.select({ eventId: schema.races.eventId, publishedAt: schema.races.publishedAt,
    hidden: schema.races.hiddenBySuperadmin }).from(schema.races).where(eq(schema.races.id, raceId)).limit(1);
  if (!race || race.hidden) return "NONE";
  if (race.publishedAt) return "PUBLIC";
  if (!accountSessionToken) return "NONE";
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, { sessionToken: accountSessionToken }, now);
    if (auth.status !== "authenticated") return "NONE";
    const grant = await activeEventAdministrationGrant(tx, { accountId: auth.principal.accountId, eventId: race.eventId,
      roles: ["OWNER", "ADMIN", "FUNCTIONARY"] }, "share");
    return grant ? "PREVIEW" : "NONE";
  });
}
