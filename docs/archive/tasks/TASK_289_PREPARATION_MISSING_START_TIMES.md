# TASK289: saknade minutstartstider från förberedelseöversikten

Status: genomförd och syntetiskt UI-verifierad 2026-10-01.

## Mål och gräns

Vid ”Planera starten” visas antalet deltagare i lästa FIXED-klasser som
saknar fast starttid, med befintlig `missingFixedStartTime`-predikat.
Fri start och deltagare med fast tid räknas inte. Positivt antal är en
liten textstödd varningslänk till befintlig deltagartabell, filtrerad
på samtliga minutstartsdeltagare utan tid. Noll är neutral text, inte
”tävlingen klar”. Inget globalt godkännande av upplägg eller datatäckning.

Återanvänd samma roster, filter och `openMissingFixedStart`-väg med
tomt klassfilter för alla klasser. Rensa andra filter och behåll samma
workflowLocked/fokusgräns. Ingen extra hämtning, lagring, serverregel,
automatisk lottning eller tidsändring. Ingen API-/teknik-/domängräns
ändras; ingen ADR eller ny dependency behövs.

## Acceptans

- Count och deltagarurval matchar, inklusive flera minutstartsklasser,
  fri start utan tid och minutstart med redan fast tid.
- Mindre ambertext med tydlig svensk beskrivning; neutralt nolläge.
- Exakt befintligt filter, ingen implicit redigering eller skrivning.
- Både knapp och callback spärras under pågående workflow.
- Utöka TASK227/288:s befintliga browserfall och guidekomponenttest,
  inte nya sviter. Riktad web/E2E-lint/typecheck samt build.

Fysisk mobil, databas-/fältacceptans, korrekt genomförd lottning och
fullständig startberedskap ingår inte i detta lokala presentationssnitt.

## Genomfört

Sol-agenten lade en liten textstödd amberlänk vid steget Planera starten.
En klassmap och det befintliga rosterpredikatet ger antal från precis
det lästa underlaget. Nolläge är neutral källkvalificerad text, inte
ett grönt klarbesked. Ingen extra fetch eller automatisk tidsändring.

Länken använder `openMissingFixedStart("")`: gamla klass-/sök-/övriga
filter rensas och samma deltagartabell visar alla minutstartsdeltagare
utan tid. Befintliga klassbundna länkar fungerar fortsatt. Huvudagenten
kompletterade samma väg med fokus till listpanelen även på desktop;
mobilens tidigare panelbyte/fokus behålls. WorkflowLocked spärrar
knappen och callbacks. Inga server-, auth-, schema- eller resultatändringar.

## Exakta kontroller

- `CI=true pnpm --filter @o-tid/web lint`: exit 0 efter slutlig ändring.
- `CI=true pnpm --filter @o-tid/web typecheck`: exit 0 efter slutlig ändring.
- `CI=true pnpm --filter @o-tid/web exec vitest run src/components/race-preparation-guide.test.tsx`:
  exit 0, 1 fil/2 tester, totalt725 ms.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json`: exit 0.
- `CI=true pnpm exec eslint tests/e2e/task-227-class-finder.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.task167-payment-filter.json"}'`: exit 0.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK289`:
  exit 0, 1/1; slutkörning13,8 s. Första körningen passerade12,8 s;
  samma fall återkördes efter desktopfokusrättning, ingen ny svit.
- `CI=true pnpm --filter @o-tid/web build`: exit 0, Next16.3.3,
  22 statiska sidor.

Browserfallet provar åtta saknade tider, övergång till klassfilter ALL,
och två FIXED-klasser med en redan tidsatt deltagare: 15 i både count
och tabell, den redan tidsatta personen utelämnad. Fri start utan tid
räknas inte. Nytt syntetiskt underlag med alla FIXED-tider ger neutral
nolltext utan varningslänk; återgång till ursprungsunderlag visar åter
åtta. Inga skrivbegäranden. Stegen/mobilnavigeringen från TASK288
passerade också. Bilder vid390/1280 px granskades. Ingen PostgreSQL,
riktig credential eller hårdvara användes.

## Kvarvarande antaganden

- Count beskriver bara hämtat underlag, inte serverändringar sedan lästid.
- Noll, även med tomt minutstartunderlag, är inte ett beredskapsbevis.
- Layout på fysisk mobil och isolerad DB-filteracceptans är inte provade.
- Låsskyddet granskas i guarded callback/disabled, men detta nya count-
  klick fick ingen separat pågående-write-browsersekvens.

Nästa minsta vertikala uppgift: visa deltagarens tilldelade bana och
kontrollföljd i läsläget även innan första resultatet finns, skilt från
historisk resultatbana och utan att ändra ban- eller resultatregler.
