# TASK185: begripligt upplägg och operativ deltagararbetsyta

Status: implementerat och riktat verifierat, 2026-09-24. Användarstyrd
fortsättning på TASK184/183. Verklig databas-/fältacceptans återstår.

## Användarutfall

Före tävlingen visar en samlad arbetsordning: banor, klasser, deltagare,
start/lottning, startlista och funktionärer. Under tävlingen har egna
underflikar Lägesbild, Deltagare och Speaker. Samma deltagartabell och
personval återanvänds mellan huvudfliken Deltagare och Under, utan kopior
av mutationsflöden. Sökning omfattar hela inlästa rostren, inte bara sidan.

Personkortet visar namn/klubb, klass, bricka, start och betalning före
åtgärder. Resultat och ordnad kontrolltabell är läsning av serverunderlaget,
inte en ny beräkning i React. Vanliga ändringar är nära personen;
sekundära resultatbeslut och kontokoppling har en tydlig separat plats.

## Gränser och implementation

- Behåll befintliga writers, granskning, exakt retry och rollgränser.
- ADR-0161 beslutar före kod om smal kontrollprojektion och separat
  MANAGE_RACE-speakerläsare. Inga migreringar eller teknikbyten.
- Befintlig MANAGE_RACE-kursgeometriläsning kan ge namn/kontrollföljd till
  banöversikten. Den är begränsad; otillgänglig kursinformation markeras,
  inte fabriceras. Kartgeometri behöver inte visas i setupvyn.
- Desktop/padda: tät lista och personkort samtidigt, med möjlighet till
  helbreddstabell. Mobil: lista/detalj var för sig och stora tryckytor.
- Inga nya tävlingsformer, radio-/livekontroller, GPS eller hårdvarustöd.

## Acceptans och proportionerlig verifiering

Återanvänd befintligt syntetiskt TASK167-browserprov: föreflödets ingångar,
underflikar, sökning och vald person, översikt före ändringsknappar,
kontrollföljd/tider och speakerläsning samt 390/900/1280 px. Riktad lint,
typecheck, små kontrakts-/routeprov och webbuild. Kör inte full DB-regression
mot demo eller privat tävling. Dokumentera vad som faktiskt verifierats.

## Levererat

- Före: Upplägg, Banor, Klasser, Deltagare, Lottning & starttider,
  Startlista, Funktionärer. Banlistan visar klassernas tilldelade versioner
  med namn och kontrollföljd. Upplägget anger ordning, inte falska klarmarkeringar.
- Under: Läget i tävlingen, Alla deltagare, Speaker, Tid- & kontrollrättning.
  Lägesbilden hämtar kvar-i-skogen-underlag vid inträde; personändringar och
  resultatbeslut använder samma befintliga handlingar som tidigare.
- Deltagare: sökning i hela hämtade rostern inklusive bricknummer, klassfilter,
  25/100/250 rader per sida, brett tabelläge på större skärm. Val av person
  återställer sida-vid-sida-läge. Ny deltagare öppnar också arbetsvyn från bredläge.
- Personkort: namn, klubb, klass, bricka, start och betalningsmarkering;
  kompakt ändringsval, gällande resultat, ordnade kontroller, sträck-/totaltider
  och lagrade saknade/extra kontroller. Sekundära resultatbeslut/historik och
  frivillig kontokoppling ligger i egna detaljer.
- Speaker: administratörssessionen återanvänds, separat kompakt tabell/mobilkort,
  synlig lästid, femsekunders läsintervall endast i aktiv synlig vy, timeout
  och markering av gammalt underlag. Funktionärernas separata behörighet består.

## Exakt verifiering

Installerade lokala binärer användes. Agentens försök med
`pnpm --filter @o-tid/web typecheck` nådde inte skriptet: registry-/installsteg
följdes av `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, exit 1. Ingen
dependencyinstallation genomfördes. Det är inte ett godkänt pnpm-workspaceprov.

Från repositoryroten:

```bash
node_modules/.bin/vitest run packages/contracts/test/administrator-effective-result.test.ts apps/web/src/lib/race-administrator-route-handlers.test.ts
node_modules/.bin/vitest run packages/application/test/administrator-effective-result-projection.test.ts packages/contracts/test/administrator-effective-result.test.ts
node_modules/.bin/tsc --noEmit -p packages/contracts/tsconfig.json
node_modules/.bin/tsc --noEmit -p packages/application/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json
./node_modules/.bin/eslint apps/web/src/components/race-administrator-workspace.tsx apps/web/src/components/race-preparation-guide.tsx apps/web/src/components/race-participant-facts.tsx apps/web/src/components/race-result-controls.tsx apps/web/src/components/race-course-overview.tsx apps/web/src/components/race-workspace-speaker.tsx apps/web/src/i18n/race-workflow-detail-sv.ts apps/web/src/i18n/race-workspace-speaker-sv.ts apps/web/src/i18n/race-workspace-navigation-sv.ts
./node_modules/.bin/eslint packages/contracts/src/administrator-effective-result.ts packages/contracts/test/administrator-effective-result.test.ts packages/application/src/administrator-effective-result.ts packages/application/src/speaker-board.ts packages/application/src/index.ts packages/application/test/administrator-effective-result-projection.test.ts apps/web/src/lib/race-administrator-route-handlers.ts apps/web/src/lib/race-administrator-route-handlers.test.ts 'apps/web/src/app/api/admin/races/[raceId]/administrator/speaker-board/route.ts'
./node_modules/.bin/eslint tests/e2e/task-167-payment-filter.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.task167-payment-filter.json"}'
CI=true ./node_modules/.bin/playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts
node apps/web/scripts/build-checkin.mjs
```

Resultat: alla ovanstående slutkontroller **exit 0**. Första Vitest-körningen
**43 tester** (3 contracts + 40 route), andra **4 tester** (1 ny
produktionsprojektion + samma 3 kontraktstester), alltså **44 unika tester**.
Typecheck och lint utan fel. Browserprovet **1/1, 14,0 s** efter sista
ändringen, vid 390/900/1280 px. Checkin-appskal **3d3ed4d181f4,
3 public assets**.

Browserprovet behövde tre mellanliggande rättningar i testet: två tvetydiga
textselektorer och antagandet att Strict Mode bara gör en initial läsning.
Dessa körningar gav exit 1. Ett tidigare komplett prov gav 1/1 på 13,8 s;
det upprepades efter den visuella putsningen (17,7 s) och efter återställd
aria-pressed-markering på personåtgärderna (14,0 s). Provet verifierar också
bevarat personval/sökning, review-lås och stoppad speakerläsning efter flikbyte.
En kodgranskning hittade fel matchning av upprepad neutraliserad kontroll;
den rättades och täcks av det enda nya application-regressionsprovet.

Navigationen i befintliga browserfall TASK007/029/092/150/152/153 anpassades
utan nya testfall. TASK029-typecheck och lint med respektive E2E-projekt:
exit 0. En första samlad ESLint-körning utan `project` gav exit 2
(saknad typinformation), därefter passerade korrekt angivna projekt:

```bash
node node_modules/typescript/bin/tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
./node_modules/.bin/eslint tests/e2e/task-007-demo.spec.ts tests/e2e/task-029-race-administrator.spec.ts tests/e2e/task-092-class-control-neutralization.spec.ts tests/e2e/task-150-organizer.spec.ts tests/e2e/task-152-participant-claim.spec.ts tests/e2e/task-153-public-result-follows.spec.ts --parser-options '{"projectService":false,"project":["tests/e2e/tsconfig.demo.json","tests/e2e/tsconfig.race-administrator.json","tests/e2e/tsconfig.class-control-neutralization.json","tests/e2e/tsconfig.organizer.json","tests/e2e/tsconfig.task152-claim.json","tests/e2e/tsconfig.task153-follows.json"]}'
./node_modules/.bin/eslint tests/e2e/task-029-race-administrator.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
```

De äldre fallen är **inte körda i browser eller mot DB**; statiska kontroller
är inte full acceptans av dem.

Från `apps/web`:

```bash
DATABASE_URL=postgresql://build:build@127.0.0.1:1/build node node_modules/next/dist/bin/next build
```

Slutlig produktionsbuild **exit 0**, 22/22 statiska sidor; compile 2,8 s,
TypeScript 5,3 s. Byggadressen är avsiktligt oanvändbar, ingen tävlings-DB
kontaktas. Browsern använde loopback3167 och syntetiska HTTP-svar, inga
riktiga credentials eller databaswriters. Befintlig lokal demo lyssnar
fortsatt på loopback3000; ingen omstart eller omprovisionering gjordes.

## Kvarvarande antaganden och avgränsningar

- MANAGE_RACE är rätt administratörsroll för dessa smala privata läsningar
  enligt ADR-0161. Vanliga funktionärer får inte dess rättigheter.
- Banöversikten återanvänder den begränsade kursgeometriprojektionen
  (högst 100 versioner/256 kontroller); fel/saknad version visas uttryckligt.
  Den är inte ett fullständigt banbibliotek eller importflöde.
- Speaker omfattar högst 25 senaste publicerade uppdateringar. Inte
  placering, alla målgångar, prognoser, radio eller automatisk uppläsning.
- Resultat per kontroll avser lagrade tider, inte fri redigering av råstämplingar.
  Befintliga versionsbundna rättningar ligger kvar i sina verktyg.
- Full PostgreSQL-regression, alla äldre adminbrowserfall, fysisk padda/
  mobil och verkligt arrangörsprov är inte körda. Separat offlineavläsning
  är oförändrad; dessa administrationsläsningar kräver serverkontakt.
- TASK183:s krav på fem synliga deltagarrader i 1280×800 återstår. Här
  verifierades tre syntetiska personer, filter, bredläge och ingen horisontell
  helsidesscroll. Kontrolltabellen kan rullas separat på mobil.

## Enda nästa minsta UI-uppgift

Slutför återstående TASK183: förtäta deltagarlistans filter-/verktygsrad
så att minst fem deltagarrader och vald persons grunduppgifter ryms i
1280×800. Återanvänd data och handlingar; ingen ny API eller domänfunktion.
