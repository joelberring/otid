# TASK150: arrangörskonto → skapa tävling → Mina tävlingar

Status: syntetiskt verifierad 2026-09-23 enligt provrapporten nedan. Detta är
inte fältverifiering eller fältklarhet. Berörd lint/typecheck/build och de
riktade proven passerade efter de sista produktändringarna.

## Användarutfall

En person med provisionerat arrangörskonto loggar in från mobil eller dator,
skapar ett event med första loppet, ser det under ”Mina tävlingar” även efter
ny session och öppnar den befintliga `/manage`-arbetsytan utan att klistra in
en separat racecredential. Publikresultat och stationsarbete ändras inte.

## Ägda gränser och ordning

1. Additiv PostgreSQL-migration, Drizzle-schema och restore/rollback-notering
   för ADR-0144:s konto, verifierare, loginspärr, session, eventgrant,
   createjournal och delegationslänk. Dokumentera FK/check/unikhet och
   låsordning innan writer används. Historiska event är fortsatt otilldelade.
2. Betrodd CLI för initial provisionering och rotation via privat in-/utdata;
   inget lösenord i argv, URL, logg, browserlagring eller databas i klartext.
   Implementera serverbeständig throttling och opaka, återkalleliga sessioner.
3. Strikta konto-login/logout/status, kontobunden idempotent create och
   SQL-minimerad ”Mina tävlingar”-läsning. Separat från legacy `/api/events`.
4. Race-enter som ger en konto-/sessionsbunden `MANAGE_RACE`-delegation och
   central föräldrakontroll på **varje** delegerad race-request. Äldre
   racecredentials använder oförändrad väg.
5. Svensk kontoentré, skapande och kompakt ägarlista med öppnaåtgärd i
   befintlig adminarbetsyta. Efter osäker HTTP-commit behålls exakt request-id
   och intent tills användaren får bekräftat utfall eller avbryter explicit.

## Acceptans

- En provisionerad användare loggar in, skapar event+första race och får en
  OWNER-grant atomiskt. Exakt retry efter tappat svar returnerar samma IDs;
  ändrat konto/intent med samma request-id blir konflikt.
- ”Mina tävlingar” visar endast det kontots aktiva event, också efter ny
  inloggning på en annan enhet. En obehörig användare får varken privat lista
  eller möjlighet att öppna `/manage` via account-enter.
- Efter enter kan ägaren utföra en redan befintlig, vanlig `MANAGE_RACE`-
  åtgärd. Konto-utloggning/spärr gör både kontoläsning och delegerad
  race-session obrukbara; en legacy racecredential påverkas inte.
- Tomt, laddande, felaktigt och utloggat tillstånd är begripligt på svenska.
  Vid 390 px: inga horisontella sidscrolls, synliga etiketter och minst 44 px
  tryckytor. Publika listor/resultat fungerar fortsatt utan login.
- Isolerade PostgreSQL-fall täcker loginspärr, konkurrens/retry, race-scope,
  logout/spärr och legacy-samexistens. Ett sammanhållet browserfall täcker
  mobil och desktop genom skapande → lista → enter → adminåtgärd; inga
  generella browser-/databassviter körs i onödan.
- Berörd lint, typecheck, riktade tester och build körs efter sista ändringen.
  Rapporten anger exakta kommandon/utfall och kvarvarande antaganden.

## Ingår inte

Självregistrering, e-postleverans, publik profil, deltagarkonto, synkade
favoriter, GPS, medadministratörsinbjudan, automatiskt övertagande av gamla
event, full klubb-/medlemsmodell, Eventor-skrivning, ny tävlingsform,
SPORTident-parser eller backupdrift. TASK149:s publika delningsknapp ägs inte
av detta snitt.

## Säker arbetsordning

Ingen riktig tävlingsdata, delad Eventornyckel eller demo-/privat databas får
användas i prov. Välj en uttryckligen isolerad migrerad PostgreSQL/PostGIS med
syntetiskt underlag och kör writers sekventiellt. En agent äger schema och
authkontrakt; UI kan delegeras först när kontraktet är låst. Läs AGENTS.md,
CODEX_BRIEF.md och arkitektur-/domän-/offlinedokumenten före kodändring.

## Verifieringsrapport 2026-09-23

Riktade syntetiska kontroller passerade: PostgreSQL-integration 5/5,
contracts 3/3, CLI 4/4, webbenhetstester 10/10 och ett sammanhållet
Playwright-browserfall 1/1. Browserfallet använde en separat migrerad
PostgreSQL-databas, syntetiska konton och loopbackserver på port 3150. Det
provade login, skapa event, ”Mina tävlingar”, kontoöppning av `/manage`,
skapande av bana och klass med delegerad administratörsåtkomst, ny session,
mobilbredd samt att ett annat konto nekas race-enter. Browser-
harnessen skapar en ny `otid_task150_e2e_...`-databas och privat fixturekatalog
från en uttryckligt angiven lokal syntetisk källa. Login- och
sessionstatuskontrakten innehåller också konto-ID så klienten kan binda en
väntande skapanderequest till samma konto.

Linter, typecheck och build för web, contracts, application och database samt
scripts tsc/eslint passerade med exit 0 efter de sista berörda ändringarna.
Browserharnessen typkontrollerades och lintades med exit 0. Slutligt
Playwright-omtag passerade 1/1 med exit 0 efter sista UI-ändringen; kontroll efteråt visade
ingen kvarvarande `otid_task150_e2e_...`-databas eller lyssnare på port 3150.
Ingen verklig tävling,
demodatabas, Eventor-nyckel, fysisk hårdvara eller fältmiljö ingick.

Kvarvarande antaganden: första kontot provisioneras betrott via CLI, inte
självregistrering; historiska event får ingen automatisk ägare; delning till
medadministratör är nästa separata snitt. Browserprovet kördes på simulerade
desktop-/390 px-viewportar, inte fysisk mobil eller driftsatt HTTPS. Befintlig
stations-/offlineväg och hela den publika resultatsviten omkördes inte i
TASK150; det riktade browserfallet kontrollerade en anonym resultatsida.

De riktade testkommandona är:

```bash
CI=true pnpm --filter @o-tid/contracts exec vitest run test/organizer-account.test.ts
CI=true pnpm --filter @o-tid/application exec vitest run test/integration/task-150-organizer-account.test.ts
CI=true pnpm exec tsc --noEmit -p scripts/tsconfig.json
CI=true pnpm exec vitest run scripts/organizer-account.test.ts
CI=true pnpm --filter @o-tid/web exec vitest run src/lib/organizer-account-route-handlers.test.ts src/lib/organizer-client.test.ts
CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.organizer.json
CI=true pnpm exec eslint tests/e2e/task-150-organizer.spec.ts tests/e2e/task-150-organizer-server.ts tests/e2e/playwright.organizer.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.organizer.json"}'
CI=true pnpm exec playwright test --config tests/e2e/playwright.organizer.config.ts --timeout 30000
```

PostgreSQL- och browserproven kräver att `TEST_DATABASE_URL` sätts privat till
en separat lokal PostgreSQL-källa med syntetiskt namn, till exempel
`otid_task150_synthetic_<suffix>`, aldrig tävlings-, demo- eller privatdata.
Applikationsintegrationen kräver en roll med `CREATEDB` och skapar/raderar sin
egen `otid_task150_spec_...`-databas. Browserkonfigurationen kräver en
loopbackvärd och godkänt `otid_task150_synthetic_`, `otid_task150_spec_` eller
`otid_task150_e2e_`-källnamn; den skapar en egen migrerad
`otid_task150_e2e_...`-målbas, privat 0700-katalog med 0600-fixturefil och
loopbackserver på 3150. Den separata byggkatalogen är `.next-organizer-test`.
Harnessen städar målbas och fixture efter normal körning. Om browser- eller
integrationskörningen avbryts oväntat ska driftaren inspektera databaslistan
och manuellt städa enbart verifierade, körningsunika
`otid_task150_e2e_<32 hex>`- respektive `otid_task150_spec_<32 hex>`-databaser.
Automatisera inte efterstädning och rör aldrig demo-, privat- eller
tävlingsdatabaser.

Slutligt godkända paketkontroller (samtliga exit 0):

```bash
CI=true pnpm --filter @o-tid/contracts lint
CI=true pnpm --filter @o-tid/contracts typecheck
CI=true pnpm --filter @o-tid/contracts build
CI=true pnpm --filter @o-tid/application lint
CI=true pnpm --filter @o-tid/application typecheck
CI=true pnpm --filter @o-tid/application build
CI=true pnpm --filter @o-tid/database lint
CI=true pnpm --filter @o-tid/database typecheck
CI=true pnpm --filter @o-tid/database build
CI=true pnpm --filter @o-tid/web lint
CI=true pnpm --filter @o-tid/web typecheck
CI=true pnpm --filter @o-tid/web build
CI=true pnpm exec eslint scripts/organizer-account.ts scripts/organizer-account-access.ts scripts/organizer-account.test.ts
```
