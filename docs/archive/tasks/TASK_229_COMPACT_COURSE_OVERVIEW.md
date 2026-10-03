# TASK229: kompakt banöversikt med kontrollföljd på begäran

Status: implementerad och syntetiskt UI-verifierad 2026-09-27.

## Användarutfall

I `Före tävlingen` → `Banor` ska en funktionär kunna överblicka många
banor utan att varje banas hela kontrollföljd fyller skärmen. Det ska
fortfarande vara lätt att granska exakt kontrollordning och upprepade
kontroller på vald bana.

## Avgränsning

Behåll befintlig lista och semantiska kursrubriker men gör varje bana
till en kompakt expanderbar rad. I stängt läge visas banans namn,
version, kopplade klasser och antal kontroller; den fullständiga
sorterade kontrollföljden visas först när just den raden öppnas.
Upprepade kontrollkoder och ordningsnummer får inte döljas eller
fabriceras. Varning om saknad tilldelad banversion ska
synas före listan, inte efter en lång lista. Minst 44 px tryckyta på
mobil, neutral tätt satt layout och ingen färg utan stödjande text.

Detta ändrar endast presentation av redan hämtad baninformation. Ingen
API-, databasskrivning, domänregel, behörighet eller teknik ändras;
ingen ADR krävs. Ingen OMAP, GPS, stafett eller riktig tävling ingår.

## Riktad acceptans

Använd syntetiskt underlag med 12 banversioner, 60 klasser och ungefär
500 deltagare vid 390 × 844 och 1280 × 800. Alla 12 banor ska gå att
skanna i stängt läge utan att 18-kontrollsföljderna visas. Öppna en
bana och verifiera exakt ordning, inklusive en upprepad kontrollkod;
övriga banor förblir kompakta. Verifiera att klasskopplingarna och
kontrollantalet finns i stängt läge, att saknad banversion varnar ovanför
listan och att inget horisontellt
sidspill uppstår. Riktad webblint/typecheck/build och ett syntetiskt
browserfall räcker; ingen bred testsuite.

Det validerade `adminCourseControlGeometryStateResponseSchema` kräver minst
en kontroll per levererad bana. En syntetisk bana med noll kontroller
avvisades av kontraktet före browserprovet. Noll-kontrollstillståndet i
komponenten är därför en defensiv vy, inte ett accepterat API-fall;
detta snitt ändrar inte kontraktet eller serverns urval.

## Utfall

Tolv banor visas som tunna expanderbara rader med namn, version,
klasskoppling och kontrollantal i stängt läge. Den exakta ordnade
kontrollföljden visas bara för öppnad bana. Varning om saknad tilldelad
banversion ligger före listan med en smal signalfärg och stödjande text.
Den befintliga yttre listan och banrubrikerna är kvar.

Webblint/typecheck, E2E-TypeScript/ESLint, checkin-förberedelse och
web-build gav **exit 0**. Två syntetiska browserfall passerade **1/1
vardera, exit 0**: ett med 12 banor/60 klasser/500 deltagare vid
390 × 844 och 1280 × 800, ett äldre arbetsflöde som använder Banor.
Provet kontrollerade 44 px tryckyta, stängda rader, klasskoppling,
kontrollantal, exakt ordning med upprepad kod, saknad version före listan
och inget horisontellt sidspill. Bilder i stängt och öppet läge granskades.

Det första försöket att skapa en syntetisk noll-kontrollbana gav
**exit 1 före testinsamling** eftersom kontraktets minimiantal är 1;
testunderlaget rättades utan domän- eller API-ändring. Ingen verklig
tävling, databasskrivning, OMAP, fysisk enhet eller funktionärsacceptans
ingick. Långa verkliga ban-/klassnamn och större kursmängder än provets
tolv återstår som layoutantaganden.
