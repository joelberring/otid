# TASK284: kompakt speakeröverblick med tydliga källor

Status: genomförd och syntetiskt UI-verifierad 2026-10-01.

## Mål och gräns

Under → Speaker ska på desktop visa senaste resultatuppdateringar och
separata publika klassledare sida vid sida, med en liten verktygsrad och
tydliga käll-/lästider. På mobil behålls separata läsbara listor och
tryckytor. Inga nya kort, typsnitt eller resultatberäkningar införs.
Senaste 25 resultathuvuden är inte målgångsordning, ranking eller hela
tävlingen. Ledare kommer endast från befintlig validerad publik ranking.

## Acceptans

- Desktop har två platta avdelade ytor, inte staplade stora kort. Namn,
  klass, status och tid har prioritet framför hjälptext och metadata.
- Röd text för MP/DSQ, gul text för inget aktivt resultat eller gammalt/
  saknat underlag, grön text endast för befintligt bevisad publik ledare.
  Status och varningar är alltid begripliga utan färg.
- Privat feed och publika ledare behåller skilda källor/lästider,
  separata uppdateringar och cachevarning. Ingen ny ledare härleds från
  de 25 senaste uppdateringarna. Befintlig polling, sessionrensning,
  fail-closed och requests oförändrade.
- Korta källbegränsningar syns alltid. Längre hjälp och separat
  speakerinloggning får ligga sekundärt, aldrig före den operativa
  informationen på desktop.
- Ett riktat syntetiskt Next/browserfall vid 390/1280 px med OK, MP,
  NO_ACTIVE_RESULT och bevisad ledare räcker. Kontrollera separata
  felvägar/freshness i samma fall, inga oavsiktliga writes eller
  förhämtade ledare. Webblint/typecheck/build och relevant ren
  ledarprojektionstest; ingen DB-/hårdvaru-/bred browserkörning.

## Arkitektur

Ändringen gäller presentation av redan accepterade läsmodeller i
RaceWorkspaceSpeaker. Resultatlogik, API, behörigheter, teknikval och
domängränser ändras inte; ingen ny ADR behövs. Separat speakervy ingår
inte. Ingen stafett, GPS eller USB påbörjas.

## Genomfört

Under → Speaker visar två platta desktopkolumner med separata rubriker,
uppdateringsknappar, källbegränsningar och lästider. På mobil behålls
klassledare först och därefter senaste resultatuppdateringar i statiska
listor; små mellanrum och normal textstorlek för status/tid minskar
onödig scroll. Den separata speakerinloggningen ligger efter operativt
underlag, inte mellan källorna.

NO_ACTIVE_RESULT heter fortfarande ”Inget aktivt resultat” men har gul
text; detta är inte samma sak som en saknad eller ej startad deltagare.
MP/DSQ är röda, bevisade publika ledare gröna. Saknad/äldre lästid
markeras gult och befintlig källspecifik feltext visas fortsatt.
Sol-agenten gjorde den avgränsade presentationen; huvudagenten granskade
bilder och förfinade neutral textfärg, lästidsrubrik och mobilmellanrum.
Request-, polling-, session- och rankingkod ändrades inte.

## Exakta resultat

| Kontroll | Resultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/race-workspace-speaker-leaders.test.ts` | exit 0, 1/1 test |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json` | exit 0 |
| ESLint för `tests/e2e/task-167-payment-filter.spec.ts` med samma E2E-projekt | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK284` | slutkörning exit 0, 1/1, 5,5 s |
| `CI=true pnpm --filter @o-tid/web build` | exit 0 efter sista CSS-ändringen; Next 16.3.3, 22 statiska sidor |

Ett nytt avgränsat fall använder befintlig Next-harness på loopback3167
och avlyssnar samtliga API-anrop med syntetiska svar. Det verifierar OK,
MP och NO_ACTIVE_RESULT, grön publik delad ledare (inte den snabbaste
privata feedraden), ingen ledarförhämtning, två desktopkolumner,
separata lästider, mobilrader, ingen sidöverflow eller oavsiktlig write.
Publik 503 och privat 503 behåller respektive gamla källa med explicit
varning; privat 403 rensar båda källornas personer.

Fallet kördes tre gånger: första exit 1 eftersom färgkontrollen råkade
välja kolumnrubriken ”Ledare” i stället för kroppens ledarmarkering.
Efter avgränsning till tbody passerade andra körningen (4,0 s) och
slutkörningen efter mobilförtätning (5,5 s). Ingen bred svit,
PostgreSQL, riktig credential eller hårdvara användes. Desktop och
slutlig mobilbild granskades. Bildens övriga adminbanner beror på
fixturens avsiktligt saknade avvikelse-API-svar och ingår inte i detta
speakerbevis.

## Kvarvarande antaganden

- Endast syntetiskt 390/1280 px, inte riktig mobil, handske, speaker-
  fältarbete, skärmläsare eller internetdrift.
- Raderna är fortfarande högst 25 senaste privata resultathuvuden,
  inte full resultattabell eller målgångsordning. Publika ledare kan
  vara cachefördröjda och hämtas bara uttryckligen.
- Lång namn-/klassdata och mycket många publika klasser har inte
  layoutprovats i detta snitt; inga nya gränser infördes.

Nästa minsta vertikala uppgift: lokal namn-/klassökning inom redan lästa
speakerkällor med separata träffantal och tydlig begränsning till det
hämtade underlaget, utan ny API-yta eller implicit ledarhämtning.
