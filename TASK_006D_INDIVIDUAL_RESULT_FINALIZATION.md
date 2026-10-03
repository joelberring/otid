# TASK 006D – immutable individuell resultatfinalisering

Status: Genomförd och verifierad 2026-08-31.

## Mål

Ge arrangören ett explicit, granskningsbart beslut som fryser fullständiga
individuella klassresultat och därefter ett helt lopp. Endast en lyckad
loppsfinalisering får skapa IOF XML 3.0 `ResultList status="Complete"`.

Den befintliga exporten fortsätter alltid vara en levande `Snapshot`. Snittet
inför inga nya resultatstatusar, ingen automatisk omräkning eller publicering
och ingen Eventor-uppladdning.

## Arkitektur- och licensbeslut före implementation

- ADR-0028 låser tvåstegsfinalisering, täckningsbevis, immutable snapshot,
  capability, idempotens och återställning före implementation.
- IOF:s officiella Data Standard 3.0-XSD används endast som faktakälla. Ingen
  extern kod eller schemafil kopieras eller vendlas.
- `published` betyder fortsatt publik synlighet och återanvänds inte som
  slutgiltighetsflagga.
- Resultatlogik och ranking ligger fortsatt i `packages/domain`. SQL väljer och
  låser fakta; IOF-adaptern validerar och serialiserar en redan beslutad
  projektion.
- Ingen konflikt finns med `CODEX_BRIEF.md`, ADR-0026 eller ADR-0027. Snittet
  fyller uttryckligen deras öppna lucka för ett sanningsenligt `Complete`.

## Berörda paket

- `packages/domain`: den befintliga rena klassrankingen återanvänds utan nya
  resultatstatusar.
- `packages/contracts`: strikta login-, kandidat-, mutations-, list- och
  exportmetadata-kontrakt.
- `packages/database`: additiv migration för capability, auditaktör och en
  append-only finaliseringstabell.
- `packages/application`: kandidatberäkning, täckningskontroll, idempotent
  finalisering och läsning av fryst slutexportrad.
- `packages/iof-xml`: explicit dokumentstatus; `Complete` kräver ett validerat
  finaliseringsbevis och får aldrig härledas av serializeraren.
- `apps/web`: separat privat finaliseringssession och svensk operatörsyta samt
  separat skyddad nedladdning av en vald fryst `Complete`.
- `tests` och `docs`: kontrakt, PostgreSQL, route, UI, E2E, acceptans och
  återställningsnot.

Station, Android, simulator, ingestkontrakt, lokal SQLite och paketformat
ändras inte.

## Två explicita steg

### 1. Klassfinalisering

En klassfinalisering fryser exakt alla aktuella entries i en aktuell klass som
har minst en entry. Den får skapas endast när:

1. varje entry har minst en resultatrevision,
2. entryns högsta revision är publicerad; en nyare opublicerad revision
   blockerar även om en äldre publicerad revision finns,
3. evaluationen är strikt giltig `OK` eller `MP`, har samma entry, race,
   aktuella klass och aktuella banversion som underlaget,
4. revisionens `snapshotVersion` är exakt loppets aktuella snapshotversion,
5. hela klassens OK-resultat använder en jämförbar historisk banversion och
   domänrankingen inte ger `MIXED_COURSE_VERSIONS`, och
6. projektionen ryms inom de befintliga ResultList-gränserna.

En tom klass kan inte finaliseras separat. Det finns inga tävlande att täcka,
och den ingår därför inte heller i loppets manifest.

### 2. Loppsfinalisering

En loppsfinalisering kräver minst en aktuell entry och exakt en senaste giltig
klassfinalisering för varje aktuell klass som har entries. Under samma
`race UPDATE`-lås räknas varje klassgrund om och måste vara byte-/hashidentisk
med den valda klassfinaliseringen.

Loppet får dessutom inte ha någon olöst `UNKNOWN_CARD`-avläsning, definierad
som en normaliserad avläsning vars serverbedömning var `UNKNOWN_CARD` och som
fortfarande saknar resultatrevision. Ingen DNS, DNF eller DSQ fabriceras.

Först därefter sammanfogas de frysta klassprojektionerna, serialiseras explicit
som `Complete` och sparas tillsammans med exakt XML-text och SHA-256. Ett event
med flera races avvisas fortsatt eftersom O-Tid saknar en sann raceordinal och
inte får påhitta `raceNumber=1`.

## Immutable snapshot och revisioner

En enda additiv tabell `result_finalization` innehåller både `CLASS` och
`RACE`:

- request-id, race, valfri klass, scope och scope-lokal revisionssekvens,
- källans snapshotversion och canonical SHA-256 för den fullständiga grunden,
- strikt runtimevaliderad `frozen_projection` med klass-, display-, resultat-,
  kontroll-, ranking- och källrevisionsdata,
- för `RACE`: exakt `Complete`-XML och dess SHA-256,
- aktörscredential och finaliseringstid.

Scope-/klass-, hash- och XML-kombinationerna skyddas med constraints. Update
och delete avvisas av databastrigger. En raceprojektion kopierar valda
klassprojektioner och deras identitet in i sin egen hashbundna JSON; dess
logiska innehåll beror därför inte på senare child-rader, namn, organisation,
externa id:n, course controls eller serializerarkod.

Senare ingest, import, klassändring, displayändring eller explicit omräkning
ändrar aldrig en äldre finalisering. Korrigering sker framåt genom en ny
klassfinaliseringsrevision och därefter en ny loppsfinaliseringsrevision.

## Capability, idempotens och samtidighet

- `FINALIZE_RESULTS` är en separat write-capability med egen credential,
  host-only cookies, högst en timmes session, CSRF/Origin-kontroll och actor-
  audit. Export- eller omräkningscapability får inte finalisera.
- Kandidat-GET lämnar endast operativa räknare, klassnamn, blockerarkoder,
  snapshotversion, canonical grundhash och senaste scope-revision; inga namn,
  bricknummer, punches, rawdata eller full evaluation.
- Mutation använder
  `Idempotency-Key: result-finalization:<canonical-uuid>` och binder scope,
  klass, väntad snapshotversion, väntad grundhash och väntad senaste revision.
- Exakt samma aktör och intent returnerar samma immutable rad med
  `replayed: true`. Återanvänt request-id med ändrad aktör eller intent ger
  konflikt.
- Låsordningen är session `UPDATE` → accesscredential `UPDATE` → race
  `UPDATE` → request advisory lock → full grundkontroll → finalisering och
  exakt en auditpost. Ingest och omräkning tar race `SHARE`, så commit blir ett
  helt före- eller efterläge.
- Finalisering ändrar aldrig `race.snapshotVersion`, resultatrevision,
  publiceringsflagga, entry, klass, bana, rådata eller stationstillstånd.

## Exportgräns

- Den befintliga export-URL:en och applikationsfunktionen förblir live
  `Snapshot` och skrivfria.
- En separat read-only-route under `EXPORT_IOF_RESULT_LIST` listar frysta
  loppsfinaliseringar och laddar ned exakt sparade XML-bytes efter
  `finalizationId`.
- Serializeraren får ett diskriminerat dokumentstatusfält. `Complete` kräver
  ett internt, runtimevaliderat finaliseringsbevis; bevisets interna id:n
  serialiseras aldrig till XML.
- IOF-mappning, elementordning, millisekundprecision, splitregler, ranking,
  single-race-gräns och dataminimering från TASK 006B/006C behålls.

## Acceptans

- Full klass med `OK` och `MP` kan finaliseras deterministiskt; saknad, stale,
  opublicerad, korrupt, klass-/bankonflikt eller mixed-course blockeras utan
  write.
- Ett lopp kan finaliseras först när alla aktuella entries täcks av aktuella
  klassfinaliseringar och inga olösta okända avläsningar finns.
- Hundra samtidiga exakta retries skapar en finaliseringsrad och en auditpost;
  olika request-id:n serialiseras till obrutna scope-revisioner.
- Senare mutationer ändrar aldrig gammal projektion, XML eller hash; en ny
  finalisering kräver nya explicita beslut.
- Fryst export ger byteidentisk `Complete` över hundra läsningar. Liveexporten
  fortsätter ge `Snapshot` och noll writes.
- Fel capability, race, CSRF, origin, expiry och revocation avvisas före
  kandidat- eller bodydata.
- Full lint, typecheck, enhets-, PostgreSQL-, E2E- och buildgrind passerar.

## Utanför snittet

- DNS, DNF, DSQ, utom tävlan och utan tidtagning,
- automatisk publicering, automatisk omräkning eller automatisk finalisering,
- Eventor-uppladdning, Delta-export, multi-race och flerdagarsresultat,
- stafett, lag, GPS, karta, SPORTident-parser och riktig USB,
- produktionsbackup, digital signering av resultat eller generell rollmodell.
