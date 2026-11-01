import { and, eq, isNotNull } from "drizzle-orm";
import { schema, type Database } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { activeEventAdministrationGrant } from "./race-session";
import { groupMembership } from "./training-group-access";
import { authenticateUserAccountSessionForProtectedRead } from "./user-account";
import { UUID_PATTERN } from "./serialization";


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
  return (await publicRaceGate(db, raceId, accountSessionToken, now)).access;
}

/**
 * Som `publicRaceAccess`, och om svaret är privat: steg 68 (ADR-0182 beslut 7) – en tävling i en träningsgrupp vars sida
 * bara är för inloggade medlemmar syns publikt bara för gruppens ledare och medlemmar (och tävlingens egna administratörer
 * och funktionärer), och svaren får då aldrig sparas i en delad cache.
 */
export async function publicRaceGate(db: Database, raceId: string, accountSessionToken: string | null,
  now = new Date()): Promise<{ access: PublicRaceAccess; privateCache: boolean }> {
  const none = { access: "NONE" as const, privateCache: true };
  if (!UUID_PATTERN.test(raceId)) return none;
  const [race] = await db.select({ eventId: schema.races.eventId, publishedAt: schema.races.publishedAt,
    hidden: schema.races.hiddenBySuperadmin, groupId: schema.events.trainingGroupId, pageVisibility: schema.trainingGroups.pageVisibility })
    .from(schema.races).innerJoin(schema.events, eq(schema.events.id, schema.races.eventId))
    .leftJoin(schema.trainingGroups, eq(schema.trainingGroups.id, schema.events.trainingGroupId))
    .where(eq(schema.races.id, raceId)).limit(1);
  if (!race || race.hidden) return none;
  const membersOnly = race.groupId !== null && race.pageVisibility === "MEMBERS";
  if (race.publishedAt && !membersOnly) return { access: "PUBLIC", privateCache: false };
  if (!accountSessionToken) return none;
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, { sessionToken: accountSessionToken }, now);
    if (auth.status !== "authenticated") return none;
    const grant = await activeEventAdministrationGrant(tx, { accountId: auth.principal.accountId, eventId: race.eventId,
      roles: ["OWNER", "ADMIN", "FUNCTIONARY"] }, "share");
    if (!race.publishedAt) return grant ? { access: "PREVIEW" as const, privateCache: true } : none;
    const member = grant || (race.groupId && await groupMembership(tx, { accountId: auth.principal.accountId, groupId: race.groupId }));
    return member ? { access: "PUBLIC" as const, privateCache: true } : none;
  });
}

/**
 * Steg 52 (ADR-0176): den inloggade är ägare, administratör eller funktionär på tävlingen. Då visar de publika svaren
 * banorna även när de är hemliga publikt (arbetsytans resultatlista, förhandsvisningen). Svaret får då aldrig sparas i en
 * delad cache.
 */
export async function isRaceStaff(db: Database, raceId: string, accountSessionToken: string | null, now = new Date()): Promise<boolean> {
  if (!accountSessionToken || !UUID_PATTERN.test(raceId)) return false;
  const [race] = await db.select({ eventId: schema.races.eventId }).from(schema.races).where(eq(schema.races.id, raceId)).limit(1);
  if (!race) return false;
  return db.transaction(async tx => {
    const auth = await authenticateUserAccountSessionForProtectedRead(tx, { sessionToken: accountSessionToken }, now);
    if (auth.status !== "authenticated") return false;
    return !!await activeEventAdministrationGrant(tx, { accountId: auth.principal.accountId, eventId: race.eventId,
      roles: ["OWNER", "ADMIN", "FUNCTIONARY"] }, "share");
  });
}
