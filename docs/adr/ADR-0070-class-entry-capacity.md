# ADR-0070: Valfri deltagargräns per klass

- Status: Accepterad
- Datum: 2026-09-12
- Uppgift: TASK029

## Beslut

En administratör kan sätta ett platstak per klass med samma MANAGE_RACE-session.
class.maxEntries är null (ingen konfigurerad gräns) eller heltal0–10000.
Noll stänger en tom klass för nya entries. Alla registrerade entries i klassen
räknas, oavsett resultat/DNS; en ej startande frigör ingen plats automatiskt.
Antalsgränsen säger inget om lediga minutstartluckor eller tävlingsbehörighet.
Klassnamn, kön eller ålder används inte för att gissa regler som inte finns.

Klassens capacityVersion börjar på1. Ändring fryser expectedCapacityVersion,
expectedMaxEntries och nytt maxEntries; no-op eller gräns under aktuellt antal
avvisas. Samma request-id, klass, race, aktör och normaliserade intent ger
exakt ursprunglig kvittens. Ny immutable class_capacity_change_request och
adminaudit sparas atomiskt med version+1. Rollen verifieras under samma
session/credential → race UPDATE → request advisory-ordning som rosterwriters.

CapacityVersion är separat från racesnapshot: en ren platsgräns ändrar inte
bana, starttid eller resultatunderlag och ska inte kräva nytt stationspaket
eller omräkning. Alla writers kontrollerar däremot verkligt platstak under
racelås vid commit. Gammal browserinformation får därför konflikt om platsen
tagits eller taket sänkts sedan granskningen. UI visar aktuellt antal/tak och
uppdaterar efter beslut; det får inte lova att en läst ledig plats är reserverad.

## En gemensam regel i alla skrivvägar

Transfer, direktanmälan och båda äldre klassbytesvägarna kontrollerar målklassen
innan en ny medlem läggs till. Flytt inom redan samma klass ökar inte antal.
EntryList-import kontrollerar slutligt klassantal efter hela importens upserts,
inte varje mellanläge; klassbyten inom en import får därmed byta plats.
Överskridet tak kastar transaktionskonflikt som återställer hela importen,
inklusive versionsökningar, kortkopplingar och importjournal. Exakt gammal
import-/ändringsretry ska fortfarande kunna returnera sitt historiska svar
utan nya writes, även om dagens klass är full.

Kapacitetslogiken ligger i application, inte trigger/SQL-vy eller React.
PostgreSQL används för räknings-/låsmekanik. Resultatmotorn är oförändrad.
Ingen godtycklig override, kölista, avgift eller extern integration ingår.

## Migration och återställning

Additiv migration0044 lägger nullable max_entries, capacity_version med
positivitetsvillkor och ändringsjournal. Befintliga klasser är obegränsade;
inga deltagare flyttas/raderas. Gamla importupserts ska bevara dessa fält.
Aktivera administratörens gränssättning först när samtliga produktwriters är
kopplade till regeln. Vid incident stäng setters, bevara gränser/journaler och
gör additiv rättning eller verifierad restore; ta inte bort taket automatiskt.
