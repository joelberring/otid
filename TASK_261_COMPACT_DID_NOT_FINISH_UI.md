# TASK261: kompakt neutral vy för Ej fullföljt

Status: genomförd 2026-09-27.

## Användarutfall

Målpersonal ska snabbt kunna hitta deltagare vars aktuella tekniska resultat
kan markeras som Ej fullföljt, och förstå varför andra inte kan väljas.
Desktop visar en tät lista; mobil visar samma beslutsunderlag i prioriterad
ordning utan sidspill. Vardagsläget är grått/vitt och signalfärg reserveras
för beslutets konsekvens, fel och okänt skrivutfall.

## Gräns före implementation

ADR-0033:s separata `DECIDE_DID_NOT_FINISH`-behörighet, exakta publicerade
OK/MP-target, status-only DNF, fryst intent, tvåstegsbekräftelse, CSRF och
same-id-retry ändras inte. Ingen automatisk DNF-klassificering införs. Rawdata,
tekniska revisioner, stationens offlinekö, resultatmotor och gemensam
administratörsvy ändras inte. Ingen dependency, migration, API eller
domänregel tillkommer; ingen ny ADR behövs.

## Riktad acceptans

- Låg neutral status för internet, session och antal beslutsbara kandidater,
  samt synlig men kort behörighets- och konsekvenstext.
- Täta rader för deltagare, klubb, klass, deltagarversion, exakt teknisk
  targetrevision och beredskap/blockeringsskäl. Blockerade kandidater ska
  fortsatt synas men ha disabled åtgärd; text bär betydelsen utan färg.
- Fryst granskningspanel visar deltagare, klass, target och snapshot före
  POST. Okänd commit och återautentisering förblir skilda; bara uttrycklig
  byteidentisk same-id-retry är möjlig.
- Riktat UI-/klientprov och ett syntetiskt browserfall vid 390/1366 px,
  plus berörd lint/typecheck/build. Ingen verklig databas eller credential.

## Ingår inte

Ingen ändring i DNF-beslutets lagring, återtagande, gemensam
administratörsvy, resultatmotor, offlineavläsning eller fysisk
enhetsacceptans.

## Genomfört och verifierat

Den separata DNF-vyn har nu en låg statusrad för internet, session och antal
beslutsbara deltagare. Desktop visar täta rader; mobilen visar samma namn,
klubb, klass, deltagarversion, tekniska revision och blockeringsskäl utan
sidspill. Tekniska orsaker och nyckeltext är på svenska. När en kandidat
väljs flyttas fokus till den frysta bekräftelsen; efter osäker commit till
den separata same-id-retry-panelen. Backend och beslutsmodell ändrades inte.

Riktade UI-/klientprov: **5/5**. Syntetiskt Chromiumprov: **1/1** vid
390/1366 px, med normalvy, bekräftelse och retry. E2E-TypeScript,
E2E-ESLint, webblint, webbtypecheck och webbbuild: **exit 0**.
Skärmbilder granskades. Första browserstarten nekades lokal port av
sandlådan (`EPERM`); första tillåtna körningen avslöjade att bekräftelsen
hamnade utanför mobilens synfält. Efter fokus-/scrollkorrigering passerade
omkörningen. Det äldre PostgreSQL-beroende `task-001`-provet kördes inte;
ingen verklig credential, fysisk mobil eller hårdvara användes.
