import type { DbExecutor } from "./snapshot";
import { acceptRacePersonInvitations } from "./race-person-invitations";
import { applyEventorMemberships } from "./club-affiliation-access";

/**
 * Det som händer när ett konto med bekräftad adress loggar in, oavsett väg (lösenord, bekräftelselänken, återställningslänken
 * eller Google; ADR-0205): öppna inbjudningar tas (ADR-0188 beslut 6, träningsgrupper och klubbar ingår) och adressen jämförs
 * med klubbarnas medlemslistor från Eventor (ADR-0209 beslut B). Båda kräver bekräftad adress och ett konto som inte är spärrat,
 * så ett obekräftat konto får inget här.
 */
export async function acceptOnLogin(tx: DbExecutor, accountId: string, now: Date): Promise<void> {
  await acceptRacePersonInvitations(tx, accountId, now);
  await applyEventorMemberships(tx, accountId, now);
}
