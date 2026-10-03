# TASK184: sammanhållen tävlingsbild och arbetsområden

Status: implementerad och riktat syntetiskt verifierad 2026-09-24.
UI-specifikation och research skrevs före implementation.

Mål: administratören förstår tävlingens upplägg innan den öppnar formulär,
och hittar uppföljningen under tävlingen. Se
[UI-riktningen](docs/ui-workspace-design-2026-09-24.md) och
[systemjämförelsen](docs/research/competition-ui-comparison-2026-09-24.md).

Berör `apps/web` och befintligt TASK167-browserprov. Inga nya paket,
API:er, migreringar, behörigheter eller resultatregler. Ingen AGPL-kod.

Acceptans: en kompakt översikt med sanningsenliga klass-/startfakta,
överblick före formulär, rättningar under operativt arbete, bevarade
granskningar och retry samt användbar mobil-/padd-/datorlayout.
Verifiera riktat enligt UI-specifikationen och redovisa exakta resultat.

Nästa minsta snitt är TASK183, inte stafett/GPS/hårdvara eller total redesign.

## Levererat

- Översikt som första läge i `/manage`, med tävlingsnamn/lopp/datum,
  underlagstid/version, klassernas startform och antal/kapacitet.
- Före / Deltagare / Under / Efter är navigering, inga nya tillstånd som
  förbjuder administrativa ändringar vid fel tid på dagen.
- Fria starter räknas inte som saknade minutstarttider. Uppföljning av
  äldre resultat, hyrbrickor och betalning öppnar befintliga rosterfilter.
- Tids-/kontrollrättningar finns under Under, funktionärsåtkomst under
  Före och kart-/ruttverktyg under Efter. Inga sådana formulär före login.
- Komponenternas laddning/granskning/oklara sparutfall och visad åtkomstkod
  håller arbetsläget öppet. Osäkra resultatwrites behåller samma försök
  för retry; nya avbrytknappar gäller bara före skickad/osäker write.
- Kompaktare masthead. På bred skärm ligger klassöversikt och uppföljning
  sida vid sida; på mobil staplas områdena och banans upprepade
  "Tilldelad"-kolumn utelämnas. Inget nytt mobilramverk införs.

## Verifiering och exakta resultat

Installerade lokala verktyg användes för huvudkontrollerna, eftersom pnpm
kan försöka installera workspace under en kontroll. Inga nya beroenden.

| Kontroll efter sista produktändring | Resultat |
| --- | --- |
| Web `../../node_modules/.bin/tsc --noEmit` från `apps/web` | exit 0 |
| ESLint på de 11 berörda TS/TSX-filerna i web | exit 0 |
| `./node_modules/.bin/tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json` | exit 0 |
| TASK167-spec ESLint med samma projekt och `projectService:false` | exit 0 |
| ESLint för navigeringsanpassade TASK007/091/092/150/152/153-specar, respektive befintlig tsconfig | exit 0 |
| TASK029 `tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json` och ESLint med samma projekt efter navigeringsändringarna | exit 0 vardera |
| `CI=true ./node_modules/.bin/playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts` | **1/1 passerade, 13,7 s, exit 0** |
| `node apps/web/scripts/build-checkin.mjs` | exit 0, `9ffb58027824`, 3 publika assets |
| `DATABASE_URL=postgresql://build:build@127.0.0.1:1/build node node_modules/next/dist/bin/next build` från `apps/web` | exit 0, 22 statiska sidor |

Browserprovet kör en riktig Next-app med enbart syntetiska API-svar på
loopback3167, ingen PostgreSQL. Det omfattar landningsvy, blandad
fri/minutstart, uppföljningsfilter, bevarad sökning/vald person, review-lås,
en fördröjd rättningsläsning med fel och synligt felbesked samt
390/900/1280 px utan horisontell sidscroll. Datorns två deltagarpaneler
kontrolleras sida vid sida. Skärmbilder granskades visuellt.

Första starten blockerades av sandboxens loopbackbindning (EPERM, exit 1).
Två utvecklingskörningar stoppade vid en exakt label-väljare för
rättningsformulärets select; bytet till namngiven combobox gav grönt prov.
En efterföljande layoutförtätning följdes av slutkörningen ovan. pnpm-
försök i agenternas kontroller behövde CI-läge; dessa är inte huvudbeviset.

Äldre browserfall som använder `/manage` har fått explicita lägesval och
kontokopplingens befintliga disclosure där det behövs. De DB-baserade
sviterna har **inte körts** i detta UI-pass. Inte heller full workspace-
regression, fysisk mobil, faktisk stationshårdvara eller arrangörstest.
Navigeringsanpassning är inte ett påstående om att deras hela äldre
acceptansscenario nu är runtime-verifierat.

## Kvarvarande antaganden

- Arbetsområdena behöver provas av en arrangör under realistisk arbetsbelastning.
- Rosterunderlaget är serverns senast hämtade bild, inte stationshälsa eller
  osynkade startmarkeringar. Skogsrapporten behåller sin egen osäkerhet.
- Klassöversikten kan visa att en bana är tilldelad, men befintlig DTO ger
  inte bannamn/kontrollföljd där. UI:t gör ingen ny fullständighetskontroll.
- Deltagardetaljen och arrangörens övergång till tävlingen behöver fortsatt
  UX-arbete. TASK183 är nästa minsta snitt. Detta är inte MeOS-paritet och
  tillför inte stafett eller gaffling.
