# ADR-0033: Explicit individuellt DNF som permanent manuell overlay

- Status: Accepterad
- Datum: 2026-09-01

## Kontext

CODEX_BRIEF anger `ej fullföljt` som V1-status, kräver append-only
resultatrevisioner och förbjuder att senare offlinesynk tyst skriver över en
manuell åtgärd. Kortmotorn producerar endast tekniska `OK`, `MP` och
`UNKNOWN_CARD`; DNF är ett verksamhetsbeslut och får inte härledas ur att en
stämpling eller avläsning ännu saknas.

En första idé var att endast tillåta `MP/MISSING_FINISH`. Det vore semantiskt
snävt men är inte ett operativt vertikalt snitt: dagens device-batch-kontrakt
kräver `finishPunchedAt` och `card_readout.finish_punched_at` är `NOT NULL`.
Produktion kan därför inte skapa den targetformen utan att först bredda
stationens ingest- och lagringsgräns.

Ett DNF ska inte bära targetens eventuella finish eller elapsed. Den tekniska
revisionen måste ändå bevaras som granskningsbar fakta. Det separata manuella
beslutet är den auktoritativa uppgiften att deltagaren inte fullföljde.

IOF Data Standard 3.0 har statusen `DidNotFinish`. XSD:n kräver inte tid,
placering eller split för den statusen och uttrycker inte O-Tids manuella
provenans eller finaliseringsbevis.

## Beslut

### Status-only outcome, oförändrad kortmotor

O-Tid inför `DNF / DID_NOT_FINISH` som en strikt lagrad medlem i
`ResultOutcome`. `EvaluationResult`, stationens kontrakt och
`evaluateCardReadout` ändras inte.

En ren domänkonstruktor accepterar endast ett runtimevaliderat tekniskt
`OK|MP` med kanonisk entry-, klass- och banidentitet. Den skapar ett nytt
status-only outcome med samma identitet men utan start, mål, elapsed,
missing/extra controls eller splits. Ingen tävlingsfakta fabriceras eller
kopieras till en semantiskt motsägande DNF-form.

### Immutable decision och permanent aktiv overlay

`did_not_finish_decision` är verksamhetsbeslut, idempotensjournal och
provenans. Den binder actor/request, race/entry, aktuell entry-/klass-/bana-/
snapshotversion, policyversion, exakt tekniskt target och skapad DNF-revision.

Target måste vara entryns absoluta senaste revision och samtidigt vara
publicerad, teknisk/readoutbaserad, strikt giltig `OK|MP` och exakt aktuell.
Servern hoppar aldrig över ett nyare opublicerat eller manuellt huvud och
väljer aldrig om target efter att intentet frysts.

DNF-revisionen är publicerad, har null direkt readout, unik decisionreferens,
orsaken `MANUAL_DID_NOT_FINISH` och motorn `manual-did-not-finish-v1`.

TASK 006I har inget återtagande. Beslutet är därför permanent aktivt och väljer
sin frysta DNF-revision som effektivt tävlingsutfall även om senare ingest
eller omräkning appenderar tekniska revisioner. Rawdata och tekniska
revisioner blockeras eller avpubliceras aldrig. En separat senare ADR måste
låsa hur ett DNF får återtas.

### Gemensam aktiv-manual-grind

DNS, DSQ, approval och DNF är ömsesidigt uteslutande aktiva manuella
resultattillstånd per entry. En gemensam application-grind körs under
entrylåset, validerar kompletta reciprocal decision-/revision-/withdrawal-
kedjor och returnerar exakt `NONE`, `ACTIVE_DNS`, `ACTIVE_DSQ`,
`ACTIVE_APPROVAL` eller `ACTIVE_DNF`.

Fler än ett aktivt tillstånd, saknad reciprocal revision, fel race/entry/
revisionsnummer eller korrupt outcome ger konflikt. Ingen prioritetsordning
eller fallback tillämpas. Grinden återanvänds av DNS-, DSQ-, approval- och
DNF-writers samt den centrala resultathuvudresolven.

Detta rättar samtidigt en befintlig asymmetri där approval-writern kontrollerar
aktiv DSQ men DSQ-writern inte alltid kontrollerar aktiv approval efter senare
teknisk ingest. Det är en nödvändig förstärkning av redan accepterad invariant,
inte en ny verksamhetsfunktion.

### Databasinvarianter

Migration 0018 är expand-only. Den lägger till revisionsorsak, capability,
actor kind, nullable unik `result_revision.did_not_finish_decision_id` och den
immutable decisionjournalen.

Check-, unique- och deferred komposit-FK:er bevisar targetens exakta
`(id, race, entry, revision)`, decision ↔ skapad DNF-revision och samma
race/entry/revisionsnummer åt båda håll. `UNIQUE(entry_id)` är avsiktlig medan
withdrawal saknas. Källconstrainten skiljer DNF från tekniska revisioner, DNS,
DSQ/restaurering och approval/restaurering.

Teknisk/publicerad/absolut aktuell target, canonical JSON och aktiv-manual-
mutex hör till domain/application under lås och dupliceras inte i trigger eller
SQL-vy. Generiska immutable triggers skyddar journal och revision.

### Ranking, publik och IOF

DNF är `NOT_RANKABLE_STATUS`; statusordningen är `OK`, `MP`, `DSQ`, `DNF`,
`DNS`. Endast OK påverkar ranking, tid efter och mixed-course-kontroll.

Publikresultat använder format 4 och visar svensk status samt manuell källa
utan tid, ranking, kontroller eller splits. Format 1–3 förblir läsbara.

IOF-adaptern mappar DNF till `DidNotFinish`. Eftersom det lagrade DNF-utfallet
är status-only serialiseras endast `Status`; aldrig StartTime, FinishTime,
Time, Position, TimeBehind eller SplitTime. Intern reason, decision och target
serialiseras inte.

### Historik och finalisering

Historikformat 4 har en diskriminerad `MANUAL_DID_NOT_FINISH`-källa och visar
det tekniska targetet följt av DNF. Format 1–3 läses oförändrat.

Nya finaliseringsprojektioner använder format 4. Basis fryser decision,
target, effektiv DNF-revision och absolut underliggande fysiskt huvud. Senare
teknik under aktiv DNF förändrar därför aktuell basis/hash och kräver ny
explicit finalisering, men ändrar aldrig äldre fryst projektion, XML eller hash.

Finalisering validerar den centralt resolverade effektiva revisionen. Stödda
strikta outcomes är tekniskt `OK|MP`, manuellt DNS, aktiv DSQ, aktiv approval
och aktiv DNF med respektive full provenans. En nyare opublicerad revision,
korrupt/dubbelaktiv manualkedja eller annan status blockerar. IOF `Complete`
kräver fortsatt separat finalization proof.

### Säkerhet, idempotens och lås

`DECIDE_DID_NOT_FINISH` är en separat racebunden write-capability med eget
tokenprefix, cookies, session, CSRF och actor kind. Access gäller högst åtta
timmar och session högst en timme.

Requestjournalen binder hela intentet. Exact replay från samma actor returnerar
samma objekt även efter senare data. Ändrad actor, target eller versionsgrund
är konflikt. Browsern auto-retryar aldrig okänd commit.

Transaktionsordningen är session `UPDATE`, credential `UPDATE`, race `SHARE`,
request advisory lock, exact replay, entry `UPDATE`, aktiv-manual-grind,
absolut targetkontroll, append och audit. Den serialiserar mot ingest/
omräkningens entrylås och finaliseringens exklusiva racelås.

## Konsekvenser

- DNF blir ett explicit, granskningsbart och sanningsenligt status-only utfall
  utan ändring av kortmotorn eller stationens kontrakt.
- Sen offlineingest bevaras men upphäver inte verksamhetsbeslutet tyst.
- Utan withdrawal är ett felaktigt DNF permanent aktivt i detta snitt; nästa
  minsta uppgift behöver vara ett explicit append-only återtagande.
- Publik-, historik- och finaliseringskontrakt får format 4; äldre format och
  frysta Complete-bytes ändras inte.
- Den gemensamma grinden gör den redan beslutade DSQ/approval-mutexen
  symmetrisk och utvidgar den med DNF.

## Databasmigration och återställning

Migration 0018 är additiv. Befintliga rader skrivs inte om. Nullable kolumn,
enumvärden och ny tabell skapas innan writers aktiveras; readers måste tolka
DNF före produktionswrite.

Enumvärden och historik droppas inte vid incident. Route/CLI inaktiveras,
credentials spärras och felet rättas framåt med en additiv migration, eller så
återställs en verifierad full PostgreSQL-backup. Destructive rollback är
förbjuden.

## Avvisade alternativ

- Endast `MP/MISSING_FINISH`: inte nåbart via dagens produktionsingest utan ett
  större kontrakts- och schemasnitt.
- Härleda DNF ur saknad finish, sen avläsning eller frånvaro: kan betyda att
  deltagaren är kvar i skogen, att data är offline eller att operatören väntar.
- Kopiera targetens tider/splits till DNF: kan motsäga statusen och exponera
  teknisk finish som om den vore DNF-fakta.
- Låta nästa readout superseda DNF: bryter briefens förbud mot tyst
  överskrivning av manuella åtgärder.
- Blockera ingest medan DNF är aktivt: hotar offlinekedjan och rawdatans
  bevarande.
- Lägga overlay i SQL-vy, React eller IOF-adapter: skapar konkurrerande
  domänregler.
- Återanvända DSQ/approval-tabell eller generell `MANAGE_RESULTS`: blandar
  olika verksamhetsbeslut och bryter minsta privilegium.
- Införa DNF-withdrawal, manuella tider eller kontrollneutralisering i samma
  snitt: överskrider den minsta vertikala uppgiften.
