# TASK233: hitta bana eller klass i banöversikten

Status: implementerad och syntetiskt UI-verifierad 2026-09-27.

## Användarutfall

I `Före tävlingen` → `Banor` ska en funktionär kunna hitta en bana
eller dess tilldelade klass utan att bläddra genom en lång lista.
Vyn ska vara lika kompakt och neutral på mobil som på dator.

## Avgränsning

Filtrera enbart de redan lästa, klasskopplade banversionernas
presentationslista lokalt på bannamn eller tilldelat klassnamn,
skiftlägesokänsligt och med trimmad sökfras. Bevara ursprunglig
ordning och exakt `courseVersionId` som listnyckel; ingen identitet
får härledas från namn. Visa ett litet träffantal och begriplig
nollträff. Sökfältet behöver bara uppta plats när listan har minst
åtta banversioner eller en sökfras redan är aktiv. Vid nytt `raceId`
ska tidigare lokal sökning rensas. Den globala varningen om saknade
tilldelade banversioner och uppdatera-knappen får inte filtreras bort
eller påstå att sökningen ändrar tävlingsunderlaget.

Återanvänd befintlig typografi, spacing och fokusmönster. Minst 44 px
tryckyta på mobil. Ingen API-, domän-, databas-, behörighets- eller
teknikändring; ingen ADR krävs. Ingen ändring av bana eller resultat.

## Riktad acceptans

Utöka det befintliga syntetiska browserfallet med tolv banor, sextio
klasser och femhundra deltagare. Prova bannamn, klassnamn, stora/små
bokstäver, tom sökning, nollträff och att varningen fortsätter visa
alla berörda klasser oberoende av filtret. Kontrollera att en öppnad
banas kontrollföljd fortfarande fungerar, vid 390/1280 px utan
sidspill eller ny skrivbegäran. Riktad lint/typecheck/build och ett
återanvänt browserfall räcker.

## Utfall

Banöversikten har nu en liten lokal sökning på bannamn eller namn på
tilldelad klass. Den dyker upp vid åtta eller fler lästa,
klasskopplade banversioner eller när ett sökvärde finns. Träffantal,
nollträff och banordning följer endast listans presentationsfilter;
varningen om saknade tilldelade versioner ligger kvar ofiltrerad.
Sökningen är knuten till loppets ID och rensas när det ändras.

Webblint/typecheck/build, E2E-TypeScript/ESLint och checkin-
förberedelse gav **exit 0**. Ett återanvänt syntetiskt Playwright-
fall passerade **1/1, exit 0** med tolv banor, sextio klasser och
femhundra deltagare: trimmad/skiftlägesokänslig bana- och klassökning,
nollträff, återställd lista, ofiltrerad varning och fortsatt öppningsbar
kontrollföljd. Inga skrivbegäranden eller horisontellt sidspill sågs
vid 390/1280 px. Mobil- och datorbilderna granskades. Nytt `raceId`
är hanterat i komponenten men inte separat browserprovat. Ingen
verklig tävling, fysisk mobil, databasändring eller funktionärsacceptans
ingick. `pnpm`-wrappern försökte installera mot avstängt nät;
kontrollerna kördes med installerade lokala binärer.
