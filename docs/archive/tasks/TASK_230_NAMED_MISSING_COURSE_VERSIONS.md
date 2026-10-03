# TASK230: namnge klasser med saknad banversion i banunderlaget

Status: implementerad och syntetiskt UI-verifierad 2026-09-27.

## Användarutfall

En funktionär som ser varningen i `Före tävlingen` → `Banor` ska veta
vilka klasser och tilldelade banversioner som behöver kontrolleras.
Varningen ska vara kompakt även när många klasser berörs och får inte
felaktigt påstå att själva banan är raderad eller att tävlingen är redo.

## Avgränsning

Jämför klassernas exakta `courseVersionId` med det redan validerade
banunderlagets versions-ID:n. Räkna varje berörd klassrad en gång,
även om två klasser har samma visningsnamn. Visa klassnamn, tilldelat
bannamn och versionsnummer, aldrig interna UUID:n. Vid få berörda
klasser kan de namnges direkt; vid fler än tre ska antal synas direkt
och hela listan finnas i en inbyggt tangentbordsstyrd, hopfälld
detalj. Bevara varningen ovanför banlistan, neutral layout med en
smal signalfärg och minst 44 px tryckyta på mobil.

Formulera detta som en lucka i **det lästa banunderlaget**. Svaret saknar
gemensam snapshot-version med deltagarunderlaget, och serverns läsning
kan utelämna kontrollösa versioner; UI:t får inte hävda att banan
saknas i databasen eller skapa en ny status. Ingen API-, domän-,
databas-, behörighets- eller teknikändring görs; ingen ADR krävs.

## Riktad acceptans

Återanvänd det syntetiska browserfallet med 60 klasser och 12 banor.
Med en saknad version ska rätt klass och bannamn/version namnges före
listan. Med fyra berörda klassrader ska antalet visas kompakt och alla
fyra finnas i öppnad lista, utan att likalydande visningsnamn slås ihop.
Ingen rå UUID visas. Inget varningspåstående visas när alla versioner
finns; otillgängligt svar ska fortsätta visa läsfel, inte en
”saknad version”. Kontrollera 390/1280 px utan horisontellt sidspill.
Riktad lint/typecheck/build och ett återanvänt syntetiskt browserfall
räcker; ingen bred testsuite eller verklig tävling.

## Utfall

Varningen namnger nu varje berörd klassrad och dess tilldelade bannamn
och version, härlett med exakt versions-ID utan att visa UUID:n. Vid
en till tre klasser visas raderna direkt. Från fyra visas antalet i en
kompakt, tangentbordsstyrd detalj som kan öppnas för alla rader.
Likalydande klassnamn slås inte ihop. Varningen ligger före banlistan
och kallar detta en lucka i det **lästa underlaget**.

Webblint/typecheck, E2E-TypeScript/ESLint, checkin-förberedelse och
web-build gav **exit 0**. Ett återanvänt syntetiskt browserfall
passerade **1/1, exit 0** vid 390 × 844 och 1280 × 800: en saknad
version namngavs, fyra berörda rader visades i öppen detalj (två med
samma text), inga UUID:n renderades, minst 44 px tryckyta och inget
sidspill. Komplett matchning gav ingen varning; otillgängligt svar gav
endast läsfel. Bilderna granskades.

Ingen verklig tävling, fysisk mobil, databasändring eller fältacceptans
ingick. Två identiska visningsnamn och samma bannamn/version är ännu
inte entydigt åtgärdbara enbart genom varningstexten; ett framtida
direktval måste använda klassens interna ID utan att exponera det.
