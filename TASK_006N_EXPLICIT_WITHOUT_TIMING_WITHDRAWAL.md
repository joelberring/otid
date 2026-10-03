# TASK 006N – explicit append-only återtagande av individuellt utan tidtagning

Status: Genomförd 2026-09-01. Androids Gradlegrindar är fortsatt blockerade
av att verifieringsvärden saknar Java-runtime.

## Mål

Ge en separat behörig arrangör möjlighet att rätta ett felaktigt aktivt
`NT/WITHOUT_TIMING`-beslut utan att mutera eller avpublicera beslutet,
NT-revisionen, teknisk historik, rawdata eller readout.

Återtagandet ska appendera en immutable verksamhetsjournal och en publicerad
restaureringsrevision vars outcome är canonicalt exakt lika med en fryst,
direkt och publicerad teknisk `OK|MP`-källa. Snittet inför ingen generell
resultateditor, manuell tid eller ny IOF-status.

## Arkitektur- och licensbeslut före implementation

- ADR-0038 låser withdrawal-reason, exakt observerat absolut huvud, teknisk
  restaureringskälla, livscykelresolver, format, IOF/finalisering, capability,
  idempotens och låsordning.
- Ingen extern kod, schemafil eller UI kopieras. IOF 3.0 används endast som
  interoperabilitetsmål enligt repo-pinnad officiell XSD.
- Utan senare teknik restaureras NT-beslutets ursprungliga direkta tekniska
  `OK/COMPLETE`-target.
- Finns senare revisioner måste det requestbundna absoluta huvudet självt vara
  en publicerad, direkt readoutbaserad och exakt aktuell teknisk `OK|MP`-källa.
  Manuell, restaurerad, opublicerad, stale eller äldre källa avvisas.
- Aktiv NT fortsätter blockera IOF Snapshot och ny finalisering. Efter ett
  giltigt återtagande används den restaurerade vanliga `OK`-/`MissingPunch`-
  formen; intern withdrawalprovenans serialiseras aldrig.
- `packages/iof-xml` ändras inte och får inte härleda livscykel eller täckning.

## Berörda paket

- `packages/domain`: ren NT-livscykel med withdrawal och exact restoration.
- `packages/contracts`: separat withdrawal-adminformat 1, lagrat outcomeformat
  8, historikformat 9 och finaliseringsformat 8 med äldre läsare kvar.
- `packages/database`: migration 0023 med capability, actor kind,
  revisionsorsak, withdrawaljournal och reciprocal provenans.
- `packages/application`: kandidatlista, mutation, exact retry, central
  resolver/mutex, historik, finalisering och IOF-projektion.
- `apps/web`, `scripts`, `tests` och `docs`: separat svensk tvåstegsyta,
  credential-CLI samt regressioner.

Station, device-transport, SPORTidentparser, SQLite/outbox, ingestprotokoll,
Android USB, Eventor, GPS, kartor och stafett berörs inte.

## Domän- och revisionsregler

1. Withdrawal avslutar exakt en aktiv reciprocal NT-kedja; beslut, target och
   NT-revision behålls immutable och publicerade.
2. Intentet fryser aktuell entry-/klass-/bana-/snapshotversion, decision,
   originaltarget, NT-revision, absolut resultathuvud och teknisk källa.
3. Är absolut huvud NT-revisionen måste källan vara originaltargeten. Är
   huvudet senare måste samma rad vara källan och vara publicerad, direkt
   teknisk `OK|MP` med verklig readout och exakt aktuell grund.
4. Ingen historisk fallback eller omvald källa tillåts vid commit eller retry.
5. `without_timing_withdrawal`, publicerad revision
   `MANUAL_WITHOUT_TIMING_WITHDRAWAL` och actor-audit committar atomiskt.
   Restorationen får null direkt readout och outcome exakt kopierat från
   källan; inga fakta räknas om eller fabriceras.
6. Den rena resolvern kräver full reciprocal
   decision↔NT↔withdrawal↔source↔restoration-provenans. Med withdrawal måste
   normalt valt huvud vara restorationen eller en senare revision.
7. Alla historiska NT-kedjor valideras. Högst en får vara aktiv och endast
   den räknas i manualmutexen med DNS, DSQ, approval, DNF och OOC.
8. Ett nytt NT kräver en senare ny direkt teknisk `OK/COMPLETE`; en manuell
   restoration får inte vara target.
9. Statusunion, statusordning och ranking ändras inte. Restaurerat OK rankas
   åter; restaurerat MP är orankat.

## Capability, idempotens och samtidighet

- `WITHDRAW_WITHOUT_TIMING` är separat racebunden write-capability med
  tokenprefix `otid_org_without_timing_withdrawal_v1`, egna host-only cookies,
  actor kind `WITHOUT_TIMING_WITHDRAWAL_ACCESS_CREDENTIAL`, access högst åtta
  timmar och session högst en timme.
- Kandidat-GET är privat och bounded och lämnar endast minimal display-,
  versions-, decision-, head- och sourcemetadata; aldrig rawdata, bricka,
  punches, full evaluation, token eller hash.
- Body är strikt versionsmärkt JSON om högst 4 KiB. Origin, session,
  capability, race och CSRF valideras före bodyläsning och mutation.
- Idempotency key är `without-timing-withdrawal:<canonical-uuid>`, enda reason
  `ERRONEOUS_MANUAL_WITHOUT_TIMING` och policyversion
  `without-timing-withdrawal-v1`.
- Exact retry matchar actor och hela frysta intentet och återger samma
  withdrawal/restoration även efter senare data. Minsta avvikelse är konflikt.
- Låsordning är session `UPDATE` → credential `UPDATE` → race `SHARE` →
  request advisory lock → exact replay → entry `UPDATE` → full livscykelgrind
  → absolut head/source → append och audit.
- Om ingest vinner först blir intentet stale och write-fritt. Om withdrawal
  vinner appenderas restorationen och senare ingest får nästa revision.
  Finaliseringens race-`UPDATE` ser ett helt före- eller efterläge.

## Publik, IOF, historik och finalisering

- Publikformat 6 ändras inte. Efter withdrawal visar det exakt restaurerat
  `OK|MP` utan intern provenans; äldre NT förblir synligt i historiken.
- Historikformat 9 visar target → NT → eventuell senare teknik → withdrawal
  och restoration. Format 1–8 förblir läsbara och låsta.
- Aktiv NT fortsätter ge fail-closed konflikt i levande IOF Snapshot och ny
  finalisering. En återtagen NT-kedja ger vanlig `OK`/`MissingPunch` med
  källans exakta tider, kontroller och splits.
- Nya klass- och loppsfinaliseringar använder format 8 och fryser hela
  NT-withdrawalkedjan samt effektiv restoration. Äldre format och tidigare
  Complete XML/hash förblir byte-exakta.
- Complete kräver fortsatt separat runtimevaliderat proof med
  `finalizationId`, `revision` och `sourceHash`; serializeraren får inte
  härleda aktivitet eller täckning.

## Acceptans

- Aktiv NT utan senare teknik återtas atomiskt till originaltargetens exakta
  `OK/COMPLETE`; med senare teknik restaureras exakt det requestbundna
  publicerade tekniska `OK|MP`-huvudet.
- Stale eller fel entry/klass/bana/snapshot/decision/NT/absolute/source,
  opublicerad/manuell/restaurerad/korrupt källa och fel policy/reason ger noll
  domänwrites.
- Hundra samtidiga exact retries ger en withdrawal/restoration/audit. Ändrad
  actor/intent konflikterar; två request-id:n ger en vinnare.
- Samtidig ingest och withdrawal ger obrutna revisionsnummer och helt
  före/efter utan raw/readout/snapshotmutation.
- Samtidig finalisering och withdrawal ger helt före/efter utan deadlock;
  äldre Complete XML/hash ändras aldrig.
- Resolver/mutex validerar flera historiska NT-kedjor fail-closed, räknar bara
  oåtertagen NT aktiv och tillåter nytt NT först efter ny teknik.
- Migrationens komposit-FK, unique/check och immutable-trigger avvisar
  felparning, dubbel withdrawal, update och delete. Restore 0000–0023 och
  befintlig 0022→0023 provas.
- Publik format 6 och IOF går från aktiv NT-konflikt till exakt restaurerat
  `OK|MP`/`OK|MissingPunch`; ranking återkommer bara för OK.
- Historikformat 9, finaliseringsformat 8 och äldre format verifieras.
- Svenskt UI har separat capability, andra bekräftelsesteg, minst 52 px
  touchmål, synligt fokus, text/symbol utöver färg, minnesburet intent och
  endast explicit same-id-retry efter okänd commit.
- Full lint, typecheck, enhets-, PostgreSQL-, E2E-, produktions-, build- och
  Androidgrind körs och redovisas exakt.

## Utanför snittet

- bulkåtertagande, fri reason och generell resultateditor,
- manuell tid, punch-/splitändring och kontrollneutralisering,
- IOF-mappning av aktiv NT, Eventor-uppladdning och multi-race,
- stafett/lag, GPS, kartor, SPORTidentparser och riktig USB.

## Genomfört

- Domänen har en ren reciprocal NT-livscykelresolver som validerar alla
  historiska decision-/withdrawalkedjor, tillåter högst en aktiv NT och
  restaurerar exakt en fryst direkt teknisk `OK|MP`-källa utan I/O.
- Kontrakten har separat withdrawal-adminformat 1, lagrat outcomeformat 8,
  historikformat 9 och finaliseringsformat 8. Publikformat 6 och stationens
  evaluation-/ackformat är oförändrade.
- Migration 0023 lägger additivt till separat capability, actor kind,
  revisionsorsak, reciprocal withdrawalprovenans och immutable journal. Det
  tillfälliga entryunika 0022-indexet ersätts utan att historiska rader skrivs
  om.
- Applikationen fryser actor/request, race, entry, klass, bana, snapshot,
  decision, NT-revision, absolut huvud och teknisk källa. Withdrawal,
  publicerad restoration och audit appenderas atomiskt under den gemensamma
  manuella låsgrinden; exact retries återger samma write.
- Aktiv NT blockerar fortsatt levande IOF och ny finalisering. Efter withdrawal
  ger publik och IOF exakt restaurerat `OK|MP` respektive
  `OK|MissingPunch`. Äldre Complete-XML och hash ändras inte.
- En separat svensk tvåstegsyta, capabilitybunden session/CSRF, CLI och
  explicit same-id-retry har införts och täcks av Chromiumtest.
- Ingen generell editor, manuell tid, kontrollneutralisering, aktiv
  NT-mappning till IOF, Eventor, multi-race, stafett, GPS,
  SPORTidentparser eller riktig USB infördes.

## Verifiering

- Färsk PostgreSQL 17/PostGIS: migration 0000–0023, exit 0 och
  `Databasmigrationer klara`. Separat uppgradering 0022→0023 med en verklig
  reciprocal NT-kedja gav exit 0; den historiska raden bevarades,
  withdrawalkolumnen var null och den nya journalen fanns.
- `CI=true pnpm lint`: exit 0; samtliga 10 workspaceprojekt med lintscript och
  produktionsprobernas ESLint passerade.
- `CI=true pnpm typecheck`: exit 0; samtliga 10 workspaceprojekt med
  typecheckscript och produktionsprobernas TypeScript passerade.
- `CI=true pnpm test`: exit 0; 163 testfiler och 1026 tester passerade: domän
  133, transport 49, IOF 91, kontrakt 190, SI-verktyg 20, station 38, databas
  57, applikation 49 och webb 399. Worker saknar avsiktligt testfiler och
  avslutade med exit 0 via `--passWithNoTests`.
- `DATABASE_URL=... TEST_DATABASE_URL=... CI=true pnpm test:integration`:
  exit 0; 1 fil och 118/118 PostgreSQL/PostGIS-tester passerade på 4,42
  sekunder.
- `DATABASE_URL=... TEST_DATABASE_URL=... CI=true pnpm test:e2e`: exit 0;
  26/26 Playwrighttester passerade på 1,1 minut. Det nya fokuserade 006N-testet
  passerade även separat, 1/1 på 8,6 sekunder.
- `CI=true pnpm test:production:simulator --reporter=list`: exit 0; 2/2
  produktionsprober passerade på 650 ms.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationens webbundle/Capacitor-copy och optimerad Next.js 16.3.3-
  build med withdrawal-sidan och dess API-rutter.
- `CI=true pnpm android:test`: exit 1 före Gradle; `Unable to locate a Java
  Runtime`.
- `CI=true pnpm android:lint`: exit 1 före Gradle med samma Javafel.
- `CI=true pnpm android:assemble`: exit 1 efter lyckad webbundle/Capacitor-copy
  men före Gradle med samma Javafel. Inget native-resultat redovisas som
  godkänt.

## Kvarvarande antaganden

- Ett senare tekniskt huvud får restaureras endast när samma absoluta rad är
  publicerad, direkt readoutbaserad och strikt `OK|MP`. Ingen historisk
  fallback eller omvald källa antas vara sanningsenlig.
- Ett nytt NT efter withdrawal kräver en senare ny direkt teknisk
  `OK/COMPLETE`; en manuell restoration antas aldrig vara ett giltigt target.
- IOF-regeln är verifierad mot repo-pinnad officiell XSD-semantik och lokala
  fixtures, inte genom uppladdning till Eventor eller extern installation.
- Samtidighet och avbrott är verifierade med syntetiska payloads och lokal
  PostgreSQL/PostGIS, inte med flera fysiska stationer eller
  SPORTident-hårdvara.
- Reverse proxy, backup/PITR, full arkivrestore, last, längre process- eller
  strömavbrott samt operativ användning i regn, skarpt ljus och handskar är
  inte fältverifierade.
- Värden saknar JDK 21. Androids Gradlegrindar är därför overifierade och
  riktig SPORTident-/USB-status förblir `untested`.

## Nästa minsta vertikala uppgift

TASK 006O bör endast införa en explicit, versionsbunden ändring av fast
starttid för en individuell entry och append-only-omräkning av just dess
resultat. En ADR måste först låsa källtid, snapshot-/paketversion, stale-
hantering, resultatrevisionsorsak, idempotens och påverkan på redan
finaliserade resultat. Snittet ska inte samtidigt införa fri resultattid,
kontrollneutralisering, Eventor, stafett, GPS, SPORTidentparser eller riktig
USB.
