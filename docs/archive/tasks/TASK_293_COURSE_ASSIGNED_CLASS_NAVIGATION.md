# TASK293 – från bana till klassupplägg

## Avgränsning

Gör banöversiktens tilldelade klassnamn handlingsbara med exakta klass-ID:n.
Återanvänd befintlig läsande klassnavigering och återgång till Banor.
Ingen ny sida, API, databasregel, automatisk ändring eller ADR behövs.

## Acceptans

- Klassnamn öppnar exakt befintlig klasspost, även med likalydande namn.
- Befintlig återgång till Banor fungerar och kritiska varningar bevaras.
- Läsande navigation är spärrad under pågående skrivflöde.
- Neutral kompakt presentation, externaliserad svenska och minst44 px
  tryckyta. Inga interaktiva klassknappar inuti banans disclosure-summary.
- Återanvänd befintligt TASK227/TASK231-browserfall, ingen ny svit.

## Verifiering

Klart 2026-10-02. Sol-agent implementerade, huvudagent granskade, körde
kontrollerna och granskade mobil-/datorbilder.

Tilldelade klassnamn är neutrala ID-bundna knappar utanför disclosure-summary.
Likalydande klassnamn får synligt radnummer; inga interna ID:n visas.
Klassvyn markerar/fokuserar rätt post och befintliga klassväljare för
deltagargräns/startupplägg förifylls, utan skrivbegäran. Normal navigation
har neutral kontext, medan tidigare saknad-bana-varning behåller sin
separata text. Återgång till Banor behåller befintligt fokusflöde.

På breda skärmar (från1000 px) ligger stängd bana och klassnamn på en
gemensam kompakt rad; öppen kontrollföljd använder full bredd. Mobilen
radbryter. Summary och klassknappar behåller minst44 px tryckyta.

Exakta resultat:

- `CI=true pnpm --filter @o-tid/web lint`: exit 0.
- `CI=true pnpm --filter @o-tid/web typecheck`: exit 0.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json`: exit 0, även efter sista teständringen.
- Riktad ESLint av `tests/e2e/task-227-class-finder.spec.ts` med samma
  E2E-tsconfig: exit 0, även efter sista teständringen.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK293`:
  första exit1 (desktopsummary33,14 px, tidigare flerradig text maskerade
  en befintlig CSS-specificitetskonflikt). Lokal CSS rättades. Andra1/1
  på14,5 s. Bildgranskning ledde därefter till tätare desktoprad. Slutlig
  tredje körning1/1 på16,1 s, exit0. Samma enda befintliga browserfall;
  ingen ny svit, fixture eller databas.
- `CI=true pnpm --filter @o-tid/web build`: båda exit0, slutligt bygge
  efter desktopförbättring Next16.3.3, 22/22 statiska sidor.
  Kördes separat från browsern.

Browsern verifierar mobil-/datornavigation till exakt klassrad, fokus,
förifyllda klassväljare, återgång, inga klassknappar inne i summary,
stängd desktoprad högst56 px och minst44 px klassknapp, inga länkar under
pågående underlagsläsning samt bevarade befintliga saknad-bana-varningar
och noll oavsiktliga skrivningar.

## Kvarvarande antaganden och nästa snitt

Syntetiska API-svar verifierar UI, inte faktisk serverauktorisering,
fysisk mobil eller fältbruk. Den nya normalnavigeringen provas med unika
klassnamn; befintligt varningsflöde provar likalydande namn. ID-bindningen
och synliga radnummer i normalflödet är kodgranskade, inte en ny fixture.
Nästa minsta snitt: klassöversiktens bannamn öppnar exakt tilldelad
banversion, så att upplägget går att följa i båda riktningar.
