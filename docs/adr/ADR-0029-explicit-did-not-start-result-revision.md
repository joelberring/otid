# ADR-0029: Explicit ej-startbeslut som resultatrevision

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

ADR-0028 kräver en senaste publicerad resultatrevision för varje aktuell entry
innan en klass kan finaliseras. Det är avsiktligt fail closed, men en verklig
icke-startare saknar kortavläsning och kan därför inte få ett sanningsenligt
resultat genom den nuvarande kortmotorn. Att tolka "ingen avläsning" som DNS
vore osäkert: deltagaren kan vara kvar i skogen, avläsningen kan ligga offline
eller en operatör kan ha missat ett arbetsmoment.

CODEX_BRIEF skiljer rå hårdvarudata, normaliserad avläsning, beräknat resultat
och manuellt beslut. Samtidigt är `result_revision` den auktoritativa
append-only-historiken som publikresultat, IOF-export och finalisering läser.
Ett ej-startbeslut måste därför både ha en egen manuell provenans och skapa en
resultatrevision, utan en syntetisk `card_readout`.

IOF Data Standard 3.0 har den uttryckliga statusen `DidNotStart`. I ett
individuellt resultat är `Status` obligatorisk medan tider, position och splits
är valfria. Det stöder en status-only-projektion, men säger inte hur O-Tid ska
bevisa att beslutet är sant.

## Beslut

### Separat manuellt resultat, oförändrad kortmotor

O-Tid inför `DNS / DID_NOT_START` som en separat strikt domänresultattyp.
`EvaluationResult` och `evaluateCardReadout` förblir begränsade till
`OK | MP | UNKNOWN_CARD`; stationens lokala bedömningskontrakt breddas inte.
En ny `ResultOutcome`-union används endast där lagrade resultatrevisioner kan
komma från antingen kortmotorn eller ett explicit manuellt beslut.

DNS-resultatet innehåller entry, historisk klass och historisk banversion men
inga start-/måltider, total tid, missing/extra controls eller splits. En ren
domänfunktion konstruerar resultatet och en explicit policyversion sparas som
revisionsprovenans. Banversionen bevisar vilken aktuell klass-/banbasis beslutet
avsåg; den påstår inte att banan genomfördes.

### Egen immutable beslutskälla och resultatrevision

Migration 0014 inför en append-only `did_not_start_decision`. Den är både det
manuella verksamhetsbeslutet och idempotensjournalen och binder request, aktör,
race, entry, väntad entry-/klass-/ban-/snapshotversion, väntat revisionshuvud,
policyversion och beslutstid.

`result_revision` får en nullable `readout_id` och en nullable unik
`did_not_start_decision_id`. En databasconstraint kräver exakt en källtyp:

- `MANUAL_DID_NOT_START` har null `readout_id`, icke-null beslut, `DNS` och
  `DID_NOT_START`;
- alla äldre orsaker har icke-null `readout_id`, null beslut och får inte bära
  DNS-paret.

Evaluation-JSON-kolumnens historiska namn behålls migrationssäkert, men dess
runtime-typ blir den diskriminerade lagrade `ResultOutcome`-unionen. Ingen
syntetisk rawpost eller avläsning skapas. Beslut, revision och audit committar
atomiskt och båda verksamhetsraderna avvisar update/delete.

### Smal första beslutspolicy

TASK 006E tillåter DNS endast när entryn saknar samtliga tidigare
resultatrevisioner. Detta löser den uttryckliga icke-startaren utan att samtidigt
införa en generell resultateditor eller policy för att återta ett verkligt
kortresultat. Intentet måste matcha exakt aktuell entryversion, klass,
klassens banversion, race-snapshot, tomt revisionshuvud och policyversion.

En senare riktig avläsning är inte förbjuden. Ingest appendar då nästa
CARD_READOUT-revision och korrigerar historiken framåt. Ett felaktigt DNS-beslut
utan senare avläsning kräver ett framtida separat återtagningsbeslut; den
historiska raden får aldrig raderas.

### Säkerhet, idempotens och lås

`DECIDE_DID_NOT_START` är en separat racebunden capability. Den delar
hash-only-credentialsubstrat men har eget prefix, cookies, högst åtta timmars
access, högst en timmes session, Origin-/CSRF-kontroll, request-ID och
auditaktör. Ingen annan capability implicerar denna rätt.

Kandidat-GET är privat och bounded. Mutationen binder hela frysta intentet.
Exakt retry från samma aktör återger samma beslut och resultatrevision; ändrad
aktör, target eller intent med samma request-id är konflikt.

Transaktionsordningen är session `UPDATE`, credential `UPDATE`, race `SHARE`,
request advisory lock, entry `UPDATE`, beslut, revision och audit. Därmed
serialiseras DNS mot ingest och omräkning per entry och mot finalisering via
race-låset utan att snapshotversionen ändras.

### Ranking, IOF och finalisering

DNS är `NOT_RANKABLE_STATUS`. Endast OK deltar i placering, tid efter och
mixed-course-kontroll. Publikresultat visar svensk text utan tid/splits/ranking.

IOF-adaptern mappar exakt DNS till `DidNotStart` och kräver status-only:
inga tider, position, tid efter, expected controls eller splits. Liveexporten
förblir `Snapshot`; `Complete` kräver fortsatt ADR-0028:s frysta bevis.

En publicerad DNS-revision täcker en entry i finalisering endast när dess
snapshot, klass, bana och strikta utgång är aktuella. Den löser aldrig en
`UNKNOWN_CARD`-avläsning eftersom den saknar readoutkoppling.

## Konsekvenser

- En verklig icke-startare kan behandlas och exporteras utan påhittad hårdvara.
- Kortmotorn och stationens offlinebedömning behåller sin nuvarande semantik.
- Nullable `readout_id` är säkert endast tillsammans med den nya
  källconstrainten och den unika beslutskopplingen.
- Publik-, historik-, export- och finaliseringsprojektioner måste förstå den
  lagrade `ResultOutcome`-unionen och får inte fortsätta anta att varje revision
  har en readout.
- Den första policyn kan inte återta ett felaktigt DNS utan en senare riktig
  resultatrevision. Det är en avsiktlig avgränsning.
- Stationens paket, SQLite, outbox, ingestkontrakt och kvittenser ändras inte.

## Databasmigration och återställning

Migration 0014 är expand-only: enumvärden, capabilitycheck, beslutstabell,
nullable källkolumn, ny besluts-FK och en validerad källconstraint läggs till.
Befintliga resultatrevisioner skrivs inte om och validerar som readoutbaserade.

Produktionsrollback får inte droppa enumvärden, beslut, revisioner eller audit.
Vid incident inaktiveras DNS-routes/CLI, credentials spärras och felet rättas
framåt med en additiv migration. Annars återställs en verifierad full
PostgreSQL-backup.

## Avvisade alternativ

- Härleda DNS från saknad avläsning: kan göra en aktiv eller osynkad deltagare
  till officiell icke-startare utan beslut.
- Skapa syntetisk rawpost/card readout: förfalskar hårdvaruhistorik och bryter
  rådatagränsen.
- Lagra endast manual decision: publik/export/finalisering väljer
  resultatrevisioner och skulle få två konkurrerande resultatkällor.
- Återanvända `RECALCULATE_RESULT` eller `FINALIZE_RESULTS`: bryter minsta
  privilegium och blandar skilda verksamhetsbeslut.
- Låta DNS skriva över OK/MP i detta snitt: kräver en större återtagnings- och
  jurybeslutspolicy.
- Göra banversion nullable: försvagar aktualitets-, klass- och
  finaliseringsbeviset utan att behövas för en status-only IOF-projektion.
- Låta stationens kortmotor producera DNS: frånvaro kan inte avgöras från ett
  kortmeddelande och ska inte påverka offlinebedömningen.

