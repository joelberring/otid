# TASK105: återta en felaktig PUNCH-starttidsrättning

Påbörjad 2026-09-20 efter TASK104. ADR-0119 är skriven före produktkod.

Status: implementerad och riktat verifierad 2026-09-20. Migration0064 är
additiv; kontrakt 5/5, PostgreSQL17/PostGIS-integration 2/2, webbrutt 34/34
och 390 px-browserfall 1/1 (11,2 s) passerar. Browserfallet provar tappat
commitsvar och exakt retry. Riktig USB, fältmobil/startstation och
produktionsdatabas återstår utanför verifieringen.

## Användarvärde

Tävlingsadministratören kan återta en nyligen bekräftad men felaktig manuell
PUNCH-starttidsrättning utan att ändra avläsningen eller dölja att rättningen
fanns.

## Avgränsning

- En `MANAGE_RACE`-administratör, en Entry och exakt en aktuell
  `MANUAL_PUNCH_START_TIME_CORRECTION`.
- Endast när den rättade revisionen är entryns absoluta huvud och dess
  TASK104-källa är omedelbart föregående direkta tekniska revision, med samma
  bevarade startstämpling.
- Immutable withdrawal-journal och exakt en ny återställd resultatrevision.
- Ingen ändring av rawdata, CardReadout, äldre revisioner, klass, bana,
  snapshot, stationspaket eller fryst Complete-XML.
- Ingen ny tid, generisk editor, bulk, automatisk omräkning, återtagande av
  andra beslut, GPS, karta/rutt, stafett eller riktig USB.

## Acceptans

1. En giltig aktuell TASK104-kedja skapar exakt en
   `MANUAL_PUNCH_START_TIME_CORRECTION_WITHDRAWAL` med den tekniska källans
   oförändrade utfall, start och splits.
2. Senare revision, aktiv manuell overlay, ändrad entry-/klass-/ban-/snapshot-
   grund, avvikande läst start eller motsägande journal/proveniens avvisas utan
   write.
3. Samma request-id återger samma journal/revision; ändrad aktör eller intent
   konflikterar utan delwrite.
4. Rawdata, CardReadout, originalkälla, TASK104-rättning och äldre Complete-
   bytes förblir oförändrade. Privat historik visar hela trestegskedjan.
5. Publikresultat, Snapshot-IOF, speaker och ny finalisering använder den
   strikt validerade återställda revisionen utan ny status.
6. Svensk 390 px-vy visar teknisk start, felaktig rättning och återställd
   start, kräver granskning och återförsöker exakt samma intent vid tappat svar.

## Berörda paket

`contracts`, `database`, `application` och `web`. `domain` får ingen ny
resultatregel eftersom återställningen måste använda exakt lagrad teknisk
evaluation, inte beräkna om den. Stationens transport, protokoll och offlinekö
ändras inte.

## Verifieringsplan

Fokuserade kontrakts- och provenanceinvarianter, ett isolerat PostgreSQL-prov
för transaktion/replay/publik projektion/historik och ett 390 px-browserfall.
Berörd lint, typecheck och build körs efter implementation. Fysisk hårdvara,
produktionsserver och faktisk startstation påstås inte vara verifierade.

## Migrations- och återställningsnot

Migrationen ska vara additiv: ny revisionsorsak, nullable proveniensreferens
och immutable withdrawal-journal. Vid incident stängs writer och UI; historik
tas inte bort. Återställning sker genom forward-reparation eller verifierad
PostgreSQL-backup, aldrig genom att ta bort enumvärde eller revisioner.
