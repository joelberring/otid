# TASK204: vald deltagare utanför den synliga listan

Status: genomfört och riktat verifierat 2026-09-27.

## Utgångsläge

Deltagarens arbetskort hämtas från hela aktuella underlaget, medan tabellen
filtreras, sorteras och sidindelas separat. Sökning, filter, ordning eller
sidbyte kan därför dölja den valda raden fast arbetskortet fortfarande är
öppet och redigerbart. Efter en ändring som gör att deltagaren lämnar ett
uppföljningsfilter är detta särskilt lätt att misstolka.

## Minsta operatörsutfall

En kompakt kontextrad visas bara när vald deltagare inte finns på synlig
tabellsida. Raden skiljer mellan ”utanför aktuellt urval” och ”på sida N”.
Operatören kan uttryckligen visa den valda raden. Om den finns i urvalet
byts bara sida; om filter döljer den rensas sök, klass och de fyra
uppföljningsfiltren före sidval. Ordning och sidstorlek behålls. Vald person,
arbetskort, åtgärd och pågående formulär bevaras; låsta operationer kan inte
starta kontextbytet. På mobil öppnas listpanelen.

Raden ligger i befintlig arbetsyta utan nytt kort, fast toppobjekt eller
typsnitt. Den är en privat visningsåtgärd: inga API-, databas-, domän- eller
behörighetsändringar och ingen ADR krävs.

## Proportionerlig kontroll

Utöka ett befintligt syntetiskt browserfall för filtrerad vald person och
vald person på annan sida. Kontrollera att återgången visar rätt rad utan
att stänga personkortet, vid mobil och dator, samt att sidan inte får
horisontellt spill. Kör riktad browser-TS/ESLint och web lint/typecheck/build.
Ingen PostgreSQL eller bred testsvit krävs för detta snitt.

## Utfall och verifiering

En tunn kontextrad visas när vald person antingen filtrerats bort eller ligger
på en annan sida. Den visar namn och orsak. Den uttryckliga knappen rensar
bara filter som faktiskt döljer personen, eller byter bara sida. Sortering,
sidstorlek, vald person och arbetskort bevaras. Mobil öppnar listpanelen och
den valda raden rullas in i vy. Under låst åtgärd är knappen avstängd.

Befintligt syntetiskt browserfall utökades med båda situationerna och
passerade **1/1, exit 0**. Skärmbilder vid 390 och 1280 px granskades;
ingen horisontell sidscroll i 390px-kontrollen. Browser-TypeScript och
browser-ESLint: **exit 0** var för sig. Web lint, typecheck och build:
**exit 0** var för sig. Första browserstarten gav **exit 1** endast för att
sandboxen nekade lokal bindning på port 3167; samma isolerade prov kördes om
med lokal behörighet och passerade. Ingen databas eller riktig tävlingsdata
användes.

Kvarvarande antaganden: serverns roster innehåller vald person så länge
kortet är öppet; riktig stor tävling, fysisk mobil/padda, textzoom och
skärmläsare är inte fältaccepterade. En uppdatering som helt tar bort vald
person hanteras som tidigare genom att arbetskortet inte längre visas.
