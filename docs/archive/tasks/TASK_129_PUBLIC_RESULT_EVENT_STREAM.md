# TASK 129: återanslutningsbar direktuppdatering av publika resultat

## Status

Genomförd 2026-09-22.

## Mål

När arrangören committar en publicerad resultatrevision ska redan öppna
publika resultatsidor normalt hämta sin befintliga säkra snapshot direkt.
Flödet ska fungera på både mobil och dator, återhämta sig efter tappad
anslutning och behålla femsekunderspolling som reserv.

## Avgränsning

Ingår:

- race-scopad, versionsmärkt SSE-wake-up med monoton händelsesekvens,
  `Last-Event-ID`, replay, reset och keep-alive;
- additiv PostgreSQL-markörjournal och teknisk commit-notifiering för redan
  publicerade resultatrevisioner;
- robust Node/PostgreSQL-lyssnare som fungerar för flera webbprocesser;
- mobil-/desktopklient som använder samma validerade resultat-GET som idag
  och fortsätter polla var femte sekund vid fel;
- riktade PostgreSQL-, server-/klient- och verklig browserkontroller med
  syntetiska data.

Ingår inte:

- ny resultatlogik, ranking, publiceringsbeslut, administratörsbehörighet,
  deltagarkonto eller pushnotiser;
- live-GPS, karta, OMAP, ruttuppspelning, stafett, Eventor, SPORTident eller
  USB;
- en publik produktionsdriftsättning, Redis, WebSocket eller ny tjänst.

## Arkitektur och beslut

ADR-0135 är beslutet för snittet. Resultat är fortsatt kanoniskt och
append-only i PostgreSQL. SSE är aldrig sanningskälla: den innehåller bara en
ofarlig uppdateringsmarkör och klienten läser alltid resultat från den
befintliga kontraktsvaliderade läsvägen.

Den databastrigger som lägger en teknisk markör gör ingen domänutvärdering och
ändrar inga resultat. Den ligger i samma transaktion som den redan godkända
publicerade revisionen, så rollback lämnar varken resultat eller wake-up.

## Acceptans

1. En commit av `published = true` ger exakt en sekvensmarkerad markör för
   loppet; `published = false` ger ingen.
2. Två publiceringar för samma lopp får stigande id, medan andra lopp aldrig
   skickas i den öppna strömmen.
3. En EventSource utan id får `reset` för att täcka glappet efter SSR; ett
   giltigt id replayar senare markörer i ordning; för gammalt/ogiltigt id ger
   också `reset` och en snapshotläsning.
4. Strömmen lämnar aldrig namn, resultatstatus, tider, intern revision,
   entry-id, rådata eller andra resultatrader. Den har `no-store`, korrekt
   event-stream-content-type och keep-alive.
5. Lyssnarrestart eller en missad notifiering kan inte göra att klienten tror
   att dess resultatdata är aktuell: den återansluter/replayar eller pollar
   snapshoten.
6. Vid EventSource-fel fortsätter sidan att uppdatera exakt som ADR-0004.
   Dubblett-signaler ger ingen okontrollerad överlappande fetch.
7. Browserfallet visar att en redan öppen 390px publik sida uppdateras inom
   fyra sekunder efter en syntetisk stationpublicering via riktig lokal
   PostgreSQL/SSE. Ingen fysisk mobil eller extern nätanslutning krävs.

## Verifiering

Kör riktat och sekventiellt med en uttryckligen isolerad, migrerad
PostgreSQL/PostGIS-databas för integrationstester. Kör aldrig mot demo- eller
privat tävlingsdata. Browserprovet använder syntetisk tävlingsdata, riktig
loopback-PostgreSQL/SSE och egen loopbackport.

```bash
CI=true pnpm --filter @o-tid/database lint
CI=true pnpm --filter @o-tid/database typecheck
CI=true pnpm --filter @o-tid/application lint
CI=true pnpm --filter @o-tid/application typecheck
CI=true pnpm --filter @o-tid/application exec vitest run test/integration/task-129-public-result-event-stream.test.ts
CI=true pnpm --filter @o-tid/web lint
CI=true pnpm --filter @o-tid/web typecheck
CI=true pnpm --filter @o-tid/web exec vitest run src/lib/public-result-event-stream-wire.test.ts src/lib/public-result-event-stream-client.test.ts src/components/public-results-ui.test.tsx
CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.public-result-event-stream.json
CI=true pnpm exec eslint tests/e2e/task-129-public-result-event-stream.spec.ts tests/e2e/playwright.public-result-event-stream.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.public-result-event-stream.json"}'
CI=true pnpm exec playwright test --config tests/e2e/playwright.public-result-event-stream.config.ts
CI=true pnpm --filter @o-tid/web build
```

## Resultat

- Migration `0073_task_129_public_result_event_stream.sql` är additiv och
  skapar en teknisk markörjournal, per-race commitserialisering och en
  `NOTIFY` endast för redan publicerade revisioner.
- `/api/public/races/{raceId}/result-events` sänder bara
  `{"formatVersion":1}` som `refresh`/`reset`, med SSE-id endast på refresh.
  Resultat hämtas fortsatt från den befintliga publika GET-rutten.
- Klienten återansluter via browserns `Last-Event-ID` och behåller
  femsekunderspolling samt spärr mot överlappande läsningar.
- Alla listade lint/typecheck-kommandon passerade. Webbenhetstester: 3 filer,
  12 tester passerade. PostgreSQL-integrationen: 1 fil, 1 test passerade.
  E2E TypeScript och ESLint passerade; Playwright: 1/1 passerade på 5,1 s.
  Produktionsbygget passerade; Next kompilerade på 1,784 s och TypeScript på
  1,157 s.

## Kvarvarande antaganden

- PostgreSQL är den kanoniska delade databasen i webbdrift; webprocesserna kan
  ha en långlivad, autentiserad `LISTEN`-anslutning.
- Reverse proxy och driftplattform tillåter SSE och vidarebefordrar inte
  mellanlagrade privata svar. Produktionsacceptansen ingår inte här.
- En uppdatering högst fem sekunder efter EventSource-/proxyfel är fortsatt
  acceptabel tills ett separat drift- och lastsnitt har mätt verkliga mål.
