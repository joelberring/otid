# ADR-0010: Konkurrenssäker ingest och paketmedveten kvittens

- Status: Accepterad
- Datum: 2026-08-30

## Kontext

TASK 001 allokerar nästa resultatrevision med `max(revision) + 1`. Två
samtidiga stationer kan därför läsa samma maxvärde och försöka skapa samma
revision. Uniknyckeln skyddar databasen från dubbelnumrering men gör att en
giltig request kan rullas tillbaka, vilket strider mot produktkravet att rådata
ska bevaras och att flera stationer ska kunna arbeta samtidigt.

Ingestsvaret saknar dessutom ett delat runtimevaliderat kontrakt, aktuell
snapshot-/paketversion och en uttrycklig signal när stationens paket är stale.
Klienten kan därmed inte säkert skilja en hållbar kvittens från ett oväntat
svarsformat eller veta att ett nytt tävlingspaket behövs.

## Beslut

PostgreSQL-radlås används inom den befintliga modulära monoliten. Ingen separat
sekvenstjänst, Redis eller ny revisionsräknartabell införs.

Alla berörda transaktioner följer låsordningen `race -> entry -> revision`:

- resultatutvärdering tar `FOR SHARE` på loppet innan en sammanhängande
  `RaceSnapshot` läses,
- import och klassändring tar `FOR UPDATE` på loppet innan de muterar data som
  tillhör snapshoten eller höjer `snapshot_version`,
- ingest och explicit omräkning tar `FOR UPDATE` på deltagaren innan de läser
  `max(revision)` och skapar nästa append-only-revision.

Flera ingests för olika deltagare kan hålla delade lopplås samtidigt. Ingests
för samma deltagare serialiseras endast vid revisionsallokeringen. Mutationer
av tävlingssnapshoten väntar tills pågående utvärderingar har committat och
tvärtom. Den gemensamma låsordningen ska förhindra korsande race-/entry-lås.

Device-batchsvaret definieras och valideras i `packages/contracts`. Det
innehåller:

- device-id och högsta sammanhängande permanent lagrade sekvens,
- aktuell serverpaketversion,
- `packageVersionStatus`: `current`, `stale` eller `ahead`,
- `packageUpdateRequired`, som endast är sann för `stale`,
- en ordnad kvittens per händelse med sekvens och innehållshash,
- stabil status `stored`, `duplicate` eller `rejected`,
- beständig raw-message-identitet för lagrade/dubbla poster,
- serverresultat med motor- och snapshotversion när det finns.

En äldre eller oväntat ny paketversion avvisar inte rådata. Servern beräknar
med sin aktuella, låsta snapshot och gör avvikelsen synlig i svaret. En klient
får endast ta bort exakt den lokala posten efter en runtimevaliderad `stored`
eller `duplicate` vars frysta device-, paket-, sekvens- och hashidentitet
matchar. Lokala köposter äger därför `queueId`, `deviceId` och `sessionId`; de
får inte ärva en senare global enhetsidentitet. HTTP-fel eller ett ogiltigt
2xx-svar stoppar ordnad flush eftersom commitstatus då är okänd.

Innehållshashfel och sequence/hash-konflikt är uttryckliga per-event-avslag och
hindrar inte senare, oberoende händelser i samma validerade batch. Oväntade
databas- eller systemfel får däremot requesten att misslyckas; servern får inte
låtsas att en okänd commitstatus är ett säkert `rejected`.

## Konsekvenser

- Giltiga samtidiga avläsningar för samma bricka kan få obrutna
  resultatrevisionsnummer utan retry på uniknyckelfel.
- Resultatets `snapshotVersion` avser en sammanhängande server-snapshot.
- Tävlingsmutationer och resultatutvärdering får kortvarig radlåskonkurrens på
  loppet; detta ska lasttestas mot V1-målet 20 händelser/sekund innan fältdrift.
- Ingen schemaändring eller destruktiv migration behövs.
- Detta bygger inte den lokala offlinekön eller ett signerat tävlingspaket, men
  etablerar det kvittenskontrakt de senare ska använda.
- Beslutet ändrar inte SPORTident-, kart-, rutt- eller resultatdomängränser.
