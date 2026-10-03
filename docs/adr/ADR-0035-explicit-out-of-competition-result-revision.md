# ADR-0035: Explicit individuellt utom tävlan som permanent manuell overlay

- Status: Accepterad
- Datum: 2026-09-01

## Kontext

CODEX_BRIEF anger ”utom tävlan” som V1-status, kräver append-only
resultatrevisioner och förbjuder att senare offlinesynk tyst skriver över en
manuell åtgärd. Kortmotorn producerar endast tekniska `OK`, `MP` och
`UNKNOWN_CARD`; deltagande utanför tävlan är ett verksamhetsbeslut och kan inte
härledas ur kortdata.

Till skillnad från DNF motsäger OOC inte att deltagaren har start-, mål-, tids-
eller splitfakta. Ett status-only-resultat skulle därför kasta bort observerad
teknisk fakta. Samtidigt får en OOC-deltagare inte påverka placering, tid efter,
ledartid eller mixed-course-ranking.

IOF Data Standard 3.0:s pinnade XSD definierar `NotCompeting` som löpning
utanför tävlan. Start, mål, total tid och splits är valfria för individresultat,
medan `Position` enligt schemadokumentationen endast ska finnas för `OK`. XSD:n
uttrycker inte O-Tids actor, manuella beslut, aktivitet över senare revisioner
eller finaliseringsbevis.

## Beslut

### Egen lagrad OOC, oförändrad kortmotor

O-Tid inför `OOC / OUT_OF_COMPETITION` som en strikt manuell medlem i lagrade
`ResultOutcome`. `EvaluationResult`, `evaluateCardReadout`, stationens
kontrakt, SQLite/outbox och device-batch förblir oförändrade.

En ren domänkonstruktor accepterar endast ett fullständigt runtimevaliderat
direkt tekniskt `OK`- eller `MP`-resultat. Den deep-kopierar entry, historisk
klass och bana, eventuella start-/måltider och elapsed, missing/extra controls
och splits exakt och ändrar endast status/reason. Den räknar aldrig om
kortdata, skapar ingen rawdata och fabricerar ingen saknad fakta.

### Immutable decision och exakt target

`not_competing_decision` är verksamhetsbeslut, idempotensjournal och
provenans. Den binder actor/request, race/entry, aktuell entry-/klass-/bana-/
snapshotversion, policyversion, exakt targetrevision och skapad OOC-revision.

Target måste vara entryns absoluta senaste, publicerade och aktiva revision,
strikt direkt readoutbaserad teknisk `OK|MP` och exakt aktuell. Godkänd OK,
DSQ, DNF, DNS, alla restaureringsrevisioner, opublicerad/stale eller korrupt
källa och `UNKNOWN_CARD` avvisas. Servern hoppar aldrig över ett nyare huvud och
väljer aldrig om target efter att intentet frysts.

OOC-revisionen har orsak `MANUAL_OUT_OF_COMPETITION`, null direkt readout,
unik decisionreferens, motorn `out-of-competition-v1` och canonicalt samma
fakta som domänkonstruktorn över target. Decision, revision och actor-audit
committar atomiskt.

### Permanent overlay och gemensam manualgrind

TASK 006K har inget withdrawal. Ett OOC-beslut är därför permanent aktivt i
detta snitt och väljer sin frysta revision som effektivt tävlingsutfall även
om senare ingest eller omräkning appenderar tekniska revisioner. Rawdata och
tekniska revisioner blockeras eller avpubliceras aldrig.

Den centrala entry-låsta application-grinden utökas så att DNS, DSQ, approval,
DNF och OOC är ömsesidigt uteslutande aktiva manuella resultattillstånd. Den
validerar full reciprocal decision-/revision-/withdrawalprovenans och returnerar
exakt ett tillstånd. Dubbelaktiv eller korrupt historik ger konflikt; ingen
prioritetsordning eller fallback finns.

Application-resolvern väljer OOC-overlayn. SQL-vy, trigger, route, React och
IOF-adapter får inte implementera en konkurrerande aktivitetspolicy. Ett
framtida återtagande kräver separat ADR och append-only rättning.

### Databasinvarianter

Migration 0020 är expand-only. Den lägger till capability
`DECIDE_OUT_OF_COMPETITION`, actor kind
`OUT_OF_COMPETITION_ACCESS_CREDENTIAL`, revisionsorsaken
`MANUAL_OUT_OF_COMPETITION`, nullable unik
`result_revision.not_competing_decision_id` och den immutable
`not_competing_decision`-journalen.

Check-, unique- och deferred komposit-FK:er bevisar targetens exakta
`(id, race, entry, revision)`, decision ↔ skapad OOC-revision, samma
race/entry/revisionsnummer och `created = target + 1`. En aktiv OOC per entry
upprätthålls av `UNIQUE(entry_id)` medan withdrawal saknas.

Canonical JSON-likhet, teknisk/publicerad/absolut aktuell target och aktiv-
manual-mutex hör till domain/application under lås. Generiska immutable
triggers skyddar decision och resultatrevision; ingen business-trigger eller
SQL-vy får bära resultatlogik.

### Ranking, publik och IOF

OOC är `NOT_RANKABLE_STATUS`. Endast `OK` deltar i position, tid efter och
mixed-course-bedömning. Gemensam deterministisk statusordning blir `OK`, `MP`,
`DSQ`, `DNF`, `OOC`, `DNS`; detta är ett O-Tid-beslut, inte en påstådd IOF-
regel.

Publikresultat får format 5 och visar ”Utom tävlan” med exakt bevarad teknisk
fakta men utan ranking eller intern provenans. Format 1–4 förblir läsbara.

IOF-adaptern mappar endast explicit lagrat OOC till `NotCompeting`. Den
bevarar source-valid start, mål, Time och SplitTime, förbjuder Position,
TimeBehind och `manualApprovalProof` och serialiserar ingen intern reason,
decision eller target. Saknade förväntade kontroller representeras enligt den
befintliga `SplitTime status="Missing"`-regeln utan fabricerad tid.

### Historik och finalisering

Historikformat 6 får den diskriminerade källan
`MANUAL_OUT_OF_COMPETITION` med decision- och targetidentitet och visar target
→ OOC → eventuell senare teknik. Format 1–5 förblir läsbara och måste bindas
till sina historiska status-/outcomescheman så att OOC inte accepteras i äldre
format av misstag.

Nya klass- och loppsfinaliseringar använder format 6. Basis fryser decision,
target, effektiv OOC-revision och absolut underliggande fysiskt huvud. Senare
teknik gör aktuell basis inaktuell och kräver ny explicit finalisering, men
ändrar aldrig äldre fryst projektion, XML eller hash. Ett strikt OOC täcker
entryn i Complete; serializeraren kräver fortsatt separat finalization proof.

### Säkerhet, idempotens och lås

`DECIDE_OUT_OF_COMPETITION` är en separat racebunden write-capability med
eget tokenprefix, cookies, session, CSRF och actor kind. Access gäller högst
åtta timmar och session högst en timme. Ingen annan capability implicerar
rätten.

Kandidat-GET är privat och bounded. Requesten binder hela frysta intentet.
Exact replay från samma actor återger samma immutable decision och revision
även efter senare data; ändrad actor, target eller version är konflikt.
Browsern auto-retryar aldrig okänd commit.

Transaktionsordningen är session `UPDATE`, credential `UPDATE`, race `SHARE`,
request advisory lock, exact replay, entry `UPDATE`, full manualgrind, absolut
targetkontroll, append och audit. Den delar `race → entry → revision` med
ingest/omräkning och serialiseras mot finaliseringens exklusiva racelås.

## Konsekvenser

- En deltagare kan markeras utom tävlan utan att sann teknisk tid eller splits
  kastas bort eller börjar påverka ranking.
- Sen offlineingest bevaras utan att verksamhetsbeslutet försvinner.
- Resultatstatus, publik, historik, export och finalisering breddas; stationens
  motor, SQLite, outbox och kvittenser gör det inte.
- Utan withdrawal är ett felaktigt OOC permanent aktivt i detta snitt. Nästa
  minsta rättningsuppgift behöver vara ett separat append-only återtagande.

## Databasmigration och återställning

Migration 0020 är additiv. Befintliga resultatrevisioner skrivs inte om.
Nullable kolumn, enumvärden och journal skapas innan writers aktiveras; readers
måste kunna tolka OOC före produktionswrite.

Enumvärden och historik droppas inte vid incident. Route/CLI inaktiveras,
credentials spärras och felet rättas framåt med en additiv migration, eller så
återställs en verifierad full PostgreSQL-backup. Destructive rollback är
förbjuden.

## Avvisade alternativ

- Status-only OOC: kastar bort sann teknisk fakta för en deltagare som faktiskt
  sprang utanför tävlan.
- Rankat OOC eller intern `OK` med flagga: gör statusen osynlig i adapters och
  kan påverka placering/ledartid.
- Härleda OOC från import, klass, readout eller avsaknad: ett
  verksamhetsbeslut kan inte bevisas av tekniska data.
- Låta nästa readout superseda OOC: upphäver en manuell åtgärd utan actor,
  intent eller withdrawal.
- Blockera ingest medan OOC är aktivt: hotar offlinekedjan och rawdatans
  bevarande.
- Återanvända DSQ/DNF/approval-tabell eller generell `MANAGE_RESULTS`: blandar
  skilda verksamhetsbeslut och bryter minsta privilegium.
- Införa withdrawal, utan tidtagning, manuella tider, kontrollneutralisering,
  Eventor, stafett, GPS eller hårdvara: större än snittet.
