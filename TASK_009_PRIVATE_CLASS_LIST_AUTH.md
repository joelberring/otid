# TASK 009 – Spärrsäker privat klassbyteslista

Status: klart som avgränsad säkerhetsrättning 2026-09-07.

## Vertikalt flöde och beslut

En arrangör med CHANGE_ENTRY_CLASS ska kunna läsa samma privata klassbyteslista
som tidigare, men en samtidig logout eller credentialspärr får inte passera en
fristående authkontroll och ändå följas av en obehörig persondataläsning.
Läsning och spärr ska serialiseras genom den befintliga protected-read-gränsen
i ADR-0059. Ingen capability, DTO eller UI ändras.

Nuvarande listEntryClassesAsAdmin autentiserar utanför datatransaktionen.
Flytta denna kontroll till första steget i samma transaktion, med
authenticatePairingAdminSessionForProtectedRead. Behåll befintlig
READ COMMITTED och race SHARE för listans snapshot; alla normala rosterwriters
tar race UPDATE. Lägg inte till repeatable-read, ett nytt retryprotokoll eller
annan resultatlogik. Detta tillämpar redan accepterad ADR-0059, inte ett nytt
teknik- eller domänbeslut. Inga externa källor/licensfrågor uppstår.

## Berörda filer

- packages/application/src/results.ts: endast listEntryClassesAsAdmin och import.
- packages/application/test/integration/task-009-class-list.test.ts: riktade PG-prov.
- tests/e2e/playwright.class-list.config.ts och tsconfig.class-list.json:
  kör endast befintligt klassadmin-browserflöde på separat loopbackport 3109.
- Befintliga relevanta tester samt status/arkitektur/ADR-0059:s täckningsnot.

Ingen ny migration behövs: 0037:s guard måste redan vara installerad.
Privat tävlingsdatabas och manuell demo migreras inte. HTTP-/UI-kontrakt,
klassbytesmutationen, resultat och stationsflödet förblir oförändrade.

## Acceptans

1. Syntetiskt PG-prov reproducerar gamla luckan utan sleeps som bevis:
   faktisk låsväntan observeras via pg_blocking_pids. Credentialspärr och
   sessionslogout som vinner före authgrinden ger unauthorized utan lista.
2. Läsning som redan håller authlåsen får slutföra sin lista; konkurrerande
   spärr väntar tills transaktionen avslutas. Nästa läsning avvisas.
3. Rätt race/capability fungerar; annan race/capability, expiry och spärr
   avvisas. Listan behåller samma strikt validerade och deterministiska DTO.
4. GET är skrivfri. Samtidig klass-/importändring ger sammanhängande lista
   genom befintligt racelås. Inga resultat-/raw-/auditrevisioner ändras av läsning.
5. Riktade PG-prov samt workspace lint/typecheck/test/build och full PG-svit
   körs, med exakta resultat i docs/status.md. Relevanta befintliga HTTP-prov
   ska fortfarande passera utan kontraktsändring.
   Befintligt klassadmin-browserprov körs separat från den manuella demon på 3000.

## Gränser

Övriga legacy-läsare, generell behörighetsadministration, nya speakerfunktioner,
GPS, stafett och verklig USB ingår inte. En lyckad redan auktoriserad läsning
kan ha skickat data före en senare spärr; redan mottagna kopior kan inte återkallas.
Avgränsningen gäller databasens auth-/läsgräns, inte ett löfte att nätbytes kan
tas tillbaka efter commit. Hela V1 är fortsatt öppet.

## Verifierat resultat

Före fix reproducerade båda riktade konkurrensproven OK med privat lista efter
committad spärr (exit 1). Efter fix passerar alla sex nya PostgreSQL-prov:
scope/expiry/skrivfrihet, credential/session revocation-wins, credential/session
reader-wins samt sammanhängande lista under verklig klassändring. Befintliga
HTTP-prov ingår i den fulla enhetssviten och browserflödet är oförändrat.

Slutkörningar, samtliga med CI=true:

- `pnpm lint`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm test`: exit 0, 219 filer / 1 427 tester.
- `pnpm --filter @o-tid/application test:integration`: exit 0,
  20 filer / 238 tester, 88,97 s.
- `pnpm build`: exit 0.
- `pnpm exec tsc --noEmit -p tests/e2e/tsconfig.class-list.json`: exit 0.
- Riktad ESLint för `tests/e2e/playwright.class-list.config.ts` med
  projectService=false och tsconfig.class-list.json: exit 0.
- `pnpm exec playwright test --config tests/e2e/playwright.class-list.config.ts`:
  exit 0, 1/1, 22,3 s. Login, minimerad lista, verkligt klassbyte, tappat
  commitsvar/exakt retry utan dubbel revision samt logout fungerar.

Loggar `/private/tmp/otid-009-{red,targeted,targeted-retry,lint,lint-final,typecheck,typecheck-final,unit,integration,build,browser}.log`.
Första post-fix-PG-provet hade en felaktig testobservation av direkt blockerare;
testet följer nu även den faktiska låskedjan via läsaren. Första lint/typecheck
hittade en felaktig överlagrad pool.connect-typ i testhjälparen. Båda rättades
utan borttagna resultatassertioner; detaljer finns i docs/status.md.

Endast syntetisk PostgreSQL på 55432 (`otid_006w_review_schema`) användes;
browser hade samma DATABASE_URL/TEST_DATABASE_URL. Testservern på 3109 är
stängd. Ingen privat tävling eller manuell demodatabas migrerades.

Kvarvarande antaganden: normala rosterwriters fortsätter ta race UPDATE,
migration 0037 ska finnas före denna serverkod och produktionsdrift kräver
fortsatt separat verifiering. Övriga legacy-preflight-läsare är ännu inte
konverterade. Ingen fysisk mobil/hårdvara eller Android testades i denna
serverspecifika rättning; andra browserpaket kördes inte om och påstås inte
nyverifierade här.
