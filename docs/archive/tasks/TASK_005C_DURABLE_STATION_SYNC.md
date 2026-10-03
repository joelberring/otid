# TASK 005C – beständig stationssynk och central grundjämförelse

## Syfte

Knyt Androidstationens beständiga outbox till det befintliga device-batch-API:t
utan att försvaga offlinegarantierna. Ett tappat HTTP-svar ska kunna återvinnas
med en säker retry, även när brickan är okänd, och operatören ska kunna se om
stationens lokala grundbedömning motsvarar serverns auktoritativa besked.

Detta är nästa minsta vertikala snitt efter TASK 005B. Snittet omfattar inte
SPORTidentprotokoll, riktig USB, stafett, GPS, automatisk paketuppdatering eller
full produktionsparning av enheter.

## Berörda paket

- `packages/contracts`: versionsmärkt serverutfall med hash över full bedömning.
- `packages/database`: additiv PostgreSQL-migration för append-only ingestutfall.
- `packages/application`: lagra utfallet i samma transaktion och återläs det vid
  duplicate-retry.
- `apps/station`: native HTTP-adapter, single-flight-synk, SQLite schema 3,
  strukturerade kvittensobservationer och svensk statusvy.
- `docs`: arkitektur, offlineprotokoll, acceptanstest och status.

## Avgränsat flöde

1. Stationen läser den tidigaste pending-posten ur SQLite.
2. Den omvaliderar fryst payload och innehållshash och skickar exakt ett event
   till `/api/races/{raceId}/device-batches` via Capacitors native HTTP-klient.
3. Hela svaret runtimevalideras och måste vara en bijektion mot skickad device,
   sekvens och hash innan native lagring anropas.
4. Native lagrar rå kvittens och en strukturerad append-only observation i samma
   transaktion som outboxstatus blir `ACKNOWLEDGED` eller `REJECTED`.
5. Nätfel, timeout, HTTP-fel, ogiltig body eller lokalt commitfel lämnar posten
   `PENDING` och stoppar ordnad flush.
6. Identisk retry är idempotent. Ett senare, giltigt centralbesked appenderas som
   en ny observation utan att skriva över äldre historik.
7. UI:t visar serverkontakt, paketstatus, kö och en versionsmedveten jämförelse
   av lokal och central bedömning. Servern markeras alltid som auktoritativ.

Single-event-batcher väljs i detta snitt. Serverns idempotens ligger per event;
valet ger dessutom en crash-stabil batchgräns utan ännu en lokal state machine.
Batchning av flera events är en senare optimering.

## Beständighet och migration

- PostgreSQL får en append-only rad per råmeddelande med den första fullständiga
  serverbedömningen, inklusive `UNKNOWN_CARD`.
- Serverutfallet sparas före transaktionscommit och används för duplicate-svar.
- Android SQLite höjs additivt från schema 2 till 3. Både 1→2→3 och 2→3 ska
  bevara device-id, paket, outbox, receipts och lokala bedömningar.
- Gamla kvittenser backfillas inte till strukturerade observationer.
- En observation identifieras av device, sekvens och hash över canonical
  per-event-kvittens. Update och delete förbjuds med triggers.
- Bas-URL får lagras som icke-hemlig stationskonfiguration. Bearer-token och
  betrodd SPKI får fortsatt endast finnas i minnet.

PostgreSQL-rollback är restore/roll-forward: produktionsdata droppas inte
automatiskt. Före en eventuell manuell nedtagning av den nya tabellen ska dess
data exporteras och en verifierad full backup finnas. SQLite-downgrade 3→2
blockeras; återställningspunkten är en hel databaskopia tagen före uppgradering.

## Säkerhets- och kontraktsgräns

- HTTPS krävs, utom explicit loopback-HTTP för lokal utveckling.
- Capacitors redan installerade native HTTP används; ingen ny dependency läggs
  till och cross-origin-webbfetch används inte som Androids transport.
- `highestContiguousSequence` används endast som information och får aldrig
  implicit kvittera lokala poster.
- `stale` och `ahead` stoppar inte rådata. Ingen automatisk downgrade sker.
- Ingest-routen saknar fortfarande produktionsautentisering. Detta snitt skickar
  inte hemligheter till en route som inte verifierar dem och påstår inte att
  bootstrapflödet är produktionssäkert.
- Befintlig route behålls som kompatibilitetsyta; briefens `/api/v1/events/...`
  introduceras inte som en tredje parallell variant.

## Acceptans

- Förlorat första svar följt av retry ger `duplicate` med samma `rawMessageId`,
  samma `evaluationHash` och samma serverutfall, även för `UNKNOWN_CARD`.
- Servern har exakt en raw/readout/ingest-outcome per accepterat event.
- Stationen skickar endast omvaliderad payload med korrekt fryst hash och
  `Idempotency-Key: {deviceId}:{sequence}:{sequence}`.
- Partiell, extra, omordnad eller motsägande kvittens appliceras inte.
- Nät-/HTTP-/parse-/nativefel bevarar pending och stoppar ordnad flush.
- Exakt retry skapar ingen dubblettobservation; ett nytt centralbesked bevarar
  både den äldre och den nya observationen.
- Migration 1→3 och 2→3 är additiv och bevarar tidigare data.
- UI skiljer match, avvikelse, versionsskillnad, väntande, saknat besked och
  rejection med text/symbol och utan att förlita sig på färg.
- Lint, typecheck, enhets-, PostgreSQL-integrations-, webb-E2E-, Android JVM-,
  Android lint- och buildgrindar körs. Instrumentering kompileras; runtime anges
  explicit om emulator eller fysisk enhet saknas.

Se ADR-0013.
