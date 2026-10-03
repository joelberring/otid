# TASK085: lös vald okänd avläsning i ett atomiskt målflöde

Påbörjad 2026-09-19 som B2:s minsta operativa snitt.

## Användarvärde

Målpersonalen kan välja en specifik lagrad avläsning med okänd bricka, koppla
den till rätt befintlig eller ny deltagare och få just den avläsningen bedömd.
Ett tappat svar kan återförsökas säkert utan dubbla brickkopplingar eller
resultat.

## Arkitektur och avgränsning

- Följ ADR-0107. Den första `UNKNOWN_CARD`-observationen och rådata förblir
  oförändrade; resolutionen journalför relationen och append:ar en ny revision.
- Requesten binder explicit `readoutId`, bricknummer, race/snapshot och
  existerande Entry eller strikt direktregistreringsunderlag.
- Transaktionen väljer aldrig "senaste avläsning"; den evaluerar exakt den
  valda normaliserade avläsningen med den aktuella sammanhängande snapshoten.
- Endast `MANAGE_RACE` får skriva. Begränsade kort-/resultat-/historik-
  credentials utökas inte.
- Ny entry följer befintlig klass- och kapacitetsregel. Entry- och
  brickkopplingsändring, resultatrevision, journal och audit committas atomiskt.
- Ingen rådataändring, DNS-fabrikation, massomräkning, finalisering, IOF-export,
  GPS, karta, stafett eller riktig USB ingår.

## Berörda delar

- ADR-0107, domän-/offline-regler och additiv immutable journalmigration,
- contracts för kandidat, request, receipt och idempotensnyckel,
- application för exakt readout-upplösning och separat resolutionsorsak,
- skyddad adminroute och kompakt svensk målvy med granska → bekräfta → exakt
  retry,
- riktade kontrakts-, PostgreSQL-, route- och browserprov.

## Acceptans

1. En `UNKNOWN_CARD`-avläsning kan lösas mot en befintlig Entry; exakt samma
   `readoutId` ligger till grund för en och endast en ny resultatrevision.
2. Direktregistrering skapar Entry, brickkoppling och bedömning atomiskt med
   samma kapacitetsregel som ordinarie registrering.
3. Råmeddelande, `card_readout` och första `device_ingest_outcome` ändras inte;
   den ursprungliga observationen är fortsatt `UNKNOWN_CARD`.
4. Exakt retry returnerar samma receipt. Ändrat actor/scope/readout/entry/
   bricka/registreringsuppgifter eller föråldrad grund ger konflikt utan
   delskrivning.
5. En senare avläsning med samma bricknummer används aldrig i stället för den
   valda avläsningen. Olöst okänd bricka blockerar fortsatt finalisering.
6. Browsern visar svensk konsekvens, vald avläsning och säkert retryläge vid
   tappat commitsvar på 390 px utan horisontell scroll.

## Verifieringsläge 2026-09-19

- contracts lint/typecheck: exit 0; riktat kontraktstest 2/2 på 3 ms;
- database lint/typecheck och application lint/typecheck: exit 0;
- web lint/typecheck: exit 0; route-handler-svit 29/29 på 65 ms;
- E2E TypeScript och riktad E2E ESLint: exit 0;
- web production build: exit 0; Next kompilerade på 4,1 s, TypeScript på 5,8 s
  och 7/7 statiska sidor på 55 ms; checkin-skalets hash `ee37b5f34097`.

Den riktade PostgreSQL/PostGIS-integrationen kördes mot en separat syntetisk
databas i lokal PostgreSQL17/PostGIS och passerade 2/2 på 92 ms. Browserfallet
fann ett strikt kandidatprojektionfel (`entryId` läckte från intern brickrad),
vilket rättades. Ett för snävt scoped Playwright-sökuttryck för comboboxen
ersattes därefter med de unika tillgängliga namnen, och den riktade 390 px-
browserkedjan passerade 1/1 på 9,2 s mot riktig Next/HTTP och samma isolerade
PostgreSQL17/PostGIS. Slutlig web lint och build passerade; build kompilerade
på 1,6 s, TypeScript på 3,2 s och genererade 7/7 statiska sidor på 52 ms.
Den isolerade cluster stoppas kontrollerat och testdata bevaras under
`/private/tmp/otid-task084-pg.Q50oJG`.

## Riktad verifieringsplan före slutförande

- kontraktstest för strikt diskriminerad befintlig/ny Entry-intent och exact
  receipt,
- isolerat PostgreSQL-prov för befintlig Entry, direktregistrering, replay,
  konkurrens/stale, exakt readoutval, rå-/ingestimmutability och finalisering,
- route-test för MANAGE_RACE, scope, CSRF och idempotens,
- ett 390 px browserfall mot riktig Next/HTTP/isolera PostgreSQL med tappat svar.

Ingen bred regression eller fysisk hårdvaruacceptans ingår.
