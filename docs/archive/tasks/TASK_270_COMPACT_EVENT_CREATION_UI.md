# TASK270: neutralt och kompakt tävlingsskapande

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Användarutfall och gräns

Arrangören ska förstå vad som skapas, fylla i tävlingens och första loppets
fyra uppgifter utan lång scroll och tydligt se om ett försök är obekräftat.
Normalläget ska följa O-Tids gråvita, täta UI-riktning; signalfärg används
bara vid verkligt osäkert utfall eller frånkoppling och alltid med text.

ADR-0021:s globala, smala CREATE_EVENT-behörighet och atomiska event+lopp,
request-id, idempotency-key, Origin/CSRF, minnesburet intent och explicit
retry ändras inte. ADR-0069:s raceadministration följer separat behörighet;
skapandet ger ingen automatisk åtkomst. Detta snitt är presentation och
kopiering, inte nytt domänbeslut. Ingen ADR eller migration behövs.

En befintlig Sol-agent äger komponent, sida, isolerad TASK270-CSS och
eventCreation*-texter. Huvudagenten äger ett syntetiskt browserfall,
granskning, verifiering och dokumentation. Anropsfunktioner/API/server/
kontrakt ändras inte.

## Acceptans

- Låg sidkrom och tre kompakta statusfält (nät, session, försök), alla med
  text och ikon. På dator samsas namn, första lopp, datum och tidszon i en
  tät form. På mobil är ordningen enkel och handlingar minst 52 px.
- Nyckelinloggning är begriplig utan att dölja att den är personlig och
  separat från loppets administratörsbehörighet.
- Vid okänt skapande syns exakt fryst request-id, tävlingsnamn, loppnamn,
  datum **och tidszon** före knapparna för samma-id-retry och att rensa ett
  ännu obekräftat försök. Bara detta tillstånd får gul textstödd signal.
  Formuläret får inte starta en andra avsikt medan attempt finns.
- Kvitto visar event-/lopp-id och att skapandet inte automatiskt ger
  racebehörighet. Nyckel/intent sparas inte i Web Storage eller URL.
- Browserprov vid 390/1280 px utan sidspill med syntetisk session och
  avbruten första POST följd av byteidentisk explicit retry. Riktade små
  befintliga tester, E2E-TypeScript/ESLint och web lint/typecheck/build.
  Ingen databas, verklig credential eller fysisk tävling.

## Ingår inte

Nytt kontosystem, roller, raceåtkomst, automatisk behörighetsutfärdning,
Eventorimport, offlineskapande, startlottning eller resultatsättning.

## Genomfört och verifierat

Sidan har nu låg neutral rubrik, tre täta textstödda statusfält och ett
fyrfältsformulär i en datorrad, två kolumner på mellanbredd och en kolumn
på mobil. Personlig nyckel har begripligare synlig etikett. Kapabilitetens
smala gräns förklaras fortfarande före formuläret.

Ett obekräftat försök visas före formuläret med exakt fryst request-id,
tävlings-/loppnamn, datum och tidszon. Samma-id-retry/rensning syns före
hjälptexten. Endast obekräftat försök eller utloggning får gul kant;
normalläget och kvittot är gråvita. Vid kvitto får rubriken fokus och
scrollas in utan animation. Det gamla ifyllda formuläret monteras bort:
ett nytt tomt formulär kräver nu ett uttryckligt klick på ”Skapa ytterligare
tävling”. Logga ut finns kvar. Ingen serverpolicy eller begäranfunktion
ändrades.

Verifiering efter sista applikationskodändringen:

| Kommando | Exakt resultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/event-creation-admin-ui.test.tsx src/lib/event-creation-admin-client.test.ts` | exit 0, 2 filer, 12/12 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.result-finalization-public-link.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-270-event-creation-visual.spec.ts tests/e2e/playwright.result-finalization-public-link.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.result-finalization-public-link.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.result-finalization-public-link.config.ts --grep TASK270` | slutkörning exit 0, 1/1 Chromiumfall vid 1280/390 px, 3,0 s |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-produktionsbuild och offline-appskal |

Det enda browserfallet avlyssnar alla `/api/**`-anrop, använder syntetisk
skapandesession och inga hemliga nycklar. Det första POST-svaret bryts,
sedan provar fallet full fryst granskning, spärrad ny avsikt, byteidentisk
explicit retry, synligt kvitto, inget aktivt gammalt formulär och lokal
rensning trots okänt DELETE-svar. Datorform, mobilvarning och mobilkvitto
granskades som bilder. Äldre PostgreSQL-bundet TASK001-browserfall kördes
inte; bara dess etikettlokator ändrades för den nya svenska fälttexten.

Första browserkörningen gav exit 1 av en felaktig testlokator till
formuläret. Nästa gav exit 1 av ett textmönster som skrev ”automatiskt”
där UI:t skrev ”automatisk”. Båda var provfel och rättades. Browsern
passerade därefter, och kvittofokus samt spärr mot oavsiktlig dubblett
förbättrades på grund av mobilbildgranskningen; slutkörningen passerade.

## Kvarvarande antaganden

- Syntetisk session och kvittens verifierar inte CREATE_EVENT-behörighet,
  PostgreSQL-transaktion, verklig CSRF-kontroll eller audit i servern.
- Fysisk mobil, skärmläsare och arrangörsanvändning i fält återstår.
- Skaparnyckeln är fortfarande den av ADR-0021 beslutade separata
  bootstrapbehörigheten. Den är inte samma sak som konto eller raceadmin.

Nästa minsta vertikala uppgift: ge arrangörsstarten för befintliga tävlingar
en lika neutral, tät översikt med tydligt skapandeval, utan ändrat konto-
eller behörighetsflöde.
