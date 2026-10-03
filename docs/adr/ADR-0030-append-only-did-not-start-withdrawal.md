# ADR-0030: Append-only återtagande av manuellt ej-startbeslut

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

ADR-0029 låter en behörig operatör skapa ett explicit manuellt DNS för en entry
utan tidigare resultatrevision. Beslutet och DNS-revisionen är immutable. Det
är korrekt för audit, men ett mänskligt fel utan senare readout kan inte rättas
utan att antingen mutera historiken, fabricera en ny resultatstatus eller lägga
en separat livscykel ovanpå det manuella beslutet.

CODEX_BRIEF skiljer beräknade resultat från manuella beslut, kräver att
resultatförändringar bevaras som revisioner och anger som framtida kritiskt fall
att en manuell diskvalifikation ska kunna återtas utan förlorad historik. TASK
006F behöver etablera den smalaste sådana riktningen för DNS utan att införa
DSQ eller en generell jury-/resultatmotor.

IOF 3.0 har `DidNotStart`, men ingen status som betyder "ett tidigare lokalt
DNS-beslut har återtagits och deltagaren saknar nu resultat". En sådan status
får därför inte serialiseras eller läggas in i den interna resultatutgången som
om den vore ett tävlingsresultat.

## Beslut

### Återtagandet reviderar beslutets livscykel, inte resultatutfallet

O-Tid inför en separat immutable `DidNotStartWithdrawal`. Originalets
`DidNotStartDecision`, DNS-`ResultRevision`, publiceringsflagga och audit ändras
aldrig. Withdrawal-raden är den append-only revision som gör den manuella
deklarationen inaktiv från sin committidpunkt. Därmed bevaras varje historiskt
påstående och rättning utan overwrite.

Withdrawal skapar inte en ny `ResultRevision`, eftersom den inte innehåller ett
nytt tävlingsutfall. `EvaluationResult`, `ResultOutcome`, `RevisionCause`,
stationens kontrakt och IOF-statusunion breddas inte. Den rena domänen äger i
stället regeln som resolverar ett redan valt resultathuvud tillsammans med en
eventuell exakt withdrawal till `ACTIVE_RESULT` eller `NO_ACTIVE_RESULT`.

### Exakt target och aktuellhetsgrind

Endast TASK 006E:s manuella DNS får targetas. Databasen binder withdrawal med
en komposit-FK till samma immutable decision, race, entry och skapade DNS-
revision. Applikationen validerar dessutom status, orsak, null readout och
provenans vid runtime.

Vid första commit måste target vara entryns absoluta högsta revision. Aktuell
entryversion, klass, klassens banversion och race-snapshot binds separat. En
klass- eller snapshotändring gör inte original-DNS korrekt, men kräver att
operatören läser om underlaget innan återtagandet får committa.

`card_readout` har ingen säker historisk entry-FK; koppling sker genom
bedömningen vid ingest. O-Tid får därför inte gissa "entry har readout" genom
ett nuvarande bricknummer. Den säkra grinden är att den manuella DNS-revisionen
är absolut resultathuvud. Om en känd readout har behandlats har ingest redan
appendat en senare revision under samma entrylås. En okänd readout förblir
olöst och påverkas inte.

### Ingen fallback i levande projektioner

Varje levande läsare gör två steg:

1. välj det resultathuvud som läsarens befintliga policy anger,
2. applicera en eventuell withdrawal som exakt targetar det valda huvudet.

Ett återtaget huvud blir `NO_ACTIVE_RESULT`. Läsaren får aldrig exkludera target
före max-/latest-urval och därmed falla tillbaka till en äldre revision. En
senare publicerad CARD_READOUT-revision väljs däremot normalt och påverkas inte
av withdrawal på DNS-revisionen.

Den delade application-resolvern runtimevaliderar withdrawal/target och
delegerar livscykelbeslutet till den rena domänen. Publikresultat, live Snapshot,
finaliseringsbasis och withdrawal-lista återanvänder samma regel. SQL-vy,
databastrigger, route och React får inte bära en alternativ resultatregel.

### Publik, export och finalisering

Efter withdrawal saknas entryn ur levande publikresultat och ranking tills en
ny aktiv resultatrevision finns. Snapshot-exporten utelämnar den och räknar den
som omitted. Ingen IOF-status fabriceras och `packages/iof-xml` behöver ingen ny
resultattyp.

Finaliseringsbasis behåller target- och withdrawalidentitet så basisens hash
ändras. En aktuell entry vars senaste huvud är ett återtaget DNS får blockeraren
`WITHDRAWN_DID_NOT_START`; den kan inte ingå i nytt Complete. Tidigare fryst
Complete-projektion, XML och hash är historiska bytes och ändras aldrig.

En senare riktig ingest appendar nästa ordinarie resultatrevision. Den blir
aktiv enligt det vanliga urvalet; withdrawal gäller fortsatt endast den äldre
DNS-revisionen.

### Säkerhet, idempotens och lås

`WITHDRAW_DID_NOT_START` är en separat racebunden capability. Den har eget
hash-only tokenprefix, egna host-only cookies, högst åtta timmars access,
högst en timmes session, Origin-/CSRF-kontroll och auditaktör. Rätt att skapa DNS
ger inte rätt att återta det.

Withdrawal-tabellen är både idempotensjournal och provenance. Requesten binder
actor, race, entry, current entry/class/course/snapshot, target decision,
targetrevision och policyversion. Exakt replay återger samma immutable rad även
om senare ingest har kommit; ändrad kontext är konflikt.

Transaktionsordningen är session `UPDATE`, credential `UPDATE`, race `SHARE`,
request advisory lock, entry `UPDATE`, target-/huvudkontroll, withdrawal och
audit. Ingest delar race `SHARE` och entry `UPDATE`; finalisering tar race
`UPDATE`. Det ger ett helt före-/efterläge utan att stoppa senare offlineingest.

Databasen använder deklarativa FK-, unique- och checkconstraints samt den
befintliga generiska immutability-triggern. Den får ingen business-trigger som
försöker avgöra aktuellt resultathuvud, eftersom resultatlogik inte får ligga i
databastriggers.

### Privat operatörsflöde

En separat privat GET visar bounded manuella DNS-beslut som
`WITHDRAWABLE`, `WITHDRAWN` eller `SUPERSEDED`. Den innehåller endast namn,
organisation, klass och minimal target/latest/withdrawal-metadata efter auth.
Ingen bricka, punch, rawdata, full evaluation, token eller hash lämnas ut.

UI:t kräver ett uttryckligt andra bekräftelsesteg och förklarar att historiken
finns kvar men att deltagaren därefter saknar aktuellt resultat. Credential och
pending intent hålls endast i React-minne. Timeout, nätfel, 5xx och ogiltigt
svar ger okänd commit och endast explicit exact retry med samma request-id.

## Databasmigration och återställning

Migration 0015 är expand-only. Den lägger till capability/auditaktör,
capability-livslängd, kompositnycklar som stärker DNS decision↔revision-paret
och en immutable `did_not_start_withdrawal` med unika request-, decision- och
targetgränser. Befintliga beslut och revisioner skrivs inte om.

Produktionsrollback får inte droppa enumvärden, withdrawal, audit eller
historiska DNS-rader. Vid incident inaktiveras withdrawal-routes/CLI,
credentials spärras och felet rättas framåt med en additiv migration. Annars
återställs en verifierad full PostgreSQL-backup.

## Konsekvenser

- Ett mänskligt fel kan rättas utan radering, syntetisk hårdvara eller påhittad
  resultstatus.
- "Senaste publicerade revision" är inte längre ensam tillräckligt för levande
  resultat; läsare måste använda den gemensamma withdrawal-overlayn.
- Historiska DNS- och Complete-objekt förblir verifierbara, medan levande
  projektion sanningsenligt kan sakna resultat.
- Station, outbox, ingestkvittenser och kortmotor påverkas inte.
- Mönstret kan ge underlag för framtida DSQ-återtagande, men generaliseras inte
  i detta snitt.

## Avvisade alternativ

- `UPDATE result_revision SET published=false`: skriver om historik och kan få
  senaste-published-urval att falla tillbaka.
- Ny `WITHDRAWN`-resultatstatus/revision: fabricerar ett icke-IOF-utfall och
  breddar ranking, export och station utan verksamhetsbehov.
- Radera DNS-revision eller decision: förstör audit och tidigare Complete-bevis.
- Återanvända `DECIDE_DID_NOT_START`: bryter minsta privilegium för en åtgärd
  som tar bort ett levande publikt resultat.
- Blockera på gissad readout via aktuellt bricknummer: saknar säker historisk
  entrykoppling och kan blanda okända/omkopplade brickor.
- Anti-join withdrawal före latest-urval: kan återuppliva en äldre revision och
  bryter no-fallback-regeln.
- Businesslogik i SQL-vy eller insert-trigger: strider mot projektets
  domängräns och skulle skapa en konkurrerande resultatmotor.
