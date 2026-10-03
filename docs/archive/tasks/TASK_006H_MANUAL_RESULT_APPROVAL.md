# TASK 006H – manuellt resultatgodkännande med append-only återtagande

Status: Genomförd och server-/webbverifierad 2026-09-01. Androids
Gradlegrindar är fortsatt overifierade eftersom värden saknar Java-runtime.

## Mål

Ge två separat behöriga arrangörsroller möjlighet att:

1. manuellt godkänna ett exakt aktuellt, publicerat och tidskomplett
   individuellt `MP`-resultat, och
2. uttryckligen återta just godkännandet utan att beslut, kortfakta eller
   resultathistorik skrivs över.

Godkännandet ska vara det levande tävlingsutfallet tills ett explicit
återtagande committar, även om senare avläsning eller omräkning appenderar nya
tekniska revisioner. Återtagandet ska skapa en ny publicerad
restaureringsrevision från den exakt intentbundna senaste giltiga tekniska
`OK`/`MP`-källan.

Snittet genomför CODEX_BRIEF:s V1-regel om manuellt godkännande utan en
generell resultateditor, manuella tider, kontrollneutralisering eller fria
statusval.

## Arkitektur- och licensbeslut före implementation

- ADR-0032 låser lagrad outcome, aktiv overlay, restaureringsrevision,
  capabilitygräns, ranking, IOF, finalisering och låsordning.
- `EvaluationResult`, `evaluateCardReadout` och stationens
  `OK | MP | UNKNOWN_CARD` breddas inte. `OK / MANUAL_APPROVAL` är endast en
  strikt lagrad `ResultOutcome`.
- Första policyn accepterar endast tidskomplett `MP/MISSING_CONTROL` eller
  `MP/WRONG_ORDER`. `MISSING_START`, `MISSING_FINISH` och
  `INVALID_TIME_ORDER` avvisas eftersom ett rankbart OK annars skulle kräva
  fabricerad tid.
- Approval-revisionen kopierar källans entry, historiska klass/bana,
  start/mål/total tid, missing/extra controls och splits exakt. Endast
  status/reason ändras.
- Ett aktivt approval är en explicit overlay över senare tekniska revisioner.
  Detta följer briefens regel att servern aldrig tyst skriver över en manuell
  åtgärd när data synkas efter offlineperiod.
- Den pinnade officiella IOF 3.0-XSD:n vid commit
  `24eb108e4c6b5e2904e5f8f0e49142e45e2c5230` används endast som faktakälla.
  Ingen extern kod eller schemafil kopieras eller vendlas.
- Ingen konflikt finns med ADR-0028–0031. ADR-0032 kompletterar deras
  immutable finaliserings- och manuella resultatlivscykler.

## Berörda paket

- `packages/domain`: ren approval-konstruktion och explicit approval-resolver.
- `packages/contracts`: lagrad approval-union, publik/historik/finalisering
  format 3 samt separata adminflöden.
- `packages/database`: additiv migration med capabilities, actor kinds,
  revisionsorsaker, provenienskolumner och immutable decision/withdrawal.
- `packages/application`: kandidat- och mutationsflöden, exact retry,
  gemensam effektiv-resultatresolver, publik, Snapshot, historik och
  finalisering.
- `packages/iof-xml`: explicit runtimevaliderad, icke-serialiserad
  approval-proof för `OK` med sanningsenlig saknad split.
- `apps/web`: två separata svenska tvåstegsytor med egna sessioner och CSRF.
- `scripts`, `tests` och `docs`: credential-CLI, enhets-, PostgreSQL-, route-,
  E2E-, migrations-, export- och finaliseringsbevis.

Stationens SQLite, outbox, device-batch, SPORTidenttransport/parser och native
USB får ingen ny semantik.

## Domän- och revisionsregler

1. Första approval-intentet får endast targeta entryns absoluta senaste
   revision när den är publicerad, teknisk/readoutbaserad, exakt aktuell för
   entry/klass/bana/snapshot och har `MP/MISSING_CONTROL` eller
   `MP/WRONG_ORDER` med giltig start, mål och totaltid.
2. `OK`, DNS, DSQ, `UNKNOWN_CARD`, tidslöst eller korrupt MP, opublicerad/stale
   revision och redan aktiv manuell approval/DSQ avvisas utan write.
3. Beslutet appenderar immutable decision, publicerad
   `OK / MANUAL_APPROVAL`-revision och actor-audit atomiskt. Rawdata,
   readout och snapshotversion ändras inte.
4. Approval-resultatet deep-kopierar källans tävlingsfakta. Missing controls
   och frånvarande splittid bevaras som fakta; ingen punch eller split fabriceras.
5. Senare ingest eller explicit omräkning får appendera tekniska revisioner.
   Det aktiva beslutets frysta approval-revision förblir effektiv tills
   withdrawal.
6. Withdrawal-intentet binder aktiv decision, approval-revision, observerat
   absolut revisionshuvud och exakt senaste giltiga underliggande tekniska
   `OK`/`MP`-källa. Utan senare teknik är originalets MP-target källan.
7. Withdrawal, en publicerad `MANUAL_RESULT_APPROVAL_WITHDRAWAL`-revision som
   exakt kopierar källans `ResultOutcome`, och audit committar atomiskt.
8. Ett senare separat approval kräver att föregående beslut är återtaget och
   att ett nytt exakt tekniskt MP-head är aktuellt.

## Capability, idempotens och samtidighet

- `APPROVE_RESULT` och `WITHDRAW_RESULT_APPROVAL` är separata racebundna
  write-capabilities med egna tokenprefix, host-only cookies och actor kinds.
  Access gäller högst åtta timmar och session högst en timme.
- Privat kandidat-/withdrawal-GET är bounded och lämnar minimal display-,
  revisions- och livscykelmetadata efter auth. Bricknummer, punches, rawdata,
  full evaluation, token och hash lämnas inte ut.
- Body är strikt versionsmärkt JSON om högst 4 KiB. Origin, CSRF, race och
  capability valideras före mutation och före bodyläsning där gränsen kräver.
- Idempotency keys är `manual-result-approval:<canonical-uuid>` respektive
  `manual-result-approval-withdrawal:<canonical-uuid>`.
- Exact replay matchar actor, race, entry och varje fryst intentfält och
  returnerar samma beslut/revision utan ny write. Ändrad kontext är konflikt.
- Låsordning är session `UPDATE` → credential `UPDATE` → race `SHARE` →
  request advisory lock → exact replay → entry `UPDATE` → full kontroll →
  append och audit.
- Om ingest vinner före ett nytt approval blir target stale. Om approval
  vinner får ingest appendera, men effektivt resultat förblir approval. Ett
  stale withdrawal-intent byter aldrig huvud eller källa automatiskt.
- Aktiv approval och aktiv DSQ får aldrig finnas samtidigt för samma entry.
  Respektive mutationsgräns måste faila stängt mot den andra livscykeln.

## Publik, ranking, IOF, historik och finalisering

- `OK/MANUAL_APPROVAL` är rankbart med källans exakta elapsed time.
  Position/tid efter härleds på nytt över klassens aktuella OK-resultat och
  sparas aldrig i revisionen.
- Publik format 3 visar `Godkänd manuellt av arrangör`, bevarad
  missing-/splitförklaring och härledd ranking. Format 1 och 2 förblir läsbara.
- IOF Snapshot och nya Complete-dokument mappar approval till `OK`. Start,
  mål, Time, Position och TimeBehind följer vanliga OK-regler. En saknad split
  skrivs som `SplitTime status="Missing"`; aldrig med fabricerad tid.
- IOF-adaptern får bara tillåta ett OK med saknad split när projektionen bär en
  strikt runtimevaliderad `manualApprovalProof` med decision- och target-id.
  Proof och intern reason/proveniens serialiseras aldrig.
- Aktiv-resultatresolvern används gemensamt av publik, Snapshot,
  finaliseringsbasis och adminlistor. SQL, route, React och XML får inte bära
  en alternativ overlayregel.
- Historiken visar MP-target → approval → eventuella senare tekniska revisioner
  → restaureringsrevision utan update/delete.
- Ny finaliseringsbasis fryser approval decision/target, effektiv revision,
  absolut underliggande head och eventuell withdrawal/restoration i format 3.
  Historiska format 1/2 och äldre Complete XML/hash förblir byte-exakta.

## Acceptans

- Giltig tidskomplett `MISSING_CONTROL` och `WRONG_ORDER` kan godkännas;
  källfakta bevaras exakt och resultatet rankas som OK.
- Tidslösa MP-former, fel status/reason, korrupt tid/split/proveniens och stale
  target avvisas utan decision, revision eller audit.
- Beslutet skapar exakt en decision, approval-revision och audit men noll
  rawposter, readouts eller snapshotändringar.
- Senare ingest/omräkning appenderar men publik, Snapshot och finalisering visar
  fortsatt aktiv approval tills explicit withdrawal.
- Withdrawal utan senare teknik restaurerar original-MP exakt; med senare
  teknik restaurerar den exakt intentbundna senaste giltiga tekniska OK/MP-källan.
- Hundra samtidiga exact retries ger en decision/withdrawal, en respektive
  revision och audit. Ändrad actor eller intent konflikterar.
- Databasens komposit-FK, unique/check och immutable-trigger avvisar felparning,
  dubbelt target/withdrawal, update och delete.
- Snapshot och Complete skriver `OK`, härledd ranking och sanningsenliga
  splits utan interna beslut/reason/proveniensfält.
- Svenskt UI har separata sidor/capabilities, uttrycklig andra bekräftelse,
  minst 52 px touchmål, synligt tangentbordsfokus, text/symbol utöver färg,
  minnesburet intent och endast explicit same-id-retry efter okänd commit.
- Full lint, typecheck, enhets-, PostgreSQL-, E2E-, produktions- och buildgrind
  körs och redovisas exakt.

## Utanför snittet

- generell resultateditor, fri status-/orsaksväljare och bulkbeslut,
- approval av OK, DNS, DSQ, `UNKNOWN_CARD`, DNF eller tidslöst MP,
- manuell start/mål/totaltid, punch-/splitändring och kontrollneutralisering,
- automatisk approval/withdrawal, Eventor-uppladdning, multi-race, stafett/lag,
- GPS, kartor, SPORTidentparser och riktig USB.
