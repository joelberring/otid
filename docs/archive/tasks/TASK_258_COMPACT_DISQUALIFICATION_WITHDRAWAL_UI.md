# TASK258: kompakt neutral återtagning av diskvalifikation

Status: genomförd 2026-09-27.

## Användarutfall

Målpersonal ska kunna överblicka vilka manuella DSQ-beslut som kan återtas,
se det exakta underliggande OK/MP-resultatet som i så fall återställs och
förstå när ett historiskt beslut inte längre är valbart. Desktop ska ge tät
information utan stora kort; mobil ska ha samma beslutsinformation i läsbar
ordning och utan sidspill. Grå/vit yta bär vardagsläget; signalfärg reserveras
för konsekvens, fel och osäker commit.

## Gräns före implementation

ADR-0031:s separata `WITHDRAW_DISQUALIFICATION`-behörighet, frysta
revisionsintent, tvåstegsbekräftelse, CSRF och same-id-retry ändras inte.
Återtagande appenderar en exakt restaureringsrevision; UI får varken välja
annan källa tyst eller räkna om resultat. Stationens offlineväg berörs inte.
Ingen teknik, dependency, migration, API eller domänregel införs och därför
behövs ingen ny ADR.

## Riktad acceptans

- Låg neutral status för internet, session och antal valbara beslut, med
  separat och textmärkt konsekvens för åtgärden.
- Täta rader för deltagare, klubb, klass, deltagarversion, DSQ-revision,
  absolut huvud, restaureringskälla och valbarhet. Redan återtagna beslut
  syns som historik med disabled åtgärd; betydelse bärs av text, inte färg.
- Fryst granskningspanel visar deltagare, klass, restaureringskälla och
  snapshot före POST. Osäker commit och återautentisering hålls åtskilda;
  bara explicit, byteidentisk same-id-retry tillåts.
- Riktat UI-/klientprov och ett syntetiskt browserfall vid 390/1366 px,
  plus berörd lint/typecheck/build. Ingen verklig databas eller credential.

## Ingår inte

Ingen ändring i gemensam administratörsvy, DSQ-beslut, resultatmotor,
offlineavläsning eller fysisk enhetsacceptans.

## Genomfört

Den separata vyn visar internet, session och antal återtagbara beslut i en
låg neutral statusrad. En tät desktoplista och ordnad mobilvy visar namn,
klubb, klass, deltagarversion, DSQ-revision, absolut huvud och exakt
restaureringskälla. Redan återtagna beslut förblir synliga som historik och
har disabled åtgärd. Den permanenta behörighetstexten är kort men
fortfarande synlig. Inloggningen använder användarordet »återtagningsnyckel«.
Fryst bekräftelse och explicit same-id-retry får fokus och syns på mobil.
Backend, kontrakt och mutationsflöde ändrades inte.

## Verifiering

- Riktade UI-/klientprov: 2 testfiler, 6/6 godkända.
- Syntetiskt Chromiumfall: 1/1 godkänt vid 390 och 1366 px. Normalvy,
  bekräftelse och retry granskade som skärmbilder; ingen POST före
  bekräftelse, och retry använder byteidentisk begäran.
- Riktad E2E-TypeScript och ESLint: exit 0.
- Webblint, web-typecheck och web-build: exit 0 vardera.

Första browserstarten nekades loopbackport av sandlådan (`EPERM`);
isolerad lokal omkörning passerade. Det äldre PostgreSQL-beroende
`task-001`-browserprovet kördes inte; dess ändrade label-locator är därför
inte verifierad mot server och databas. Ingen verklig credential, fysisk
mobil eller hårdvara ingick.
