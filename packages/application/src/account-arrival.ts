import { eq } from "drizzle-orm";
import { schema } from "@o-tid/database";
import type { DbExecutor } from "./snapshot";
import { acceptRacePersonInvitations } from "./race-person-invitations";
import { acceptGroupInvitations } from "./training-group-invitations";
import { acceptClubInvitations } from "./club-invitations";
import { applyEventorMemberships } from "./club-affiliation-access";
import { acceptMapProjectInvitations } from "./map-project-access";

/**
 * Den enda vägen där inbjudningar av alla slag tas (städrundan C4). Varje `accept*` tar bara sitt eget slag; här bestäms när.
 *
 * - Ankomst (inloggning, bekräftelselänken, återställningslänken, Google och Mina tävlingar): tävlingens behörigheter
 *   (ADR-0188 beslut 6), träningsgrupperna (ADR-0189 beslut 9), klubbarna (ADR-0194 beslut 1) och kartprojekten (ADR-0219).
 * - En tävling som öppnas: bara inbjudningarna som gäller den tävlingen, dvs. tävlingens egna och dess träningsgrupps (en ledare
 *   i gruppen är administratör på gruppens tävlingar). En behörighetskontroll tar aldrig en klubbinbjudan eller en inbjudan
 *   till en annan tävling eller grupp.
 *
 * Alla kräver bekräftad adress och ett konto som inte är spärrat (kontrolleras i varje `accept*`). Ger antalet som togs.
 */
export async function acceptAllInvitations(tx: DbExecutor, accountId: string, now: Date): Promise<number> {
  return await acceptRacePersonInvitations(tx, accountId, now) + await acceptGroupInvitations(tx, accountId, now)
    + await acceptClubInvitations(tx, accountId, now) + await acceptMapProjectInvitations(tx, accountId, now);
}

/** Inbjudningarna som gäller tävlingen `raceId` (dess egna och dess träningsgrupps). Ger antalet som togs. */
export async function acceptInvitationsForRace(tx: DbExecutor, accountId: string, now: Date, raceId: string): Promise<number> {
  let accepted = await acceptRacePersonInvitations(tx, accountId, now, raceId);
  const [race] = await tx.select({ groupId: schema.events.trainingGroupId }).from(schema.races)
    .innerJoin(schema.events, eq(schema.events.id, schema.races.eventId)).where(eq(schema.races.id, raceId));
  if (race?.groupId) accepted += await acceptGroupInvitations(tx, accountId, now, race.groupId);
  return accepted;
}

/**
 * Det som händer när ett konto med bekräftad adress loggar in, oavsett väg (ADR-0205): alla öppna inbjudningar tas och adressen
 * jämförs med klubbarnas medlemslistor från Eventor (ADR-0209 beslut B). Ett obekräftat konto får inget här.
 */
export async function acceptOnLogin(tx: DbExecutor, accountId: string, now: Date): Promise<void> {
  await acceptAllInvitations(tx, accountId, now);
  await applyEventorMemberships(tx, accountId, now);
}
