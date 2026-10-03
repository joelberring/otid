# TASK 005M – begränsad och strikt device-batch-ingress

## Syfte

Ersätt den autentiserade device-batch-routens obegränsade `request.json()` med
en explicit HTTP-kuvertgräns som avvisar fel race/scope före första bodybyte och
därefter begränsar faktisk streamstorlek, medietyp, UTF-8, JSON och fältmängd.

Snittet ändrar inte stationcredentialens livscykel, batchens domäninnehåll,
sekvens-/hashidempotens, ingesttransaktionen, rawdata, resultatrevisioner,
kvittenskontraktet eller stationens offlinekö. Det lägger inte till rate-limit,
reverse proxy, fler-event-batchning i Android, SPORTidentparser, riktig USB,
stafett, GPS eller annan senare funktion.

## Berörda paket

- `packages/contracts`: yttre batch- och eventobjekt avvisar okända fält i
  stället för att tyst strippa dem.
- `apps/web`: injicerbar routeorkestrering och en purpose-specific begränsad
  JSON-läsare.
- `apps/station`: endast regressionsbevis för oförändrad kö vid 413/415; ingen
  produktionskod ändras.
- `tests`: route-, kontrakts-, PostgreSQL-, Playwright- och standalonebevis.
- `docs`: ADR, arkitektur, offlinekonsekvens, acceptans och status.

`packages/domain`, resultatmotorn, `packages/application`, databasschema,
Androidtransport och worker ändras inte. Ingen migration eller dependency
behövs.

## Avgränsat flöde

1. Routen väntar på race-id och autentiserar bearercredentialen utan att dra
   requestbodyn.
2. Fel route-race eller annan scope än `READOUT` ger 403 före första bodybyte.
3. Endast exakt `Content-Type: application/json` accepteras; avvikelse ger ett
   generiskt privat 415.
4. Om `Content-Length` finns måste det vara canonical osignerad decimal och
   ligga mellan 1 och 4 194 304 bytes. För stor deklaration ger 413; malformed,
   noll eller senare mismatch mot faktiskt antal ger 400. Saknad header tillåts
   för chunked transport och ger ingen bypass.
5. Servern läser Web `ReadableStream` inkrementellt, räknar faktiska bytes och
   avbryter/cancel vid byte 4 194 305. Detta ger 413 oberoende av deklarerad
   längd.
6. Tom body avvisas. Bytes avkodas med fatal UTF-8 och parsas som JSON; fel ger
   ett generiskt privat 400 utan parserdetalj.
7. Det delade Zod-kontraktet validerar hela värdet. `deviceBatchSchema` och
   `deviceEventSchema` är uttryckligen strict, liksom payload och punch, så
   okända fält avvisas i stället för att strippas.
8. Först därefter binds body-`deviceId` till credentialen, exakt
   `deviceId:firstSequence:lastSequence` kontrolleras och befintlig
   `ingestDeviceBatch` anropas oförändrad.
9. Giltig första request och exakt retry ger fortsatt `stored` respektive
   `duplicate`; serverfel ger generiskt privat 500 och fabricerar aldrig
   per-event-avslag.
10. Alla icke-2xx lämnar simulatorns och Androidstationens enda lokala kopia
    kvar och stoppar ordnad flush med okänt/avvisat utfall.

## Vald kuvertstorlek

Serverns gräns är 4 MiB. Det delade wirekontraktet tillåter 1–100 events och upp
till 256 punches per event; ett normalt maximalt 100×256-prov är cirka
1,5–2 MiB. Ett servermaximum på Androidklientens 512 KiB skulle därför göra en
realistisk kontraktsgiltig multi-event-batch omöjlig.

Androidstationen behåller avsiktligt sin snävare, redan verifierade policy:
exakt ett event och högst 512 KiB fixed-length UTF-8. Webbsimulatorn skickar
också ett event. Ingen klient behöver ändras.

ISO-schemat tillåter tekniskt godtyckligt lång sekundfraktion. Därför är 4 MiB
ett externt HTTP-kuvertkontrakt, inte ett påstående att varje matematiskt
Zod-giltig representation ryms. Tidsnormalisering eller fler-event-lagring är
separata framtida beslut.

## Fel- och säkerhetsgräns

- 400: ogiltig längd/mismatch, tom body, UTF-8, JSON, schema eller
  idempotency-key.
- 401: bearer saknas, är malformed, utgången eller spärrad.
- 403: credentialen har fel race/scope eller body-device.
- 413: deklarerad eller faktisk body över 4 MiB.
- 415: annan eller parameteriserad medietyp än exakt `application/json`.
- 500: oväntat auth-, ingest- eller responsekontraktsfel.

Alla svar är `no-store, private`, `default-src 'none'` och `nosniff`.
Credential-, body-, Zod-, databas- och exceptiondetaljer lämnas aldrig. En
reverse proxy kan buffra före Next och måste i drift få samma eller snävare
gräns; proxyimplementation och rate-limit ligger utanför detta snitt.

## Migration och återställning

Ingen databasmigration görs. Rollback får inte återinföra obegränsad
`request.json()`. Återställning sker genom korrigerande kod som behåller auth-
före-body och en finite faktisk streamgräns. Inga rawposter, köposter eller
resultatrevisioner migreras eller raderas.

## Acceptans

- 401 samt rätt credential för fel race/scope drar noll bodychunks och anropar
  aldrig ingest.
- Exakt medietyp, canonical deklarerad längd, faktisk max/max+1, chunked bypass,
  cancel, tom body, fatal UTF-8, JSON och faktisk/deklarerad mismatch provas.
- Okända top-level-, event-, payload- och punchfält avvisas generiskt utan
  ingest; korrekt batch vidarebefordras oförändrad.
- Ett realistiskt giltigt 100×256-prov under 4 MiB når mockad ingest. Exakt
  4 MiB syntaktisk JSON kan läsas medan byte 4 MiB+1 ger 413.
- Fel race/device/scope/key och auth-/ingest-/ackfel ger rätt detaljfria status
  och privata headers.
- PostgreSQL/E2E bevisar noll raw/readout/outcome/revision vid avslag och att en
  efterföljande giltig request med samma sekvens blir `stored`, sedan
  `duplicate` vid exact retry.
- Stationstest bevisar att 413/415 lämnar pending orörd och inte applicerar ack.
- Standalone-proben med död databas får 401 på en oavslutad chunked request utan
  att vänta på body completion eller försöka ansluta till databasen.
- Lint, typecheck, enhets-, PostgreSQL-integrations-, Playwright-, standalone-
  och buildgrind körs och redovisas exakt.

Se ADR-0023.
