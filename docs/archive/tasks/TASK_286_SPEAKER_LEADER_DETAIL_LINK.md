# TASK286: exakt publik deltagardetalj från klassledare

Status: genomförd och syntetiskt UI-verifierad 2026-10-01.

## Mål och gräns

Speakern ska kunna öppna en publik klassledares redan publicerade
deltagarresultat och sträcktider via en liten länk i befintligt namn.
Länken använder exakt raceId/publicResultId i befintlig publik route;
ingen privat feedrad kopplas via namn, slot eller klassnamn.

## Acceptans

- Namnet länkar i desktoptabell och mobilrad till befintlig publik
  deltagardetalj, utan ny kolumn, knapp, ikon eller färgkodning.
- Tillgänglig länktext beskriver ”Visa publicerat resultat för …”.
  Länken är läsande, har tydligt fokus/understrykning och mobiltryckyta.
- Öppna separat flik med noopener/noreferrer så speakerurval, term och
  källa bevaras. Texten förklarar ny flik; ingen automatisk förhämtning.
- Privat feed får inga namn-/identitetsgissade länkar. Sessionfel
  rensar ledaruppgifter/länkar enligt befintlig grind.
- Utöka samma TASK284/285-browserfall för exakta hrefs, mobil-/desktop-
  länkar och frånvaro av privata personlänkar. Riktad webb-/E2E-lint,
  typkontroll och build. Ingen ny DB- eller resultattestsvit.

## Arkitektur

Publik route och publicResultId finns redan. Ingen API, resultatlogik,
domängräns, behörighet eller teknik ändras; ingen ny ADR behövs.
Detaljens egna publicerings-/404-regler är oförändrade. Nytt konto,
publik publicering, stafett, GPS och USB ingår inte.

## Genomfört

En Sol-agent ändrade de tre befintliga speaker-/CSS-/i18n-filerna.
Namnen i publika ledartabellen och mobilens listor länkar nu till
exakt kodad raceId/publicResultId. Next Link har `prefetch={false}`,
`target="_blank"` och `rel="noopener noreferrer"`. En kort förklaring
om ny flik ligger i befintlig källnotis. Länkarna är neutrala och
understrukna med fokusmarkering; mobilens tryckyta är minst 44 px.
Den privata listan, källornas lästid, filtrering och 403-rensning
är oförändrade. Ingen extra kolumn, färg eller behörighet tillkom.

## Exakta kontroller

- `CI=true pnpm --filter @o-tid/web lint`: exit 0.
- `CI=true pnpm --filter @o-tid/web typecheck`: exit 0.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json`: exit 0.
- `CI=true pnpm exec eslint tests/e2e/task-167-payment-filter.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.task167-payment-filter.json"}'`: exit 0.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK286`: exit 0, 1/1 på 6,2 s; en körning.
- `CI=true pnpm --filter @o-tid/web build`: exit 0, Next 16.3.3, 22 statiska sidor.

Samma enda TASK284/285-fall utökades med exakta hrefs, separat flik,
rel-attribut, mobilens tryckyta och frånvaro av privata personlänkar.
Tidigare assertions för filter, skilda källor, statusfärger och
sessionsrensning passerade också. Bilder vid 1280/390 px granskades.
Testets globala avvikelsevarning beror på avsiktligt syntetiska 404-svar
för andra arbetsytor; den är inte bevis för ett fel i verklig tävling.
Ingen ny svit, databas, riktig credential eller hårdvara användes.

## Kvarvarande antaganden

- Browserprovet kontrollerar länkens presentation och destination,
  inte laddning av deltagardetalj mot riktig PostgreSQL. Befintlig
  publik route och dess publicerings-/404-gräns granskades i koden.
- En äldre ledarögonblicksbild kan länka till ett återkallat resultat;
  detaljens befintliga 404 gäller, utan privat fallback.
- Fysisk mobil, skärmläsare och extrema namn är inte fältverifierade.
- Automatisk polling återprovas inte när detta fall har pausad klocka.

Nästa minsta vertikala uppgift: verifiera just speakerlänk → publicerad
deltagardetalj/sträcktider i ett befintligt browserflöde mot uttryckligen
isolerad syntetisk PostgreSQL, inklusive återkallat resultat utan privat
fallback. Ingen bred resultat- eller hårdvarusvit.
