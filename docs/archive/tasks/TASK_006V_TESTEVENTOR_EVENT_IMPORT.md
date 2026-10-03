# TASK 006V – Testeventor till ny intern tävling/lopp

Status: Implementerad med syntetisk upstreamacceptans; liveacceptans återstår.
ADR-0046 och officiell schema-/API-audit föregick implementation. Nyckel/CLI,
adapter, migration 0031, atomär import och svensk granska/bekräfta/retry är
integrerade. Uppgiften markeras inte klar utan autentiserat Testeventorprov.

Flöde: konfigurera privat krypterad Testeventoranslutning → hämta vald tävling →
välj lopp/tidszon och granska → bekräfta atomärt skapande med extern provenans.
Inga deltagare, uppdateringar, Eventor-writes eller automatiska publiceringar.

## Acceptans

1. Verifierad självständig adapter för officiellt Event/EventRace-subset,
   explicit lopp/tidszon, inga fabricerade starter/IDs eller kontaktuppgifter.
2. Servernyckel krypterad med kontextbunden GCM; inga hemligheter i browser,
   URL, logg eller repository. Endast auktoriserad connection-owner får läsa.
3. Pinned Testeventor-origin, inga redirects, bounded body/timeout, strikt XML
   utan externa entiteter. Fel avvisas utan intern partiell tävling.
4. Atomiskt event/race/referens/journal/audit; same-id-retry utan nätbehov,
   ändrat intent/source och dubblett extern identitet konflikterar.
5. Privat svensk mobil granskning, bekräftelse, tydliga nätfel/retry; ingen
   implicit racebehörighet eller start-/resultatpublicering.
6. Lint/typecheck/test/build, relevanta PostgreSQL-/E2E-tester samt faktiskt
   autentiserat Testeventor-läsprov. Utan nyckel får livekontrollen inte påstås.

Berör application, contracts, database, separat Eventoradapter och web/CLI.
Varken resultatmotor, station, stafett, GPS eller USB ändras.

## Lokal provisionering och liveprov

1. Kör migrationerna mot avsedd lokal server. Konfigurera
   OTID_EVENTOR_MASTER_KEY_ID och OTID_EVENTOR_MASTER_KEY_BASE64 separat i
   serverns/CLI:ns secret-hantering. Masterkey är 32 kryptografiskt slumpade
   bytes, canonical base64; aldrig en incheckad eller återanvänd testnyckel.
2. Utfärda en befintlig CREATE_EVENT-credential via
   `pnpm event:create:access:issue --label <etikett> --expires-at <ISO-högst-8h>`.
   Hantera accesscredential privat; använd endast dess icke-hemliga credentialId
   som anslutningens ägare. Samma credential loggar in i webbgränssnittet.
3. Lägg den riktiga Testeventornyckeln i en privat fil med begränsad åtkomst,
   inte repository eller chat. Kör med rätt DATABASE_URL och masterkey i CLI:
   `pnpm eventor:connection:create --owner-credential-id <uuid> --label <etikett> --operator-label <lokal-operatör> < /privat/sökväg/testeventor.key`.
   Endast connectionId skrivs till stdout. CLI-fel är generiska.
4. Öppna /admin/events/eventor, logga in, välj anslutning och godkänd
   testtävling. Granska riktiga namn/datum, välj lopp och tidszon uttryckligt
   och bekräfta. Notera serverkvittens och jämför minimal intern metadata.
   Nyckeln får aldrig fyllas i webbsidan. Importen gör inga externa writes.
5. Spärra vid behov med `pnpm eventor:connection:revoke --connection-id <uuid> --operator-label <lokal-operatör>`.
   Journal/extern provenans behålls; spärrad anslutning kan inte användas för retry.

E2E-testet använder verklig session/list-route och PostgreSQL men dispatchar
POST via samma route-handler i testprocessen för att injicera syntetisk upstream.
Det är inte en full live-HTTP-kedja. Ingen osäker produktions-testflagga tillkom.
