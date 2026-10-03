# TASK296 – från klassantal till deltagarlista

## Avgränsning

Klassöversiktens registrerade antal öppnar befintlig deltagartabell med
exakt klassfilter. Kapacitetsgräns visas fortsatt separat, inte som antal
deltagare. Ingen ny API, databas-/resultatregel eller ADR behövs.

## Acceptans

- Neutral kompakt antalåtgärd med exakt klass-ID och svensk åtkomstetikett.
- Gamla namn-/klass-/resultat-/betalnings-/hyrbricke-/saknad-starttid-filter
  rensas så att hela klassens redan hämtade underlag visas.
- Mobil visar LIST-panelen och fokus flyttas till listan även på dator.
- Tom klass visar korrekt tomt klassurval; inget antal eller status fabriceras.
- Pågående skrivflöde spärrar navigation; inga skrivbegäranden från hoppet.
- 44 px tryckyta utan högre normala desktoprader.
- Återanvänd endast befintligt TASK227/TASK295-browserfall.

## Verifiering

- `CI=true pnpm --filter @o-tid/web lint`: exit 0.
- `CI=true pnpm --filter @o-tid/web typecheck`: exit 0.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json`: exit 0.
- Riktad ESLint för `tests/e2e/task-227-class-finder.spec.ts` med samma
  E2E-tsconfig: exit 0.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK296`:
  exit 0, 1/1 browserfall, 18,0 s. Återanvänt fall, ingen ny svit.
- `CI=true pnpm --filter @o-tid/web build`: exit 0, Next16.3.3,
  22/22 statiska sidor genererade.

390/1280 px med syntetiska API-svar: exakt klass31/60, rensad sökning och
saknad-starttid-filter, listfokus, rensat personval och 44 px mål/normal
desktoprad högst50 px. Desktopbild granskad: neutral gråvit bas och
diskreta inlineåtgärder; ingen större statusruta tillagd.

Kodgranskning: övriga specialfilter nollställs explicit. Tom klass använder
befintlig tomlista men saknar eget browserfixture. Ingen verklig databas,
credential eller tävlingsdata användes. Fysisk mobil, full serverauktorisering
och funktionärsacceptans är inte verifierade av detta UI-prov.

Nästa minsta uppgift: granska det befintliga deltagarkortets informationstäthet
vid390/1280 px med samma neutrala språk; ingen ny domänfunktion.
