# TASK288: gå från uppläggsöversikt till förberedelsearbete

Status: genomförd och syntetiskt UI-verifierad 2026-10-01.

## Mål

Före → Uppläggs sex arbetssteg ska öppna rätt befintlig arbetsyta:
banor, klasser, deltagare, lottning/starttider, startlista och funktionärer.
Idag är de bara statisk text trots att verktygen finns under separata flikar.
Behåll den lilla numrerade översikten; gör rubriken till neutral textknapp,
inte en ny stor ruta eller extra rad med knappar.

## Gräns och arkitektur

Exakta typade lokala områdesval, samma workflowLocked-spärr som navigation.
Rensa gammal banvarningskontext och flytta tangentbordsfokus till vald
befintlig navigationskontroll när översiktens knapp försvinner. Mobilens
select visar samma val; ingen implicit redigering, import eller publicering.
Ingen ny API, domänregel, dependency, teknik eller ADR behövs. Detta är
navigering till redan implementerade funktioner, inte ny resultatlogik.

## Verifiering

Utöka ett befintligt syntetiskt förberedelsebrowserfall för de sex exakta
valen, fokus, 390/1280 px och inga skrivbegäranden från stegen. Återanvänd
guidekomponentens lilla test för statisk/avstängd presentation. Riktad
webb-/E2E-lint/typecheck och web-build, inga nya sviter eller databastester.

## Genomfört

En Sol-agent lade exakta `area`-värden i de sex stegbeskrivningarna,
en typad callback i guiden och ett lokalt navigeringsval i arbetsytan.
Stegrubrikerna är understrukna neutrala textknappar, minst 44 px höga.
Nummer och befintliga beskrivningar behålls. Stegen visas nu före den
potentiellt långa klasstabellen. Ingen ny ruta, kolumn eller färg tillkom.

Den befintliga workflowLocked-gränsen gäller både knapp och callback.
Gammal banvarningskontext rensas och vald arbetsyta sätts; fokus flyttas
till motsvarande desktopflik eller mobilens befintliga select. Befintliga
COURSES-refs och återgången från klassvarning behålls. Guidens fristående
användning utan callback förblir statisk. Inga redigeringsformulär öppnas
automatiskt; särskilt lottning/publicering kräver sina vanliga explicita
åtgärder efter navigeringen. Ingen import-/behörighetsgräns ändras.

## Exakta kontroller

- `CI=true pnpm --filter @o-tid/web lint`: exit 0.
- `CI=true pnpm --filter @o-tid/web typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/web exec vitest run src/components/race-preparation-guide.test.tsx`:
  exit 0, 1 fil/2 tester, 944 ms totalt. Befintligt låstest utökades
  med sex avstängda steg, inget nytt testfall tillkom.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json`: exit 0.
- `CI=true pnpm exec eslint tests/e2e/task-227-class-finder.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.task167-payment-filter.json"}'`: exit 0.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK288`:
  exit 0, 1/1 på 16,4 s; en körning.
- `CI=true pnpm --filter @o-tid/web build`: exit 0, Next16.3.3,
  22 statiska sidor.

Det befintliga stora förberedelsefallet provar nu alla sex steg via Enter
vid 390/1280 px, exakt valt område, navigationsfokus, minst 44 px och
noll skrivbegäranden. Tidigare klass-/ban-/mobilnavigering passerade
också. Bilder av stegens översikt vid båda bredder granskades. API-svaren
är syntetiska; inget PostgreSQL eller riktig credential användes.

## Kvarvarande antaganden och nästa minsta uppgift

- Detta bevisar navigering, inte färdig lottning, bemanning eller publicering.
- Fysisk mobil/skärmläsare och ovanligt långa översatta rubriker är oprövade.
- Låsskydd verifieras genom komponenttest och guarded callback; ingen
  ny browsersekvens för pågående skrivning tillkom.

Nästa minsta vertikala uppgift: visa antal minutstartsdeltagare utan
fast tid direkt vid ”Planera starten”, från redan hämtat underlag och
utan att kalla resten av upplägget klart. Samma befintliga arbetsyta,
inga automatiska starttider eller ny serverlogik.
