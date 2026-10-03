# TASK228: åtgärdsstyrd klassbild på tävlingens förstasida

Status: implementerad och syntetiskt UI-verifierad 2026-09-27.

## Användarutfall

Första tävlingsöversikten ska visa en klass med saknad fast starttid utan
att funktionären behöver bläddra genom ett långt klassunderlag. Det ska
också gå att hitta en annan klass eller bana direkt, medan vyn förblir
ren, neutral och informationstät på mobil och dator.

## Avgränsning

I den befintliga klassöversiktens tabell, visa klasser med saknade fasta
starttider först, i fallande antal. Låt övriga klasser behålla sin
ursprungliga inbördes ordning. Lägg en kompakt, svensk sökning på klass-
eller banamn med synligt träffantal och 0-träffsläge. Filtrering och
ordning påverkar endast visade rader, aldrig tävlingens totalsiffror,
underlaget eller servern. Befintliga länkar till klassupplägg respektive
deltagare utan fast starttid ska fungera oförändrat. Förklara kort varför
en klass kan ligga först; skapa ingen ny generell "klar"-status.

Detta är bara presentation av redan hämtad data. Ingen API-, domän-,
behörighets-, databas- eller teknikändring görs och ingen ADR krävs.
Ingen riktig tävling eller credential används.

## Riktad acceptans

Återanvänd det syntetiska underlaget med 60 klasser och 500 deltagare
vid 390 × 844 och 1280 × 800. Klass 31 med åtta saknade fasta tider
ska ligga först innan sökning, ha fungerande deltagarlänk och visas med
saknat antal. Sök `Klass 31`, `Bana 08` och något utan träff, kontrollera
1/5/0 rader, återställ till 60 och verifiera oförändrade globala
nyckeltal och inget horisontellt sidspill. Kör riktad lint/typecheck,
ett syntetiskt browserfall och web-build; ingen bred testsuite.

## Utfall

Förstasidans klassrader med saknade fasta tider visas först, med flest
saknade överst. Rader utan sådan brist behåller sin tidigare ordning.
En kompakt lokal sökning på klass/bana visar träffantal och ett tydligt
0-träffsläge. Texten anger varför en klass kan ligga först. Både
klassuppläggs- och saknad-tid-länken är kvar; tävlingens nyckeltal räknas
fortfarande på hela underlaget.

Webblint, web-typecheck, E2E-TypeScript, E2E-ESLint,
checkin-förberedelse och web-build gav alla **exit 0**. Det återanvända
syntetiska browserfallet passerade **1/1, exit 0** med 60 klasser och
500 deltagare. Vid 390 × 844 och 1280 × 800 låg Klass 31 med åtta
saknade tider först, klass-/banfilter gav 1/5/0 träffar, länken öppnade
rätt deltagarurval, globala nyckeltal stod kvar och sidan saknade
horisontellt spill. Bilderna granskades.

Agentens `pnpm`-wrapper stannade före körning på nät/TTY-kontroll;
slutkontrollerna kördes med installerade lokala binärer. Inga riktiga
tävlingsdata, credentials, databasskrivningar eller fysiska enheter
ingick. Att ordningen fungerar för funktionärer i ett faktiskt lopp
är fortfarande ett användbarhetsantagande.
