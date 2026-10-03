# ADR-0100: hyrstatus tillhör den journalförda brickkopplingen

- Status: Accepted
- Datum: 2026-09-18

## Kontext

V1 ska kunna skilja arrangörens hyrbrickor från deltagarens egna brickor.
Systemet har redan immutable brickkopplingsidentiteter och ett separat,
idempotent brickbytesflöde. Att lägga hyrstatus på deltagaren skulle göra
historiken fel när brickan byts. Att registrera ett hyrstatusbyte som ett
brickbyte skulle i sin tur fabricera ett byte av bricknummer.

TASK073 avgränsas till en explicit markering på den aktiva brickkopplingen,
en säker rättningsväg och synlig status i den gemensamma administratörsvyn.
Betalstatus, avgift, återlämning och sammanställd hyrbrickerapport ingår inte.

## Beslut

1. `card_assignment.is_rental` är en obligatorisk boolean. `false` betyder
   endast "inte markerad som hyrbricka" och är inte bevis på ägande, betalning
   eller återlämning.
2. Hyrstatus tillhör assignmenten `(race, entry, card number)`. Den bevaras
   när assignmenten blir inaktiv och återkommer om exakt samma historiska
   assignment senare återaktiveras.
3. Endast den enda aktiva, entydiga assignmenten får ändras. Saknad eller
   multipel aktiv assignment ger konflikt; inaktiva assignmenter kan inte
   rättas genom denna operation.
4. Ändringen är ett eget kommando under befintlig `MANAGE_RACE`, inte ett
   brickbyte och inte en ny capability. Requesten binder request-id, aktör,
   race, entry, assignment-id/nummer/hyrstatus samt förväntad entry- och
   snapshotversion.
5. Samma request och oförändrat intent ger samma kvittens. Ändrad aktör,
   target eller intent ger konflikt.
6. `is_rental`, entryversion och race-snapshot uppdateras atomiskt tillsammans
   med en immutable `entry_card_rental_change` och ett audit-event. Inga
   råmeddelanden, avläsningar, resultatrevisioner eller bricknummer ändras.
7. Den privata gemensamma rosterprojektionen exponerar `isRental` endast för
   den entydiga aktiva assignmenten. En textbunden "Hyrbricka"-markering får
   inte visas för inaktiva eller konfliktfyllda assignmenter.
8. Stationspaket och startlistor utökas inte i detta snitt. Hyrstatus behövs
   inte för lokal resultatutvärdering; framtida hyrbrickerapport får läsa den
   journalförda servermodellen separat.

## Databas och återställning

Migrationen är additiv: en `NOT NULL DEFAULT false`-kolumn, ett kompositbevis
för assignmentens race/entry och en immutable journal med constraints/FK.
Befintliga assignmenter behålls och får den uttryckliga betydelsen "inte
markerad". Assignmentens befintliga identitetsimmutabilitet består; endast
`active` och den nya hyrstatusen får ändras av sina respektive kommandon.

Vid incident stängs hyrstatusrouten och UI:t. Journal och kolumn droppas inte.
Rätta framåt med en additiv migration eller återställ en verifierad full
PostgreSQL-backup. En felmarkering rättas genom ett nytt journalfört kommando.

## Konsekvenser

- Hyrstatus kan visas och senare sammanställas utan att blanda ihop deltagare,
  bricknummer och betalning.
- Varje rättning ökar entryversion och race-snapshot, så samtidig administration
  följer befintlig optimistisk konfliktmodell.
- Historiska importer markeras inte automatiskt som hyrbrickor.
- Ett framtida återlämnings-/avgiftsflöde kräver ett separat beslut och får
  inte härledas ur denna boolean.

