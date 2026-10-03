# TASK295 – välj klassinställningar från klassnamnet

## Avgränsning

Klassnamnen i befintlig klassöversikt ska välja exakt klass för de
befintliga kapacitets-/startuppläggsformulären. Återanvänd openClassSetup;
ingen ny sida, API, databasregel, automatisk sparning eller ADR behövs.

## Acceptans

- Neutral klassnamnsåtgärd med exakt ID och minst44 px tryckyta.
- Vald klassrad markeras och båda befintliga klassväljare förifylls.
- Direktval får inte felaktigt säga att klassen öppnades från Banor eller
  att banversion saknas. Befintliga ban-/varningsflöden bevaras.
- Pågående skrivflöde spärrar val. Ingen POST/PATCH från direktvalet.
- Kompakt datorrad och mobilradbrytning bevaras.
- Återanvänd endast befintligt TASK227/TASK294-browserfall.

## Verifiering

Klart 2026-10-02. Sol-agent implementerade; huvudagent granskade och
verifierade. Klassnamn är neutral exakt-ID-knapp i befintlig tabellcell.
DIRECT-val markerar raden och förifyller befintliga kapacitets- och
startklassväljare, men öppnar inte två stora formulär automatiskt.
DIRECT visar varken saknad-bana-varning eller från-Banor-kontext.
ASSIGNED/MISSING-flöden behåller tidigare beteende.

Manuell ändring av endera klassväljaren till annan klass rensar en DIRECT-
markering, utan att tyst synka de två oberoende formulären. Desktopens
klassnamnscell har ingen extra vertikal padding runt 44 px-knappen.

Exakta resultat:

- `CI=true pnpm --filter @o-tid/web lint`: exit 0.
- `CI=true pnpm --filter @o-tid/web typecheck`: exit 0.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json`: exit 0, även efter testkorrigering.
- Riktad ESLint av `tests/e2e/task-227-class-finder.spec.ts` med samma
  E2E-tsconfig: exit 0, även efter testkorrigering.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK295`:
  första körningen avbröts avsiktligt med exit130 när testet väntade på
  en klassväljare inne i stängt kapacitetsformulär. Testet rättades till
  att först öppna formuläret som en användare. Exakt kvarvarande egen
  Next-testprocess stoppades; ingen produktkod ändrades för detta.
  Slutlig körning1/1 på15,9 s, exit0. Ett befintligt fall, ingen ny svit,
  fixture eller databas.
- `CI=true pnpm --filter @o-tid/web build`: exit0, Next16.3.3,
  22/22 statiska sidor. Kördes separat från browsern. Loopback3167
  saknade lyssnare efteråt (lsof exit1, tomt svar).

Browsern provar direkt klass05 på mobil och klass60 på dator, exakt ID i
båda väljare, markerad/fokuserad rad, inga falska bankontexter, oberoende
manuellt klassbyte, kompakt desktoprad och noll oavsiktliga skrivningar.
Befintliga ban-/varningskontroller kvarstår. Desktopbild granskades.

## Kvarvarande antaganden och nästa snitt

Syntetiska API-svar verifierar UI, inte serverauktorisering, fysisk mobil
eller fältbruk. Rensning vid startregelväljarens manuella klassbyte är
kodgranskad; browsern provar kapacitetsväljarens motsvarande beteende.
Nästa minsta snitt: öppna klassens befintliga deltagarlista från dess
registrerade antal i klassöversikten, utan nya data eller filterregler.
