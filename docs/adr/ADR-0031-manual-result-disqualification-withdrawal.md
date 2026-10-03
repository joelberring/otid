# ADR-0031: Manuell diskvalifikation och explicit restaureringsrevision

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

CODEX_BRIEF anger `diskvalificerad` som V1-status, manuellt godkännande/
diskvalifikation som resultatregel och följande kritiska acceptansfall:
"Manuell diskvalifikation kan återtas utan att historik försvinner."

Den befintliga modellen har immutable kortbaserade `OK`/`MP`-revisioner,
separat manuellt DNS och ett append-only återtagande som lämnar
`NO_ACTIVE_RESULT`. Det mönstret kan inte kopieras mekaniskt till DSQ. En
diskvalifikation ersätter ett faktiskt resultat, och ett återtagande måste
återställa ett exakt faktiskt resultat i stället för att fabricera frånvaro
eller välja en godtycklig äldre revision.

En ytterligare konkurrensfråga är senare ingest. En offlineavläsning eller
explicit omräkning måste fortsatt få appendera sin tekniska revision. Den får
däremot inte tyst upphäva ett manuellt DSQ enbart genom att få högre
revisionsnummer.

IOF Data Standard 3.0:s pinnade XSD definierar `Disqualified` som
diskvalificering av annan orsak än saknad stämpling. Individresultatets tider
och splits är valfria, medan `Position` enligt schemadokumentationen endast ska
förekomma för `OK`. XSD:n avgör inte O-Tids manuella provenans eller återtagande.

## Beslut

### Separat lagrat DSQ, oförändrad kortmotor

O-Tid inför `DSQ / MANUAL_DISQUALIFICATION` som en strikt manuell medlem i
lagrade `ResultOutcome`. `EvaluationResult`, `evaluateCardReadout` och
stationens kontrakt förblir `OK | MP | UNKNOWN_CARD`.

En ren domänkonstruktor accepterar endast ett fullständigt runtimevaliderat
lagrat `OK`- eller `MP`-resultat. Den kopierar entry, historisk klass och bana,
start/mål/total tid, missing/extra controls och splits exakt och ändrar endast
status/reason. Den räknar aldrig om kortdata och skapar aldrig rawdata eller en
syntetisk readout.

### Immutable beslut, revision och källprovenans

`result_disqualification_decision` är både verksamhetsbeslut,
idempotensjournal och provenans. Den binder actor/request, race/entry, aktuell
entry/klass/bana/snapshot, exakt targetrevision och skapad DSQ-revision.

Resultatrevisionen får orsak `MANUAL_DISQUALIFICATION`, null direkt readout och
en unik beslutsreferens. Den fysiska grunden nås genom beslutets exakta
targetrevision; ingen readout dupliceras som om det manuella beslutet vore en
ny kortutvärdering.

Första beslutet kräver att target är entryns absoluta senaste, publicerade och
aktiva revision, strikt readoutbaserad `OK` eller `MP` och exakt aktuell för
entry, klass, bana och race-snapshot. DNS, återtaget DNS, opublicerat/stale eller
korrupt resultat och redan aktiv DSQ avvisas.

### Aktiv DSQ över senare tekniska revisioner

Ett DSQ-beslut är aktivt tills en exakt withdrawal finns. Aktivitet får inte
härledas från att dess skapade revision råkar vara fysisk maxrevision.

Levande läsare väljer först sitt normala underliggande resultathuvud och
applicerar sedan den centrala rena DSQ-livscykeln. Ett aktivt beslut väljer den
frysta DSQ-revisionen som effektivt tävlingsutfall även om senare ingest eller
omräkning har appenderat en teknisk revision. Ingest får inte blockeras,
avpubliceras eller automatiskt skapa en ny DSQ-kopia.

Application-resolvern runtimevaliderar decision, target, DSQ-revision och
eventuellt withdrawal. SQL-vyer, databastriggers, routes, React och XML-
adaptern får inte implementera en konkurrerande aktivitetspolicy.

### Återtagande skapar en exakt restaureringsrevision

`result_disqualification_withdrawal` avslutar exakt ett aktivt beslut. Den
binder dessutom operatörens observerade absoluta revisionshuvud och den exakta
underliggande `OK`/`MP`-revision som ska återställas.

Om ingen senare giltig teknisk revision finns är beslutets ursprungliga target
källan. Om senare ingest eller omräkning finns måste withdrawal-intentet binda
den exakt senaste giltiga underliggande revisionen. Stale eller ogiltig källa
ger konflikt; servern väljer aldrig om källan tyst.

Withdrawal appenderar en publicerad revision med orsaken
`MANUAL_DISQUALIFICATION_WITHDRAWAL`, null direkt readout, unik withdrawal-
referens och exakt samma `ResultOutcome` som källrevisionen. Withdrawal,
restaureringsrevision och audit committar atomiskt. Därefter finns ingen
fallbacköverlagring: ordinarie latest-urval ser den nya verkliga revisionen.

### Databasinvarianter

Migrationen lägger additivt till två nullable provenienskolumner på
`result_revision`, två revisionsorsaker, två capabilityvärden, två actor kinds
och två immutable tabeller.

Deklarativa check-, unique- och deferred komposit-FK:er bevisar:

- decisionens exakta target `(id, race, entry, revision)`,
- decision ↔ skapad DSQ-revision med samma race/entry/revision,
- withdrawal → exakt decision och dess DSQ-revision,
- withdrawalens exakta restaureringskälla,
- withdrawal ↔ skapad restaureringsrevision.

Källconstrainten skiljer readoutbaserade revisioner, manuellt DNS, manuellt DSQ
och manuell DSQ-restaurering. JSON-likhet och aktuell resultathuvudpolicy hör
till domain/application och dupliceras inte i en business-trigger.

### Ranking, publik och IOF

DSQ är `NOT_RANKABLE_STATUS`. Endast `OK` deltar i position, tid efter och
mixed-course-kontroll. Gemensam deterministisk statusordning är `OK`, `MP`,
`DSQ`, `DNS`.

Publikresultat visar svensk status och bevarade tider/splits men ingen ranking.
IOF-adaptern mappar endast explicit lagrat DSQ till `Disqualified`, bevarar
start/mål/Time och SplitTime när de fanns, förbjuder Position/TimeBehind och
serialiserar inga interna beslut-, reason- eller proveniensfält.

### Finalisering och immutable format

En aktiv, strikt giltig DSQ täcker entryn i en ny klass-/loppsfinalisering.
Finaliseringsbasis omfattar både effektiv DSQ, decision/target och absolut
underliggande head. Senare teknisk revision, withdrawal eller restoration
ändrar därför aktuell basis men aldrig äldre fryst XML.

Nya frysta projektioner använder format 2 med diskriminerad källprovenans och
DSQ-stöd. Format 1 förblir läsbart för historiska immutable finaliseringar.
`Complete` kräver fortsatt explicit finaliseringsbevis; serializeraren bevisar
inte täckning.

### Säkerhet, idempotens och lås

`DISQUALIFY_RESULT` och `WITHDRAW_DISQUALIFICATION` är två separata racebundna
write-capabilities med egna tokenprefix, cookies, sessioner och actor kinds.
Rätt att skapa implicerar inte rätt att återta.

Varje requestjournal binder hela intentet. Exact replay från samma actor
återger samma immutable objekt även efter senare data; ändrad actor, target,
källa eller annat intentfält är konflikt. Browsern auto-retryar aldrig okänd
commit.

Transaktionsordningen är session `UPDATE`, credential `UPDATE`, race `SHARE`,
request advisory lock, exact replay, entry `UPDATE`, full kontroll, append och
audit. Detta delar `race -> entry -> revision` med ingest/omräkning och
serialiseras mot finaliseringens exklusiva racelås.

## Konsekvenser

- Kritiska acceptansfall 16 får en verifierbar append-only kedja.
- Sen offlineingest bevaras utan att verksamhetsbeslutet försvinner.
- Levande resultat kräver en central DSQ-livscykelresolver ovanpå det normala
  head-urvalet tills withdrawal har skapat restaureringsrevisionen.
- Resultatstatus, ranking, publik, export, historik och finalisering breddas;
  stationens motor, SQLite, outbox och kvittenser gör det inte.
- Ett senare nytt DSQ är möjligt först efter giltigt withdrawal och mot ett nytt
  exakt aktuellt target; parallella aktiva beslut failar stängt.

## Databasmigration och återställning

Migration 0016 är expand-only. Befintliga resultatrevisioner och DNS-rader
skrivs inte om. Nullable kolumner och nya tabeller skapas innan writers
aktiveras; readers måste kunna tolka de nya enumvärdena före produktionswrite.

Enumvärden och historik droppas inte vid incident. Routes/CLI inaktiveras,
credentials spärras och felet rättas framåt med en additiv migration, eller så
återställs en verifierad full PostgreSQL-backup. Sammansatta index/FK-
validering planeras som produktionslåsande operationer; destructive rollback
är förbjuden.

## Avvisade alternativ

- Låta nästa readout superseda DSQ: upphäver ett manuellt beslut utan actor,
  intent eller withdrawal.
- Blockera ingest medan DSQ är aktiv: hotar offlinekedjan och bevarandet av
  rådata.
- Appendera en ny DSQ-kopia efter varje ingest: fabricerar resultatrevisioner,
  ändrar ingestsemantik och dubblerar writes.
- DNS-modellens `NO_ACTIVE_RESULT`: ett DSQ-återtagande har ett verkligt exakt
  resultat att återställa.
- Anti-join/fallback till föregående revision: kan välja fel historiskt utfall
  och lämnar ingen ny resultatrevision för ändringen.
- Mutera `published`, decision eller DSQ-revision: skriver om historik.
- En bred `MANAGE_RESULTS`-capability eller återbruk av recalculation/finalize:
  bryter minsta privilegium och blandar verksamhetsbeslut.
- Status-only DSQ utan källans tider/splits: kastar bort redan verifierbara
  tävlingsfakta och ger sämre spårbarhet trots att IOF tillåter dem.
- Fri statusväljare eller generell juryeditor: är större än snittet.
