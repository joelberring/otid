# ADR-0101: återlämningsstatus tillhör hyrbrickans assignment

- Status: Accepted
- Datum: 2026-09-18

## Kontext

ADR-0100 placerar hyrstatus på den konkreta, journalförda brickkopplingen.
TASK074–075 kan därför sammanställa och skriva ut aktiva hyrbrickor, men kan
inte skilja en fortfarande utlånad bricka från en som fysiskt har lämnats
tillbaka. `card_assignment.active` kan inte användas som återlämningsbevis:
assignmenten behöver vara aktiv för resultatkopplingen även efter återlämning.

TASK076 ska ge tävlingsadministratören en explicit och rättningsbar markering,
utan att införa betalning, avgift, lager, SPORTident-I/O eller ett nytt
behörighetssystem.

## Beslut

1. `card_assignment.rental_returned` är en obligatorisk boolean med default
   `false`. Fältet är endast operativt relevant när `is_rental = true`.
2. Återlämning ändrar inte assignmentens `active`, bricknummer, rådata,
   readout eller resultat. Hyrstatus och återlämningsstatus är separata
   uttryckliga fakta.
3. Endast den enda aktiva, entydiga assignmenten får ändras, och endast när
   den är markerad som hyrbricka. Saknad, multipel, icke-hyrd eller redan
   önskad status ger konflikt utan skrivning.
4. Kommandot använder befintlig `MANAGE_RACE`. Requesten binder request-id,
   aktör, race, entry, assignment-id/nummer/hyr-/återlämningsstatus samt
   förväntad entry- och snapshotversion.
5. Samma request, aktör och oförändrat intent ger exakt samma kvittens.
   Ändrad aktör, target eller intent ger konflikt.
6. Projektion, entryversion och race-snapshot uppdateras atomiskt med en
   immutable `entry_card_rental_return_change` och ett audit-event. En
   felmarkering rättas genom ett nytt kommando till motsatt status.
7. Den privata rosterprojektionen exponerar `rentalReturned` för den entydiga
   aktiva assignmenten. Operativ lista, filter och utskrift omfattar endast
   `isRental && !rentalReturned`; vald deltagare visar båda statusarna.
8. Om hyrmarkeringen senare rättas bort bevaras återlämningsfältet som
   historisk assignmentdata men ignoreras operativt. En ny hyrmarkering på
   samma assignment fabricerar inte automatiskt ett nytt utlån; administratören
   måste uttryckligen rätta återlämningsstatusen om brickan lånats ut igen.

## Databas och återställning

Migrationen är additiv: `rental_returned boolean NOT NULL DEFAULT false` och
en race-/entry-/assignmentbunden append-only journal med constraints, FK och
immutabilitetstrigger. Befintliga rader blir "inte registrerad som återlämnad";
detta är inte bevis för att brickan fortfarande är fysiskt utlånad.

Vid incident stängs writerrouten och UI:t. Kolumn och journal droppas inte i
produktion. Rätta framåt additivt eller återställ en verifierad full
PostgreSQL-backup. Historiska beslut bevaras.

## Konsekvenser

- Målpersonal kan arbeta med en kortare lista över ännu inte återlämnade
  hyrbrickor utan att resultatkopplingen bryts.
- Varje ändring ökar entryversion och race-snapshot och följer samma
  optimistiska konfliktmodell som övrig administration.
- Default `false` är en migreringsstartpunkt, inte fysisk inventeringssanning.
- Betalning, avgifter, depåsaldo och ny utlåningstransaktion ligger utanför
  detta beslut.
