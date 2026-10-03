# ADR-0036: Append-only återtagande av individuellt utom-tävlan-beslut

- Status: Accepterad
- Datum: 2026-09-01

## Kontext

ADR-0035 gör ett individuellt OOC-beslut permanent aktivt inom TASK 006K så
att senare offlineingest inte tyst kan upphäva en manuell arrangörsåtgärd.
CODEX_BRIEF kräver samtidigt att resultatändringar skapar revisioner och att
operatören kan förstå varför ett resultat ändrats. Ett felaktigt OOC-beslut
måste därför kunna rättas utan update/delete, avpublicering eller historisk
fallback.

OOC skiljer sig från status-only DNF genom att dess targetens start, mål,
totaltid, kontrollutfall och splits är sann observerad teknik. Återtagandet ska
inte räkna om denna fakta. Finns senare offlineingest ska operatören däremot
kunna välja exakt den nu observerade tekniska revisionen, inte tvingas tillbaka
till originaltargeten.

IOF Data Standard 3.0 har ingen withdrawalstatus eller intern
livscykelprovenans. Efter rättningen representeras deltagaren åter av källans
vanliga `OK` eller `MissingPunch`; historisk OOC kan fortsatt finnas i O-Tids
revisionshistorik och tidigare frysta `Complete`.

## Beslut

### Egen immutable withdrawal och restaureringsrevision

O-Tid inför `not_competing_withdrawal` som eget append-only verksamhetsbeslut,
idempotensjournal och provenans. Den muterar aldrig `not_competing_decision`,
OOC-revisionen, targeten, teknisk historik, rawdata, readout, snapshot eller
publiceringsflagga.

Withdrawal committar atomiskt med en ny publicerad `result_revision` vars orsak
är `MANUAL_OUT_OF_COMPETITION_WITHDRAWAL`, vars direkta readout är null och vars
unika `not_competing_withdrawal_id` pekar tillbaka på journalen. Outcome är
canonicalt exakt lika med den frysta direkta tekniska `OK|MP`-källan. Ingen
domänstatus eller kortmotorform läggs till.

### Absolut huvud och exakt teknisk källa

Intentet binder entryns absoluta fysiska resultathuvud under entrylåset:

- Är huvudet OOC-revisionen själv måste restaureringskällan vara beslutets
  ursprungliga tekniska target.
- Finns ett senare huvud måste samma revision vara restaureringskälla och vara
  publicerad, direkt readoutbaserad, strikt teknisk `OK|MP` på exakt aktuell
  entry-/klass-/ban-/snapshotgrund.

Opublicerat, manuellt, restaurerat, äldre eller korrupt huvud/källa och
`UNKNOWN_CARD` avvisas. Servern söker aldrig bakåt, återupplivar aldrig target
genom fallback och väljer aldrig om källa vid commit eller retry.

I detta ADR betyder ”direkt readoutbaserad teknisk revision” samma etablerade
source-union som databasen och `parseOutOfCompetitionTechnicalRevision` redan
använder: `CARD_READOUT`, `CLASS_CHANGE_RECALCULATION` eller
`EXPLICIT_RECALCULATION`, alltid med verklig `readout_id` och strikt tekniskt
`OK|MP`-outcome. ADR-0035:s kortform ska inte tolkas som att endast
`CARD_READOUT` tillåts. Detta klargör befintlig semantik och inför ingen fjärde
teknisk källa.

Restaureringsrevisionen får `absolute.revision + 1`. Källans entry, historiska
klass/bana, eventuella tider, missing/extra controls och splits deep-kopieras
exakt. Ett nytt OOC-beslut efter withdrawal kräver en senare ny direkt teknisk
revision; den manuella restaureringen är inte ett tillåtet target.

### Ren livscykelresolver och gemensam manualgrind

`resolveManualOutOfCompetitionResultHead` utökas med en explicit withdrawal-
referens. Den validerar reciprocal decision↔OOC↔withdrawal↔restoration-
provenans och alla historiska OOC-kedjor fail-closed.

Utan withdrawal väljs fryst OOC även över senare teknik. Med withdrawal måste
det normalt valda fysiska huvudet vara restaureringen eller en senare revision;
resolvern returnerar det huvudet och faller aldrig tillbaka till target eller
källa. Högst en OOC-kedja får vara aktiv. Endast oåtertagen OOC räknas i mutexen
med DNS, DSQ, approval och DNF.

SQL-vyer, triggers, routes, React och IOF-adapter får inte implementera en
konkurrerande aktivitetspolicy.

### Databasinvarianter och migration 0021

Migration 0021 är expand-only. Den lägger till capability
`WITHDRAW_OUT_OF_COMPETITION`, actor kind
`OUT_OF_COMPETITION_WITHDRAWAL_ACCESS_CREDENTIAL`, revisionsorsaken
`MANUAL_OUT_OF_COMPETITION_WITHDRAWAL`, nullable unik
`result_revision.not_competing_withdrawal_id` och den immutable
`not_competing_withdrawal`-journalen.

Journalen fryser actor/request, race/entry, aktuell entry-/klass-/bana-/
snapshotversion, decision, originaltarget, OOC-revision, observerat absolut
huvud, exakt teknisk källa, policy/reason och skapad restoration.

Deferred komposit-FK:er och reciprocal tuple-index bevisar hela kedjans exakta
race-, entry-, id- och revisionsparning. Checkar kräver `OOC = target + 1`,
`restoration = absolute + 1`, tillåten källrelation och skilda resultatrevisioner.
Den gemensamma source-provenance-checken kräver exakt en källreferens.

ADR-0035:s tillfälliga `UNIQUE(not_competing_decision.entry_id)` ersätts med
ett icke-unikt `(race_id, entry_id, created_result_revision, id)`-index. Inga
historiska rader skrivs om. Aktiv unikhet upprätthålls av den entry-låsta rena
livscykelresolven; targetens befintliga unique-index behålls.

Canonical JSON-likhet, publicerad/direkt teknisk källa och manual-mutex hör till
domain/application under lås, inte en business-trigger.

### Ranking, publik och IOF

Statusunion och deterministisk ordning förblir `OK`, `MP`, `DSQ`, `DNF`, `OOC`,
`DNS`. Efter withdrawal är den restaurerade tekniska statusen effektiv: `OK`
rankas på nytt med sin exakta elapsed time och `MP` förblir orankad.

Publikformat förblir 5 och exponerar ingen intern withdrawalprovenans. IOF
Snapshot och nya Complete-dokument använder befintlig `OK`/`MissingPunch`-
projektion och serialiserar aldrig decision, withdrawal eller revisions-id:n.
Tidigare fryst `NotCompeting`-XML och hash ändras aldrig.

### Historik och finalisering

Historikformat 7 får källan `MANUAL_OUT_OF_COMPETITION_WITHDRAWAL` och fryser
withdrawal, decision, target, OOC-revision, observerat absolut huvud,
restaureringskälla och restoration. Format 1–6 förblir läsbara mot sina
historiska status- och source-unioner.

Nya klass- och loppsfinaliseringar använder format 7 och fryser samma kedja
samt effektivt restaurerat outcome. En withdrawal eller senare teknik gör
levande basis inaktuell och kräver ny finalisering, men kan aldrig ändra äldre
projektion, XML eller hash. Complete kräver fortsatt separat runtimevaliderat
proof med `finalizationId`, `revision` och `sourceHash`.

### Säkerhet, idempotens och lås

`WITHDRAW_OUT_OF_COMPETITION` är en separat racebunden write-capability med
eget tokenprefix, egna cookies, session, CSRF och actor kind. Access gäller
högst åtta timmar och session högst en timme. Ingen annan capability implicerar
rätten.

Kandidat-GET är privat och bounded. Requesten är strikt, högst 4 KiB och binder
hela det frysta intentet. Idempotency key är
`out-of-competition-withdrawal:<canonical-uuid>` och policyversionen är
`out-of-competition-withdrawal-v1`; enda reason är
`ERRONEOUS_MANUAL_OUT_OF_COMPETITION`.

Exact replay från samma actor återger samma immutable withdrawal/restoration
även efter senare data. Ändrad actor eller ett intentfält är konflikt.
Browsern auto-retryar aldrig okänd commit.

Transaktionsordningen är session `UPDATE`, credential `UPDATE`, race `SHARE`,
request advisory lock, exact replay, entry `UPDATE`, full livscykel/manualgrind,
absolut huvud/källkontroll, append och audit. Ingest delar `race → entry →
revision`; finaliseringens race-`UPDATE` ger helt före/efter utan korsad
låsordning.

## Konsekvenser

- Ett felaktigt OOC kan rättas spårbart utan att historik eller teknisk fakta
  skrivs över.
- Sen offlineingest kan vara explicit restaureringskälla och bevaras fortsatt
  även när operatörsåtgärden sker först.
- Publik och IOF behöver ingen ny status eller formatversion; historik och
  finalisering behöver format 7 för full provenans.
- Ett nytt OOC kan inte togglas direkt över en manuell restoration utan ny
  teknisk revision.
- Stationens motor, paket, SQLite, outbox, synk och ack påverkas inte.

Terminologiambiguiteten kring ”direkt readoutbaserad” upptäcktes under den
skrivskyddade förgranskningen och löses av den explicita cause-unionen ovan.
Ingen annan konflikt hittades mellan CODEX_BRIEF, styrdokumenten och
ADR-0028–0035.

## Databasmigration och återställning

Migration 0021 är additiv för data men ersätter 0020:s uttryckligen tillfälliga
entry-unika index med ett icke-unikt uppslagsindex. Befintliga decisions och
resultatrevisioner skrivs inte om.

Enumvärden, nullable kolumn, readers, journal och constraints installeras före
att writern aktiveras. Vid incident spärras capability/routes och felet rättas
framåt med additiv migration, eller så återställs en verifierad full
PostgreSQL-backup. Enumvärden eller historik droppas inte och destructive
rollback är förbjuden.

Restore ska verifiera både tom kedja 0000→0021 och uppgradering av en befintlig
0020-databas med OOC-historik.

## Avvisade alternativ

- Update/delete eller avpublicering av OOC: förstör historiskt bevis.
- Withdrawal utan restaureringsrevision: gör den levande ändringen osynlig i
  resultatrevisionshistoriken.
- Återuppliva originaltarget genom query-fallback: bryter latest-head och kan
  dölja senare teknik.
- Sök bakåt efter senaste tekniska revision: byter operatörens frysta avsikt.
- Restaurera en opublicerad, manuell eller tidigare restaurerad revision: den
  är inte en direkt teknisk sanningskälla för detta snitt.
- Tillåta omedelbart nytt OOC mot restorationen: möjliggör toggle utan ny
  observerad teknik.
- Återanvända DNF-/DSQ-/approvalwithdrawal eller generell `MANAGE_RESULTS`:
  blandar skilda verksamhetsbeslut och minsta privilegium.
- Införa fri reason, utan tidtagning, editor, manuella tider,
  kontrollneutralisering, Eventor, stafett, GPS eller hårdvara: större än
  snittet.
