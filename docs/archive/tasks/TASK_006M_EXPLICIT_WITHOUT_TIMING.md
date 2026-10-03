# TASK 006M – explicit individuellt utan tidtagning

Status: Genomförd och verifierad 2026-09-01. Androids Gradlegrindar är fortsatt
blockerade av att värden saknar Java-runtime; ingen Android- eller
hårdvarukod ändrades i snittet.

## Mål

Ge en separat behörig arrangör möjlighet att uttryckligen markera en individ
som ”utan tidtagning” mot exakt ett aktuellt, publicerat och direkt tekniskt
`OK/COMPLETE`-resultat.

Beslutet ska appendera en immutable verksamhetsjournal och en publicerad
status-only-revision `NT/WITHOUT_TIMING`. Det tekniska targetet, rawdata,
readout, snapshot, tider, kontroller och splits ska förbli immutable historik.
Snittet inför inget återtagande, ingen generell resultateditor och ingen
fabricerad eller manuellt ändrad tid.

## Arkitektur- och licensbeslut före implementation

- ADR-0037 låser intern status/reason, strikt target, ranking, IOF-policy,
  finalisering, provenans, format, capability, idempotens och låsordning.
- Ingen extern kod, schemafil eller UI kopieras. IOF 3.0 används endast som
  interoperabilitetsmål enligt repo-pinnad officiell XSD.
- `NT/WITHOUT_TIMING` betyder att deltagaren har ett validerat tekniskt
  genomförande men inte ska ha ett aktivt tävlingsresultat med tid eller
  ranking. Det betyder varken ”utom tävlan”, ”ej fullföljt” eller
  ”felstämplad”.
- Target begränsas till exakt publicerat direkt tekniskt `OK/COMPLETE` med
  verklig `readout_id` och orsak `CARD_READOUT`,
  `CLASS_CHANGE_RECALCULATION` eller `EXPLICIT_RECALCULATION`.
- `MP`, manuellt godkänt `OK`, manuella/restaurerade revisioner,
  `UNKNOWN_CARD`, stale, opublicerad eller korrupt target avvisas.
- IOF 3.0 saknar en sanningsenlig ”utan tidtagning”-status. `OK` skulle dölja
  den lokala icke-rankade innebörden och kräva kända kontrollsplitar;
  `NotCompeting` betyder redan löpning utanför tävlan. Därför avvisar både
  Snapshot-export och ny finalisering en aktiv NT-entry i detta snitt.
- Ingen ändring görs i `packages/iof-xml`; den ska aldrig gissa en mappning.

## Berörda paket

- `packages/domain`: ren status-only-konstruktor, permanent NT-overlay,
  ranking och deterministisk statusordning.
- `packages/contracts`: lagrat outcomeformat 7, separat adminformat 1,
  publikformat 6 och historikformat 8 med bakåtkompatibla läsare.
- `packages/database`: migration 0022 med capability, actor kind,
  revisionsorsak, unik reciprocal provenans och immutable decisionjournal.
- `packages/application`: kandidater, mutation, exact retry, gemensam
  manualgrind, effektiva projektioner, publik, historik och explicita
  IOF-/finaliseringsblockerare.
- `apps/web`: separat svensk tvåstegsyta med egen session och CSRF.
- `scripts`, `tests` och `docs`: credential-CLI, PostgreSQL-, route-, UI-,
  E2E-, migrations-, ranking-, historik- och exportregressioner.

Station, device-transport, SPORTidentparser, SQLite/outbox, ingestpaket,
Android USB, Eventor, GPS och kartor berörs inte.

## Domän- och revisionsregler

1. En ren konstruktor accepterar endast ett fullständigt runtimevaliderat,
   direkt tekniskt `OK/COMPLETE` med canonical entry-, klass- och banidentitet.
2. NT-outcome kopierar endast `entryId`, historiskt `classId` och
   `courseVersionId`. Det får aldrig bära start, mål, elapsed, kontroller,
   punches eller splits.
3. Intentet fryser aktuell entry-/klass-/bana-/snapshotversion och exakt
   target-id/revision/status/reason. Target måste vara entryns absoluta senaste
   fysiska, publicerade revision vid commit.
4. `without_timing_decision`, skapad NT-revision och actor-audit committar
   atomiskt. Revisionen får `target + 1`, null direkt readout, orsak
   `MANUAL_WITHOUT_TIMING` och unik decisionreferens.
5. Beslutet är en permanent aktiv overlay i TASK 006M. Senare ingest och
   omräkning appenderar normalt men ändrar inte effektiv NT.
6. DNS, DSQ, approval, DNF, OOC och NT är ömsesidigt uteslutande aktiva
   manuella tillstånd. Dubbelaktiv eller korrupt reciprocal provenans ger
   konflikt utan prioritet eller fallback.
7. NT är `NOT_RANKABLE_STATUS`. Endast OK deltar fortsatt i placering,
   tid-efter, ledartid och mixed-course-bedömning.
8. Deterministisk statusordning är `OK`, `MP`, `DSQ`, `DNF`, `OOC`, `NT`,
   `DNS`.

## Capability, idempotens och samtidighet

- `DECIDE_WITHOUT_TIMING` är en separat racebunden write-capability med
  tokenprefix `otid_org_without_timing_v1`, egna host-only cookies och actor
  kind `WITHOUT_TIMING_ACCESS_CREDENTIAL`. Access gäller högst åtta timmar
  och session högst en timme.
- Privat kandidat-GET är bounded och lämnar endast minimal display-,
  versions- och targetmetadata; aldrig rawdata, bricka, punches, full
  evaluation, token eller hash.
- Body är strikt versionsmärkt JSON om högst 4 KiB. Origin, session,
  capability, race och CSRF valideras före bodyläsning och mutation.
- Idempotency key är `without-timing:<canonical-uuid>` och policyversionen
  `without-timing-v1`. Exact replay matchar actor och varje fryst intentfält.
- Låsordning är session `UPDATE` → credential `UPDATE` → race `SHARE` →
  request advisory lock → exact replay → entry `UPDATE` → full manualgrind →
  absolut targetkontroll → append och audit.
- Om ingest vinner först är intentet stale och write-fritt. Om NT vinner
  appenderar senare ingest nästa tekniska revision medan NT förblir effektiv.
  Finaliseringens race-`UPDATE` ser ett helt före eller efter.

## Publik, IOF, historik och finalisering

- Publikformat 6 visar ”Utan tidtagning” utan tid, tid efter, placering,
  kontroller, splits eller intern provenans. Format 1–5 förblir läsbara med
  historiskt låsta statusunioner.
- Historikformat 8 visar det tekniska targetet, NT-beslutet, NT-revisionen och
  eventuellt senare absolut tekniskt huvud. Format 1–7 förblir läsbara.
- Levande IOF Snapshot avvisar en aktiv NT-entry; den utelämnas aldrig och
  maskeras aldrig som `OK`, `NotCompeting`, `DidNotFinish` eller annan status.
- Klass- och loppsfinalisering blockerar när en aktuell entry är NT. Inget nytt
  finaliseringsformat införs i TASK 006M. Äldre fryst Complete XML/hash och
  format 1–7 förblir byte-exakta.
- Ett senare separat interoperabilitetsbeslut får lägga till exportstöd, men
  får inte retroaktivt ändra tidigare frysta bytes eller låta XML-adaptern
  härleda verksamhetssemantik.

## Acceptans

- Exakt aktuellt publicerat direkt tekniskt `OK/COMPLETE` skapar atomiskt en
  decision, status-only NT-revision och audit; inga rå- eller tekniska fakta
  muteras.
- MP, manuellt OK, restoration, stale/opublicerad/korrupt target och alla
  aktiva manuella tillstånd ger noll domänwrites.
- Hundra samtidiga exact retries ger en decision/revision/audit. Ändrad actor
  eller ett enda intentfält konflikterar; två request-id:n ger en vinnare.
- Samtidig ingest/finalisering ger endast kompletta före-/efterlägen utan
  deadlock, brutna revisionsnummer eller historikmutation.
- Migrationens komposit-FK, unique/check och immutable-trigger avvisar
  felparning, dubbel request/target/entry, update och delete. Restore 0000–0022
  och befintlig 0021→0022 provas.
- Publik format 6 är orankad och status-only; äldre kontrakt förblir låsta.
- Snapshot och ny finalisering avvisar aktiv NT utan att utelämna deltagaren,
  fabricera IOF-status eller ändra äldre Complete-bytes.
- Historik format 8 visar exact target→NT→senare teknik. Stationens
  evaluation/ack fortsätter avvisa NT.
- Svenskt UI har separat capability, ett andra bekräftelsesteg, minst 52 px
  touchmål, synligt fokus, text/symbol utöver färg, minnesburet intent och
  endast explicit same-id-retry efter okänd commit.
- Full lint, typecheck, enhets-, PostgreSQL-, E2E-, produktions-, build- och
  Androidgrind körs och redovisas exakt.

## Utanför snittet

- withdrawal, tidsåterställning, fri reason, bulk och generell resultateditor,
- manuella tider, punch-/splitändring och kontrollneutralisering,
- IOF-mappning av NT, Eventor-uppladdning och multi-race,
- stafett/lag, GPS, kartor, SPORTidentparser och riktig USB.

## Genomfört

- Ren domänkonstruktor och permanent central NT-overlay har införts utan I/O i
  domänen. Ranking och deterministisk statusordning behandlar NT som orankad.
- Strikta lagrade-, admin-, publik- och historikkontrakt har införts med
  bakåtkompatibla läsare. Stationens evaluation/ack och IOF-adaptern breddades
  inte.
- Migration 0022 appenderar capability, actor kind, revisionsorsak,
  reciprocal proveniens och immutable decisionjournal utan dataomskrivning.
- Applikationen validerar exact current technical target, committar decision,
  NT-revision och audit atomiskt, återspelar samma intent idempotent och låter
  senare tekniska revisioner bevaras under den permanenta overlayn.
- Publik format 6 visar endast ”Utan tidtagning”. Historik format 8 visar exact
  target→NT→senare teknik. Levande IOF Snapshot och ny finalisering failar
  stängt på aktiv NT.
- Separat svensk tvåstegsyta, capabilitybunden session/CSRF, CLI och explicit
  same-id-retry har införts. Ett Chromiumtest verifierar även att okänd commit
  inte skapar dubbel revision eller läcker credential/intent till lagring.
- Inget withdrawal, ingen resultateditor, manuell tid, IOF-NT-mappning,
  Eventor, stafett, GPS, SPORTidentparser eller riktig USB infördes.

## Verifiering

- Färsk PostgreSQL 17.11/PostGIS 3.6.4: migration 0000–0022, exit 0; 23
  migrationer i Drizzlejournalen och tre reciproka 006M-constraints.
- Separat 0021→0022-uppgradering: exit 0; decisiontabell,
  `without_timing_decision_id` och tre reciproka constraints verifierade.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript och
  produktionsprobernas ESLint passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript och produktionsprobernas TypeScript passerade.
- `CI=true pnpm test`: exit 0; 157 testfiler och 998 tester passerade: domän
  130, transport 49, IOF 91, kontrakt 184, SI-verktyg 20, station 38, databas
  49, applikation 47 och webb 390. Worker saknar avsiktligt testfiler och
  avslutade med exit 0 via `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://joelberring@localhost:55432/otid_006m_full
  CI=true pnpm test:integration`: exit 0; 1 fil och 114/114
  PostgreSQL/PostGIS-tester passerade på 4,20 sekunder.
- `DATABASE_URL=... TEST_DATABASE_URL=... CI=true pnpm test:e2e`: första fulla
  körningen gav 24 passerade och en stale publikformatsassertion. Efter att de
  två historiska aktuellt-format-assertionerna ändrats från 5 till 6 gav full
  omkörning exit 0; 25/25 Playwrighttester passerade på 1,1 minut. Det nya
  fokuserade 006M-testet passerade separat på 5,9 sekunder.
- `CI=true pnpm test:production:simulator --reporter=list`: exit 0; 2/2
  produktionsprober passerade på 641 ms.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationens webbundle/Capacitor-copy och optimerad Next.js 16.3.3-
  build med NT-sidan och dess API-rutter.
- `CI=true pnpm android:test`: exit 1 före Gradle; `Unable to locate a Java
  Runtime`.
- `CI=true pnpm android:lint`: exit 1 före Gradle med samma Javafel.
- `CI=true pnpm android:assemble`: exit 1 efter lyckad webbundle/Capacitor-copy
  men före Gradle med samma Javafel. Inget native-resultat redovisas som
  godkänt.

## Kvarvarande antaganden

- NT är avsiktligt permanent i 006M; rättning kräver ett separat append-only-
  withdrawal och får inte mutera beslutet eller NT-revisionen.
- Endast absolut senaste, publicerade, direkta tekniska `OK/COMPLETE` med
  verkligt readout-id är sanningsenligt target. Ingen historisk fallback eller
  manuell/restaurerad källa antas tillåten.
- IOF-regeln är verifierad mot repo-pinnad officiell XSD-semantik och lokala
  fixtures, inte genom uppladdning till Eventor eller extern installation.
- Samtidighet och avbrott är verifierade med syntetiska payloads och lokal
  PostgreSQL/PostGIS, inte med flera fysiska stationer eller SPORTident-
  hårdvara.
- Reverse proxy, backup/PITR, full arkivrestore, last, längre process- eller
  strömavbrott samt operativ användning i regn, skarpt ljus och handskar är
  inte fältverifierade.
- Värden saknar JDK 21. Androids Gradlegrindar är därför overifierade och
  riktig SPORTident-/USB-status förblir `untested`.

## Nästa minsta vertikala uppgift

TASK 006N bör endast införa ett explicit append-only återtagande av ett aktivt
individuellt NT-beslut. En ADR måste först låsa withdrawal-reason, exact
observerat huvud, restaurering av rätt teknisk källa, samtidighet, exact retry,
publik/historik samt fortsatt fail-closed IOF-policy. Snittet ska inte samtidigt
införa generell resultateditor, manuell tid, kontrollneutralisering, Eventor,
stafett, GPS, SPORTidentparser eller riktig USB.
