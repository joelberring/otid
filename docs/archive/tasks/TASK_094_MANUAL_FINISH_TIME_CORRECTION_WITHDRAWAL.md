# TASK094: återta en felaktig manuell måltidsrättning

Genomförd 2026-09-19 efter TASK093. ADR-0112 skrevs före produktionskod.

## Användarvärde

Tävlingsadministratören kan återta en nyligen bekräftad men felaktig manuell
måltidsrättning utan att skriva om avläsningen eller dölja att rättningen fanns.

## Avgränsning

- En `MANAGE_RACE`-administratör, en Entry och exakt en aktuell
  `MANUAL_FINISH_TIME_CORRECTION`.
- Endast när den korrigerade revisionen är entryns absoluta huvud och dess
  TASK093-källa är den omedelbart föregående direkta tekniska revisionen.
- Immutable withdrawal-journal och exakt en ny återställd resultatrevision.
- Ingen ändring av rawdata, CardReadout, äldre revisioner, klass, bana,
  snapshot, stationspaket eller fryst Complete-XML.
- Ingen generisk editor, ny tid, bulk, automatisk omräkning, återtagande av
  andra beslut, GPS, karta/rutt, stafett eller riktig USB.

## Acceptans

1. Giltig aktuell TASK093-kedja skapar exakt en ny
   `MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL` med originalkällans oförändrade
   resultatvärde.
2. Senare revision, aktiv manuell status, ändrad entry-/klass-/ban-/snapshot-
   grund eller motsägande journal/proveniens avvisas utan write.
3. Samma request-id återger samma journal/revision; ändrad aktör eller intent
   konflikterar utan delwrite.
4. Rådata, CardReadout, originalkälla, TASK093-rättning och äldre Complete-bytes
   förblir oförändrade. Privat historik visar hela trestegskedjan.
5. Publikresultat, Snapshot-IOF, speaker och ny finalisering använder den
   strikt validerade återställda revisionen utan ny status.
6. Svensk 390 px-vy visar teknisk originaltid, felaktig rättning och den
   återställda tiden, kräver granskning och återförsöker exakt samma intent vid
   tappat svar.

## Berörda paket

`domain`, `contracts`, `database`, `application` och `web`. Stationens
transport/protokoll ändras inte.

## Verifieringsplan

Riktade kontrakts- och provenanceinvarianter, isolerat PostgreSQL-prov för
transaktion/replay/projektion/export och ett 390 px browserfall. Berörda
lint/typecheck/build körs efter implementation. Fysisk hårdvara och produktion
påstås inte vara verifierade.
