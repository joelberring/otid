# TASK 006G – manuell diskvalifikation med append-only återtagande

Status: Genomförd och verifierad 2026-09-01.

## Mål

Ge två separat behöriga arrangörsroller möjlighet att:

1. diskvalificera ett exakt aktuellt, publicerat individuellt `OK`- eller
   `MP`-resultat, och
2. uttryckligen återta just det manuella beslutet utan att någon historik
   skrivs över eller försvinner.

Diskvalifikationen ska förbli det levande tävlingsutfallet tills ett explicit
återtagande committar, även om senare avläsningar eller omräkningar appenderar
nya underliggande resultatrevisioner. Återtagandet ska skapa en ny publicerad
restaureringsrevision från en exakt, intentbunden `OK`/`MP`-källrevision.

Snittet uppfyller CODEX_BRIEF:s kritiska acceptansfall 16 men inför inte en
generell resultateditor, DNF, utom tävlan, utan tidtagning eller juryärenden.

## Arkitektur- och licensbeslut före implementation

- ADR-0031 låser resultattyp, beslutsaktivitet, restaureringsrevision,
  capabilitygräns, idempotens, låsning, ranking, IOF och finalisering.
- `EvaluationResult` och stationens `OK | MP | UNKNOWN_CARD` breddas inte.
  `DSQ / MANUAL_DISQUALIFICATION` finns endast i lagrade `ResultOutcome`.
- Den manuella DSQ-revisionen kopierar källresultatets tävlingsfakta men har
  egen beslutsprovenans. Den skapar aldrig rawdata eller en syntetisk readout.
- Ett aktivt DSQ-beslut är en explicit överlagring ovanpå senare tekniska
  revisioner. Endast ett immutable återtagande avslutar beslutet.
- Efter återtagande finns ingen historisk fallbacköverlagring: en ny
  resultatrevision återställer exakt den valda underliggande källans utfall.
- IOF:s pinnade officiella XSD vid commit
  `24eb108e4c6b5e2904e5f8f0e49142e45e2c5230` används endast som faktakälla.
  Ingen extern kod, schemafil eller AGPL-struktur kopieras.
- Ingen konflikt finns med styrande dokument. ADR-0028–0030 kompletteras
  uttryckligen av ADR-0031; deras historiska beslut ändras inte retroaktivt.

## Berörda paket

- `packages/domain`: ren DSQ-konstruktion, statusordning och resolver för
  aktivt manuellt beslut.
- `packages/contracts`: lagrad DSQ-union, ranking/public/finalization/IOF-
  kontrakt samt separata adminflöden för beslut och återtagande.
- `packages/database`: additiv migration för två capabilities, två actor kinds,
  revisionsorsaker, provenienskolumner och immutable beslut/withdrawal.
- `packages/application`: kandidat- och mutationsflöden, exact retry, central
  effektiv-resultatresolver samt publik, Snapshot, historik och finalisering.
- `packages/iof-xml`: strikt individuell mappning `DSQ -> Disqualified`.
- `apps/web`: två separata svenska tvåstegsytor med egna sessions-/CSRF-cookies.
- `tests`, `scripts` och `docs`: credential-CLI, enhets-, PostgreSQL-, route-,
  E2E-, migrations-, export-, finaliserings- och återställningsbevis.

Stationens SQLite, outbox, device-batch, SPORTidenttransport/parser och native
USB får ingen ny semantik.

## Domän- och revisionsregler

1. Första DSQ-intentet får endast targeta entryns absoluta senaste revision när
   den är publicerad, runtimegiltig, readoutbaserad `OK` eller `MP` och exakt
   aktuell för entry, klass, banversion och race-snapshot.
2. DNS, återtaget DNS utan aktivt resultat, `UNKNOWN_CARD`, stale eller
   opublicerad revision, korrupt provenans och redan aktiv DSQ avvisas utan write.
3. Beslutet appenderar ett immutable verksamhetsbeslut, en publicerad
   `MANUAL_DISQUALIFICATION`-revision och en actor-audit atomiskt.
4. DSQ-resultatet kopierar källans entry, historiska klass/bana, tider,
   kontrollutfall och splits exakt men ändrar status/reason till
   `DSQ / MANUAL_DISQUALIFICATION`. Det får aldrig ranking.
5. Senare ingest eller explicit omräkning får appendera vanliga revisioner.
   Det aktiva beslutets frysta DSQ-revision förblir ändå levande tills withdrawal.
6. Withdrawal-intentet binder aktivt beslut, skapad DSQ-revision, observerat
   absolut revisionshuvud och en exakt senaste giltig underliggande `OK`/`MP`-
   källa. Finns ingen senare teknisk revision är beslutets ursprungliga target
   källan.
7. Withdrawal, en publicerad `MANUAL_DISQUALIFICATION_WITHDRAWAL`-revision som
   exakt kopierar källans `ResultOutcome`, och actor-audit committar atomiskt.
   Ingen äldre revision återaktiveras genom ett generellt max-/fallbackurval.
8. Ett senare, separat DSQ-beslut får endast påbörjas efter att föregående
   beslut har ett giltigt withdrawal och ett nytt exakt aktuellt target.

## Capability, idempotens och samtidighet

- `DISQUALIFY_RESULT` och `WITHDRAW_DISQUALIFICATION` är separata racebundna
  write-capabilities med egna tokenprefix, host-only cookies och actor kinds.
  Access gäller högst åtta timmar och session högst en timme.
- Privat kandidat-/besluts-GET är bounded och lämnar minimal display-,
  revisions- och livscykelmetadata efter auth. Bricknummer, punches, rawdata,
  full evaluation, token och hash lämnas inte ut.
- Body är strikt versionsmärkt JSON om högst 4 KiB. Origin, CSRF, race och
  capability valideras före mutation.
- Idempotency keys är `manual-disqualification:<canonical-uuid>` respektive
  `manual-disqualification-withdrawal:<canonical-uuid>`.
- Exact replay matchar actor, race, entry och varje fryst intentfält och
  returnerar samma beslut/revision utan ny write. Ändrad kontext är konflikt.
- Låsordning är session `UPDATE` → credential `UPDATE` → race `SHARE` →
  request advisory lock → exact replay → entry `UPDATE` → resultat-/
  livscykelkontroll → append och audit.
- Om ingest vinner före ett nytt DSQ blir target stale och beslutet avvisas.
  Om DSQ vinner får ingest appendera nästa revision men effektivt resultat är
  fortsatt DSQ. Withdrawal och ingest ger alltid obruten revisionsföljd; ett
  stale withdrawal-intent får aldrig välja en annan källa automatiskt.

## Publik, ranking, IOF, historik och finalisering

- DSQ är `NOT_RANKABLE_STATUS`. Deterministisk ordning är `OK`, `MP`, `DSQ`,
  `DNS`; bara `OK` påverkar position, tid efter och mixed-course-kontroll.
- Publikresultat visar `Diskvalificerad`, bevarad tid/splits när källan hade dem
  och aldrig position eller tid efter.
- IOF Snapshot och nya Complete-dokument mappar DSQ till `Disqualified`.
  Start, mål, total tid och splits får följa källan; interna beslut/reason-
  fält serialiseras aldrig och rankingelement förbjuds.
- Aktiv-resultatresolvern används gemensamt av publik, Snapshot,
  finaliseringsbasis och adminlistor. SQL-vy, route eller React får inte bära
  en alternativ livscykelregel.
- Historiken visar target → DSQ → eventuella senare tekniska revisioner →
  restaureringsrevision utan update/delete.
- Ny finaliseringsbasis inkluderar effektiv DSQ, decision/target, absolut
  underliggande head och eventuell withdrawal/restoration. En ny mutation gör
  aktuell basis inaktuell, men äldre fryst Complete-XML/hash förblir byte-exakt.
- Nya frysta finaliseringsprojektioner använder format 2. Format 1 måste
  fortsatt kunna läsas för historiska finaliseringar.

## Acceptans

- Giltig OK och varje giltig MP-form kan diskvalificeras; tider/splits bevaras
  exakt och ranking försvinner.
- Beslutet skapar exakt en decision, DSQ-revision och audit men noll rawposter,
  readouts eller snapshotändringar.
- Senare ingest/omräkning appenderar men publik, Snapshot och finalisering visar
  fortsatt aktiv DSQ.
- Withdrawal utan senare resultat restaurerar originaltarget exakt; withdrawal
  efter senare resultat restaurerar den exakt intentbundna senaste tekniska
  revisionen.
- Hundra samtidiga exact retries ger en decision/withdrawal, en respektive
  revision och audit. Ändrad actor eller intent konflikterar.
- Databasens komposit-FK, unique/check och immutable-trigger avvisar felparning,
  dubbelt withdrawal, update och delete.
- Stale entry/klass/bana/snapshot/head/source, fel capability/race/Origin/CSRF
  och korrupt källa ger avslag utan partiell domänwrite.
- Snapshot och Complete skriver `Disqualified` med källans fakta men utan
  ranking. Äldre Complete-bytes ändras aldrig.
- Svenskt UI har separata sidor/capabilities, uttrycklig andra bekräftelse,
  minst 52 px touchmål, text/symbol utöver färg, minnesburet intent och endast
  explicit same-id-retry efter okänd commit.
- Full lint, typecheck, enhets-, PostgreSQL-, E2E- och buildgrind körs och
  redovisas exakt.

## Utanför snittet

- generell resultateditor, bulkbeslut eller fri statusväljare,
- DNF, utom tävlan, utan tidtagning och kontrollneutralisering,
- automatisk DSQ från kortdata eller automatisk återtagning vid ny avläsning,
- Eventor-uppladdning, multi-race, stafett och lag,
- GPS, kartor, SPORTidentparser och riktig USB.
