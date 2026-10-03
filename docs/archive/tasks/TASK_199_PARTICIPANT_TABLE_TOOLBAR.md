# TASK199: enradig deltagarverktygsrad på padda

Status: genomfört och riktat verifierat 2026-09-27.

## Användarutfall och gräns

I `/manage` vid 900 px bryts knappen ”Uppdatera deltagare” ensam till en
extra rad. Deltagarrubriken och åtgärderna Ny deltagare, bred/delad tabell
och Uppdatera ska få plats på en rad när ingen extra hyrbricksutskrift finns.
Den synliga växeltexten blir kort ”Bred tabell” respektive ”Delad vy”, med
en tillgänglig etikett som börjar med exakt den synliga texten och förklarar
vad läget gör. Flera åtgärder får fortsatt brytas vid mindre faktisk bredd,
zoom eller valfri hyrbricksutskrift; ingen knapp döljs.

Enbart svensk UI-text, klass på befintlig verktygsrad och lokal CSS i
721–1199 px ändras. 390 px behåller sina mobilmål och den redan dolda
bredtabellväxeln; 1280 px får ingen ny förtätning. Inga data, API:er,
behörigheter, resultatregler, teknikval eller domängränser ändras; ingen
ADR behövs. MeOS används bara som beteendereferens för överblick.

## Kontroll

Ett återanvänt syntetiskt browserfall passerade **1/1**. Vid 900 px ligger
de tre knapparna på samma rad utan överlapp och växling till/från bred
tabell fungerar. 390/1280 px, avsaknad av horisontell sidscroll och
bibehållet personval ingick i samma fall. 900px-skärmbilden granskades.
Web lint/typecheck/build och browserharnessens TypeScript/ESLint gav var
för sig **exit 0**. Ingen databas eller stor testsuite användes.

Antaganden: tillkommande hyrbricksutskrift, stor textzoom eller ett längre
översatt språk får bryta raden i stället för att klippa eller dölja en
åtgärd. Fysisk padda/touch har inte handhavandetestats.
