# TASK 006J – append-only återtagande av individuellt DNF

Status: Slutförd och verifierad 2026-09-01.

## Mål

Ge en separat behörig arrangör möjlighet att uttryckligen återta ett exakt
aktivt individuellt `DNF / DID_NOT_FINISH` från TASK 006I utan att skriva om
eller avpublicera beslutet, DNF-revisionen eller senare tekniska revisioner.

Återtagandet ska appendera en immutable withdrawaljournal och en publicerad
restaureringsrevision som canonicalt kopierar den exakt intentbundna senaste
giltiga tekniska `OK|MP`-källan. Därefter upphör DNF-overlayn och ordinarie
latest-head blir effektivt resultat. Snittet inför ingen generell
resultateditor, manuell tid eller ny tävlingsstatus.

## Arkitektur- och licensbeslut före implementation

- ADR-0034 låser immutable withdrawal, exakt restaureringskälla, nytt
  historik-/finaliseringsformat, capabilitygräns, idempotens och låsordning.
- `ResultOutcome`, `EvaluationResult`, kortmotorn, rankingstatusarna och IOF:s
  statusmappning breddas inte. Restaureringen är exakt källans befintliga
  `OK|MP`-outcome.
- Utan senare teknik är DNF-beslutets ursprungliga tekniska target
  restaureringskälla. Finns senare teknik måste det observerade absoluta
  huvudet självt vara den strikta publicerade tekniska `OK|MP`-källan.
- Servern får aldrig hoppa bakåt, välja om källan eller härleda en fallback vid
  commit. Ändrat huvud eller annan intentbunden identitet är konflikt.
- Den tillfälliga `UNIQUE(entry_id)`-spärren från migration 0018 ersätts av
  en icke-unik uppslagsindex och den centrala entry-låsta livscykelgrinden.
  Befintliga rader ändras inte. Ett senare nytt DNF kräver en ny direkt
  teknisk revision; restaureringsrevisionen är aldrig ett tillåtet DNF-target.
- IOF Data Standard 3.0 har inget withdrawal-element. Den pinnade officiella
  XSD:n vid commit `24eb108e4c6b5e2904e5f8f0e49142e45e2c5230` används endast
  som faktakälla; ingen extern kod eller schemafil kopieras eller vendlas.
- Ingen konflikt hittades mellan CODEX_BRIEF, arkitekturdokumenten och
  ADR-0028–0033. ADR-0034 kompletterar uttryckligen ADR-0033:s reserverade
  senare withdrawal-livscykel.

## Berörda paket

- `packages/domain`: ren DNF-livscykelresolver med explicit withdrawal.
- `packages/contracts`: separat withdrawal-adminformat samt historik- och
  finaliseringsformat 5 med bakåtkompatibel läsning.
- `packages/database`: migration 0019 med capability, actor kind,
  revisionsorsak, provenienskolumn och immutable withdrawaljournal.
- `packages/application`: privat lista, mutation, exact retry, gemensam
  manual-grind, levande projektion, historik och finalisering.
- `packages/iof-xml`: regression för restaurerat `OK|MP`; inget nytt
  XML-element, proof eller intern-id serialiseras.
- `apps/web`: separat svensk tvåstegsyta med egen session och CSRF.
- `scripts`, `tests` och `docs`: credential-CLI, PostgreSQL-, route-, UI-,
  E2E-, export-, migrations- och finaliseringsbevis.

Stationens SQLite, outbox, device-batch, SPORTidenttransport/parser och native
USB får ingen ny semantik.

## Domän- och revisionsregler

1. Withdrawal får endast targeta en komplett, reciprocal och exakt aktiv
   DNF-kedja: decision, ursprungligt tekniskt target och skapad DNF-revision.
2. Intentet binder entry-/klass-/ban-/snapshotversion, decision, target,
   DNF-revision, observerat absolut revisionshuvud och exakt teknisk
   restaureringskälla med samtliga revisionsnummer.
3. Utan senare revisioner är absolut huvud DNF-revisionen och källan
   originaltarget. Om senare ingest/omräkning finns måste absolut huvud och
   källa vara samma direkta tekniska, publicerade och strikta `OK|MP`-revision.
4. Opublicerat, manuellt, korrupt eller stödfrämmande absolut huvud, äldre
   källa, fallback, redan återtaget beslut och aktivt annat manuellt tillstånd
   avvisas utan domänwrite.
5. Withdrawal, publicerad `MANUAL_DID_NOT_FINISH_WITHDRAWAL`-revision och audit
   appenderas atomiskt. Revisionen har null direkt readout och ett
   `ResultOutcome` som är canonicalt exakt lika med källans.
6. Beslutet, DNF-revisionen, källrevisionen, rawdata, readout, publiceringsfält
   och race-snapshot muteras aldrig.
7. Efter commit väljer ordinarie latest-head restaureringsrevisionen. En senare
   teknisk revision appenderas normalt och blir därefter effektiv.
8. Alla historiska DNF-kedjor valideras under entrylåset. Högst en får vara
   aktiv; korrupt eller dubbelaktiv provenance failar stängt.
9. Ett nytt DNF efter withdrawal kräver ett nytt exakt direkt tekniskt
   `OK|MP`-head. Den manuella restaureringsrevisionen kan inte targetas.

## Capability, idempotens och samtidighet

- `WITHDRAW_DID_NOT_FINISH` är en separat racebunden write-capability med
  tokenprefix `otid_org_did_not_finish_withdrawal_v1`, egna host-only cookies
  och actor kind `DID_NOT_FINISH_WITHDRAWAL_ACCESS_CREDENTIAL`. Access gäller
  högst åtta timmar och session högst en timme.
- Privat withdrawal-GET är bounded och lämnar bara minimal display-, versions-,
  beslut-, head- och källmetadata. Tider, bricknummer, punches, rawdata, full
  evaluation, token och hash lämnas inte ut.
- Body är strikt versionsmärkt JSON om högst 4 KiB. Origin, session,
  capability, race och CSRF valideras före bodyläsning och mutation.
- Idempotency key är `did-not-finish-withdrawal:<canonical-uuid>` och
  policyversionen är `did-not-finish-withdrawal-v1`.
- Withdrawal reason är den enda tillåtna
  `ERRONEOUS_MANUAL_DID_NOT_FINISH`.
- Exact replay matchar actor, race, entry och varje fryst intentfält och
  returnerar samma withdrawal/restaureringsrevision även efter senare ingest.
  Ändrad actor, head, source eller annat intentfält är konflikt.
- Låsordning är session `UPDATE` → credential `UPDATE` → race `SHARE` →
  request advisory lock → exact replay → entry `UPDATE` → full livscykelgrind
  → absolut head-/sourcekontroll → append och audit.
- Om ingest vinner först blir withdrawal stale och write-fritt. Om withdrawal
  vinner får ingest appendera nästa revision utan avbrott i revisionsföljden.

## Publik, ranking, IOF, historik och finalisering

- Före withdrawal är effektivt utfall status-only DNF. Efter withdrawal är det
  källans exakta `OK|MP`; OK rankas på nytt och MP förblir orankat.
- Publikresultat förblir format 4 eftersom wireformen inte ändras. Den visar
  det restaurerade tekniska utfallet på samma sätt som andra latest-heads och
  läcker ingen intern withdrawalprovenans.
- IOF Snapshot och nya Complete-dokument använder vanliga befintliga regler
  för restaurerat `OK|MP`. Inga decision-/withdrawal-id:n eller nya statusar
  serialiseras.
- Historikformat 5 lägger till den diskriminerade källan
  `MANUAL_DID_NOT_FINISH_WITHDRAWAL` och visar target → DNF → eventuell senare
  teknik → restoration. Format 1–4 förblir läsbara.
- Nya klass-/loppsfinaliseringar använder format 5 och fryser hela
  withdrawal-/restaureringskedjan. En tidigare Complete med DNF förblir
  byte-, hash- och projektionsmässigt oförändrad.
- Withdrawal gör aktuell finaliseringsbasis inaktuell och kräver ny explicit
  klass-/loppsfinalisering. `Complete` kräver fortsatt separat proof.

## Acceptans

- Ren resolver godtar exakt aktiv decision↔DNF↔withdrawal↔restoration och
  avvisar alla identitets-, ordnings-, käll- och fallbackmotsägelser.
- Utan senare ingest restaureras originaltarget exakt. Med senare ingest
  restaureras exakt den intentbundna direkta tekniska latest-revisionen.
- Giltigt withdrawal skapar exakt en journal, restaureringsrevision och audit,
  men inga raw/readout/snapshotmutationer.
- Hundra samtidiga exact retries ger en withdrawal, revision och audit. Ändrad
  actor eller ett enda intentfält konflikterar; två request-id:n ger en vinnare.
- Samtidig ingest och withdrawal ger helt före/efter under lås utan tyst
  källändring; senare ingest efter withdrawal appenderas normalt.
- Gemensam manual-grind ser bara icke återtaget DNF som aktivt, avvisar
  dubbelaktiv/korrupt historik och tillåter inte omedelbart nytt DNF mot
  restaureringsrevisionen.
- Databasens komposit-FK, unique/check och immutable-trigger avvisar
  felparning, dubbel withdrawal, update och delete. Restore 0000–0019 provas.
- Publik och Snapshot går från DNF till exakt restaurerat `OK|MP`; historik
  visar hela append-only-kedjan och IOF läcker ingen intern provenans.
- Äldre Complete med DNF är byte-/hashstabil. Ny Complete efter withdrawal
  fryser format 5 och det restaurerade utfallet.
- Svenskt UI har separat capability, uttrycklig andra bekräftelse, minst 52 px
  touchmål, synligt tangentbordsfokus, text/symbol utöver färg, minnesburet
  intent och endast explicit same-id-retry efter okänd commit.
- Full lint, typecheck, enhets-, PostgreSQL-, E2E-, produktions- och buildgrind
  körs och redovisas exakt.

## Utanför snittet

- bulkåtertagande och generell resultateditor,
- automatisk withdrawal vid ingest och fri status-/orsaksväljare,
- manuella tider, punch-/splitändring och kontrollneutralisering,
- omedelbart nytt DNF mot en restaureringsrevision,
- Eventor-uppladdning, multi-race, stafett/lag, GPS, kartor,
  SPORTidentparser och riktig USB.
