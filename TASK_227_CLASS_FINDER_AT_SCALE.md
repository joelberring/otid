# TASK227: hitta rätt klass i en stor tävling

Status: implementerad och syntetiskt UI-verifierad 2026-09-27.

## Användarutfall

I `Före tävlingen` → `Klasser` ska en funktionär snabbt hitta en viss klass
eller bana även när tävlingen har många klasser och deltagare. Tabellen ska
förbli kompakt och informationstät på dator och användbar på mobil utan
att tvinga fram lång manuell bläddring.

## Avgränsning

Lägg en diskret, svenskspråkig sökning direkt över den befintliga
klassöversiktens tabell. Filtrera endast de redan hämtade klassraderna på
klassnamn eller banans namn. Visa antal synliga träffar och ett tydligt
tomt läge. Tävlingens sammanfattning ska fortsätta bygga på **alla** klasser
och deltagare. Befintlig åtgärd för saknade fasta starttider ska fungera
från filtrerad rad.

Detta är endast en lokal UI-presentation av befintligt underlag. Ingen
API-, databas-, resultatregel-, behörighets- eller teknikändring görs;
ingen ADR behövs. Inga riktiga tävlingsuppgifter eller credentials används.

## Riktad acceptans

Prova med ett syntetiskt underlag om ungefär 60 klasser och 500 deltagare
vid 1280 × 800 och 390 × 844. Första, mellersta och sista klass ska gå
att hitta med sökningen; banträff ska fungera. Visa 0-träffsläge, kontrollera
att global sammanfattning inte ändras och att befintlig åtgärd för saknad
fast starttid fortfarande öppnar rätt deltagarurval. Inget horisontellt
sidspill, och mobilens åtgärdsmål ska vara minst 44 px. Kör riktad lint,
typecheck, ett syntetiskt browserfall och web-build, inte en bred testsuite.

## Utfall

Klassvyn har nu en kompakt, lokalt filtrerande sökning på klass- eller
banamn, antal synliga träffar och ett eget 0-träffsläge. Sammanfattningen
beräknas fortfarande på hela underlaget. Befintlig länk från saknad fast
starttid öppnar rätt filtrerad deltagarlista även efter sökning.

Riktad webblint, web-typecheck, E2E-TypeScript, E2E-ESLint,
checkin-förberedelse och web-build gav **exit 0**. Ett syntetiskt
browserprov med 60 klasser/500 deltagare passerade **1/1, exit 0** på
390 × 844 och 1280 × 800: första, mellersta och sista klass, banträff,
0-träff, global sammanfattning, saknad-tid-handoff, minst 44 px mobilmål
och inget horisontellt sidspill. Bilderna granskades.

Första browserkörningen gav **exit 1** efter 45 sekunder eftersom testet
klickade före klientens initiering. Testet väntar nu på initiering; nästa
körning passerade. Första buildförsöket använde en felaktig sökväg till
lokal `next` och gav **exit 127**; korrekt sökväg gav **exit 0**.
Paketkommandot `pnpm` stoppades i agentens miljö av nät/TTY-kontroll;
installerade lokala binärer användes för slutkontrollerna.

Endast syntetiska browser-API-svar användes. Ingen verklig tävling,
databas, credential eller fysisk mobil ingick. Att sökbegreppen motsvarar
funktionärers faktiska arbetssätt återstår att pröva med användare.
