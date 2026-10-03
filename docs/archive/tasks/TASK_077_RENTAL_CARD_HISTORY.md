# TASK077: hyrbricksbeslut i deltagarhistoriken

Påbörjad 2026-09-18 som nästa minsta vertikala snitt efter TASK076.

## Användarvärde

Tävlingsadministratören ska i den befintliga deltagarhistoriken kunna se när
en bricka markerades eller avmarkerades som hyrbricka och när återlämning
markerades eller rättades. Historiken ska visa journalens verkliga tidpunkt,
deltagarversion och frysta före-/eftervärden.

## Arkitektur och avgränsning

- Utöka ADR-0078:s befintliga privata read-only-projektion med de immutable
  journalerna från ADR-0100 och ADR-0101.
- Lägg till historiktyperna `RENTAL`/`RENTAL_RETURN` och motsvarande booleska
  fält, serialiserade kanoniskt som `"true"`/`"false"` i transportkontraktet
  och presenterade på svenska i UI.
- Läs allt i samma `REPEATABLE READ`, race-/entry-scope och `MANAGE_RACE`-
  session som övrig deltagarhistorik.
- Behåll exklusiv cursor på `entryVersionAfter`, strikt fallande ordning,
  20 rader per sida och fail-closed vid dubbla eller trasiga journalversioner.
- Återanvänd befintlig GET-route, klient, komponent och no-store-policy.
- Ingen migration, skrivväg, capability, dependency, betalning, avgift,
  SPORTident-USB, GPS eller stafett ingår.

## Berörda delar

- `packages/contracts/src/administrator-entry-changes.ts`
- `packages/application/src/administrator-entry-changes.ts`
- `apps/web/src/components/administrator-entry-changes.tsx`
- `apps/web/src/i18n/race-administrator-sv.ts`
- riktade kontrakts-, PostgreSQL- och befintliga TASK029-browserprov

## Acceptans

1. Hyrmarkering och avmarkering visas som separata `RENTAL`-poster med sann
   tidpunkt, version och `Inte markerad som hyrbricka`/`Hyrbricka`.
2. Återlämning och rättning visas som separata `RENTAL_RETURN`-poster med
   sann tidpunkt, version och `Inte registrerad som återlämnad`/`Återlämnad`.
3. Assignment, aktör/capability, race/entry, statusbyte och versionssteg
   valideras från journalerna; trasigt underlag fabriceras aldrig.
4. Poster merge-sorteras med övriga deltagarändringar och befintlig exklusiv
   versionscursor fortsätter fungera.
5. Browsern visar svensk text och tidpunkt i befintlig Historik-vy utan ny
   mutation eller separat behörighet.

## Verifieringsplan

Kör ett riktat kontraktsprov, ett avgränsat PostgreSQL-prov och ett enda
`TASK077`-browserfall. Kör berörda lint/typecheck/build efter grön funktionell
verifiering; inga breda testsviter.

## Arkitektur- och licensbedömning

Ingen ny ADR behövs. Snittet är en additiv läsprojektion inom accepterade
ADR-0078, ADR-0100 och ADR-0101; skrivmodell, teknikval och domängränser är
oförändrade. Ingen extern eller AGPL-licensierad kod används.

## Slutförd 2026-09-19

Den befintliga privata deltagarhistoriken läser nu hyrmarkeringar och
återlämningsbeslut i samma `REPEATABLE READ`-projektion som övriga ändringar.
Journalernas assignment, aktör/capability, scope, booleska statusbyte och
versionssteg valideras före presentation. Poster merge-sorteras fallande med
övriga journaler och den exklusiva deltagarversionscursorn är oförändrad.

Adminvyn visar `Hyrstatus` och `Återlämning` med svenska, frysta före-/eftervärden.
Ingen route, skrivväg, capability, migration, dependency eller ADR tillkom.

Slutliga riktade kontroller med `CI=true`:

- kontraktsprov: exit 0, 1 fil och 4 tester passerade, Vitest 492 ms;
- PostgreSQL-integration: exit 0, 1 fil och 2 tester passerade, Vitest 845 ms
  (testtid 91 ms) mot isolerad PostgreSQL 17/PostGIS `otid_077_test`;
- browser `--grep TASK077`: exit 0, 1 test passerade på 16,2 s;
- lint: contracts, application, web och riktad E2E, samtliga exit 0;
- typecheck: contracts, application, web och E2E, samtliga exit 0;
- build: contracts, application och web, samtliga exit 0. Next kompilerade på
  2,9 s, TypeScript på 4,9 s, genererade 7/7 statiska sidor på 54 ms och
  checkin-skalet fick hash `e22b5520cfa8` med 3 publika assets.
- den isolerade PostgreSQL-instansen stoppades kontrollerat, exit 0; testdata
  bevarades i den privata temporära testklustern.

Browser- och databastesterna använde endast syntetiska data. Fysisk mobil,
skärmläsare, produktion och verklig hyrbricksinventering är inte verifierade.
