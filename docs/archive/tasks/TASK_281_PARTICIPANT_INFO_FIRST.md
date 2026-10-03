# TASK281: deltagarens resultat före redigeringsverktygen

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Mål och gräns

I `/admin/[raceId]/manage` ska ett vanligt val av deltagare öppna en
läsande överblick. Funktionären ser identitet, klass, klubb, bricka,
start, resultatstatus och den kända kontrollföljden utan att ett
klassbytesformulär skjuter ned dem i en separat scrollpanel. Ändringar
väljs explicit via befintliga knappar. Ingen domänmodell, API, roll,
resultatregel eller ADR ändras.

## Acceptans

- Nytt eller vanligt valt deltagarurval öppnar ett neutralt läsläge.
  Översikten och `RaceResultControls` ligger direkt efter
  deltagaruppgifterna och före resultatbeslutsverktyg. Ingen skrivning
  sker av urval eller läsläge.
- Befintliga explicita vägar till klassbyte, bricka, starttid,
  identitet och betalning visar rätt editor nära deltagaruppgifterna.
  Kontextåtgärderna för saknad fast start, omräkning och
  betalningsuppföljning förblir direkta.
- Pågående/frysta eller okända skrivförsök får inte döljas, byta mål
  eller gå att åsidosätta genom ett vanligt deltagarval.
- Mobil och desktop behåller täta tabeller, minst 44 px tryckytor,
  fokusmarkering och textstödda röd/gul/grön statussignaler.
- Ett befintligt syntetiskt browserfall används för att kontrollera
  ordning, explicit editorval och noll oavsiktliga skrivningar;
  riktad lint/typecheck/build. Ingen databas eller hårdvara.

## Ingår inte

Nytt redigeringsflöde, ny resultateditor, ändrade resultatbeslut,
ombyggd deltagartabell, automatisk korrigering av stämplingar eller
fler browser- och integrationstester.

## Genomfört och verifierat

Vanligt deltagarval nollställer nu den lokala åtgärden till `INFO`.
Detta visar befintliga deltagarfakta, gällande resultat och historisk
kontrollföljd utan att klassbytesformuläret startar automatiskt.
Redigeringsknapparna, direktval för saknad fast start/omräkning/
betalningsuppföljning och spärren för väntande skrivförsök är kvar.
En lyckad direktanmälan landar också i läsläget. Befintliga TASK029-
browserflöden har uppdaterats med ett uttryckligt klick på ”Byt klass”;
de har inte körts mot databas i detta snitt.

Ett nytt, enda syntetiskt browserfall återanvänder TASK167:s Next-harness.
Det visar en felstämplad deltagare med röd textstatus, gul äldre-
underlagsvarning och kända kontroller 31–33 med saknad mellantid för
kontroll 32. Det bekräftar DOM-ordningen fakta → resultat → kontroller,
avsaknad av automatisk klasseditor, explicit klassbytesval, återgång till
INFO för nästa deltagare, noll oavsiktliga skrivbegäranden och ingen
horisontell scroll vid 390/1280 px. Båda bilderna granskades.

| Kontroll | Slutresultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json` | exit 0 |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json` | exit 0 |
| ESLint för de två berörda E2E-filerna med båda projekten | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK281` | exit 0, 1/1 syntetiskt Chromiumfall |
| `CI=true pnpm --filter @o-tid/web build` | exit 0; Next 16.3.3, 22 statiska sidor |

## Kvarvarande antaganden

- Browserfallet använder syntetiskt resultatunderlag, inte riktig
  PostgreSQL/PostGIS eller fältdata. TASK029:s ändrade klick är
  statiskt kontrollerat men ännu inte DB-kört i detta snitt.
- Den befintliga 70dvh-scrollpanelen begränsar mängden kontrollrader
  som syns samtidigt på desktop. Ingen fysisk skärm-, regn- eller
  handsktestning har gjorts.

Nästa minsta vertikala uppgift: kontrollera det explicita klassbytesklicket
och läsläget mot en isolerad migrerad PostgreSQL i ett enda redan
befintligt TASK029-browserfall, utan verkliga tävlingsdata.
