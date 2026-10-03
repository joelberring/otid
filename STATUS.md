# Status

Kort logg. Högst tio rader per steg. Nyaste överst. Historik före omstarten
finns i `docs/archive/status-2026-10-03.md`.

## Aktuellt steg

Steg 8 – Enkel arbetsyta för det som finns. Steg 7 (hårdvara) görs parallellt av ägaren. Steg 0–6 är klara.

## Logg

### 2026-10-03 – Steg 8.1: resultat är aktuella per löpare
- Migration 0089: `result_revision.basis_hash`, sätts av databasen vid insert (klass, startsätt, banversion med
  kontroller, strukna kontroller, fast starttid). Äldre revisioner utan hash jämförs som tidigare.
- Alla ställen som avgjorde "äldre underlag" via tävlingsversionen använder nu `isResultCurrent`. Godkännande av en
  felstämplad löpare kräver inte längre omräkning efter en direktanmälan (träningskvällstestet har en omräkning mindre).
- Verifierat: lint, typecheck, test, test:integration (81 filer, nytt `adr-0169-result-basis`), build, e2e.

### 2026-10-03 – Förberedelse för steg 7
- Avläsningssidan loggar all stationstrafik i minnet. "Ladda ner rålogg" ger trafiken och loppets råramar som JSON
  (inga namn). Täcks av enhetstest och träningskvällstestet.

### 2026-10-03 – Steg 2 klart
- `race-administrator-workspace.tsx` 4 301 → 189 rader: session, laddning och navigering. Områdena (förberedelse,
  deltagare, resultatbeslut, tävlingsdag, efter tävlingen) ligger i `components/race-administrator/` (22 filer, största 543).
- En gemensam anrops-/operationshjälp (`operations.ts`); de fem likadana resultatbesluten laddas med samma funktion.
- `race-administrator-route-handlers.ts` 1 382 → 84 rader (dispatcher) + fyra gruppfiler; testerna delade likadant.
- Borttaget: inloggning med åtkomstkod via `POST /session` (ger nu 405) och 1 200 rader oanvänd CSS.
- Ingen fil i `apps/web/src` över 800 rader (största: `globals.css` 629). Markup, etiketter och roller oförändrade.
- Verifierat: lint, typecheck, test, build, e2e (utvecklingsläge och driftbygge bakom HTTPS).

### 2026-10-03 – Steg 6 klart
- `Dockerfile` (Next standalone + paketerad migrering som körs före start), `docker-compose.prod.yml` med PostgreSQL,
  webb, Caddy (automatisk HTTPS) och backup (`pg_dump` vid start och varje natt, 14 dagars rotation). `docs/drift.md`.
- Verifierat lokalt utan Docker (registren nås inte här): produktionsbygget bakom Caddy med HTTPS – båda webbläsarflödena
  gröna, även offline-avläsningen. Backup, rotation och `pg_restore` provade; samma antal rader efter återställning.
- Verifierat i CI-jobbet `production`: `docker compose up --build`, webbläsartesterna mot https://localhost och att en
  backupfil skapas. CI är grönt för första gången: avbildningen `postgis/postgis:17-3.6` fanns inte (nu 17-3.5).
- Rättat: IOF-exporten avvisade svar som Caddy komprimerat (ETag/content-length). Innehållshashen kontrolleras fortfarande.

### 2026-10-03 – Steg 5 klart
- `tests/e2e/traningskvall.spec.ts`: 10 löpare genom hela kedjan – två banor/klasser (fri start är standard), åtta
  förhandsanmälda, avläsning med övningsstationen (delvis offline, omladdning offline), två okända brickor
  direktanmäls, kvar i skogen = 2, felstämplad räknas om och godkänns manuellt, publikt resultat, IOF XML-export.
- "Kvar i skogen" visas som eget tal i Under tävlingen (anmälda som varken lästs av eller är ej startande).
- `pnpm demo` ersätter `demo:provision`, `demo:access:copy`, `db:seed` och utvecklingsinloggningen för demotävlingar.
- `simulatedRun`/`readSimulatedCard` i `packages/sportident` används av övningsstationen, demon och tester.
- Övningsstationens okända bricka springer vald deltagares bana. `readout.spec.ts` ingår nu i träningskvällstestet.
- Verifierat: lint, typecheck, test, test:integration (80 filer), build, e2e (2 flöden).

### 2026-10-03 – Steg 4 klart
- `/admin/<lopp>/readout` leder till appskalet `/readout/` (esbuild + service worker, `build:shells`). Det startar utan nät.
- Web Serial (38 400, sedan 4 800 baud) eller övningsstation (`FakeSiStation` genom samma protokollkod). Stort besked med
  symbol och text, sträcktider, statusrad (station, internet, kö, underlagsversion). Serverns bedömning gäller och avvikelser visas.
- Kö i IndexedDB per lopp med stabilt enhets-/sessions-id och löpnummer. Raderas aldrig; status ändras bara vid kvittens.
  Utgången adminsession förnyas via kontot. Nya routes `readout-package` och `readouts` på adminsessionen.
- Kontrakt: transport `sportident` med råramar (hex). Mål får saknas (migration 0088); bedöms som felstämplad.
- Den gamla simulatorsidan är borttagen. Stationsappens bearer-ingest finns kvar (parkerad).
- Verifierat: lint, typecheck, test, test:integration (81 filer), build, e2e (`readout.spec.ts`: offline-avläsning → omladdning
  offline → synk → publikt resultat → okänd bricka direktanmäls i Hantera). Hårdvara: fortfarande `untested`.

### 2026-10-03 – Steg 1 klart
- Självregistrering på `/organizer`. Kontoinloggningen gäller i 30 dagar (migration 0087).
- `/manage` öppnas med kontot, utan behörighetskod. En kontoinloggad admin (MANAGE_RACE) får alla funktioner i tävlingen.
- IOF-importen använder adminsessionen. Eventor-importen är borttagen från sidan (parkerad).
- Borttaget: 27 dubblettsidor, ~75 API-routes, 33 behörighetsskript, kontoinbjudningskoder, CREATE_EVENT-sidorna,
  skrivstoppet (`ops/systemd`, `proxy.ts`) och 154 gamla webbläsartestfiler (38 konfigurationer, mest röda vid baslinjen).
- Nytt: en Playwright-konfiguration, `tests/e2e/admin-access.spec.ts` (konto → tävling → bana/klass/deltagare →
  medadmin → publik/401), integrationstestet `adr-0168-two-levels` och routetester för registrering. CI kör e2e igen.
- **Avvikelse från planen:** tabeller och applikationskod för de gamla rollerna ligger kvar men nås inte från webben.
  Stationsparning/-credentials, start-/målpersonalens koder och claim-koder finns kvar (parkerade, steg 4 tar stationen).
  Publik speakervy är inte gjord. Demo (`demo:provision`) fungerar inte längre och ersätts i steg 5.

### 2026-10-03 – Steg 3 klart (gjort före steg 1–2, oberoende av dem)
- Nytt paket `packages/sportident`: ramtolkning med CRC, tillståndsmaskin för avläsningsstation,
  avkodning av SI5/6/8/9/10/11/SIAC/pCard, tidstolkning med tidszon samt `FakeSiStation`.
- 55 tester: alla chunkgränser, fel CRC/ETX, trunkering, dubbletter, alla bricktyper, uttagen bricka,
  tidsgräns, station utan handskakning, fel inställd station, AM/PM, midnatt, vintertid.
- CRC verifierad mot publicerade ramar. Minneslayouterna är jämförda mot en oberoende öppen avkodare
  (bara som referens, inte kopierad): allt stämmer utom SI6-kontrollkoder >255, där referensen har fel.
- Hårdvara: alla rader `untested` i `docs/sportident.md` tills steg 7.

### 2026-10-03 – Steg 0 klart
- Git och GitHub (`joelberring/otid`). TASK-filer, gamla status- och plandokument är flyttade till `docs/archive/`.
- **Fel i migreringarna:** drizzles migrator kör allt i en transaktion, och PostgreSQL vägrar då använda nya
  enum-värden. `pnpm db:migrate` kraschade på ny databas och vid uppgradering över flera migrationer.
  `@o-tid/database` har nu en egen `migrate` som committar enum-värden först och sedan kör en transaktion per fil.
- Borttaget (parkerat enligt ADR-0168, testerna krävde macOS): backup/replikering och PM-skannerns Docker-isolering.
- Röda tester som var föråldrade är rättade: formatversioner 10/12/14 → 15, motorversion 0.1.1, ett tidsberoende
  test (TASK160), ett för strikt namnkrav på testdatabas (TASK153), kortbyte med extra fält (TASK030), TASK300/301.
- Gröna: lint, typecheck, `pnpm test`, `pnpm test:integration` (ett test om begränsade roller hoppas över tills steg 1), `pnpm build`.
- **Webbläsartester:** `pnpm test:e2e` går inte att köra som helhet. Det finns 38 separata Playwright-konfigurationer
  och flera specar kräver egna databaser och miljövariabler. Adminflödets svit: 22 av de första 24 testerna föll
  (tidsgränser). Ersatt i steg 1.
- CI kör nu lint, typecheck, test, integration och build. Android-jobbet är borttaget (parkerat).

### 2026-10-03 – Omstart
Granskning visade 301 uppgifter på fem veckor men ingen riktig brickavläsning,
en Android-app som aldrig byggts och för mycket behörighetsmaskineri.
Ägaren beslutade om ny plan (`PLAN.md`) och ADR-0168: ett mål (körbar
klubbträning), avläsning i webbläsaren via Web Serial, eget SPORTident-protokoll
nu, två behörighetsnivåer (admin och alla andra) och parkering av GPS,
deltagarkonton med mera. `AGENTS.md` har bantats från 210 KB. Den gamla finns i
`docs/archive/AGENTS-2026-10-03.md`.

Kvarstår för ägaren: begära *PC Programmer's Guide* från SPORTident
(support@sportident.com), välja server för drift (steg 6), skaffa station och
brickor till steg 7.

## Idéer (inte i planen än)

- …
