# TASK300 – skapa klass utan att kopiera befintlig bana

## Mål och beslut före kod

En administratör kan låta exempelvis D40 och H55 dela samma exakta bana,
med varsin explicit startregel, genom Före → Klasser och samma inloggning.
ADR-0166 är skriven före implementation. Kontrakt, migration0085,
application-transaktion, adminroute och kompakt klassform är implementerade.
Detta är inte en driftsättning eller migrering av den manuella demotävlingen.

## Vertikalt snitt

1. Strikta request/response/idempotency-kontrakt.
2. Additiv immutable requestjournal/migration och återställningsnot.
3. Race-/aktörsbunden application-transaktion med exakt målval/snapshot.
4. Dedikerad befintlig adminsession-route med Origin/CSRF/no-store/validering.
5. Kompakt klassform, granskning, fryst retry och återläst underlag efter kvittens.

En backendägare för contracts/database/application, en webbägare för route/UI.
Huvudagenten granskar integration/migration och kör kontroller sekventiellt
mot vald isolerad databas. Föredra återanvänd Sol-kontext före nya agentstarter.

## Acceptans

- Två klasser refererar samma courseVersionId; antal banor/versioner/kontroller
  och deras ordning är oförändrade. Den nya klassen har ingen extern identitet.
- Fri/minutstart väljs explicit; inga tider/resultat/deltagare fabriceras.
- Exakt retry ger samma klass/kvittens och bara ett snapshotsteg. Ändrat
  intent/aktör, stale snapshot och banversion i annat race avvisas utan delwrite.
- En giltig adaptermappad banversion kan återanvändas utan att importidentitet
  kopieras till ny klass. Gamla revisions-/publiceringsdata förändras inte.
- Namnlikhet kopplar inte mål. Målurval används från aktuell läst snapshot.
- Okänt svar fryser request/target; motsvarande parentlås och sessiongrind kvar.
- Mobil390/desktop1280 har neutral kompakt form, tydligt mål och44 px kontroller.

## Proportionerlig verifiering

Utöka befintligt TASK081-integrationstest med ett sammanhängande syntetiskt
PG-fall för delad bana/retry/felrace/stale/aktör/immutable journal. Återanvänd
befintlig admin-browserharness för ett sammanhängande skapa/retry-UI-fall;
ingen andra testplattform. Riktad contracts/database/application/web
lint/typecheck/test/build efter sista ändring. En ny isolerad testdatabas krävs,
aldrig manuell demo eller användartävling. Ingen bred workspace-/hårdvarusvit.

## Ingår inte och nästa steg

Se ADR-0166. Stafett, gaffling, GPS, riktig USB och historisk versionsväljare
ingår inte. Nästa minsta funktionella snitt är att rätta namnet på en manuell
klass från klassöversikten, med samma ID och bevarad resultat-/importhistorik.

## Verifieringslogg 2026-10-03

- `CI=true pnpm --filter @o-tid/contracts lint`, `typecheck`, `build`: exit0.
  `exec vitest run test/manual-class.test.ts`: exit0,2/2 tester.
- `CI=true pnpm --filter @o-tid/database lint`, `typecheck`, `build`: exit0.
- `CI=true pnpm --filter @o-tid/application lint`, `typecheck`, `build`:
  slutligen exit0. Första lint exit1: två osäkra pg-resultatfält i testet;
  explicita resultattyper rättade dem, utan produktändring.
- `CI=true TEST_DATABASE_URL=<isolerad> pnpm --filter @o-tid/application
  exec vitest run test/integration/task-081-manual-course-class.test.ts
  -t 'TASK300|preserves manual objects'`: exit0,2/2 valda tester,2 hoppade över.
  PostgreSQL17.11/PostGIS i ny `otid_task300_synthetic_20261003`, migration0085
  applicerad. Inga demo-/tävlingsdata. Egen testinstans stoppad; historik kvar.
- `CI=true pnpm --filter @o-tid/web exec vitest run
  src/lib/race-administrator-route-handlers.test.ts -t TASK300`: exit0,
  1/1 valt test,40 hoppade över. Service-dubbel bevisar kontrakt/Origin/method/
  kvittensbindning, inte verklig CSRF- eller databasauktorisering.
- Webblint/typecheck: exit0 efter sista produktändring. Riktad E2E-TypeScript/
  ESLint: exit0 även efter slutlig testlocatorrättning.
- `CI=true pnpm --filter @o-tid/web build`: exit0, Next16.3.3,
  22/22 statiska sidor, ny `/administrator/classes`-route med i bygget.
  Checkin-appskal byggdes också av det befintliga buildkommandot.
- `CI=true pnpm exec playwright test --config
  tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK300`:
  slutligen exit0,1/1 på49,8 s. Fyra tidigare körningar exit1: optionsökningen
  räknade även startupplägg; syntetiskt sessionssvar saknade CSRF-cookie;
  klasslocatorn valde dold kopia; ersättningslocatorn hade fel tillgänglighetsnamn.
  Testet rättades i samma befintliga fall, utan lättad produktauktorisering.
  Verifierar granskning utan POST,503→byteidentisk body/key, låst navigation,
  återläst klass, dedup12 banversioner,44 px kontroller och ingen horisontell
  overflow vid390/1280 px. Mobil-/desktopbilder granskade: neutral gemensam
  typografi, tre desktopfält/en mobilkolumn och textstödd gul okänd-status.
  Testet är syntetiskt och är inte ett verkligt auktoriseringsprov.

Antaganden/begränsningar: UI:s första målurval består bara av banversioner
som finns i det aktuella klassunderlaget, inte alla historiska/otilldelade
banor. Skapandet är online; offline gäller separata station-/avprickningsflöden.
Browsern använder syntetiska API-svar; HTTP→UI→PostgreSQL, fysisk mobil,
produktions-TLS, samtidiga verkliga operatörer och journalens fulla restore
har inte verifierats av detta snitt. Befintlig full pg_dump omfattar journalen;
inga tabellspecifika restore-allowlists hittades i källgenomgången.
