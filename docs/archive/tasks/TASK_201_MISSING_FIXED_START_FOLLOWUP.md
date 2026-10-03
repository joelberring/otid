# TASK201: från saknad minutstart till rätt deltagare

Status: genomfört och riktat verifierat 2026-09-27.

## Avgränsat användarutfall

I tävlingsöversiktens redan befintliga klasstabell är ett positivt antal
”Minutstart utan fast tid” en direkt åtgärd. Den öppnar deltagarlistan
filtrerad till just den klassen och de deltagare vars fasta starttid saknas.
Urvalet är synligt och kan tas bort utan att tävlingsdata ändras. Operatören
kan därifrån öppna en person och använda den befintliga starttidsrättningen.

Fri start räknas aldrig som saknad tid. Nolltal är läsbar information men
ingen åtgärd. En uppdatering av deltagarunderlaget omräknar listan utan att
en gammal träff ligger kvar. Andra uppföljningsfilter fortsätter fungera.

Ingen ny ruta, backend, datamodell, behörighet, resultatregel eller
domängräns införs; ingen ADR behövs. MeOS är enbart beteendereferens.

## Minsta kontroll

Ett rent test av saknad-tid-villkoret, ett tillägg i det befintliga syntetiska
browserfallet (mobil och desktop), web lint/typecheck/build. Ingen databas
eller stor testsvit krävs för denna klientprojektion.

## Utfall och verifiering

Klasstabellens positiva antal är en understruken, tangentbordsfokuserbar
knapp med ett fullständigt svenskt tillgängligt namn. Klick öppnar den
befintliga deltagarlistan med klass + saknad fast tid; sökningen och tidigare
uppföljningsfilter nollställs för ett entydigt urval. Urvalet anges synligt
och ”Visa alla starttider” tar bort just tidsfiltret medan klassvalet är kvar.
Fri-startklass och nolltal har ingen knapp. Filtreringen härleds varje gång
från aktuellt deltagarunderlag, utan sparat resultat eller ny serveråtgärd.

Riktat enhetstest: **4/4 passerade, exit 0**. Det befintliga syntetiska
browserfallet: **1/1 passerade, exit 0**, inklusive klassknapp, synligt
urval, rätt person, rensning och att fri start inte får samma åtgärd.
Browser-TypeScript och riktad ESLint: **exit 0**. Web lint, typecheck och
build: **exit 0** var för sig. Mobilbilden efter urvalet och den kompakta
1280px-översikten granskades; ingen horisontell sidbredd uppstod i provet.
Första browserstarten gav **exit 1** på sandboxens `EPERM` vid lokal port
3167; omkörning med tillåten loopback passerade. En första browser-
TypeScript/ESLint-kontroll använde felaktigt konfigurationsfilnamn och gav
**exit 1**; rätt konfiguration passerade. Ingen databas eller verklig
tävling användes.

Kvarvarande antaganden: serverns validerade startregel och starttid i det
senast hämtade underlaget representerar aktuellt läge; osynkade enhetsköer
ingår inte. Fysisk touch, skärmläsare och textzoom har inte accepterats.
På små skärmar prioriteras minst 44 px tryckyta framför maximal täthet.
