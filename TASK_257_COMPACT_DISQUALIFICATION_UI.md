# TASK257: kompakt neutral separat diskvalifikationsvy

Status: genomförd 2026-09-27.

## Användarutfall

Målpersonal ska snabbt kunna hitta aktuella OK/MP-resultat som kan
diskvalificeras, se varför andra deltagare är blockerade och kontrollera
exakt källrevision före ett separat bekräftelsesteg. Desktop ska vara
informationstät och mobil ska vara tydlig utan sidspill eller stora
permanenta varningsrutor.

## Gräns före implementation

ADR-0031:s separata `DISQUALIFY_RESULT`-behörighet, frysta
revisionsintent, tvåstegsbekräftelse, CSRF och same-id-retry ändras
inte. Ett DSQ skapar en immutable resultatrevision men skriver aldrig om
kortdata eller stationens offlinekö. Resultat- och rankningsregler
stannar i domän/application; detta UI-snitt får inte implementera dem.
Ingen teknik, dependency, migration, API eller domänregel införs;
ingen ny ADR behövs.

## Riktad acceptans

- Låg neutral status för internet, session och beslutsbara kandidater.
  Permanent behörighets-/konsekvenstext hålls synlig men kompakt.
- Täta rader med namn, klubb, klass, deltagarversion, beredskap och
  blockeringsskäl, exakt targetstatus/revision och åtgärd. Blockerade
  åtgärder är både visuellt och semantiskt disabled. Text bär alltid
  betydelsen; röd/gul används sparsamt för betydelsefulla beslut/fel.
- Fryst granskningspanel med deltagare, klass, targetstatus/revision och
  snapshot före POST. Okänd commit och återautentisering förblir skilda
  från bekräftelsen och får endast explicit byteidentisk retry.
- En riktad UI-/klientkontroll och ett syntetiskt browserfall vid
  390/1366 px, plus berörd lint/typecheck/build. Ingen verklig
  databas eller credential.

## Ingår inte

Ingen ändring i gemensam administratörsvy, DSQ-återtagande,
resultatmotor, offlineavläsning eller fysisk enhetsacceptans.

## Genomfört

Den separata diskvalifikationsvyn har en låg, neutral rad för internet,
session och beslutsbara kandidater. Deltagare, källrevision och
blockeringsskäl ligger i täta rader på desktop och ordnad mobilvy utan
sidspill. Endast beslutsbara OK/MP-resultat kan väljas. Formuläret använder
ordet »diskvalifikationsnyckel« i stället för intern credentialterminologi.
Fryst granskning föregår POST; vid osäker commit visas explicit samma-id-retry
utan automatisk omsändning. Behörighet, mutation och resultatlogik är
oförändrade.

## Verifiering

- UI-/klientprov: 2 testfiler, 6/6 godkända.
- Syntetiskt Chromiumfall: 1/1 godkänt vid 390 och 1366 px; normalvy,
  bekräftelse och retry granskade som skärmbilder.
- Riktad E2E-TypeScript och ESLint: exit 0.
- Webblint, web-typecheck och web-build: exit 0 vardera.

Ingen PostgreSQL, verklig credential, fysisk mobil eller hårdvara provades.
Det äldre databasberoende `task-001`-browserprovet kördes inte.
