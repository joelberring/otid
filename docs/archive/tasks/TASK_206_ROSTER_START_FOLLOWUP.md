# TASK206: startkolumn från avvikelse till rätt person

Status: genomfört och riktat verifierat 2026-09-27.

## Utgångsläge

Administratörens deltagartabell skiljer fri start från minutstart och visar
en saknad fast tid, men tabellcellen har ingen direkt väg till rättningen.
Satt minutstart skrivs med etikett och full lokal datum-/tid/offset på
separata block även när cellen har plats att lägga dem tätare.

## Operatörsutfall och gräns

En minutstart utan fast tid fortsätter säga just detta och får en tydlig
”Sätt starttid”-handling i startcellen. Den öppnar befintlig TIME-arbetsyta
för exakt deltagare, med befintlig granskning, versionskontroll och retry;
klicket sparar ingenting. Vid mobil växlar listan till arbetsvyn. Fri start
får ingen sådan handling. Satt minutstart behåller full datum-/tid/offset,
men etikett och tid får flöda i samma rad när bredden räcker. Ingen tid
förkortas eller gissas från loppets datum.

Alla fyra tabellkolumner och operatörens urval/ordning behålls. Inga nya
kort, globala typsnitt eller fasta toppfält. Detta återanvänder befintligt
UI-/API-flöde och ändrar ingen domän-, behörighets- eller lagringsgräns;
ingen ADR behövs.

## Proportionerlig kontroll

Utöka det befintliga syntetiska 390/900/1280px-browserfallet med blandad
fri/minutstart: knapp endast för saknad fast tid, rätt person och TIME-form
efter klick, ingen skrivbegäran före granskning, full tid när den finns och
ingen horisontell sidscroll. Kör riktad browser-TS/ESLint samt web
lint/typecheck/build. Ingen PostgreSQL eller bred testsuite för denna rena
UI-koppling.

## Utfall och verifiering

Startcellen visar fortsatt fri start skilt från minutstart. För en deltagare
med minutstart utan fast tid visas både ”Ingen fast starttid” och en separat
”Sätt starttid”-knapp med personens namn i det tillgängliga knappnamnet.
Knappen använder samma `openMissingStartTime` som befintlig
förberedelseuppföljning; TIME-formuläret och dess granskning/sparande ändras
inte. Knappen är avstängd under låst arbetsflöde och är minst 44 px i
mobilprovet. Satt tid behåller full datum, klockslag och UTC-offset; etikett
och tidsstämpel får nu flöda intill varandra där bredden räcker. Ingen
automatisk tidsättning eller serverändring sker vid klick.

Det befintliga syntetiska browserfallet passerade **1/1, exit 0** vid 390,
900 och 1280 px. Det kontrollerar rätt person och TIME-form, noll
`PATCH /start-time` före granskning, ingen sådan åtgärd för fri start,
44px-mobilknapp, full satt tidsstämpel och inget horisontellt sidspill.
Skärmbilder för mobilens saknade tid och datorns tidsordnade lista granskades.
Browser-TypeScript/ESLint och web lint/typecheck/build gav var för sig
**exit 0**. Ingen PostgreSQL eller riktig tävlingsdata användes.

Kvarvarande antaganden: befintlig TIME-granskning och versionkontroll ger
samma serverbeteende från denna nya ingång; den har inte körts mot
PostgreSQL i detta UI-snitt. Långa namn/tider, stark textzoom, skärmläsare
och fysisk touch är inte fältaccepterade.
