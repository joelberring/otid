# ADR-0013: Beständiga ingestutfall och native stationssynk

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

TASK 005A–B gav stationen en crash-safe SQLite-outbox och lokal, append-only
bedömning, men ingen operativ synk. Servern är idempotent på
`(device_id, local_sequence)`. Dess duplicate-svar återläser däremot endast
`result_revision`; `UNKNOWN_CARD` skapar ingen revision. Om första svaret tappas
efter servercommit kan stationen därför inte återfå den centrala bedömningen.

Android-WebViewens vanliga `fetch` är också en cross-origin-transport medan
device-batch-routen saknar CORS. Capacitor Core, som redan ingår, erbjuder native
HTTP. Kvittensreceipt finns i SQLite men strukturerade `serverResult`-fält tappas
och en retry efter terminal outboxstatus sparas inte.

## Beslut

### Server

PostgreSQL får en additiv append-only-tabell `device_ingest_outcome` med exakt en
rad per `raw_device_message`. Tabellen lagrar runtimevaliderat `server_result`
som JSONB samt dess `evaluation_hash`. Raden skapas i samma eventtransaktion som
rawmeddelande, normaliserad readout och eventuell resultatrevision. Detta gäller
alla bedömningar, även `UNKNOWN_CARD`.

Duplicate-svar läser i första hand ingestutfallet. En läs-fallback till befintlig
resultatrevision behålls för data skapad före migrationen; historiska okända
brickor fabriceras inte. Update och delete av ingestutfall avvisas av trigger.

`ServerResultSummary` får `evaluationHash`: SHA-256 över kontraktets canonicala
UTF-8-JSON av hela `EvaluationResult`. Hashen gör en full bedömning jämförbar utan
att göra batchsvaret stort. Resultatrevisionen är fortsatt auktoritativ historik
för kända deltagare; ingestutfallet är den oföränderliga bedömning som hör till
det första mottagandet och retrykontraktet.

### Station

Stationen använder en injicerbar adapter över Capacitors befintliga native HTTP.
HTTPS är obligatoriskt utom HTTP till loopback i lokal utveckling. Svar har
timeout och storleksgräns och runtimevalideras innan native commit.

005C skickar en pending-post per request. Det ger beständig batchidentitet utan
att lagra en separat in-flight-batch. `Idempotency-Key` sätts till
`{deviceId}:{sequence}:{sequence}`, men serverns faktiska barriär är fortfarande
device och sekvens. Endast explicita per-event-besked ändrar lokal status;
`highestContiguousSequence` är aldrig ett implicit ack.

SQLite schema 3 får append-only `server_ack_observation`. Observationen binder
device, sekvens, raw-id, ackstatus, canonical serverresultat och hash till den
råa receipten. Hash över canonical per-event-ack gör identisk retry idempotent.
Ett nytt giltigt centralbesked appenderas i stället för att äldre data skrivs
över. Annat raw-id för en redan positivt kvitterad sekvens är konflikt.

Ett read-only pluginanrop returnerar senaste outboxpost för valt lopp tillsammans
med eventuell lokal bedömning och senaste centralobservation. TypeScript härleder
jämförelsen; den lagras inte. Samma `evaluationHash` och samma versionskontext
visas som match. Annan motor/snapshot visas som ej direkt jämförbar. Annan hash
eller status visas som avvikelse, och servern märks auktoritativ.

Icke-hemlig normaliserad bas-URL får beständigt lagras. Token och betrodd SPKI
lagras inte i webbstorage eller SQLite.

## API- och autentiseringsavgränsning

Den etablerade routen `/api/races/{raceId}/device-batches` behålls. Briefens
tidigare exempel `/api/v1/events/{eventId}/device-batches` införs inte parallellt.
Routen saknar produktionsautentisering. 005C är därför en lokal/icke-produktions-
bootstrap av transport- och beständighetssemantiken, inte färdig enhetsparning.
En senare ADR måste besluta stationsidentitet, credentialrotation och route-auth.

## Konsekvenser

- Okänd commit kan alltid retryas utan att centralbedömningen försvinner.
- Lokal historik visar vad servern faktiskt svarade även efter omstart.
- Full likhet kan verifieras genom hash utan att exponera hela bedömningen i ack.
- En event/request ger fler HTTP-anrop men minimerar crash-state och håller
  implementationen avgränsad. Fler-event-batcher kan senare optimeras separat.
- Nya serverutfall ersätter inte resultatrevisioner och ändrar ingen domängräns.
- Verklig Android-nättrafik kräver fortfarande connected test på fungerande
  emulator eller fysisk enhet.

## Migration och återställning

PostgreSQL-migrationen är endast additiv. Automatisk destruktiv rollback är inte
tillåten. Vid nödvändig återgång exporteras den nya tabellen och databasen
återställs från verifierad backup eller förs framåt med en korrigerande migration.

SQLite migrerar sekventiellt 1→2→3 eller direkt 2→3 och skriver inte om äldre
rader. Gamla receipts markeras indirekt som att strukturerad central observation
saknas. Downgrade 3→2 blockeras; återställning kräver hel v2-backup.

## Avvisade alternativ

- Enbart återläsa `result_revision`: förlorar `UNKNOWN_CARD` vid retry.
- Tolka gamla receipt-JSON vid varje UI-läsning: valideringen var för svag och
  senare observationer efter terminal status tappas.
- Vanlig WebView-fetch med bred CORS: gör Androidtransporten beroende av webb-
  origin och breddar serverns yta utan behov.
- Flera events per batch utan beständig batchgräns: requestidentiteten kan ändras
  efter processdöd när nya events tillkommer.
- Lagra härledd jämförelsestatus: duplicerar data och kan bli stale.
