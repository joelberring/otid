# ADR-0032: Manuellt resultatgodkännande och explicit restaureringsrevision

- Status: Accepterad
- Datum: 2026-09-01

## Kontext

CODEX_BRIEF anger manuellt godkännande som V1-regel, append-only
resultatrevisioner och att servern aldrig tyst skriver över en manuell åtgärd
när tävlingsdata ändrats efter en offlineperiod.

Den befintliga kortmotorn producerar tekniska `OK`, `MP` och `UNKNOWN_CARD`.
TASK 006G visar hur en uttrycklig manuell åtgärd kan ligga som en validerad
overlay över senare tekniska revisioner och avslutas med en exakt
restaureringsrevision. Ett godkännande skiljer sig dock från DSQ: det gör ett
tidigare orankat MP rankbart och kan därför påverka hela klassens positioner,
tid efter, IOF-export och finaliseringsbasis.

Alla MP-former bär inte tillräckliga fakta för ett rankbart resultat.
`MISSING_START`, `MISSING_FINISH` och `INVALID_TIME_ORDER` saknar giltig
start/mål/totaltid. `MISSING_CONTROL` och `WRONG_ORDER` bär däremot fullständig
tid och kan manuellt valideras utan att tid eller stämpling fabriceras.

IOF Data Standard 3.0 har ingen särskild status för manuellt godkänd. Ett
validerat resultat använder `OK`; Position och TimeBehind är då tillåtna. En
saknad kontrolltid kan uttryckas med `SplitTime status="Missing"`. O-Tids
nuvarande serializer kräver avsiktligt full splitcoverage för vanliga OK och
måste därför få ett strikt, icke-serialiserat proof i just approval-fallet.

## Beslut

### Lagrad approval, oförändrad kortmotor

O-Tid inför `OK / MANUAL_APPROVAL` som en strikt manuell medlem i lagrade
`ResultOutcome`. `EvaluationResult`, `evaluateCardReadout` och stationens
kontrakt förblir oförändrade.

En ren domänkonstruktor accepterar endast ett runtimevaliderat tekniskt
`MP/MISSING_CONTROL` eller `MP/WRONG_ORDER` med kanonisk entry-, klass- och
banidentitet, giltig ISO-tid, icke-negativ säker heltalstid och
`finish - start = elapsed`. Den deep-kopierar start/mål/tid,
missing/extra-controls och splits exakt och ändrar endast status/reason.

`MANUAL_APPROVAL` används som lagrad reason i stället för `COMPLETE` för att
förklarbarheten ska överleva genom publik, historik och finalisering. Det
tekniska källutfallet förblir oförändrat och nås genom decisionens target.

### Immutable decision och aktiv overlay

`result_approval_decision` är verksamhetsbeslut, idempotensjournal och
provenans. Den binder actor/request, race/entry, aktuell
entry-/klass-/bana-/snapshotversion, exakt MP-target och skapad
approval-revision.

Target måste vara entryns absoluta senaste, publicerade, tekniska och
readoutbaserade revision. Den måste vara exakt aktuell och tidskomplett.
Approval-revisionen har null direkt readout, unik decisionreferens och
orsaken `MANUAL_RESULT_APPROVAL`.

Beslutet är aktivt tills en exakt withdrawal finns. Ett aktivt approval väljer
sin frysta revision som effektivt tävlingsutfall även om senare ingest eller
omräkning appenderar tekniska revisioner. Rawdata och tekniska revisioner får
inte blockeras eller avpubliceras. Detta är nödvändigt för att en senare
offlinesynk inte tyst ska upphäva den manuella åtgärden.

Application-resolvern validerar decision, target, approval-revision och
eventuell withdrawal. SQL-vy, databastrigger, route, React och XML-adapter får
inte implementera en konkurrerande aktivitetspolicy. En aktiv approval och en
aktiv DSQ får inte samexistera för samma entry.

### Återtagande med exakt senaste tekniska källa

`result_approval_withdrawal` avslutar exakt ett aktivt approval. Intentet
binder dessutom operatörens observerade absoluta revisionshuvud och den exakta
senaste giltiga underliggande tekniska `OK`/`MP`-revision som ska bli levande.

Utan senare teknisk revision är decisionens ursprungliga MP-target källan. Om
senare ingest eller omräkning finns måste requesten binda dess exakta senaste
giltiga tekniska OK/MP. Att tillåta även senare tekniskt OK gör att en explicit
withdrawal kan avsluta den manuella overlayn utan att återuppväcka äldre MP
ovanpå nyare fakta. Servern väljer aldrig källan tyst vid commit; stale eller
korrupt huvud/källa är konflikt.

Withdrawal appenderar en publicerad revision med orsaken
`MANUAL_RESULT_APPROVAL_WITHDRAWAL`, null direkt readout, unik
withdrawalreferens och exakt samma `ResultOutcome` som källrevisionen.
Withdrawal, restaureringsrevision och audit committar atomiskt. Därefter ser
ordinarie latest-urval restaureringsrevisionen utan historisk fallback.

### Databasinvarianter

Migration 0017 är expand-only och lägger till två nullable
provenienskolumner på `result_revision`, två revisionsorsaker, två
capabilityvärden, två actor kinds och två immutable journaler.

Check-, unique- och deferred komposit-FK:er bevisar:

- decisionens exakta MP-target `(id, race, entry, revision)`,
- decision ↔ skapad approval-revision med samma race/entry/revision,
- withdrawal → exakt decision och dess approval-revision,
- withdrawalens observerade absoluta huvud och exakta restaureringskälla,
- withdrawal ↔ skapad restaureringsrevision.

Källconstrainten skiljer tekniska revisioner, manuellt DNS, DSQ,
DSQ-restaurering, approval och approval-restaurering. Canonical JSON-likhet,
tidsvalidering och aktuell overlay hör till domain/application och dupliceras
inte i en business-trigger. `reject_immutable_change()` skyddar båda nya
journalerna; resultatrevisionens befintliga immutable-trigger skyddar
revisionerna.

### Ranking, publik och IOF

Ett aktivt `OK/MANUAL_APPROVAL` rankas med sin exakta källtidsgrund. Position
och tid efter härleds på nytt över klassens effektiva OK-resultat och sparas
aldrig i revisionen. Befintlig millisekundtie och mixed-course-policy gäller.

Publikresultat använder format 3 och visar svensk manuell provenans. Format 1
och 2 förblir läsbara. Approval-reason och decision-id läcker inte till IOF.

IOF-adaptern mappar approval till `OK`. Ett result-level
`manualApprovalProof` med kanoniskt decision-id och targetrevision-id krävs för
ett OK som saknar en eller flera förväntade splits. Proof valideras vid runtime,
är förbjudet för andra statusar och serialiseras aldrig. Därmed behålls den
strikta full-coverage-regeln för tekniska OK, medan ett manuellt validerat
saknat kontrollfaktum kan exporteras sanningsenligt som
`SplitTime status="Missing"` utan fabricerad tid.

### Historik och finalisering

Historikformat 3 har diskriminerade källor för approval och withdrawal och
visar target → approval → senare teknik → restoration. Format 1/2 förblir
läsbara.

Nya finaliseringsprojektioner använder format 3. Basis omfattar effektiv
approval, decision/target, absolut underliggande head och eventuell
withdrawal/restoration. Senare teknik eller withdrawal gör aktuell basis
inaktuell, men ändrar aldrig äldre fryst XML/hash/projektion. `Complete` kräver
fortsatt explicit finaliseringsbevis; serializeraren härleder inte coverage.

### Säkerhet, idempotens och lås

`APPROVE_RESULT` och `WITHDRAW_RESULT_APPROVAL` är separata racebundna
write-capabilities med egna tokenprefix, cookies, sessioner och actor kinds.
Rätt att skapa implicerar inte rätt att återta.

Varje requestjournal binder hela intentet. Exact replay från samma actor
återger samma immutable objekt även efter senare data. Ändrad actor, target,
huvud, källa eller annat intentfält är konflikt. Browsern auto-retryar aldrig
okänd commit.

Transaktionsordningen är session `UPDATE`, credential `UPDATE`, race `SHARE`,
request advisory lock, exact replay, entry `UPDATE`, full kontroll, append och
audit. Den delar `race → entry → revision` med ingest/omräkning och
serialiseras mot finaliseringens exklusiva racelås.

## Konsekvenser

- Manuellt godkännande blir förklarbart, rankbart och återtagbart utan
  historikmutation.
- Sen offlineingest bevaras men upphäver inte beslutet tyst.
- Levande resultat behöver en explicit approval-gren i den centrala
  resultathuvudresolven; den får inte bli en fri generell override-lista.
- Publik-, historik- och finaliseringskontrakt får format 3. Stationens
  evaluation, SQLite, outbox och kvittenser ändras inte.
- Ett senare nytt approval kräver giltigt withdrawal och ett nytt exakt
  tekniskt MP-target.

## Databasmigration och återställning

Migration 0017 är expand-only. Befintliga resultatrevisioner skrivs inte om.
Nullable kolumner och nya tabeller skapas innan writers aktiveras; readers
måste tolka de nya enumvärdena före produktionswrite.

Enumvärden och historik droppas inte vid incident. Routes/CLI inaktiveras,
credentials spärras och felet rättas framåt med en additiv migration, eller så
återställs en verifierad full PostgreSQL-backup. Destructive rollback är
förbjuden.

## Avvisade alternativ

- `OK/COMPLETE` utan manuell reason: förlorar stabil förklarbarhet och gör
  manuellt resultat omöjligt att skilja från tekniskt resultat i projektioner.
- Godkänna tidslöst MP: kräver fabricerade tävlingsfakta.
- Låta nästa readout superseda approval: bryter briefens förbud mot tyst
  överskrivning av manuella åtgärder.
- Blockera ingest medan approval är aktivt: hotar offlinekedjan och rawdatans
  bevarande.
- Återställa alltid original-MP efter senare tekniskt OK: skriver explicit
  äldre fakta ovanpå nyare verifierad teknik.
- Avsluta overlay utan restaureringsrevision: gör resultatskiftet mindre
  spårbart och bryter principen att resultatändringar skapar revisioner.
- Släppa IOF:s full-splitkontroll för alla OK: gör korrupt teknisk projektion
  accepterad. Approval-proof avgränsar undantaget.
- Mutera `published`, decision, approval eller target: skriver om historik.
- Återanvända DSQ-tabeller/capabilities eller införa `MANAGE_RESULTS`: blandar
  separata verksamhetsbeslut och bryter minsta privilegium.
- Fri juryeditor, manuella tider eller kontrollneutralisering: större än
  snittet.
