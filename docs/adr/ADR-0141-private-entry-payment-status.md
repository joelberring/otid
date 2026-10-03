# ADR-0141: privat, spårbar betalstatus per anmälan

- Status: Accepterad för TASK142
- Datum: 2026-09-22

## Kontext

O-Tid ska enligt produktmålet kunna låta tävlingsadministrationen registrera
betalstatus utan att V1 själv genomför en betalning. En enkel markering behövs
vid direktanmälan och tävlingsadministration, men belopp, Swishreferenser,
betalväxel, faktura, krav eller Eventor-skrivning skulle vara ett helt annat
ekonomisystem.

En anmälan kan vara avgiftsbefriad och äldre/importerade anmälningar saknar
ofta en verifierad ekonomisk uppgift. Det är därför fel att tolka en tom
uppgift som obetald, eller att låta en administrativ markering ändra publik
startlista, resultat, IOF-data eller stationspaket.

## Beslut

1. Varje `entry` får en privat aktuell status med exakt en av följande värden:
   `UNMARKED`, `UNPAID`, `PAID` eller `WAIVED`.
   `UNMARKED` är den säkra initiala betydelsen: systemet vet inte om eller hur
   anmälningsavgiften hanterats. `UNPAID` betyder endast att en behörig
   administratör uttryckligen har markerat den som ej betald; det är inte en
   fordran. `PAID` och `WAIVED` är manuella administrativa uppgifter, inte
   transaktions- eller kvittobevis.
2. Statusen hör till anmälan, inte person, klubb, bricka eller klass. Ingen
   historisk import eller befintlig entry antas vara `UNPAID`, `PAID` eller
   `WAIVED` automatiskt.
3. Varje ändring kräver befintliga `MANAGE_RACE`, CSRF, ett canonicalt
   idempotency-id, aktuell `entryVersion`, klass-id och en separat monoton
   `paymentStatusVersion`. Den sker under samma `race -> entry`-låsordning som
   övrig administration och sparar aktuell status, immutable
   `entry_payment_status_change` samt audit-event atomiskt. Samma id och
   exakt intent återspelar samma kvittens; ändrat id/aktör/target/intent eller
   stale underlag ger konflikt.
4. Betalstatus har sin **egen** version och höjer varken `entry.version` eller
   `race.snapshotVersion`. Den är privat operativ ekonomi och förändrar inte
   startlista, resultat, ban-/klasssemantik, readout, finalisering eller
   publicerat underlag. Ett parallellt klass-, namn-, start- eller brickbyte
   ändrar däremot entryversion och stoppas av payment-intentets underlag.
5. Statusen visas bara i den autentiserade tävlingsadministrationen. Den får
   inte ingå i publik roster/resultat/startlista, IOF, Eventor, speaker,
   stationspaket, offline-avprickning eller deltagarvy. Den första vyn visar
   aktuell textstatus och erbjuder en uttrycklig granska/bekräfta/rätta-väg;
   den breda generiska förändringshistoriken utökas inte i detta snitt.
6. Ändringar är tillåtna även efter start, readout, resultat eller
   finalisering, eftersom de inte påverkar dessa fakta. Rättning sker alltid
   framåt genom ny statusrad; journal och audit raderas eller skrivs aldrig om.

## Databas och återställning

Migrationen är additiv: en closed PostgreSQL-enum, `payment_status` och
`payment_status_version` på `entry` med `UNMARKED` respektive `1` som säkra
defaultar, samt en immutable journal med scope-, actor-, värde- och
versionsconstraints. Existerande entries fortsätter vara obekräftat
`UNMARKED`.

Vid incident stängs writer och adminkontroll. Varken kolumner, journal eller
audit droppas i en datamiljö med data; rätta framåt med ny status eller
additiv migration, alternativt återställ en verifierad full backup.

## Konsekvenser

- Arrangören kan se och rätta en enkel betalmarkering utan att O-Tid låtsas
  vara ett betal- eller bokföringssystem.
- En privat ekonomirättning gör inte en oförändrad publik startlista falskt
  inaktuell och kan inte ändra redan frysta resultat.
- Belopp, valuta, Swish-/OCR-referens, delbetalning, återbetalning,
  fakturering, betalprovider, extern synk och betalning på klubbs-/personnivå
  kräver ett eget senare ADR och snitt.

## Avvisade alternativ

- Boolean `paid`: kan inte skilja okänd status från uttryckligen obetalt eller
  avgiftsbefriat.
- Att sätta `UNPAID` som default: fabricerar ekonomisk information för redan
  importerade entries.
- Att höja entry-/race-snapshot vid en privat markering: gör
  startliste-/resultatunderlag onödigt stört trots oförändrat publikt innehåll.
- Att spara Swishreferens eller belopp ”för enkelhets skull”: behandlar
  betaldata utan nödvändig produkt-, retention- eller integrationsmodell.
