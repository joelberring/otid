# TASK259: kompakt neutral vy för manuellt resultatgodkännande

Status: genomförd 2026-09-27.

## Användarutfall

Målpersonal ska snabbt hitta tidskompletta MP-resultat som kan godkännas,
se varför andra resultat inte kan väljas och kontrollera exakt källrevision
före ett separat beslut. Desktop ska ha tät tabell med tydliga kolumner;
mobil ska visa samma fakta i läsbar ordning och utan sidspill. Vardagsläget
ska vara grått/vitt och diskret, medan signalfärg används sparsamt med text
vid konsekvens, fel och osäkert skrivutfall.

## Gräns före implementation

ADR-0032:s `APPROVE_RESULT`-behörighet, krav på tidskomplett tekniskt MP,
fryst revisionsintent, tvåstegsbekräftelse, CSRF och same-id-retry ändras
inte. Ett godkännande blir rankbart OK men ändrar inte rådata, stämplingar
eller stationens offlinekö. Resultatpolicy stannar i domain/application.
Ingen teknik, dependency, migration, API eller domänregel införs; ingen ny
ADR behövs.

## Riktad acceptans

- Låg neutral status för internet, session och antal beslutsbara kandidater,
  med synlig men kompakt separat behörighets- och konsekvenstext.
- Täta rader för namn, klubb, klass, deltagarversion, beredskap och exakt
  MP-källrevision/orsak. Blockerade rader har begripligt skäl och disabled
  åtgärd; text bär alltid betydelsen.
- Fryst granskningspanel visar deltagare, klass, MP-orsak/revision och
  snapshot före POST. Okänd commit och återautentisering hålls skilda,
  utan automatisk omsändning; explicit retry använder samma begäran.
- Riktat UI-/klientprov och ett syntetiskt browserfall vid 390/1366 px,
  plus berörd lint/typecheck/build. Ingen verklig databas eller credential.

## Ingår inte

Ingen ändring i gemensam administratörsvy, återtagande av godkännande,
resultatmotor, offlineavläsning eller fysisk enhetsacceptans.

## Genomfört

Den separata godkännandevyn visar internet, session och antal beslutsbara
kandidater i en låg statusrad. Desktop har en tät tabell; mobilen visar samma
fakta i läsbar ordning utan sidspill och med 52 px åtgärder. READY-rader
visar exakt MP-revision och svensk orsak; blockerade rader visar textskäl
och disabled åtgärd. Rubriken »Resultat och godkännandestatus« omfattar
både valbara och blockerade rader. Behörighet och konsekvens syns kompakt
utan permanent signalfärg; gul accent används vid bekräftelse och osäker
retry. Inloggningen använder »godkännandenyckel« i stället för intern
credentialterminologi. Fryst granskning föregår POST, och same-id-retry
kräver ett uttryckligt val. Inga backend-, kontrakts- eller domänändringar.

## Verifiering

- Riktade UI-/klientprov: 2 testfiler, 5/5 godkända.
- Syntetiskt Chromiumfall: 1/1 godkänt vid 390 och 1366 px; normalvy,
  bekräftelse och retry granskade som skärmbilder. Ingen POST före
  bekräftelse; retry använder byteidentisk begäran.
- Riktad E2E-TypeScript och ESLint: exit 0.
- Webblint, web-typecheck och web-build: exit 0 vardera.

Det äldre PostgreSQL-beroende `task-001`-browserprovet kördes inte; dess
ändrade textankare är därför inte verifierade mot server och databas.
Ingen verklig credential, fysisk mobil eller hårdvara ingick.
