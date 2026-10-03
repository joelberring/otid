# ADR-0122: direktanmälan till verifierad lottad fast starttid

- Status: Accepterad och implementerad i TASK110
- Datum: 2026-09-20

## Kontext

TASK109 kan vid klassbyte ge en befintlig deltagare en explicit serverbevisad
starttid ur en sparad `FIXED`-lottning. Direktanmälan har en egen atomisk
skrivare, eget idempotensspår och kan i dag ta en manuell fast tid. Att återanvända
den tiden som implicit slotbevis skulle ge två samtidiga direktanmälningar samma
minut och göra en senare retry omöjlig att återskapa säkert.

## Beslut

TASK110 får lägga till ett frivilligt, explicit slotbevis på befintlig
direktanmälan. Beviset består av draw-id, source-hash och exakt slotinstant från
en privat serverkandidat-GET. Det gäller endast en ny entry i en aktuell
`FIXED`-klass. Den
befintliga manuella FIXED-vägen behålls för operativa undantag men har alltid
ett null slotbevis.

Under samma befintliga race-lås måste servern kontrollera kapacitet, snapshot,
målklass/bana/startregel, senaste kompletta draw, entydig mapping av aktuell
roster, framtida slot och faktisk vakans. Registreringsskrivaren skapar entry,
eventuell brickkoppling, `entry_registration_request` och en ny immutable
`entry_registration_start_slot_assignment` i en transaktion. Journalen länkar
direkt till registreringsjournalen och fryser entry, klass, draw-id,
source-hash, tid, aktör och capability. Ett separat journalnamn bibehåller
databasens tydliga en-till-en-samband i stället för en polymorf foreign key.

Kvittensen returnerar assignment-id/bevis, och samma retry läser journalen i
stället för den eventuellt senare ändrade entryraden. Det införs ingen global
unik constraint på `entries.fixed_start_time`; äldre/manuella dubbletter måste
fortfarande kunna läsas som historik.

## Konsekvenser

Den praktiska direktanmälan kan använda samma verkliga minutluckor som ett
klassbyte, men det är varken reservationskö, startbokning, seedning eller
återlottning. Resultat, rådata och publicerade listor ändras aldrig automatiskt.
PUNCH, passerade tider, GPS, karta, stafett och betalning ingår inte.

Migrationen är additiv. Vid incident stängs writer/UI, medan båda journalerna
behålls; rätta framåt eller återställ en verifierad backup.

## Alternativ

- Fri texttid som automatiskt kallas slot avvisas: den saknar draw-/vakansbevis.
- Att utvidga TASK109:s transferjournal till en polymorf association avvisas:
  det försvagar databasegenskapen att exakt en slot hör till sin skrivjournal.
- Generell slotreservation avvisas: behovet är just den atomiska committen.
