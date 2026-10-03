# ADR-0037: Explicit individuellt utan tidtagning som status-only overlay

- Status: Accepterad
- Datum: 2026-09-01

## Kontext

CODEX_BRIEF anger ”utan tidtagning” som en egen V1-status, men definierar inte
dess interna representation, relation till tekniskt resultat eller IOF 3.0.
Kortmotorn producerar endast tekniska `OK`, `MP` och `UNKNOWN_CARD`; beslutet
att inte publicera eller ranka en teknisk tid är ett verksamhetsbeslut.

O-Tids pinnade IOF 3.0-XSD har ingen ”utan tidtagning”-status. `OK` betyder
”Finished and validated”, `NotCompeting` betyder löpning utanför tävlan, och
schemadokumentationen kräver att varje känd bankontroll representeras som
`SplitTime`. Att skriva status-only `OK` skulle därför dölja den effektiva
icke-rankade betydelsen och bryta IOF:s dokumenterade splitsemantik. Att skriva
`NotCompeting` skulle sammanblanda NT med O-Tids separata OOC-beslut.

Samtidigt kräver offlinearkitekturen att senare readout aldrig tyst upphäver
ett manuellt beslut, att rawdata och tekniska revisioner bevaras och att all
resultatlogik ligger i domän/application i stället för React, SQL eller XML-
adapter.

## Beslut

### Egen lagrad NT, oförändrad kortmotor

O-Tid inför `NT/WITHOUT_TIMING` som en strikt lagrad `ResultOutcome`, inte som
`EvaluationResult`. Betydelsen är: deltagaren har ett direkt tekniskt,
validerat genomförande men ska inte ha ett aktivt tävlingsresultat med tid eller
ranking.

En ren domänkonstruktor accepterar endast direkt tekniskt `OK/COMPLETE` med
canonical entry-, historisk klass- och banidentitet. Den nya status-only-
revisionen kopierar bara dessa tre identiteter. Start, mål, elapsed,
missing/extra controls och splits stannar i det immutable targetet och får
varken kopieras, räknas om eller fabriceras i NT-outcome.

`MP` avvisas: ”utan tidtagning” får inte dölja ett tekniskt felresultat.
Manuellt godkänt `OK` avvisas eftersom det inte är en direkt teknisk källa.
Stationens kontrakt, SQLite/outbox, device-batch och kvittenser breddas inte.

### Immutable decision och exakt target

`without_timing_decision` binder actor/request, race/entry, aktuell entry-,
klass-, bana- och snapshotversion, policyversion, exakt targetrevision och
skapad NT-revision.

Target måste vara entryns absoluta senaste fysiska, publicerade revision,
ha status/reason `OK/COMPLETE`, verklig `readout_id` och orsak
`CARD_READOUT`, `CLASS_CHANGE_RECALCULATION` eller
`EXPLICIT_RECALCULATION`. Manuella/restaurerade, stale, opublicerade,
stödfrämmande eller korrupta revisioner avvisas. Servern söker aldrig bakåt
eller väljer om target efter att intentet frysts.

NT-revisionen får orsak `MANUAL_WITHOUT_TIMING`, null direkt readout, unik
decisionreferens, motorn `without-timing-v1` och revision `target + 1`.
Decision, revision och actor-audit committar atomiskt.

### Permanent overlay och gemensam manualgrind

TASK 006M har inget withdrawal. Ett giltigt NT-beslut förblir effektiv overlay
även om senare ingest eller omräkning appenderar tekniska revisioner. Rawdata,
readout, tekniska revisioner och publiceringsflaggor ändras aldrig.

Den centrala entry-låsta resolvern utökas så att DNS, DSQ, approval, DNF, OOC
och NT är ömsesidigt uteslutande aktiva. Full reciprocal provenans valideras;
dubbelaktiv eller korrupt historik ger konflikt utan prioritet eller fallback.
SQL-vy, trigger, route, React och IOF-adapter får inte bära en parallell
aktivitetspolicy.

### Databasinvarianter

Migration 0022 är expand-only. Den lägger till capability
`DECIDE_WITHOUT_TIMING`, actor kind `WITHOUT_TIMING_ACCESS_CREDENTIAL`,
revisionsorsak `MANUAL_WITHOUT_TIMING`, nullable unik
`result_revision.without_timing_decision_id` och den immutable
`without_timing_decision`-journalen.

Check-, unique- och deferred komposit-FK:er bevisar exakt targettuple,
decision ↔ skapad NT-revision, samma race/entry och `created = target + 1`.
`UNIQUE(entry_id)` uttrycker högst ett permanent NT-beslut medan withdrawal
saknas. Canonical outcome-likhet, teknisk/current/publicerad target och
manualmutex hör till domain/application under lås; ingen business-trigger
eller SQL-vy införs.

### Ranking, publik och historik

NT är `NOT_RANKABLE_STATUS`. Endast `OK` deltar fortsatt i position,
tid-efter, ledartid och mixed-course-bedömning. Deterministisk statusordning
blir `OK`, `MP`, `DSQ`, `DNF`, `OOC`, `NT`, `DNS`.

Lagrat outcome får format 7. Publikformat 6 visar ”Utan tidtagning” utan tid,
ranking, kontroller, splits eller intern provenans. Historikformat 8 fryser
decision, exact target, effektiv NT-revision och absolut underliggande huvud.
Äldre format behåller sina historiska status- och sourceunioner och får inte
acceptera NT av misstag.

### IOF och finalisering failar stängt

Aktiv NT har ingen beslutad sanningsenlig IOF 3.0-mappning. Levande Snapshot
avvisas därför för hela det avgränsade loppet; entryn får inte tyst utelämnas
och NT får inte maskeras som `OK`, `NotCompeting`, `DidNotFinish` eller annan
status. `packages/iof-xml` breddas inte och får aldrig härleda bevis eller
verksamhetssemantik.

Klass- och loppsfinalisering blockerar när en aktuell entry är NT. TASK 006M
skapar därför inget nytt finaliseringsformat. Basis ska fortfarande binda den
absoluta revisionen och NT-livscykeln så att ett beslut gör tidigare aktuell
basis stale, medan redan fryst Complete-XML/hash förblir byte-exakt.

En framtida IOF-policy eller NT-withdrawal kräver egen ADR och additivt format.
Den får inte retroaktivt tolka eller skriva om historiska bytes.

### Säkerhet, idempotens och lås

`DECIDE_WITHOUT_TIMING` är en separat racebunden write-capability med eget
tokenprefix, cookies, session, CSRF och actor kind. Access gäller högst åtta
timmar och session högst en timme. Ingen annan capability implicerar rätten.

Kandidat-GET är privat och bounded. Body är strikt JSON om högst 4 KiB och
binder hela intentet. Exact replay med samma actor återger samma immutable
decision/revision även efter senare data; ändrad actor eller minsta intentfält
är konflikt. Browsern auto-retryar aldrig okänd commit.

Transaktionsordningen är session `UPDATE`, credential `UPDATE`, race `SHARE`,
request advisory lock, exact replay, entry `UPDATE`, full manualgrind, absolut
targetkontroll, append och audit. Den delar `race → entry → revision` med
ingest/omräkning och serialiseras mot finaliseringens exklusiva racelås.

## Konsekvenser

- O-Tid kan uttrycka ”utan tidtagning” utan att förstöra den tekniska historiken
  eller låta dold tid påverka ranking.
- Sen offlineingest bevaras utan att verksamhetsbeslutet försvinner.
- Publik och historik breddas, men IOF och nya finaliseringar blockeras tills
  en separat sanningsenlig interoperabilitetspolicy finns.
- Ett felaktigt NT är permanent aktivt i detta snitt. Rättning kräver ett
  senare explicit append-only-withdrawal.

## Databasmigration och återställning

Migration 0022 är additiv och skriver inte om befintliga resultatrevisioner.
Nullable kolumn, enumvärden och journal skapas innan writers aktiveras; readers
måste kunna tolka NT före produktionswrite.

Enumvärden eller journal droppas inte vid incident. Route/CLI inaktiveras,
credentials spärras och felet rättas framåt additivt, eller så återställs en
verifierad full PostgreSQL-backup. Destructive rollback är förbjuden.

## Avvisade alternativ

- Status-only IOF `OK`: döljer NT:s icke-rankade betydelse och utelämnar kända
  `SplitTime` i strid med XSD-dokumentationens semantik.
- IOF `NotCompeting`: betyder löpning utanför tävlan och sammanblandar NT med
  den befintliga OOC-statusen.
- Tillåta `MP`: kan maskera ett tekniskt felresultat som ett annat
  verksamhetsbeslut.
- Behålla intern `OK` med flagga: gör statusen osynlig i ranking och adapters.
- Kopiera targetens tider/splits: motsäger uttryckligt ”utan tidtagning”.
- Låta nästa readout superseda NT eller blockera ingest: upphäver manuell
  åtgärd respektive hotar offlinekedjan.
- Återanvända OOC/DNF/DSQ eller generell `MANAGE_RESULTS`: blandar skilda
  verksamhetsbeslut och bryter minsta privilegium.
- Införa withdrawal, manuella tider, kontrollneutralisering, Eventor, stafett,
  GPS, parser eller riktig USB: större än snittet.
