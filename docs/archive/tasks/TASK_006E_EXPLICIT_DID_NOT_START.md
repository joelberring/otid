# TASK 006E – explicit individuellt ej-startbeslut

Status: Slutförd 2026-08-31.

## Mål

Ge en behörig arrangör möjlighet att för exakt en aktuell individuell entry
registrera det uttryckliga beslutet `DNS / DID_NOT_START`. Beslutet skapar en
ny immutable och publicerad resultatrevision utan att fabricera en
SPORTident-avläsning. Därmed kan en verklig icke-startare visas publikt,
exporteras som IOF `DidNotStart` och ingå i ett sanningsenligt finaliserat lopp.

Snittet inför endast ej-start. Det inför inte DNF, DSQ, utom tävlan, utan
tidtagning, automatisk frånvarotolkning eller generell resultatredigering.

## Arkitektur- och licensbeslut före implementation

- ADR-0029 låser status, provenans, revision, capability, idempotens,
  samtidighet och IOF-mappning före implementation.
- `evaluateCardReadout` förblir en ren kortmotor och producerar aldrig DNS.
  Domänen får i stället en separat strikt `DidNotStartResult`, och den lagrade
  resultatutgången är en diskriminerad union mellan kortbedömning och manuellt
  ej-startbeslut.
- IOF:s pinnade officiella XSD används endast som faktakälla. Ingen extern kod
  eller schemafil kopieras eller vendlas.
- Resultatlogik ligger fortsatt i `packages/domain`. HTTP, SQL, React och
  XML-adaptern får inte härleda DNS ur att en revision eller avläsning saknas.
- Ingen konflikt finns med `CODEX_BRIEF.md`, ADR-0026–0028 eller
  licensreglerna. Snittet fyller ADR-0028:s uttryckligen kvarlämnade lucka för
  en sann icke-startare.

## Berörda paket

- `packages/domain`: separat strikt DNS-resultat, policyversion och orankad
  klassranking; kortmotorn ändras inte semantiskt.
- `packages/contracts`: strikt DNS-adminflöde och lagrad resultatutgång utan att
  bredda stationens lokala kortbedömningskontrakt.
- `packages/database`: additiv migration för capability, auditaktör,
  revisionsorsak, immutable beslutsjournal och explicit revisionsprovenans.
- `packages/application`: privat kandidatprojektion, idempotent beslut,
  publikprojektion, historik, liveexport och finaliseringsgrund.
- `packages/iof-xml`: strikt `DNS -> DidNotStart` med endast `Status`.
- `apps/web`: separat privat session och svensk operatörsyta samt publik text.
- `tests` och `docs`: domän-, kontrakts-, PostgreSQL-, route-, UI-, E2E-, IOF-
  och återställningsbevis.

Stationens paket, SQLite, outbox, device-batch, parser och native USB ändras
inte.

## Domän- och revisionsregler

1. DNS får endast skapas genom ett explicit operatörsanrop för en namngiven
   aktuell entry. Avsaknad av avläsning eller revision är aldrig i sig DNS.
2. TASK 006E tillåter beslutet endast när entryn ännu saknar samtliga
   resultatrevisioner. En befintlig OK/MP/DNS-revision blockerar; återtagande
   eller överskrivning av ett verkligt resultat är ett senare eget beslut.
3. Intentet binder entryversion, aktuell klass, aktuell banversion,
   race-snapshot, väntat tomt revisionshuvud och DNS-policyversion.
4. Resultatrevisionen får `cause=MANUAL_DID_NOT_START`,
   `status=DNS`, `reason=DID_NOT_START`, `readoutId=null`, en unik immutable
   beslutsreferens, aktuell snapshot/klass/bana och tomma tider/splits.
5. `courseVersionId` är provenans för aktuell klass/bana och ett
   aktualitetsbevis, inte ett påstående om att deltagaren sprungit banan.
6. En senare riktig ingest får skapa nästa vanliga CARD_READOUT-revision. Den
   äldre DNS-revisionen skrivs aldrig över.

## Capability, idempotens och samtidighet

- `DECIDE_DID_NOT_START` är en separat racebunden write-capability med eget
  credentialprefix, egna host-only cookies, högst en timmes session,
  Origin-/CSRF-kontroll och actor-audit.
- Kandidat-GET lämnar endast aktuellt operatörsunderlag efter auth: namn,
  organisation, klass, entry-/snapshot-/banversion och senaste
  revisionsmetadata. Ingen bricka, punch, rawdata eller full evaluation lämnas.
- Mutation använder
  `Idempotency-Key: did-not-start:<canonical-uuid>` och en strikt body om högst
  4 KiB. Exakt samma aktör, target och intent returnerar samma beslut/revision
  med `replayed: true`; ändrad kontext ger konflikt.
- Låsordningen är session `UPDATE` → credential `UPDATE` → race `SHARE` →
  request advisory lock → entry `UPDATE` → revisionskontroll → beslut,
  resultatrevision och audit i samma transaktion.
- Ingest och omräkning använder samma race-/entryordning. Om ingest vinner
  först blockeras DNS; om DNS vinner först blir senare ingest nästa revision.
  Finaliseringens race `UPDATE` ser alltid ett helt före- eller efterläge.

## Publik-, IOF- och finaliseringsgräns

- DNS är orankad och påverkar aldrig OK-placering eller tid efter. Publikvyn
  visar `Ej start` utan tid, sträcktider eller placering.
- Live- och Complete-export mappar DNS till IOF
  `<Status>DidNotStart</Status>`. DNS-`Result` innehåller inga start-, mål-,
  total-, efter-, placerings- eller splitfält.
- En strikt publicerad DNS-revision på exakt aktuell snapshot/klass/bana täcker
  entryn i klassfinalisering. Saknad revision blockerar fortsatt och en DNS för
  en annan entry löser aldrig en olöst `UNKNOWN_CARD`-avläsning.
- Frysta äldre Complete-bytes ändras aldrig. Ett nytt DNS-beslut gör tidigare
  aktuell klassgrund inaktuell och kräver nya explicita klass-/loppsbeslut.

## Acceptans

- Giltigt explicit beslut skapar exakt ett immutable beslut, en publicerad
  DNS-revision och en actor-audit; ingen raw-/readout-/snapshotrad skapas eller
  ändras.
- Stale entry/klass/bana/snapshot, befintligt revisionshuvud, fel capability,
  race, Origin eller CSRF ger avslag utan domänwrite.
- Hundra samtidiga exact retries ger ett beslut, en revision och en audit.
  Ändrad aktör, entry eller intent med samma request-id ger konflikt.
- Samtidig ingest ger antingen DNS som revision 1 följd av kortrevision 2, eller
  kortrevision 1 och ett write-fritt DNS-avslag.
- Publikresultat, Snapshot och fryst Complete visar DNS sanningsenligt utan
  tider, splits eller ranking; saknad revision blir aldrig DNS.
- Klass/lopp med OK, MP och explicit DNS kan finaliseras. Olöst okänd bricka
  blockerar fortsatt.
- Full lint, typecheck, enhets-, PostgreSQL-, E2E- och buildgrind körs och
  redovisas exakt.

## Utanför snittet

- återtagande eller manuell ersättning av befintligt resultat,
- DNF, DSQ, utom tävlan och utan tidtagning,
- automatisk DNS från startlista, tid, frånvaro eller avsaknad av avläsning,
- Eventor-uppladdning, multi-race, stafett och lag,
- GPS, kartor, SPORTident-parser och riktig USB,
- generell rollmodell eller generell resultateditor.
