# TASK290: deltagarens tilldelade bana före första resultatet

Status: genomförd och syntetiskt UI-verifierad 2026-10-02.

## Mål och arkitektur

Deltagarens läsläge visar aktuell klasstilldelad bana, version och
kontrollföljd även utan publicerat resultat. Separat från resultatets
historiska bana och kontrolltider; ingen fallback mellan dessa källor.
Rosterns classId/courseVersionId och snapshotVersion anger tilldelningen.
Befintlig MANAGE_RACE-skyddad course-control-geometries-GET ger exakta
banversioner och kontrollförekomster. Ingen ny API, domänregel, dependency
eller teknik krävs; ingen ADR behövs.

## Acceptans

- Liten platt sektion i INFO mellan deltagarfakta och resultat, med
  svensk rubrik, version och numrerad kontrollföljd. Inga kartor/geometrier.
- Matcha raceId och exakt courseVersionId/name/version; ingen namngissning.
  Bevara upprepade koder, sortera på sequence och behåll förekomst-ID.
- Validera svarskontrakt och avvisa duplicerade förekomst-ID/ordningsnummer.
  Saknad/motsägande version blir synligt läsfel, aldrig historisk fallback.
- Tilldelningens snapshot och separat kontrolläsning är tydliga;
  ingen atomisk aktuellt-snapshotgaranti påstås eftersom GET saknar sådan.
- Avbryt gamla anrop vid lopp-/version-/snapshotbyte/unmount; visa aldrig
  tidigare version i ny kontext. Bara vald kurs lagras i komponentstate.
- 401/403 rensar via arbetsytans befintliga lock(). Timeout/nätfel visar
  fel utan gammal kontrollföljd, manuell retry med 44 px tryckyta.
- Ingen implicit edit, publicering eller extra läsning per likadan
  person om samma tilldelningskontext behålls.

## Verifiering

Utöka befintligt TASK281/283-browserfall för skilda aktuell/historisk
bana, före-resultat, upprepade kontroller, saknad version/nätfel och
sessionrensning. Riktad web/E2E-lint/typecheck/build; ingen ny svit/DB.
Ingen fysisk mobil, riktig avläsning eller banregeländring ingår.

## Genomfört

Sol-agenten gjorde `RaceParticipantCourse` och monterade den bara i INFO,
mellan fakta och resultat. En liten platt desktopsektion visar läst
tilldelning, version och numrerade kontrollförekomster. Mobil behåller
befintlig responsiv panel och 44 px läsknapp. Historiska resultatkontroller
ändrades inte. Ingen karta, geometriposition eller alternativ fallback.

Effektens kontext innehåller race/snapshot/class/courseId/name/version.
Svar valideras mot befintligt kontrakt och exakt kontext. En enda match
krävs; unika förekomst-ID och sammanhängande ordning kontrolleras efter
sortering. Upprepade koder behålls. Bara matchad kurs lagras. Abort,
15s timeout och redirect-error hindrar gamla anrop från att ge nya
kontroller; retry rensar först. 401/403 anropar befintligt stabilt lock().
Huvudagenten rättade en strikt TypeScript-arrayguard och timeoutens
abort-/returkant efter kodgranskning. Ingen server-/domän-/authändring.

## Exakta kontroller

- `CI=true pnpm --filter @o-tid/web lint`: exit 0 slutligen.
- `CI=true pnpm --filter @o-tid/web typecheck`: exit 0 slutligen.
  Första körningen exit 2: otillräcklig typnarrowing för matches[0], rättad
  med uttrycklig existenskontroll, inte non-null-cast.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json`: exit 0.
- `CI=true pnpm exec eslint tests/e2e/task-167-payment-filter.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.task167-payment-filter.json"}'`: exit 0.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK290`:
  slutligen exit 0, **1/1 på8,8 s**. Två körningar av samma fall;
  första exit 1 efter45s när det tillagda teststeget försökte välja en
  person innan återgång till mobilens listpanel. Testnavigeringen rättades.
- `CI=true pnpm --filter @o-tid/web build`: exit 0, Next16.3.3,
  22 statiska sidor.

TASK281/283:s enda browserfall utökades: aktuell tilldelad version2
med omvänt levererade kontroller31/44/31 visas i rätt ordning, skild
från historisk Långbanan31/32/33. Samma bana finns för David utan
publicerat resultat. Saknad version och503 visar fel utan kontroller;
403 rensar personer/arbetsyta. Noll skrivningar. Tidigare INFO-/klassval/
scrollkontext passerade. Bilder vid390/1280 px granskades. Ingen ny
testsvit, PostgreSQL, riktig credential eller hårdvara användes.

## Kvarvarande antaganden

- GET saknar snapshotVersion: detta är tilldelning från roster och en
  separat kontrolläsning, inte en atomisk garanti för senaste serverläge.
- 15s timeout, fördröjt svar vid kontextbyte och duplicerade förekomster
  granskas i koden, men fick inga separata browserfall i detta snitt.
- Kontraktets gräns på100 kursversioner är befintlig. Mycket stora lopp
  kan ge läsfel; ingen paginering eller API-expansion infördes här.
- Fysisk mobil, skärmläsare och denna nya vy mot riktig DB är inte provade.
- Identiska personval med samma kontext återanvänder komponentstate;
  byte till annan åtgärd/unmount ger ny läsning när INFO öppnas igen.

Nästa minsta vertikala uppgift: verifiera tilldelad bana före resultat
och skild historisk bana efter klassbyte i ett befintligt isolerat
PostgreSQL-browserflöde. Ingen ny svit eller ändring av resultatrevisioner.
