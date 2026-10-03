# TASK187: mer tävlingsinformation, mindre ramverk

Status: klar 2026-09-25. Plan dokumenterad före kod; slutför även TASK183.

Användarens fem skärmbilder visar behov av fler samtidiga fakta och mindre
toppyta/stora rutor. MeOS-bilderna används endast som beteendereferens, inte
som förlaga för kopierad UI/kod. Befintliga teknikval och domängränser gäller;
ingen ny ADR behövs för enbart lokal presentation.

## Avgränsad utformning

- Bara `/manage`: kompakt identitet, utvecklingsmarkör och statusrad; ingen
  fast sidhuvudyta. Behåll färskhet, varningar, tydligt val och tangentbordsfokus.
- Dator: mindre padding, cirka 32 px kontroller och flikar i stället för stora
  kortknappar. På pekskärm och mobil förblir primära mål minst 44 px.
- Flytta klass-/kapacitetslista och uppföljning före översiktens genvägar.
  Genvägarna blir kompakta; inga fiktiva statusar eller dolda viktiga varningar.
- Samla sök-/klass-/radinställningar; tätare lista och deltagarfakta bredvid.
  Mobilen behåller separat lista/detalj. Använd hela stora skärmens bredd.
- Ingen ny API, databasändring, authändring eller resultatregel.

## Kontroll

Föreändring: i faktisk demo 1280×800 ligger huvudflikarnas nederkant på
311,65 px; global header 51 px. Mät igen efter ändring.
Utöka samma befintliga syntetiska browserfall i task-167-payment-filter:
minst fem helt synliga deltagarrader och personfakta vid 1280×800, 900 px
utan horisontell sidscroll samt 390 px med 44 px primära tryckytor.
Riktad lint/typecheck och webbuild. Inga DB-prov eller externa anrop.

## Resultat

Faktisk demo i samma 1280×800-fönster: huvudflikarnas nederkant **165,54 px**
(tidigare 311,65), global header **26,19 px** (tidigare 51). Cirka **47 %**
mindre toppyta. Datorvyn har flikar, radställda statusmått, mindre ramar och
kompakta fält. Inget övergripande sidhuvud är sticky/fixed. Mobil/pekbehållare
har fortsatt 44 px primära mål; enbart fin pekare på större skärm får 32 px.
Den tillfälliga browserstorleken återställdes efter kontrollen.

Utökat befintligt browserfall: **1/1 passerade, 36,0 s, exit 0**.
Sex syntetiska personer; minst fem hela rader och valda personfakta inom
1280×800. Äldre-resultatvarning och saknad bricka förblir synliga.
900 px visar lista/detalj utan horisontell sidscroll; 390 px behåller separat
lista/detalj och minst 44 px mobilnavigation. Visuell screenshotkontroll utförd.

## Exakta kommandon

Från repositoryroten, installerade lokala binärer utan installation:

```bash
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json
node node_modules/eslint/bin/eslint.js apps/web/src/components/race-administrator-workspace.tsx apps/web/src/components/race-workspace-overview.tsx apps/web/src/i18n/race-workspace-navigation-sv.ts
node node_modules/eslint/bin/eslint.js tests/e2e/task-167-payment-filter.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.task167-payment-filter.json"}'
CI=true ./node_modules/.bin/playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts
```

Samtliga slutkontroller **exit 0**. Från `apps/web`:

```bash
DATABASE_URL=postgresql://build:build@127.0.0.1:1/build node node_modules/next/dist/bin/next build
```

**Exit 0**; kompilering 9,2 s, TypeScript 16,4 s, 22 statiska sidor. Bygg-URL
är en syntetisk placeholder, ingen databaskontakt. TypeScript kördes även i
slutbygget efter den sista verktygsradsjusteringen.

Mellanliggande prov: sandbox vägrade loopback-bindning (`EPERM`, exit 1),
varefter samma syntetiska prov kördes med lokal socketåtkomst. Två gamla
fixtureproblem gav därefter exit 1: sessionsutgång år 2099 överflödade
browserns timeout, och speakersvaret saknade numera obligatorisk tidszon.
Rättat endast testunderlaget till en timmes session respektive roster-tidszon.
Ingen auth-/speakerimplementation ändrades. Ingen bred testsuite lades till.

## Antaganden och nästa minsta uppgift

- Avser den sammanhållna `/manage`-vyn. Separata äldre rollvyer, publik och
  avläsningsstation är oförändrade.
- Skärmkontrollerna är syntetiska browserprov och läsande demokontroll, inte
  fysisk padda/mobil eller lastprov med tusentals deltagare.
- MeOS-bilder används som beteendereferens. Ingen extern kod, layoutmall
  eller verkliga deltagares personuppgifter kopierades till testdata.

Nästa minsta UI-snitt: visa vald persons vanliga redigering direkt under
personfakta, före sekundär historik/kontokoppling, med samma befintliga
spargranskning. Inga nya datakällor eller resultatregler behövs.
