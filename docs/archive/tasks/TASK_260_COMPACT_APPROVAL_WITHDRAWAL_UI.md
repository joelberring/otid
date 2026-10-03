# TASK260: kompakt neutral återtagning av resultatgodkännande

Status: genomförd 2026-09-27.

## Användarutfall

Målpersonal ska snabbt hitta aktiva manuella godkännanden som kan återtas,
se exakt vilket underliggande OK/MP-resultat som då återställs och förstå
varför ett historiskt beslut inte är valbart. Desktop ska vara en tät,
tydligt kolumnindelad lista. Mobilen ska visa samma fakta i prioriterad
ordning utan sidspill. Grå/vit yta bär vardagsläget; signalfärg reserveras
för beslutets konsekvens, fel och osäker commit.

## Gräns före implementation

ADR-0032:s separata `WITHDRAW_RESULT_APPROVAL`-behörighet, exakta
underliggande källa och absoluta revisionshuvud, fryst intent,
tvåstegsbekräftelse, CSRF och same-id-retry ändras inte. Återtagandet
appenderar en restaureringsrevision; UI väljer aldrig en ny källa tyst.
Stationens offlinekö, rådata, resultatmotor och shared admin ändras inte.
Ingen teknik, dependency, migration, API eller domänregel införs; ingen ny
ADR behövs.

## Riktad acceptans

- Låg neutral status för internet, session och antal återtagbara beslut,
  samt synlig men kort behörighets- och konsekvenstext.
- Täta rader för deltagare, klubb, klass, deltagarversion,
  godkännanderevision, absolut huvud, exakt restaureringskälla och status.
  Redan återtagna beslut syns som historik med disabled åtgärd; text bär
  betydelsen utan färgberoende.
- Fryst granskningspanel visar deltagare, klass, källa och snapshot före
  POST. Osäker commit och återautentisering hålls åtskilda; bara uttrycklig
  byteidentisk same-id-retry är möjlig.
- Riktat UI-/klientprov och ett syntetiskt browserfall vid 390/1366 px,
  plus berörd lint/typecheck/build. Ingen verklig databas eller credential.

## Ingår inte

Ingen ändring i skapandet av godkännande, gemensam administratörsvy,
resultatmotor, offlineavläsning eller fysisk enhetsacceptans.

## Genomfört och verifierat

Den separata återtagningsvyn har en låg statusrad och täta beslutsrader på
desktop. Mobilen prioriterar samma fakta utan sidspill. Redan återtagna beslut
är fortsatt läsbara men inte valbara. En fryst bekräftelse visar absolut
revisionshuvud och exakt underliggande OK/MP-källa före POST. Vid okänt
skrivutfall syns en separat, uttrycklig same-id-retry. Inloggningstexten
använder »återtagningsnyckel« utan intern credentialterminologi.

Riktade UI-/klientprov: **6/6**. Syntetiskt Chromiumprov: **1/1** vid
390/1366 px, med kontroll av normalvy, bekräftelse och retry. E2E-TypeScript,
E2E-ESLint, webblint, webbtypecheck och webbbuild: **exit 0**. Skärmbilder
granskades efter kolumn- och knappjustering. Det äldre PostgreSQL-beroende
`task-001`-browserprovet kördes inte; ingen verklig credential, fysisk mobil
eller hårdvara användes.
