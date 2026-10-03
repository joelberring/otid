# TASK267: kompakt neutral separat klasslottning

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Användarutfall

Arrangören ska överblicka en klasslottning utan stora deltagarkort eller
en bekräftelse som hamnar efter hela klassens långa lista. Klassval och
parametrar får en tät desktopordning, mobil en tydlig läsordning.
Förhandslistan visar varje deltagares gamla och nya tid i täta rader;
alla poster är fortsatt åtkomliga. Normalytor är neutrala.

## Gräns före implementation

ADR-0045:s FIXED-klass, xorshift32-fisher-yates-v1, seed, roster/sourceHash,
versionsgrund och atomära sparande ändras inte. ADR-0088:s gemensamma
adminväg är orörd. Befintlig separat credential/cookie/CSRF, timeout,
fryst preview/request-id och uttrycklig same-id-retry bevaras. Varken
resultat eller publicerade startlistor ändras automatiskt. Ingen ADR
behövs för presentation inom dessa redan accepterade gränser.

Filägare: en befintlig Sol-agent äger komponenten, sidan,
class-start-draw-sv.ts och en avgränsad TASK267-sektion i globals.css.
Huvudagenten äger granskning, en syntetisk browserkontroll i befintlig
harness, dokumentation och slutverifiering. Ingen överlappande skrivning.

## Acceptans

- Neutral sidkrom, mindre rubriker, kort svensk förklaring av enkel
  minutstartslottning och befintliga tiders/publiceringars konsekvens.
- Klassval, första explicit offsetbundna starttid, intervall och seed
  grupperas på desktop; aktuellt underlag visar version och tidszon.
- Förhandsgranskning visar klass, antal/ändrade tider, seed, algoritm,
  första start och intervall från samma frysta serverpreview.
- Gamla/nya tider, saknad gammal tid och oförändrade rader syns i tät
  lista. En begränsad lokal scroll håller bekräftelsen åtkomlig även
  för större klasser. Inga deltagare utelämnas eller tidsformat förenklas
  så datum/tidszon går förlorade.
- Mobil 390 px utan sidspill, minst 52 px åtgärder; desktop 1366 px.
  Granskning/retry får fokus utan animation. Osäkert sparutfall är
  textmärkt, fryst och kräver uttrycklig retry. Ingen automatisk skrivning.
- Ett syntetiskt browserfall med större klass, riktade befintliga tester,
  web lint/typecheck/build och E2E-TypeScript/ESLint. Ingen databas eller
  riktig credential behövs för detta presenterande snitt.

## Ingår inte

Ny lottningsalgoritm, klubbseparering, vakans-/startplatsregler,
gemensamma /manage-flödet, servermutation, offline-lottning, fysisk
mobil, fler lopp, stafett, GPS eller SPORTident/USB.

## Genomfört och verifierat

Den separata klasslottningssidan har neutral sidkrom, mindre rubriker och
en kompakt verktygsrad. Klass, första start, intervall och slumpfrö delar
desktoprad; på mobil följer de en ordnad kolumn. Aktuell tävlingsversion
och tidszon visas före parametrarna.

Granskningen visar frysta parametrar, version, klass-id och underlagshash.
Alla deltagare finns i en tät trekolumnig desktoplista med gamla/nya tider;
mobilrader behåller datum, sekunder och offset. Listan är lokalt rullbar,
tangentbordsåtkomlig och textmärkt. Bekräftelse ligger före listan så den
inte försvinner efter en stor klass. Bara ett faktiskt osäkert skrivutfall
får gul, textstödd signal och visar samma begäran-id. Fokus flyttas utan
animation till granskningen. Algoritm, requestfunktioner, versionsgrund,
CSRF, timeout och explicit same-id-retry är oförändrade.

Verifiering efter sista kodändringen:

| Kommando | Exakt resultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/class-start-draw-admin-route-handlers.test.ts src/lib/start-list-time.test.ts` | exit 0, 2 testfiler, 5/5 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.result-finalization-public-link.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-267-class-start-draw-visual.spec.ts tests/e2e/playwright.result-finalization-public-link.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.result-finalization-public-link.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.result-finalization-public-link.config.ts --grep TASK267` | exit 0, 1/1 Chromiumfall vid 390/1366 px, 7,3 s |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-build och offline-appskal byggda |

Browserfallet använder 60 kontraktsvaliderade syntetiska deltagare,
inklusive oförändrade tider och saknad gammal tid. Alla API-anrop avlyssnas.
Det provar åtkomst till sista raden via lokal scroll, synlig bekräftelse
och retry, oförlorat datum/offset, exakt fryst POST-body, byteidentisk
retry-nyckel/body och accepterad simulerad kvittens. Ingen ny preview eller
Web Storage används vid retry. Fyra bilder granskades: desktopform,
desktoppreview, mobilpreview och mobilretry. Den första gröna körningen
visade två onödiga verktygsrader; dessa slogs ihop och slutkörningens
desktopform granskades igen. Det äldre PostgreSQL-beroende TASK006U-
browserfallet kördes inte; dess åtgärdstexter och deltagar-heading behölls.

## Kvarvarande antaganden

- Oförändrad server-/lottningspolicy används. Syntetiska API-svar och
  kvittens bevisar klientlayout/retry, inte riktig transaktion eller drift.
- Prov med 60 deltagare är ett layoutprov, inte maxlastbevis för 10 000.
- Fysisk mobil, skärmläsare och regn/solljus/handskar återstår. Ingen
  offline-lottning, riktig credential eller tävlingsdata ingick.

Nästa minsta vertikala uppgift: förtäta den befintliga separata
startlistepubliceringen i samma neutrala språk, med oförändrad explicit
publicering/avpublicering och fryst retry.
