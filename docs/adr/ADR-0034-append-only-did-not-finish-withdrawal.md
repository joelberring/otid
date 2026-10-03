# ADR-0034: Append-only återtagande av DNF med exakt restaureringsrevision

- Status: Accepterad
- Datum: 2026-09-01

## Kontext

ADR-0033 gör ett uttryckligt DNF permanent aktivt i TASK 006I och reserverar
återtagande för en separat senare ADR. Det bevarar offlineingest och förhindrar
att en senare teknisk revision tyst upphäver verksamhetsbeslutet, men ett
felaktigt DNF kan ännu inte rättas operativt.

En rättning får inte mutera beslutet, DNF-revisionen, `published`, rawdata eller
senare tekniska revisioner. Att endast markera beslutet återtaget utan en ny
resultatrevision skulle dessutom göra resultatskiftet mindre granskningsbart
och kräva historisk fallback i varje läsare.

Senare ingest kan ha appenderat ny teknisk fakta medan DNF-overlayn varit
aktiv. Att alltid återställa originaltarget skulle då lägga äldre fakta ovanpå
ett nyare tekniskt resultat. Servern får samtidigt inte välja en annan källa
efter att operatören har bekräftat sitt intent.

IOF Data Standard 3.0 har `DidNotFinish`, men inget withdrawal-element eller
internt provenansformat. Efter återtagandet ska exporten därför åter använda
den befintliga sanningsenliga `OK`- eller `MissingPunch`-formen.

## Beslut

### Immutable withdrawal och restaureringsrevision

O-Tid inför `DidNotFinishWithdrawal` som ett separat immutable
livscykelbeslut. Det avslutar exakt ett aktivt DNF och appenderar samtidigt en
publicerad `ResultRevision` med orsaken `MANUAL_DID_NOT_FINISH_WITHDRAWAL`.

Restaureringsrevisionen har null direkt readout, unik withdrawalreferens och
ett `ResultOutcome` som är canonicalt exakt lika med en strikt publicerad
teknisk `OK|MP`-källa. Ingen tid, split, kontroll eller status konstrueras på
nytt. Withdrawal, restaureringsrevision och actor-audit committar atomiskt.

Beslut, DNF-revision, tekniska källor och rawdata förblir immutable. Efter
commit är restaureringsrevisionen ordinarie latest-head; ingen läsare behöver
återuppliva en äldre revision genom fallback.

### Exakt intentbunden källa

Withdrawal-intentet binder hela den aktiva kedjan och samtidighetsgrunden:
entry-/klass-/ban-/snapshotversion, DNF-decision, dess ursprungliga target,
skapad DNF-revision, observerat absolut revisionshuvud och exakt
restaureringskälla med samtliga revisionsnummer.

Utan senare teknik är det absoluta huvudet DNF-revisionen och källan
decisionens ursprungliga tekniska target. Om senare ingest eller explicit
omräkning finns måste det absoluta huvudet självt vara den direkta tekniska,
publicerade och strikta `OK|MP`-källan. Ett opublicerat, manuellt, korrupt eller
stödfrämmande huvud avvisas. Servern hoppar aldrig till en äldre teknisk
revision och väljer aldrig om källan vid commit.

Exact retry från samma actor med samma hela intent återger samma immutable
withdrawal och restaureringsrevision även efter senare data. Ändrad actor,
head, source eller annat intentfält är konflikt.

### DNF-livscykel och senare nytt beslut

Den rena DNF-resolvern får `withdrawal | null`. Utan withdrawal väljer den
fortsatt den frysta DNF-revisionen. Med withdrawal kräver den full reciprocal
decision↔DNF↔withdrawal↔restoration-provenans och att det normalt valda huvudet
är restaureringsrevisionen eller en senare revision. Saknad identitet,
fel revisionsföljd eller fallback failar stängt.

Alla historiska DNF-kedjor för en entry valideras i den centrala
application-resolvern. Högst en får vara aktiv. Endast en icke återtagen kedja
räknas i den gemensamma DNS/DSQ/approval/DNF-mutexen.

Migration 0018:s `UNIQUE(entry_id)` var uttryckligen tillfällig medan
withdrawal saknades. Migration 0019 tar bort just den enforcement-indexen och
ersätter den med en icke-unik race/entry/revision-index. Inga rader skrivs om.
Den entry-låsta resolvergrinden bevarar en-aktiv-invarianten över flera
historiska beslut, eftersom en partial unique-index inte kan uttrycka aktivitet
över decision- och withdrawaltabellerna.

Ett senare nytt DNF får skapas först när ett nytt direkt tekniskt `OK|MP`-head
har appenderats efter withdrawal. Den manuella restaureringsrevisionen räknas
inte som tekniskt target. Därmed kan ett historiskt fel rättas utan att öppna
för omedelbar DNF-toggling över samma tekniska fakta.

### Databasinvarianter

Migration 0019 lägger till capability `WITHDRAW_DID_NOT_FINISH`, actor kind
`DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL`, revisionsorsaken
`MANUAL_DID_NOT_FINISH_WITHDRAWAL`, nullable unik
`result_revision.did_not_finish_withdrawal_id` och den immutable tabellen
`did_not_finish_withdrawal`.

Journalen binder actor/request, race/entry, entry-/klass-/bana-/snapshotversion,
decision, ursprungligt target, DNF-revision, observerat absolut huvud,
restaureringskälla, policyversion, skapad revision och tidpunkt. Den skapade
revisionen är exakt `expectedAbsoluteRevision + 1`. Den enda tillåtna
withdrawal-orsaken är `ERRONEOUS_MANUAL_DID_NOT_FINISH` och policyversionen är
`did-not-finish-withdrawal-v1`.

Check-, unique- och deferred komposit-FK:er bevisar decisionens DNF-kedja,
observerat huvud, källa och reciprocal withdrawal↔restoration med samma
race/entry/revisionsnummer. Request, decision, återtagen DNF-revision och
skapad restoration är unika. Källconstrainten kräver att övriga
provenienskolumner är null för withdrawalgrenen och vice versa.

Canonical JSON-likhet, teknisk/publicerad källa, aktiv overlay och högst en
aktiv DNF hör till domain/application under lås. Generiska immutable triggers
skyddar journal och resultatrevision.

### Oförändrat outcome, ranking och IOF

`ResultOutcome`, `EvaluationResult` och statusordningen `OK`, `MP`, `DSQ`,
`DNF`, `DNS` ändras inte. Efter withdrawal är det källans exakta `OK|MP` som
blir effektivt: OK rankas på nytt och MP förblir orankat.

Publikresultat förblir format 4 eftersom wireformen inte ändras. Liksom andra
restaureringsrevisioner visar den det återställda tekniska utfallet utan intern
withdrawalprovenans.

IOF Snapshot och nya Complete-dokument följer befintliga regler för `OK` och
`MissingPunch`. Inga interna decision-/withdrawal-id:n, proof eller nya
statusar serialiseras. Tidigare fryst Complete med `DidNotFinish` ändras aldrig.

### Historik och finalisering

Historikformat 5 får den diskriminerade källan
`MANUAL_DID_NOT_FINISH_WITHDRAWAL` med withdrawal-, decision-, target-, DNF-
och restoration-source-identitet. Därmed syns target → DNF → eventuell senare
teknik → restoration utan mutation. Format 1–4 läses oförändrat.

Nya klass- och loppsfinaliseringar använder format 5 och fryser hela DNF-
withdrawalkedjan samt restaurerat outcome. Withdrawal gör en aktuell
finaliseringsbasis inaktuell och kräver ny explicit finalisering. Historiska
format och tidigare Complete-projektioner, XML-bytes och hash förblir
oförändrade. Finalization-adminwrapper och exportmetadata stannar på format 1.

### Säkerhet och lås

`WITHDRAW_DID_NOT_FINISH` är en separat racebunden write-capability med eget
tokenprefix, cookies, session, CSRF och actor kind. Rätt att skapa DNF
implicerar inte rätt att återta det. Access gäller högst åtta timmar och
session högst en timme.

Browsern håller intent endast i minnet och auto-retryar aldrig okänd commit.
En explicit retry återanvänder samma request-id och oförändrade body.

Transaktionsordningen är session `UPDATE`, credential `UPDATE`, race `SHARE`,
request advisory lock, exact replay, entry `UPDATE`, full livscykelgrind,
absolut head-/sourcekontroll, append och audit. Den delar
`race → entry → revision` med ingest/omräkning och serialiseras mot
finaliseringens exklusiva racelås.

## Konsekvenser

- Ett felaktigt DNF kan rättas operativt utan update/delete eller historisk
  fallback.
- Senare teknisk fakta bevaras och kan väljas exakt, men får aldrig bytas in
  tyst efter operatörens bekräftelse.
- Den gemensamma manualgrinden behöver förstå flera historiska DNF-kedjor och
  skilja aktiv från återtagen.
- Publik och IOF behöver ingen ny wireform. Historik och finalisering får
  format 5 med bakåtkompatibel läsning.
- Den tillfälliga unika DNF-entry-indexen tas bort avsiktligt; datarader och
  immutable historik muteras inte.

## Databasmigration och återställning

Migration 0019 är framåtkompatibel och icke-datadestruktiv. Den appenderar
enumvärden, nullable kolumn och ny tabell samt ersätter en uttryckligen
tillfällig enforcement-index med en vanlig uppslagsindex. Befintliga rader
skrivs inte om och gamla readers måste uppgraderas före ny produktionswrite.

Enumvärden, kolumn, journal och historik droppas inte vid incident. Route/CLI
inaktiveras, credentials spärras och felet rättas framåt med en additiv
migration, eller så återställs en verifierad full PostgreSQL-backup.
Destructive rollback är förbjuden.

## Avvisade alternativ

- Mutera eller avpublicera DNF-revisionen: skriver om historik och gör äldre
  finaliseringar osanna.
- Endast markera decision återtaget: saknar en resultatrevision för skiftet och
  tvingar läsare till historisk fallback.
- Restaurera alltid originaltarget: kan lägga äldre fakta ovanpå senare ingest.
- Sök senaste tekniska källa vid commit: bryter fryst intent och exact retry.
- Automatisk withdrawal när ny readout kommer: skriver tyst över en manuell
  åtgärd och gör offlineordning verksamhetsstyrande.
- Behålla livstids-`UNIQUE(entry_id)`: gör ett senare legitimt DNF omöjligt
  även efter rättning och ny teknisk fakta.
- Tillåta omedelbart nytt DNF mot restoration: gör samma fakta togglebara och
  blandar manuell restoration med teknisk target.
- Införa `WITHDRAWN` eller `NO_RESULT` som tävlingsstatus: motsvarar ingen ny
  faktisk prestation och breddar alla adaptrar i onödan.
- Generell resultatjournal eller `MANAGE_RESULTS`: blandar separata
  verksamhetsbeslut och bryter minsta privilegium.
- Bulkåtertagande, manuella tider, kontrollneutralisering, Eventor, stafett,
  GPS eller hårdvara: större än snittet.
