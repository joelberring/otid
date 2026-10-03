# TASK104: korrigera observerad starttid i PUNCH-klass

Slutförd 2026-09-20 efter TASK103. ADR-0118 skrevs före produktkod.

## Användarvärde

Tävlingsadministratören kan rätta en dokumenterat felaktig **observerad**
startstämpling för en deltagare i en PUNCH-klass, exempelvis när en
startstations klocka gått fel, utan att påstå att brickans rådata har ändrats.

## Avgränsning

- En `MANAGE_RACE`-administratör, en Entry och dess aktuella publicerade,
  direkta tekniska `OK` eller `MP` med observerad start, mål och löptid.
- Klassen måste vara `PUNCH`; `FIXED` fortsätter använda TASK031:s planerade
  starttid och startavprickning fortsätter använda TASK006W.
- Operatören anger en explicit offsetbunden korrigerad starttid. Den ska skilja
  sig från den observerade starten, ligga före bevarad måltid och inte efter
  någon bevarad matchad kontrollpassering.
- Ett immutable beslut och exakt en ny resultatrevision bevarar källans
  status/reason, måltid, kontrollföljd och avvikelser. Löptid och splitarnas
  tidsvärden räknas om från den nya starten; inga punches eller kontroller
  fabriceras eller ändras.
- Ingen ändring av rawdata, CardReadout, klass, bana, snapshot,
  stationspaket, äldre revisioner eller fryst Complete-XML.
- Ingen saknad start, fri resultateditor, bulkändring, ändrad fast starttid,
  mål-/spliträttning, avkortad bana, GPS, karta/rutt, stafett eller riktig USB.

## Acceptans

1. En giltig PUNCH-källa ger en ny revision med korrigerad start, omräknad
   löptid/split-tider och bevarad mål/status/reason/kontrollfakta.
2. FIXED-klass, saknad observerad start, saknad mål, start efter kontroll/mål,
   aktiv manuell overlay eller stale grund avvisas utan write.
3. Samma request-id återger samma beslut/revision; ändrat intent, annan aktör
   eller ny ingest/omräkning före commit ger konflikt utan delwrite.
4. Rawdata, readout, källrevision, snapshot och tidigare frysta Complete-bytes
   förblir oförändrade; den nya kedjan är läsbar i resultathistoriken.
5. Publikresultat, Snapshot-IOF, speaker och ny finalisering använder bara den
   strikt validerade nya revisionen; gammal Complete exporteras fortfarande från
   sin frysta manifestgrund.
6. Svensk 390 px-vy visar observerad/ny start, beräknad löptid och bekräftelse,
   och återförsöker exakt samma intent efter tappat svar.

## Berörda paket

`domain`, `contracts`, `database`, `application` och `web`. Stationens
transport, protokoll och offlinekö ändras inte.

## Verifieringsplan

Fokuserade domän-/kontraktsinvarianter, ett isolerat PostgreSQL-prov för
transaktion/provenans/publik projektion/historik och ett 390 px browserfall
för granskning/tappat svar. Berörd lint, typecheck och build körs efter
implementation. Fysisk hårdvara, produktionsserver och faktisk startstation
påstås inte vara verifierade.

## Migrations- och återställningsnot

En eventuell migration ska vara additiv: ny revisionsorsak, nullable
proveniensreferens och immutable journal. Vid incident stängs writer och UI;
historik tas inte bort. Återställning sker genom forward-reparation eller
verifierad PostgreSQL-backup, aldrig genom att ta bort enumvärde eller
journal/revisioner.

## Genomfört

Migration0063 lägger till orsaken, den reciprokt bundna immutable journalen och
den nullable proveniensreferensen. Den äldre resultatrevisions-checken utökas
explicit för den nya orsaken; en separat check hindrar den nya referensen från
att samexistera med annan källa. Application läser den sparade PUNCH-kvittensen
som del av proveniensbeviset. Publikresultat och läshistorik passerar samma
stricta revisionsvalidering som export/finalisering/speaker redan återanvänder.

Den kompakta `/manage`-panelen är initialt stängd och erbjuder bara kandidat,
granskning och exakt minnesburen retry. Den har ingen offlinekö och ändrar inte
den befintliga avpricknings- eller fasta-startvägen.

Riktad verifiering med `CI=true`:

- domän: 1 fil, 2/2 tester, exit 0 (513 ms);
- kontrakt: 1 fil, 3/3 tester, exit 0 (857 ms);
- lint och typecheck för domain, contracts, database, application och web:
  exit 0;
- route-handler: 1 fil, 33/33 tester, exit 0 (senaste körning 2,21 s);
- isolerad PostgreSQL17/PostGIS-integration: 1/1 test, exit 0 (932 ms);
- E2E TypeScript och riktad E2E ESLint: exit 0;
- Playwright TASK104: 1/1 test, exit 0 (5,5 s) mot lokal Next/HTTP och
  isolerad migrerad PostgreSQL17/PostGIS på loopback55485;
- web production build: exit 0; kompilerade på 5,5 s, TypeScript på 6,0 s,
  7/7 statiska sidor på 53 ms, checkin-skal `4d58d821acf9`.

Ingen full workspace-, full integrations- eller full browserregression kördes.
Ingen riktig SPORTident-avläsning, startstationsklocka, mobil i fält eller
produktionsserver har verifierats.
