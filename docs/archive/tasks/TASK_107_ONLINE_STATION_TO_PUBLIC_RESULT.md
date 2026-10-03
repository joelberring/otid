# TASK107: online station till publik resultatuppdatering

Påbörjad 2026-09-20 efter TASK106. Detta är ett verifieringssnitt för den
befintliga centralservermodellen, inte en ny resultat- eller synkarkitektur.

## Användarvärde

En tävlande eller anhörig som redan har resultatsidan öppen på mobil ser ett
nytt, servermottaget stationsresultat utan att manuellt ladda om sidan.

## Avgränsning

- Återanvänder befintlig stationssimulator, idempotent device-batch-ingest,
  publicerade resultatrevisioner och femsekunderspolling enligt ADR-0004.
- Ett isolerat browserprov ska öppna den publika resultatsidan utan resultat,
  skicka en syntetisk readout via stationssimulatorn och bekräfta att den
  redan öppna sidan uppdateras vid nästa poll.
- Ett avlyssnat misslyckat poll-svar ska behålla den senast verifierade raden
  och visa befintlig textlig varning.
- Ingen ny API-form, databas, pollingfrekvens, serverteknik, autentisering,
  SSE, USB, Eventor, GPS, karta, rutt eller stafett införs.

## Berörda delar

- `packages/application`: befintlig ingest och publik resultatprojektion.
- `packages/contracts`: befintliga batch- och publikresultatkontrakt.
- `apps/web`: befintlig simulator, publik resultatroute och pollande vy.
- `tests/e2e`: ett separat genomgående Next/PostgreSQL/browserprov.

## Acceptans

1. En publik 390 px-sida som öppnas före readout visar inget fabricerat
   resultat.
2. En giltig stationscredential och syntetisk readout når den riktiga
   device-batch-routen och ger beständig serverkvittens.
3. Den redan öppna publika sidan visar den validerade deltagarraden efter
   högst nästa femsekunderspoll, utan sidomladdning.
4. Ett efterföljande misslyckat poll-svar behåller samma redan verifierade rad
   och visar textlig varning; ingen ny resultatrad fabriceras.
5. Inga interna entry-, card-, readout- eller revisionsidentifierare exponeras
   i den publika API-projektionen.

## Arkitekturfråga

Ingen ADR krävs: TASK107 använder oförändrad polling enligt accepterade
ADR-0004. En framtida övergång till SSE kräver egen ADR med monotona event-id,
återanslutning och cache-/fan-out-regler.

## Genomfört 2026-09-20

Ett separat 390 px-Playwrightfall öppnar först den publika resultatsidan med
tom serverprojektion. En annan sida använder sedan den befintliga
stationssimulatorn och en race-/device-bunden credential för att skicka samma
syntetiska readout genom den riktiga device-batch-routen. Den redan öppna
publika sidan visar Ada Löpares `OK`-rad via sin vanliga femsekunderspoll utan
omladdning. När nästa poll avlyssnas som nätfel behålls raden och den svenska,
textliga varningen visas.

Det är ett genomgående bevis för den online-del av server → station → publik
som redan fanns, inte bevis för fysisk SI-hårdvara, Android, serverdrift eller
SSE. Inga produktionsfiler behövde ändras eftersom befintlig arkitektur höll.

## Riktad verifiering

Kör ett isolerat PostgreSQL/PostGIS-browserprov sekventiellt med andra
databaswriters. Det använder syntetisk IOF-fixture och simulerad readout,
inte fysisk SPORTident eller USB.

```bash
CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.online-public-result.json
CI=true pnpm exec eslint tests/e2e/task-107-online-public-result.spec.ts tests/e2e/playwright.online-public-result.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.online-public-result.json"}'
CI=true pnpm exec playwright test --config tests/e2e/playwright.online-public-result.config.ts
```

Samtliga tre kommandon passerade 2026-09-20. Playwright: exit 0, 1 test
godkänt på 16,2 s mot riktig Next/HTTP på loopback 3126 och isolerad
PostgreSQL17/PostGIS. Den privata temporära databasen innehåller enbart
syntetiska testdata.
