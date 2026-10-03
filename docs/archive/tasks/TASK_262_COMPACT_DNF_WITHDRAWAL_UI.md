# TASK262: kompakt neutral återtagning av Ej fullföljt

Status: genomförd 2026-09-27.

## Användarutfall

Målpersonal ska snabbt hitta återtagbara Ej fullföljt-beslut och kunna se
exakt vilket underliggande OK/MP-resultat som återställs. Desktop visar
besluten i täta rader; mobil prioriterar samma fakta utan sidspill. Vardagsytan
är neutral och signalfärg används bara när ett beslut måste granskas eller
ett skrivutfall är osäkert.

## Gräns före implementation

ADR-0034:s separata `WITHDRAW_DID_NOT_FINISH`-behörighet, absolut
revisionshuvud, exakt teknisk restaureringskälla, fryst intent,
tvåstegsbekräftelse, CSRF och same-id-retry ändras inte. Återtagandet
appenderar en restaureringsrevision; UI väljer aldrig om källan tyst.
Stationens offlinekö, rawdata, resultatmotor och gemensam admin ändras inte.
Ingen dependency, migration, API eller domänregel införs; ny ADR behövs inte.

## Riktad acceptans

- Låg neutral status för internet, session och antal återtagbara beslut,
  samt kort behörighets- och konsekvenstext.
- Täta rader för deltagare, klubb, klass, deltagarversion,
  DNF-revision, absolut revisionshuvud, exakt OK/MP-restaureringskälla och
  beslutsstatus. Redan återtagna beslut är läsbara men har disabled åtgärd.
- Fryst granskningspanel visar deltagare, klass, huvud, källa och snapshot
  före POST. Okänd commit och återautentisering förblir skilda; bara
  uttrycklig byteidentisk same-id-retry är möjlig.
- Riktat UI-/klientprov och ett syntetiskt browserfall vid 390/1366 px,
  plus berörd lint/typecheck/build. Ingen verklig databas eller credential.

## Ingår inte

Ingen ändring i skapande av DNF, serverbeslut, resultatrevisioner,
gemensam administratörsvy, offlineavläsning eller fysisk enhetsacceptans.

## Genomfört och verifierat

Den separata återtagningsvyn har en låg statusrad för internet, session och
antal återtagbara beslut. Desktop visar täta rader; mobil visar samma
deltagar-, klass-, revisions-, käll- och beslutsfakta utan sidspill. Redan
återtagna beslut syns som historik med avaktiverad åtgärd. Den frysta
bekräftelsen visar senaste absoluta revision, exakt OK/MP-källa och
tävlingsversion före POST. Osäkert utfall har separat synlig same-id-retry.
Synlig orsak och behörighetskodstext är på svenska; server- och
revisionslogik ändrades inte.

Riktade UI-/klientprov: **5/5**. Syntetiskt Chromiumprov: **1/1** vid
390/1366 px, inklusive normalvy, bekräftelse och retry. E2E-TypeScript,
E2E-ESLint, webblint, webbtypecheck och webbbuild: **exit 0**.
Skärmbilder granskades. Det äldre PostgreSQL-beroende `task-001`-provet
kördes inte; ingen verklig credential, fysisk mobil eller hårdvara användes.
