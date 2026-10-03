# TASK093: korrigera observerad måltid för en deltagare

Påbörjad 2026-09-19 efter TASK092. ADR-0111 skrevs före produktionskod.

## Användarvärde

Tävlingsadministratören kan rätta en känd felaktig måltid för en enda deltagare
utan att förlora brickans faktiska avläsning eller skapa en fri resultateditor.

## Avgränsning

- En `MANAGE_RACE`-administratör, en Entry och en aktuell publicerad direkt
  teknisk `OK` eller `MP` med start, mål och tid.
- Explicit offsetbunden korrigerad måltid; den måste ligga efter start och
  senaste matchade split.
- Immutable beslut och exakt en ny resultatrevision med full källprovenans.
- Ingen ändring av rawdata, CardReadout, kontroller, klass, bana, snapshot,
  stationspaket, äldre revisioner eller frysta Complete-XML.
- Ingen auto-/bulk-omräkning, saknad målstämpling, ändrad starttid, split-
  rättning, avkortad bana, GPS, karta/rutt, stafett eller riktig USB.

## Acceptans

1. En giltig OK- respektive MP-källa ger exakt en ny revision med korrigerad
   måltid/löptid och bevarade controls/splits/status/reason.
2. Saknad start/mål, tid före start/sista split, manuell aktiv status eller
   stale source avvisas helt utan write.
3. Samma request-id återger samma beslut/revision; ändrat intent eller ny
   ingest/omräkning före commit konflikterar.
4. Rådata, readout, källrevision, snapshot och tidigare frysta Complete-bytes
   är oförändrade; den nya revisionen är spårbar i historiken.
5. Publikresultat, Snapshot-IOF och en ny finalisering använder den strikt
   validerade nya revisionen utan ny status.
6. Svensk 390 px-vy visar gammal/ny måltid samt löptid, kräver granskning och
   återförsöker exakt samma intent vid tappat svar.

## Berörda paket

`domain`, `contracts`, `database`, `application` och `web`; stationens
transport/protokoll ändras inte.

## Verifieringsplan

Riktade kontrakts- och domäninvarianter, ett isolerat PostgreSQL-prov för
transaktion/provenans/export/finalisering och ett 390 px browserfall. Berörda
lint/typecheck/build körs efter implementation. Fysisk hårdvara och produktion
påstås inte vara verifierade.

## Genomfört

Kontrakten, den nya revisionsorsaken, immutable journalen och dess additiva
provenienskomplettering i migration0058–0059 är implementerade. Den gemensamma
state-loadern validerar nu exakt källbevis och publikresultat, Snapshot-IOF,
speaker, admin, målrutin samt finalisering skickar proofen vidare. Den
entry-låsta application-skrivaren och den privata resultathistoriken (format
V11) bevarar och visar den minimala korrektionskedjan.

Den gemensamma `/manage`-vyn innehåller ett initialt stängt, svenskt
tvåstegsflöde. Administratören väljer deltagare, hämtar exakt kandidat, ser
bevarad start/mål/löptid/senaste split, anger måltid med explicit UTC-offset
och granskar beräknad ny löptid före commit. Route och kvittens är strikt
entry-/race-scopade; ett tappat svar lämnar samma request-id, idempotensnyckel
och body kvar för exakt retry. Browseracceptansen på 390 px bekräftar den
kedjan, ny revision och oförändrade råmeddelanden.
