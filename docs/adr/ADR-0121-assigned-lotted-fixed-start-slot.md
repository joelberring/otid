# ADR-0121: tilldela en verifierad lottad fast starttid vid klassbyte

- Status: Accepterad och implementerad i TASK109
- Datum: 2026-09-20

## Kontext

En arrangör behöver ibland flytta en redan registrerad deltagare från
tävlingsklass till öppen klass, när både klassens deltagartak och en praktisk
fast starttid tillåter det. TASK029 har redan ett atomiskt klassbyte med
separat deltagartak och tydlig PUNCH/FIXED-regel. TASK108 kan nu visa tider
som är vakanta i en tidigare sparad lottning, men gör medvetet ingen bokning.

Att tolka ett vanligt `fixedStartTime` som en reserverad slot skulle vara
fel: manuellt ändrade tider och historiska dubbletter finns, en sparad
lottning kan ha blivit inaktuell, och två samtidiga administratörer får inte
få samma starttid. ADR-0045 har dessutom uttryckligen ingen reservationsmodell.

## Beslut

TASK109 utökar endast det befintliga atomiska **klassbyte för en befintlig
deltagare**. När målklassen är `FIXED` kan `MANAGE_RACE` välja exakt en
servererbjuden tid från målklassens senaste immutabla lottning. Valet är inte
en fri texttid och gäller inte direktanmälan eller en deltagare som redan är i
målklassen.

En tid får väljas endast när alla följande villkor gäller under samma race-
och klasslås:

1. målklassen är fortfarande `FIXED`, har plats enligt befintligt deltagartak
   och har en komplett senaste draw-journal;
2. den valda tiden är exakt en journalförd slot, ligger strikt efter serverns
   commit-tid och är inte upptagen av någon aktuell målklass-entry;
3. alla aktuella fasta tider i målklassen går entydigt att relatera till samma
   plan; manuell avvikelse, dubblett, ändrad klassregel, nytt draw-beslut,
   stale snapshot eller ändrad kapacitet ger konflikt;
4. överföringen behåller befintliga entry-/snapshotversionskontroller och
   resultat-/rådata-/publiceringsregler.

Samma request-id, aktör och canonical intent återger samma kvittens. Intentet
fryser deltagare, käll-/målklass, förväntade versioner och kapacitet, draw-
header, slotinstant och planens source-hash. En ny additiv immutable
`entry_start_slot_assignment`-journal binder detta bevis till den redan
befintliga `entry_transfer_request`; båda skrivs i samma transaktion. Den
finns för att ett senare byte av samma entries aktuella tid inte ska radera
vilken lottad slot som ursprungligen valdes. Transferkvittensen innehåller
assignment-id och exakt slotbevis, så samma retry inte behöver härleda
journalen från en nuvarande `fixedStartTime`.

Det tillkommer ingen generell unik constraint på `entries.fixedStartTime`.
Äldre/manuella tävlingar kan innehålla samma tid av legitima historiska skäl;
den nya skrivvägen verifierar i stället sin särskilda slot under lås.

## Konsekvenser

Arrangören kan använda en synlig, verifierad framtida minutstart vid det
arbetsflöde som redan har platskontroll, utan att systemet gissar från en
manuell tid. Om en starttid redan passerat måste arrangören använda separat
operativ rättning; den kan inte återanvändas som en ny startslot.

Detta är fortfarande inte avancerad lottning, startgrupper, klubbseparering,
reservlista, direktanmälan till slot, fri start, avprickning eller en
flerklassplan. Resultat räknas inte om och frysta publicerade listor ändras
inte automatiskt.

Migrationen ska vara additiv med bevarad journalhistorik. En incident stänger
writer-/UI-vägen; den immutable assignment-journalen tas inte bort. Restore
noterar att den nya journalen måste återställas tillsammans med transfers.

## Alternativ

- Att låta administratören skriva valfri tid igen avvisas: det bevisar varken
  den lottade planen eller frånvaro av samtidig kollision.
- Att använda klassens resterande deltagartak som antal startluckor avvisas:
  taket räknar entries, inte tider.
- Att automatiskt återanvända passerade tider avvisas för första snittet:
  det skulle kunna ge en tävlande en tid där startpersonalen redan avslutat
  flödet.
- En ny separat slotroll avvisas: befintlig `MANAGE_RACE` äger redan det
  atomiska klassbytet och ger mindre operativ friktion.
