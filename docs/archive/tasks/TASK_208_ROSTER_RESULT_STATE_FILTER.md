# TASK208: välj resultatläge i deltagarlistan

Status: implementerat och riktat verifierat 2026-09-27.

## Operatörsutfall

I den privata deltagarlistan kan administratören välja ett gällande
resultatläge och omedelbart se alla matchande deltagare i hela det redan
hämtade rosterunderlaget, inte bara på aktuell sida. Valen är alla,
publicerade OK/MP/DNS/DNF/DSQ/OOC/NT, inget aktivt resultat och inget
publicerat resultat. De svenska statusnamnen är samma som i resultatcellen.
En status är inte automatiskt en avvikelse som kräver rättning.

## Dataväg och layout

Filtrera lokalt på TASK207:s validerade `effectiveResult`; status får aldrig
härledas från den senaste råa eller opublicerade revisionen. Kombinera med
namn-/klubbsökning, klass, äldre resultat, hyrbricka och betalning före
ordning och sidindelning. Byte av val går till första sidan men behåller
ordning och sidstorlek. ”Visa vald” och direkta vägar från översikt/
förberedelser rensar vid behov resultatvalet så att rätt person inte döljs.

Ett vanligt märkt `<select>` läggs i den befintliga kompakta filterraden.
Det får radbrytas på mobil/padda men inte skapa nytt kort, fast topp,
ikonbaserat tillstånd eller horisontellt sidspill. Personkortets orsaker,
historik och rättningsknappar är oförändrade. Ingen API-, databas-,
behörighets-, domän- eller teknikändring; ingen ADR behövs.

## Riktad kontroll

Enhetstest av alla tillstånd och kombination före sidindelning samt det
befintliga syntetiska browserfallet vid 390/900/1280 px: filtrera status,
återställ, öppna rätt person och kontrollera sidbredd. Endast berörd web
lint/typecheck/build och browser-TS/ESLint; ingen bred testsvit eller
PostgreSQL-writer för ett rent klientfilter.

## Utfall och begränsningar

Den befintliga deltagarlistan har nu `Resultatläge` bredvid klass, ordning
och radantal. Selecten visar samma sju svenska publicerade statustexter som
resultatcellen samt skilda val för ingen aktiv och ingen publicerad
revision. Filtret använder `effectiveResult` från TASK207, kombineras med
sökning och befintliga urval och körs före ordning/sidindelning. Byte går
till första sidan utan att ändra sidstorlek eller ordning. Direkta ingångar
från översikt/förberedelser och ”Visa vald” rensar statusval när det annars
skulle dölja rätt person. Inga resultat ändras.

Vid 900/1280 px ryms de fyra väljarna på en rad i den befintliga
kontrollremsan; vid 390 px ligger de i två par. Skärmbilder för alla tre
bredder granskades och browserprovet fann inget horisontellt sidspill.
Riktat webbenhetstest: **6/6, exit 0**. Befintligt syntetiskt browserfall:
**1/1, exit 0**; det kontrollerar MP/OK, ingen aktiv/publicerad revision,
kombination med äldre och klass, återgång, val från andra sidan i ett
31-personersunderlag samt ”Visa vald”. Web lint/typecheck/build och
browser-TypeScript/ESLint gav var för sig **exit 0**.

Kvarvarande antaganden: statusunderlaget är senast hämtad serverkunskap,
inte automatisk liveuppdatering; TASK207:s PostgreSQL-/prestandaacceptans
för stora verkliga resultathistoriker återstår. Fysisk mobil/padda,
skärmläsare och stark textzoom har inte fältprovats. Ingen PostgreSQL
behövdes eller användes för detta rena klientfilter.
