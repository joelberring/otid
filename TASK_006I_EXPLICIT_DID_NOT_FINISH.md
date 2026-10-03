# TASK 006I – explicit individuellt ej fullföljt

Status: Genomförd och verifierad 2026-09-01.

## Mål

Ge en separat behörig arrangör möjlighet att markera ett individuellt resultat
som `DNF / DID_NOT_FINISH` genom ett uttryckligt beslut mot entryns exakta
aktuella, publicerade och tekniska `OK`- eller `MP`-revision.

Beslutet ska vara ett status-only tävlingsutfall och förbli den levande
projektionen när senare offlineavläsningar appenderas. Kortdata, tider,
stämplingar och tekniska revisioner ska bevaras oförändrade. Snittet inför inte
återtagande; rättning av ett DNF blir en separat senare vertikal uppgift.

## Arkitektur- och licensbeslut före implementation

- ADR-0033 låser outcome, immutable decision, aktiv overlay, gemensam
  manual-mutex, ranking, IOF, finalisering och låsordning.
- `EvaluationResult`, `evaluateCardReadout` och stationens
  `OK | MP | UNKNOWN_CARD` breddas inte. DNF är endast ett strikt lagrat
  `ResultOutcome`.
- Det manuella beslutet är DNF-faktumet. Targeten bevisar exakt vilken aktuell
  teknisk revision operatören bedömde; servern härleder aldrig DNF ur saknad
  stämpling eller tystnad.
- En policy som endast accepterar `MP/MISSING_FINISH` avvisas för detta snitt:
  dagens produktionskontrakt och `card_readout` kräver `finishPunchedAt`, så
  flödet skulle inte vara operativt nåbart utan ett större ingest-/schemasnitt.
- DNF-resultatet kopierar endast entry-, historisk klass- och banidentitet. Det
  innehåller ingen start, mål, elapsed, kontrollista eller split och kan därför
  inte fabricera eller motsäga targetens tekniska tidsfakta.
- Den pinnade officiella IOF 3.0-XSD:n vid commit
  `24eb108e4c6b5e2904e5f8f0e49142e45e2c5230` används endast som faktakälla.
  Ingen extern kod eller schemafil kopieras eller vendlas.
- Den inaktuella finaliseringstexten i `docs/domain-rules.md` är dokumenterad i
  `docs/status.md` och samordnas med ADR-0028, ADR-0031 och ADR-0032 innan
  produktionskod ändras.

## Berörda paket

- `packages/domain`: ren DNF-konstruktion samt statusordning/ranking.
- `packages/contracts`: lagrad DNF-union, adminflöde och publik-, historik- och
  finaliseringsformat 4.
- `packages/database`: additiv migration med capability, actor kind,
  revisionsorsak, provenienskolumn och immutable decisionjournal.
- `packages/application`: kandidat-/mutationsflöde, exact retry, gemensam
  active-manual-grind, levande projektion, historik och finalisering.
- `packages/iof-xml`: explicit `DNF -> DidNotFinish` utan tider eller ranking.
- `apps/web`: separat svensk tvåstegsyta med egen session och CSRF.
- `scripts`, `tests` och `docs`: credential-CLI, PostgreSQL-, route-, UI-,
  E2E-, export-, migrations- och finaliseringsbevis.

Stationens SQLite, outbox, device-batch, SPORTidenttransport/parser och native
USB får ingen ny semantik.

## Domän- och revisionsregler

1. Första DNF-intentet får endast targeta entryns absoluta senaste revision
   när den är publicerad, teknisk/readoutbaserad, strikt giltig `OK|MP` och
   exakt aktuell för entry, klass, bana och race-snapshot.
2. Ett äldre publicerat target bakom ett nyare opublicerat eller manuellt
   huvud, `UNKNOWN_CARD`, DNS, DSQ, approval, DNF eller korrupt utfall avvisas.
3. Beslutet appenderar en immutable decision, en publicerad
   `DNF/DID_NOT_FINISH`-revision och actor-audit atomiskt. Rawdata, readout,
   tekniskt utfall, publiceringsflagga och snapshot ändras inte.
4. DNF är status-only med entryId, classId och courseVersionId. Start, mål,
   elapsed, missing/extra controls och splits saknas alltid.
5. Senare ingest eller omräkning får appendera tekniska revisioner. Det aktiva
   DNF-beslutets frysta revision förblir effektivt utfall.
6. Aktiv DNS, DSQ, approval eller DNF blockerar ett nytt DNF. Aktiv DNF
   blockerar även nya DSQ- och approvalbeslut.
7. En gemensam entry-låst application-grind validerar att högst ett manuellt
   resultat är aktivt. Korrupt eller dubbelaktiv provenans failar stängt.

## Capability, idempotens och samtidighet

- `DECIDE_DID_NOT_FINISH` är en separat racebunden write-capability med
  tokenprefix `otid_org_did_not_finish_v1`, egen host-only session/CSRF och
  actor kind `DID_NOT_FINISH_ACCESS_CREDENTIAL`. Access gäller högst åtta
  timmar och session högst en timme.
- Privat kandidat-GET är bounded och lämnar endast minimal display-, versions-
  och targetmetadata. Bricknummer, punches, rawdata, full evaluation, token och
  hash lämnas inte ut.
- Body är strikt versionsmärkt JSON om högst 4 KiB. Origin, session,
  capability, race och CSRF valideras före bodyläsning/mutation.
- Idempotency key är `did-not-finish:<canonical-uuid>`.
- Exact replay matchar actor, race, entry och varje fryst intentfält och
  returnerar samma decision/revision även efter senare ingest. Ändrat intent
  är konflikt.
- Låsordning är session `UPDATE` → credential `UPDATE` → race `SHARE` →
  request advisory lock → exact replay → entry `UPDATE` → aktiv-manual-grind →
  absolut targetkontroll → append och audit.
- Om ingest vinner först blir target stale. Om DNF vinner får ingest appendera,
  men den levande projektionen förblir DNF.

## Publik, ranking, IOF, historik och finalisering

- DNF är orankad och statusordningen är `OK`, `MP`, `DSQ`, `DNF`, `DNS`.
  Endast `OK` påverkar position, tid efter eller mixed-course-kontroll.
- Publik format 4 visar svensk status och manuell provenance men ingen tid,
  placering, tid efter, kontrollista eller split. Format 1–3 förblir läsbara.
- IOF Snapshot och nya Complete-dokument mappar DNF till `DidNotFinish` och
  skriver endast obligatorisk `Status`; aldrig StartTime, FinishTime, Time,
  Position, TimeBehind eller fabricerade SplitTime.
- Historikformat 4 visar target → DNF som två immutable revisioner med en
  diskriminerad `MANUAL_DID_NOT_FINISH`-källa. Äldre format läses oförändrat.
- Nya finaliseringsprojektioner använder format 4 och fryser decision, target,
  effektiv DNF-revision samt absolut underliggande fysiskt huvud. Senare
  teknik gör aktuell basis inaktuell men ändrar aldrig äldre fryst XML/hash.
- `Complete` kräver fortsatt separat finalization proof; XML-adaptern får inte
  själv härleda coverage eller DNF-provenans.

## Acceptans

- Ren domänkonstruktor accepterar en strikt teknisk `OK|MP` och skapar endast
  `DNF/DID_NOT_FINISH` med exakt identitet; alla tider/kontrollfält saknas.
- Fel status/reason, manuell/opublicerad/äldre target, stale version och
  korrupt provenans avvisas utan decision, revision eller audit.
- Beslutet skapar exakt en decision, DNF-revision och audit men noll rawposter,
  readouts eller snapshotändringar.
- Senare ingest appenderar men publik, Snapshot och finalisering visar fortsatt
  aktiv DNF. Ingest före commit ger write-fri stale-konflikt.
- Hundra samtidiga exact retries ger en decision, revision och audit. Ändrad
  actor eller intent konflikterar.
- Gemensam manual-grind blockerar varje kombination av aktiva DNS/DSQ/approval/
  DNF och rättar den befintliga asymmetrin approval → senare teknik → DSQ.
- Databasens komposit-FK, unique/check och immutable-trigger avvisar felparning,
  dubbelt request/target/entry, update och delete.
- Snapshot och Complete skriver `DidNotFinish` utan tid, ranking eller intern
  provenans. Historiska Complete-bytes/hash förblir byte-exakta.
- Svenskt UI har separat capability, uttrycklig andra bekräftelse, minst 52 px
  touchmål, synligt tangentbordsfokus, text/symbol utöver färg, minnesburet
  intent och endast explicit same-id-retry efter okänd commit.
- Full lint, typecheck, enhets-, PostgreSQL-, E2E-, produktions- och buildgrind
  körs och redovisas exakt.

## Utanför snittet

- återtagande eller ersättning av DNF och generell resultateditor,
- automatisk DNF, fri status-/orsaksväljare och bulkbeslut,
- manuella tider, punch-/splitändring och kontrollneutralisering,
- ändring av finish-optional ingest/schema, Eventor-uppladdning, multi-race,
  stafett/lag, GPS, kartor, SPORTidentparser och riktig USB.
