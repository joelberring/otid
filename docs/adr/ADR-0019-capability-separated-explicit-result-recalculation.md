# ADR-0019: Capability-separerad explicit resultatomräkning

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

Den befintliga explicita omräkningen har rätt transaktionsgrund: delat racelås,
exklusivt entrylås, snapshotläsning, ren domänutvärdering, `max(revision)+1`,
append-only resultatrevision och audit. HTTP-routen är däremot öppen, saknar
Origin/CSRF/idempotens, returnerar hela databasraden och läcker interna feltexter.
Retry efter ett tappat svar skapar ytterligare en auktoritativ revision.

En gammal browserflik uttrycker heller inte vilket tävlingstillstånd den såg.
Klass/import kan ändra snapshot, en ny ingest kan ändra senaste readout/revision,
en assignment kan flyttas och en deploy kan byta motorversion innan POST når
entrylåset.

TASK 005F–005H har separata racebundna capabilities för andra trust domains.
Klassändring och skapande av en ny publicerad resultatrevision är olika
privilegier. En generell rollplattform är fortsatt för bred.

Den gamla orsaken `CLASS_CHANGE_RECALCULATION` beskriver inte alla uttryckliga
omräkningar som routen redan tillåter. Att fortsätta använda den på en separat
generell omräkningsyta skulle skapa missvisande historik.

## Beslut

### Separat capability och sessionyta

Säkerhetssubstratet utökas additivt med `RECALCULATE_RESULT`. Credentialen är
bunden till exakt race, individuellt märkt, högst åtta timmar och använder
prefixet `otid_org_result_recalc_v1`. Sessionen gäller högst en timme och får
egna cookies: `__Host-otid-recalculation-admin-session` och
`__Host-otid-recalculation-admin-csrf`, med explicita loopbacknamn.

Fysisk `pairing_admin_*`-lagring återanvänds av migrationssäkerhetsskäl. Den
exhaustiva capabilitypolicyn måste välja prefix, login-schema, livslängder och
auditmetadata för exakt capability. Den befintliga öppna POST-routen ersätts;
ingen parallell bypass skapas.

### Additiv, korrekt revisionsorsak

`EXPLICIT_RECALCULATION` läggs additivt till PostgreSQL-enum, Drizzle och
domänens `RevisionCause`. Nya capabilityskyddade, operatörsinitierade
omräkningar använder denna orsak. Historiska `CLASS_CHANGE_RECALCULATION` och
trusted äldre use case lämnas orörda och skrivs aldrig om.

Detta ändrar endast revisionsmetadata för den nya ytan. Resultatmotor,
status/reason, publicering, snapshotsemantik och tidigare revisioner ändras inte.

### Fryst intent och deterministisk källa

Ett skyddat kandidatanrop lämnar minsta data för ett operatörsbeslut. Ett nytt
request binder exakt:

- entry-version och klass-id,
- snapshotversion,
- aktiv assignment-id,
- deterministiskt senaste readout-id,
- senaste resultatrevisions id och nummer, eller null/0,
- serverns motorversion.

Readout väljs med stabil sortering `readAt DESC, id DESC`. Det ska finnas exakt
en aktiv assignment. Evaluation måste uttryckligen ge samma entry-id som
requesten. Dessa är säkerhets-/concurrencyvillkor runt samma rena
domänutvärdering, inte nya resultatregler.

Requesten använder canonical
`Idempotency-Key: result-recalculation:<request-uuid>`. Origin, session,
race/capability, CSRF och header valideras före en bodybyte. Endast exakt JSON,
strikt UTF-8 och högst 4 KiB faktisk body accepteras.

### Transaktion, retry och concurrency

Mutationstransaktionen autentiserar på nytt och låser i ordningen
`session -> accesscredential -> race SHARE -> request advisory -> entry UPDATE
-> revision`. Exact replay kontrolleras efter requestlåset men före aktuell
entry-/resultatstatus.

En append-only `result_recalculation_request` har servergenererat UUID-PK och
separat unikt request-id. Den binder actor, race, entry och hela expected-intent
till skapad immutable resultatrevision. Request-id är intern retryidentitet, inte
ett externt Eventor-/IOF-objekt-id.

Exakt retry med samma actor och kontext återger ursprunglig revision med
`replayed: true`, även om senare händelser har ändrat aktuell status. Ändrad
kontext för samma request-id ger 409. Två olika request-id från samma senaste
revision serialiseras av entrylåset; en skapar revisionen och nästa blir stale.

En medveten ny request efter refresh får skapa nästa revision även om evaluation
är identisk. Varje verklig explicit omräkning är en historisk revision; endast
transportretry av exakt request är read-only.

Ingest använder fortsatt `race SHARE -> entry UPDATE`. Om omräkning vinner får
ingest nästa revisionsnummer; om ingest vinner blir omräkningens frysta readout/
revision stale. Import/klassändring använder `race UPDATE`, så omräkningen ser
antingen en hel snapshot före eller efter, aldrig en blandning.

### Atomik, audit och privat UI

Första giltiga request skapar `ResultRevision`, requestjournal och
`RESULT_RECALCULATED_BY_ADMIN` atomiskt. Auditaktören är
`RESULT_RECALCULATION_ACCESS_CREDENTIAL`; request-id ligger i auditfältet.
Metadata begränsas till ID:n, revision, cause, status/reason, motor-, snapshot-
och course-version. Persondata, bricknummer, punches, evaluation, rawdata och
authhemligheter ingår inte.

En separat svensk sida serverrenderar endast ett privat shell. Credential och
pending intent hålls i React-minne. Okänd commit och 401/403 behåller exakt
försök för explicit retry. Bekräftad framgång säger att en ny publicerad
revision skapats och att klass/råavläsning inte ändrats. Ingen automatisk retry
eller Web Storage används.

## Konsekvenser

- Explicit omräkning kan exponeras produktionsautentiserat utan att klass-,
  import- eller pairingbehörighet får skapa auktoritativa resultat.
- Tappat svar skapar inte dubbla revisioner och stale browserstate kan inte tyst
  välja ny snapshot, readout eller motor.
- Nya revisioner får korrekt generell orsak medan historik förblir oförändrad.
- Kandidatytan exponerar inte rawdata eller full evaluation.
- Entry- och snapshotversion ändras inte av omräkning; stationens paket påverkas
  inte.
- Ingen ny dependency eller extern kod behövs.

## Migration och återställning

Migration 0007 lägger additivt till capability, actor-kind, revisionsorsak,
åttatimmarsgräns och append-only requestjournal med FK/checks/unique-index och
immutabilitetstrigger. Äldre credentials, sessioner, revisioner och auditposter
förblir giltiga.

PostgreSQL-enumvärden tas inte bort med destruktiv rollback. Vid incident
inaktiveras nya routes/CLI och en korrigerande migration görs; full rollback
sker från verifierad backup. Resultatrevision eller requestjournal raderas inte
för att simulera rollback.

## Avvisade alternativ

- Återanvända `CHANGE_ENTRY_CLASS`: blandar konfigurations- och
  resultatpubliceringsprivilegier.
- Generell `MANAGE_RACE`/OIDC/rollmodell: för brett för snittet.
- Behålla öppen POST och endast gömma knappen: direkt bypass kvarstår.
- Automatisk omräkning efter klassändring: bryter den uttryckliga
  revisionsgränsen.
- Behålla `CLASS_CHANGE_RECALCULATION` för nya generella requests: felmärker
  historik när ingen klass ändrats.
- Endast request-id utan fryst intent: gör retry säker men stale val av
  snapshot/readout fortfarande möjligt.
- Endast expected revision utan request-id: stoppar två gamla intents men kan
  inte återge tappad commit.
- Välja “senaste” assignment/readout utan ID-bindning: låter requestens mening
  ändras under väntan.
- Returnera full evaluation: onödig person-/rådatayta för operatörsbeskedet.
- Ny request som automatisk no-op vid identisk evaluation: förväxlar medveten
  historisk revision med transportretry.
- Automatisk browserretry eller Web Storage: döljer okänd commit och förlänger
  hemligheters livstid.
- Göra hela audit-tabellen immutable i detta snitt: bred databasförändring som
  kräver eget beslut.
