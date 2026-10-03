# ADR-0023: Begränsat och strikt HTTP-kuvert för device-batcher

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

`POST /api/races/{raceId}/device-batches` autentiserar bearercredentialen före
`request.json()`, men JSON-anropet buffrar en obegränsad body utan exakt
medietyp, faktisk bytegräns eller fatal UTF-8. Race/`READOUT`-scope kontrolleras
först efter parsning. En anonym klient når inte bodyn, men en giltig credential
för fel race eller en komprometterad credential kan tvinga Next-processen att
buffra godtyckligt mycket data.

Det delade Zod-kontraktet begränsar kardinalitet till 100 events och 256 punches
per event, men en schemavalidering som körs efter full buffering är ingen
transportgräns. Dessutom är payload och punch strict medan de yttre event- och
batchobjekten tyst strippar okända fält. Det strider mot projektets krav att
requestkontrakt ska valideras och gör innehållshash-/auditresonemang svårare.

Androids native klient begränsar redan sin single-event-body till 512 KiB,
sätter fixed-length UTF-8 och exakt `application/json`. Serverkontraktet är
avsiktligt bredare och tillåter upp till 100 events. Ett normalt maximalt
100×256-kuvert är cirka 1,5–2 MiB, så Androidgränsen kan inte återanvändas som
generell servergräns utan att motsäga wirekontraktet.

## Beslut

### Auth och race-scope före första bodybyte

Routens ordning blir bindande:

```text
route race-id
  -> bearer authentication
  -> principal race + READOUT scope
  -> media/declaration + bounded byte stream
  -> fatal UTF-8 + JSON + strict schema
  -> principal device binding
  -> exact idempotency key
  -> unchanged ingest use case
```

Saknad/fel bearer ger 401 och fel route-race/scope 403 utan att bodystreamen
dras. Device-id kan endast verifieras efter begränsad parsing och kontrolleras
därför separat därefter. Auth- och ingestundantag maskeras som privata 500.

### Ett purpose-specific 4 MiB-kuvert

Webbadaptern får en egen liten deterministisk reader; de olika adminreaders
refaktoreras inte brett. Den kräver exakt `application/json`. En befintlig
`Content-Length` måste vara canonical decimal 1–4 194 304 och måste efter
läsning matcha faktiskt antal. Saknad header accepteras för chunked requests.

Streamen räknas inkrementellt och cancelas när nästa chunk passerar gränsen.
Tom body, malformed/mismatchad längd, ogiltig UTF-8 eller JSON avvisas före
schema och ingest. Gränsen gäller faktiska bytes och kan inte kringgås med
saknad eller falsk deklaration.

4 MiB bevarar realistiska 100×256-batcher med marginal. Android behåller exakt
ett event och 512 KiB som en snävare klientpolicy; detta snitt inför inte
multi-event-lagring i stationen. Eftersom ISO-regexen tillåter obegränsad
sekundfraktion är kuvertgränsen en separat extern transportregel, inte ett
matematiskt schema-maximum.

### Strikt fältmängd och stabil HTTP-semantik

`deviceEventSchema` och `deviceBatchSchema` blir `.strict()`. Payload och punch
är redan strict. Okända fält ger samma detaljfria invalid-request som annan
schemavvikelse och skickas aldrig vidare till hash-, raw- eller resultatlogik.

Statuspolicy är 400 för malformed/tom/mismatchad body, UTF-8, JSON, schema och
idempotens; 413 för deklarerat eller faktiskt overflow; 415 för fel medietyp;
401/403 för auth/authz och 500 för interna fel. Alla svar behåller stationens
privata headers. Inga Zod- eller exceptiontexter lämnas.

Stationen behandlar redan alla non-2xx som misslyckad synk före
`applyAcknowledgements`. Pendingposten ligger därför kvar och ordnad flush
stannar. `stored`/`duplicate`, ackkontrakt, transaktion och idempotens ändras
inte.

## Konsekvenser

- Next-processen buffrar högst 4 MiB för en redan race-auktoriserad request.
- Anonyma och cross-race requests konsumerar ingen body i handlern.
- Okända yttre fält kan inte längre tyst försvinna mellan mottagen och validerad
  representation.
- Android och simulator fortsätter skicka exakt samma bodies och behöver ingen
  produktionsändring.
- En reverse proxy kan fortfarande buffra före applikationen. Samma eller
  snävare proxygräns, rate-limit och TLS-verifiering återstår operativt.
- Ingen ny dependency, migration, domainregel eller hårdvarufunktion behövs.

## Migration och återställning

Ingen schema- eller datamigration behövs. Kodrollback får inte återöppna
obegränsad JSON-buffering eller body-pull före auth/race-scope. En korrigerande
roll-forward ska behålla finite faktisk bytegräns och befintliga kö-/rawdata-
invarianter. Full databasåterställning berörs inte.

## Avvisade alternativ

- Behålla `request.json()` och lita på Zod: storleken kontrolleras för sent.
- Lita enbart på `Content-Length`: saknad, chunked eller falsk header kringgår
  deklarationskontrollen.
- Sätta servergränsen till Androids 512 KiB: bryter realistiska giltiga
  100-event-batcher i det delade serverkontraktet.
- Sätta 2 MiB exakt runt ett uppmätt maxprov: lämnar för liten marginal för
  tillåtna wirefält och representationer.
- Obegränsat stöd för varje Zod-giltig tidssträng: omöjligt med finite
  transportgräns och saknar operativt värde.
- Gemensam refaktor av alla bodyreaders: bredare än snittet och ökar
  regressionsytan.
- Enbart reverse-proxygräns: saknas i lokal/testdrift och är inte en
  applikationsinvariant.
- Rate-limit eller ny credentialmodell: separata säkerhetsbeslut.
- Radera pendingpost på 400/413/415: kan förlora den enda lokala kopian och
  bryter offlineprincipen.
