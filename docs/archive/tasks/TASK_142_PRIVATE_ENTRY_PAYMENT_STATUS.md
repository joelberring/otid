# TASK142: enkel privat betalmarkering per deltagaranmälan

Status: implementerad och riktat verifierad 2026-09-22.

## Användarvärde

Tävlingsadministrationen kan se och rätta om en deltagaranmälan är omarkerad,
markerad obetald, betald eller avgiftsbefriad. Det hjälper vid direktanmälan
och expedition utan att O-Tid hanterar någon betaltransaktion.

## Avgränsning

- ADR-0141:s fyra privata statusar på `entry` med egen monotont versionerad
  optimistic-concurrency-grund.
- Additiv migration och immutable statusjournal/audit.
- En skyddad `MANAGE_RACE`-skrivroute med explicit granskning och exakt retry.
- Aktuell status på den befintliga tävlingsadministrationens deltagarrad och
  svensk bekräftelse/rättningskontroll.
- Ingen offentlig läsning, entry-historikpanel, beloppsfält, referens,
  faktura, betalprovider, Eventor-skrivning, stations- eller offlinekö.

## Acceptans

1. Nya och gamla entries är `UNMARKED` tills en administratör uttryckligen
   markerar `UNPAID`, `PAID` eller `WAIVED`.
2. En ändring binder race, entry, klass, `entryVersion`,
   `paymentStatusVersion`, föregående status och nytt statusval. Exakt retry
   är säkert; no-op eller ändrat/stale underlag skriver inget.
3. Aktuell status, ny payment-version, immutable journal och audit committas
   atomiskt. Entryversion, race-snapshot, startlista, resultat, readout och
   finalisering ändras inte.
4. Statusen visas endast efter administratörsinloggning och får inte läcka i
   publik resultat-/startlistesvar eller IOF-projektioner.
5. UI:t visar status med text, kräver granskning före skrivning, återanvänder
   samma id efter osäkert svar och uppdaterar först efter serverkvittens.

## Berörda lager

- `packages/database`: additiv migration/schema och immutable journal.
- `packages/contracts`: strikt privat request/receipt och rosterfält.
- `packages/application`: race-/entrylåst, idempotent writer och privat läsning.
- `apps/web`: befintlig administratörsroute och svensk deltagarkontroll.

## Proportionell verifiering

- Kontraktsprov för statusunion, canonical idempotency och no-op/stale-form.
- Ett namngivet PostgreSQL-prov för atomisk ändring, retry, konflikt,
  rättning, auth/revocation och frånvaro av race-/entryversionseffekt.
- Riktade web route-/komponentprov samt ett befintligt 390-px adminbrowserfall
  för granska, tappat svar/retry och privat status.
- Berörd lint, typecheck och build. Ingen bred svit, fysisk betalning eller
  extern tjänst.

## Genomförande och aktuell verifieringsgräns

ADR-0141 skrevs före kod. Migration0075, schema, privata rosterfält,
`MANAGE_RACE`-writer, immutable journal/audit, skyddad PATCH-route och den
svenska granska/bekräfta/rätta-vyn är implementerade. En markerad status syns
kompakt i den privata rosterlistan; `UNMARKED` visas endast i den valda
deltagarens betalstatusvy för att inte fylla listan med tomma markeringar.

Kontraktsprovet (2/2), databasens migrations-/schemaprov (3/3), den befintliga
administrativa route-sviten (38/38) och det namngivna PostgreSQL-provet (2/2)
passerar. Ett eget 390 px-browserfall bekräftar granskning, tappat svar, exakt
retry, en journalrad och oförändrad entry-/raceversion. Berörd database-,
contracts-, application- och webblint/typecheck/build passerar också.

Hela migrationskedjan, inklusive migration0075, kördes med det vanliga
migrationskommandot mot en ny, tom PostgreSQL17/PostGIS3.6-testdatabas i en
kortlivad privat temporärkatalog. Ingen SQLite-ersättning, privat databas,
Eventoranslutning eller riktig betalningsuppgift har använts.

Exakta slutkontroller:

- `CI=true pnpm --filter @o-tid/contracts exec vitest run test/entry-payment-status-admin.test.ts` — exit 0, 1 fil/2 tester.
- `CI=true pnpm --filter @o-tid/database exec vitest run test/entry-payment-status-schema.test.ts` — exit 0, 1 fil/3 tester.
- `CI=true DATABASE_URL=<isolerad> pnpm db:migrate` — exit 0, `Databasmigrationer klara`.
- `CI=true TEST_DATABASE_URL=<isolerad> pnpm --filter @o-tid/application exec vitest run test/integration/task-142-entry-payment-status.test.ts` — exit 0, 1 fil/2 tester.
- `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts` — exit 0, 1 fil/38 tester.
- `CI=true DATABASE_URL=<isolerad> TEST_DATABASE_URL=<samma isolerade> pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK142 --reporter=list` — exit 0, 1 passerat browserfall på 390 px.
- Berörd contracts-, database-, application- och webblint/typecheck/build samt e2e-typkontroll och e2e-eslint — samtliga exit 0.

## Utanför uppgiften

Belopp, valuta, Swish/OCR, betalningstjänst, faktura, avgiftstyper,
klubbfakturering, återbetalning, Eventor-skrivning, GPS, karta, stafett,
SPORTident och USB är uttryckligen utanför.
