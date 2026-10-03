# ADR-0038: Append-only återtagande av individuellt utan-tidtagning-beslut

- Status: Accepterad
- Datum: 2026-09-01

## Kontext

ADR-0037 gör `NT/WITHOUT_TIMING` permanent aktivt inom TASK 006M så att en
senare offlineavläsning inte tyst upphäver ett manuellt verksamhetsbeslut.
Ett felaktigt beslut måste samtidigt kunna rättas utan update/delete,
avpublicering eller att läsare söker bakåt till en äldre revision.

NT är status-only fast dess target är ett bevisat tekniskt `OK/COMPLETE`.
Senare ingest kan ha appenderat ny teknisk `OK|MP`-fakta medan overlayn varit
aktiv. En rättning får varken förlora den nyare faktan eller låta servern välja
en annan källa efter operatörens bekräftelse.

IOF Data Standard 3.0 saknar både NT- och withdrawalsemantik. Aktiv NT måste
därför fortsatt blockera export. Efter rättningen kan deltagaren däremot åter
representeras sanningsenligt av den tekniska källans vanliga `OK` eller
`MissingPunch`.

## Beslut

### Immutable withdrawal och restaureringsrevision

O-Tid inför `without_timing_withdrawal` som separat append-only
verksamhetsbeslut, idempotensjournal och provenans. Det avslutar exakt ett
aktivt NT och appenderar atomiskt en publicerad `result_revision` med orsak
`MANUAL_WITHOUT_TIMING_WITHDRAWAL`.

Restaureringsrevisionen har null direkt readout, unik withdrawalreferens och
ett `ResultOutcome` canonicalt exakt lika med en fryst strikt teknisk
`OK|MP`-källa. Ingen status, tid, kontroll eller split konstrueras på nytt.
Decision, NT-revision, target, källrevisioner, rawdata och snapshot förblir
immutable.

### Exakt absolut huvud och teknisk källa

Intentet binder entry-/klass-/bana-/snapshotversion, decision, originaltarget,
NT-revision, observerat absolut resultathuvud och restaureringskälla.

- Är absolut huvud NT-revisionen måste källan vara decisionens ursprungliga
  publicerade direkta tekniska `OK/COMPLETE`-target.
- Finns ett senare huvud måste samma revision vara källan och vara publicerad,
  direkt readoutbaserad, strikt teknisk `OK|MP` och exakt aktuell.

”Direkt teknisk” betyder den etablerade cause-unionen `CARD_READOUT`,
`CLASS_CHANGE_RECALCULATION` eller `EXPLICIT_RECALCULATION`, alltid med
verklig `readout_id`. Manuell eller tidigare restaurerad revision,
opublicerat/stale/korrupt huvud, `UNKNOWN_CARD` och historisk fallback avvisas.
Servern väljer aldrig om källa vid commit eller retry.

Restorationen får `absolute.revision + 1`. Ett senare nytt NT-beslut kräver en
ny direkt teknisk `OK/COMPLETE`-revision; restorationen är inte targetbar.

### Ren livscykelresolver och gemensam manualgrind

`resolveManualWithoutTimingResultHead` får en explicit withdrawalreferens och
validerar reciprocal decision↔NT↔withdrawal↔source↔restoration-provenans.
Utan withdrawal väljs fryst NT även över senare teknik. Med withdrawal måste
normalt valt huvud vara restorationen eller en senare revision; resolvern
returnerar det huvudet och gör aldrig target-/source-fallback.

Alla historiska NT-kedjor för en entry valideras. Högst en får vara aktiv och
endast oåtertagen NT räknas i mutexen med DNS, DSQ, approval, DNF och OOC.
SQL-vyer, triggers, routes, React och IOF-adaptern får inte implementera en
konkurrerande aktivitetspolicy.

### Databasinvarianter och migration 0023

Migration 0023 är expand-only. Den lägger till capability
`WITHDRAW_WITHOUT_TIMING`, actor kind
`WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL`, revisionsorsaken
`MANUAL_WITHOUT_TIMING_WITHDRAWAL`, nullable unik
`result_revision.without_timing_withdrawal_id` och den immutable journalen
`without_timing_withdrawal`.

Journalen fryser actor/request, race/entry, aktuell entry-/klass-/bana-/
snapshotversion, decision, originaltarget, NT-revision, absolut huvud, exakt
teknisk källa, policy/reason och skapad restoration. Deferred komposit-FK:er,
reciprocal tuple-index, checks och unika index bevisar hela kedjans parning.

ADR-0037:s tillfälliga `UNIQUE(without_timing_decision.entry_id)` ersätts med
ett icke-unikt `(race_id, entry_id, created_result_revision, id)`-index. Inga
historiska rader skrivs om. Aktiv unikhet upprätthålls av den entry-låsta rena
resolven; en partial unique-index kan inte uttrycka aktivitet över två
immutable tabeller.

Canonical JSON-likhet, publicerad teknisk källa och manualmutex hör till
domain/application under lås, inte en business-trigger. Generiska immutable
triggers skyddar journal och resultatrevision.

### Oförändrad status, publik och IOF

`EvaluationResult`, statusunion och ordningen `OK`, `MP`, `DSQ`, `DNF`, `OOC`,
`NT`, `DNS` ändras inte. Lagrat outcomeformat 8 är semantiskt samma union som
format 7 men tillåter den nya revisionsprovenansen. Restaurerat OK rankas på
nytt; restaurerat MP är orankat.

Publikresultat förblir format 6 och visar efter withdrawal källans exakta
`OK|MP` utan intern provenans. Aktiv NT fortsätter blockera IOF Snapshot och ny
finalisering. En återtagen kedja använder befintlig `OK`/`MissingPunch`-
projektion; beslut, withdrawal och interna id:n serialiseras aldrig.
`packages/iof-xml` ändras inte. Tidigare Complete-bytes/hash förblir immutable.

### Historik och finalisering

Historikformat 9 får källan `MANUAL_WITHOUT_TIMING_WITHDRAWAL` och fryser
withdrawal, decision, originaltarget, NT-revision, absolut huvud och
restaureringskälla. Format 1–8 förblir läsbara och låsta.

Nya klass- och loppsfinaliseringar använder format 8 och fryser samma kedja
samt effektivt restaurerat outcome. Withdrawal eller senare teknik gör en
levande basis inaktuell och kräver ny explicit finalisering, men kan aldrig
ändra äldre projektion, XML eller hash. Complete kräver fortsatt explicit
runtimevaliderat proof med `finalizationId`, `revision` och `sourceHash`.

### Säkerhet, idempotens och lås

`WITHDRAW_WITHOUT_TIMING` är en separat racebunden write-capability med eget
tokenprefix, cookies, session, CSRF och actor kind. Rätten impliceras inte av
`DECIDE_WITHOUT_TIMING` eller någon annan capability. Access gäller högst åtta
timmar och session högst en timme.

Kandidat-GET är privat och bounded. Requesten är strikt, högst 4 KiB och binder
hela frysta intentet. Idempotency key är
`without-timing-withdrawal:<canonical-uuid>`, policyversionen
`without-timing-withdrawal-v1` och enda reason
`ERRONEOUS_MANUAL_WITHOUT_TIMING`.

Exact replay från samma actor återger samma immutable withdrawal/restoration
även efter senare data. Ändrad actor eller ett intentfält är konflikt.
Browsern håller intent endast i minnet och auto-retryar aldrig okänd commit.

Transaktionsordningen är session `UPDATE`, credential `UPDATE`, race `SHARE`,
request advisory lock, exact replay, entry `UPDATE`, full livscykel/manualgrind,
absolut huvud/källkontroll, append och audit. Ingest delar `race → entry →
revision`; finaliseringens race-`UPDATE` ger helt före/efter utan korsad
låsordning.

## Konsekvenser

- Ett felaktigt NT kan rättas spårbart utan historikmutation eller fallback.
- Senare teknisk MP kan uttryckligen bli sann restoration trots att originalets
  NT-target måste vara OK/COMPLETE.
- Aktiv NT är fortsatt fail-closed för IOF; först en bevisad withdrawal öppnar
  vanlig `OK`/`MissingPunch`-export och finalisering.
- Publik och IOF behöver ingen ny status. Historik och finalisering får nya
  format för full provenans.
- Stationens motor, paket, SQLite, outbox, synk och ack påverkas inte.

## Databasmigration och återställning

Migration 0023 appenderar enumvärden, nullable kolumn, index, journal och
constraints samt ersätter endast 0022:s uttryckligen tillfälliga entryunika
index. Befintliga decisions och revisioner skrivs inte om. Readers installeras
före att writern aktiveras.

Vid incident spärras capability/routes och felet rättas framåt med en additiv
migration, eller så återställs en verifierad full PostgreSQL-backup.
Enumvärden, kolumn eller historik droppas inte och destructive rollback är
förbjuden. Restore ska verifiera både 0000→0023 och en befintlig 0022-databas
med NT-historik.

## Avvisade alternativ

- Update/delete eller avpublicering av NT: förstör historiskt bevis.
- Withdrawal utan restaureringsrevision: döljer resultatskiftet och kräver
  fallback i läsare.
- Restaurera alltid originaltarget: kan lägga äldre OK över senare teknisk MP.
- Sök bakåt efter senaste teknik eller välj källa vid commit: bryter fryst
  intent och exact retry.
- Restaurera en manuell, opublicerad eller tidigare restaurerad revision: är
  ingen direkt teknisk sanningskälla i detta snitt.
- Mappa aktiv NT till IOF `OK`, `NotCompeting` eller annan status: fabricerar
  semantik.
- Omedelbart nytt NT mot restoration: gör samma fakta togglingsbar utan ny
  observerad teknik.
- Återanvända OOC-/DNF-withdrawal eller generell `MANAGE_RESULTS`: blandar
  separata verksamhetsbeslut och bryter minsta privilegium.
- Bulk, fri reason, manuell tid, kontrollneutralisering, Eventor, stafett, GPS,
  SPORTidentparser eller riktig USB: större än snittet.
