# TASK 006L – explicit återtagande av individuellt utom tävlan

Status: Genomförd och verifierad 2026-09-01, med Androidgrindar blockerade av
saknad Java-runtime på värden.

## Mål

Ge en separat behörig arrangör möjlighet att uttryckligen återta exakt ett
aktivt individuellt OOC-beslut från TASK 006K. Återtagandet ska appendera en
immutable livscykeljournal och en ny publicerad restaureringsrevision som är
canonicalt exakt lika med en fryst direkt teknisk `OK|MP`-källa.

Beslut, OOC-revision, tekniska revisioner, rawdata, readout, snapshot och
publiceringsflaggor får aldrig muteras. Snittet inför ingen generell
resultateditor, fri orsak, manuell tid eller annan ny resultatstatus.

## Arkitektur- och licensbeslut före implementation

- ADR-0036 låser withdrawalens reason, tekniska källregel, append-only-
  restaurering, formatversioner, capability, idempotens och låsordning.
- Ingen extern kod, schemafil eller UI kopieras. IOF 3.0 används endast som
  interoperabilitetsmål enligt den redan pinnade officiella XSD:n.
- `EvaluationResult`, `ResultOutcome`, statusordning, rankingmotor,
  stationskontrakt, SQLite/outbox och device-batch breddas inte.
- Ingen senare teknik: om det absoluta fysiska huvudet är OOC-revisionen är
  beslutets ursprungliga tekniska target den enda tillåtna källan.
- Senare teknik: det requestbundna absoluta huvudet måste självt vara den
  publicerade, direkta, strikta tekniska `OK|MP`-källan. Servern söker aldrig
  bakåt och väljer aldrig om källa vid commit.
- ”Direkt readoutbaserad teknisk” betyder här en strikt `OK|MP`-revision med
  verklig `readout_id` och någon av de befintliga tekniska orsakerna
  `CARD_READOUT`, `CLASS_CHANGE_RECALCULATION` eller
  `EXPLICIT_RECALCULATION`. Begreppet begränsas inte till endast den första
  orsaken och ingen befintlig targetsemantik ändras.
- Restaureringen deep-kopierar hela källans canonical outcome exakt. Ingen tid,
  kontroll, punch, split, status eller reason räknas om eller fabriceras.
- En terminologiambiguitet mellan ADR-0035:s ”direkt readoutbaserad” och den
  befintliga tekniska cause-unionen upptäcktes före kodstart och är löst ovan.
  Ingen faktisk arkitekturkonflikt finns i övrigt; ADR-0035 reserverar
  uttryckligen rättning till ett senare append-only-snitt.

## Berörda paket

- `packages/domain`: OOC-livscykelresolver med withdrawal och fail-closed
  reciprocal provenance.
- `packages/contracts`: separat withdrawal-adminformat 1 samt historik- och
  finaliseringsformat 7 med bakåtkompatibel läsning av äldre format.
- `packages/database`: migration 0021 med capability, actor kind,
  revisionsorsak, restaureringsprovenans och immutable withdrawaljournal.
- `packages/application`: kandidatlista, mutation, exact retry, gemensam
  manualgrind, levande projektion, historik, IOF och finalisering.
- `apps/web`: separat svensk tvåstegsyta med egen session och CSRF.
- `scripts`, `tests` och `docs`: credential-CLI, PostgreSQL-, route-, UI-,
  E2E-, export-, migrations- och finaliseringsbevis.

`packages/iof-xml` får ingen ny XML-status; befintlig `OK|MissingPunch`-
serialisering ska regressionsverifieras för den restaurerade projektionen.
Station, transport, parser, Android USB och GPS berörs inte.

## Domän- och revisionsregler

1. `NotCompetingWithdrawal` targetar exakt en aktiv decision och dess
   reciprocal OOC-revision.
2. Intentet fryser aktuell entry-/klass-/ban-/snapshotversion, decision,
   tekniskt originaltarget, OOC-revision, observerat absolut huvud och exakt
   restaureringskälla.
3. Utan senare teknik måste absolut huvud vara OOC-revisionen och källa vara
   originaltargeten.
4. Med senare teknik måste absolut huvud och källa vara samma publicerade,
   direkt readoutbaserade, strikta tekniska `OK|MP`-revision.
5. Opublicerat, manuellt, restaurerat, äldre eller korrupt huvud/källa,
   `UNKNOWN_CARD`, stale entry/klass/bana/snapshot och historisk fallback
   avvisas utan write.
6. Restaureringsrevisionen får revision `absolute + 1`, null direkt readout,
   orsaken `MANUAL_OUT_OF_COMPETITION_WITHDRAWAL`, unik withdrawalreferens och
   canonicalt exakt käll-outcome.
7. Den rena resolvern validerar alla historiska OOC-kedjor och tillåter högst
   en aktiv. Efter withdrawal väljs endast restaureringen eller ett senare
   normalt fysiskt huvud; targeten återupplivas aldrig genom fallback.
8. Återtagen OOC räknas inte i den gemensamma manuella mutexen. Ett nytt OOC
   kräver en senare ny direkt teknisk revision; restaureringen får inte targetas.
9. Publikformat förblir 5. Restaurerat `OK` rankas och restaurerat `MP` är
   orankat enligt befintliga regler.

## Capability, idempotens och samtidighet

- `WITHDRAW_OUT_OF_COMPETITION` är en separat racebunden write-capability med
  tokenprefix `otid_org_out_of_competition_withdrawal_v1`, egna host-only
  cookies och actor kind `OUT_OF_COMPETITION_WITHDRAWAL_ACCESS_CREDENTIAL`.
  Access gäller högst åtta timmar och session högst en timme.
- Privat kandidat-GET är bounded och lämnar endast minimal display-, versions-
  och revisionsmetadata. Rawdata, bricka, punches, full evaluation, token och
  hash lämnas inte ut.
- Body är strikt versionsmärkt JSON om högst 4 KiB. Origin, session,
  capability, race och CSRF valideras före bodyläsning och mutation.
- Idempotency key är `out-of-competition-withdrawal:<canonical-uuid>` och
  policyversionen `out-of-competition-withdrawal-v1`. Enda reason är
  `ERRONEOUS_MANUAL_OUT_OF_COMPETITION`.
- Exact replay matchar actor, race, entry och varje fryst intentfält och
  returnerar samma withdrawal/restaurering även efter senare ingest. Ändrad
  actor eller ett enda fält är konflikt.
- Låsordning: session `UPDATE` → credential `UPDATE` → race `SHARE` → request
  advisory lock → exact replay → entry `UPDATE` → full livscykel/manualgrind →
  absolut huvud/källa → append och audit.
- Om ingest vinner först blir intentet stale och write-fritt. Om withdrawal
  vinner appenderas restaureringen först och senare ingest appenderar nästa
  tekniska revision. Finaliseringens race-`UPDATE` ger ett helt före/efter.

## Publik, IOF, historik och finalisering

- Efter withdrawal använder levande publik, Snapshot och ny finalisering det
  exakt restaurerade `OK|MP`-utfallet. Ingen intern provenans exponeras.
- IOF använder befintlig `OK` respektive `MissingPunch`; `NotCompeting` gäller
  bara det historiska OOC-resultatet. Intern reason, decision, withdrawal och
  revisionsidentiteter serialiseras aldrig.
- Historikformat 7 visar target → OOC → eventuell senare teknik → withdrawal/
  restoration och fryser decision, OOC, observerat absolut huvud och källa.
  Format 1–6 förblir läsbara med sina historiska unioner.
- Nya klass-/loppsfinaliseringar använder format 7 och fryser hela kedjan och
  effektiv restoration. Äldre Complete XML/hash förblir byte-exakta.
- Complete kräver fortsatt explicit proof med `finalizationId`, `revision` och
  `sourceHash`; serializeraren härleder varken aktivitet eller täckning.

## Acceptans

- Aktiv OOC utan senare teknik återtas atomiskt till originaltargetens exakta
  outcome; med senare teknik återställs exakt det requestbundna tekniska huvudet.
- Stale eller fel entry/klass/bana/snapshot/decision/OOC/absolute/source,
  opublicerad/manuell/restaurerad/korrupt källa och fel policy/reason ger noll
  domänwrites.
- Hundra samtidiga exact retries ger en withdrawal, restaurering och audit.
  Ändrad actor/intent konflikterar; två request-id:n ger en vinnare.
- Samtidig ingest och withdrawal ger obrutna revisionsnummer och helt
  före/efter utan raw/readout/snapshotmutation.
- Samtidig finalisering och withdrawal ger helt före/efter utan deadlock;
  äldre Complete XML/hash förblir byte-stabila.
- Gemensam resolver/mutex validerar historiska OOC-kedjor fail-closed, räknar
  endast oåtertagen OOC aktiv och tillåter nytt OOC först efter ny teknik.
- Migrationens komposit-FK, unique/check och immutable-trigger avvisar
  felparning, dubbel withdrawal, update och delete. Restore 0000–0021 och
  befintlig 0020→0021 provas.
- Publik format 5 och IOF går från OOC/`NotCompeting` till exakt restaurerat
  `OK|MP`/`OK|MissingPunch`; ranking återkommer bara för OK.
- Historik/finalisering format 7 och äldre format verifieras. Tidigare frysta
  OOC-Complete-bytes ändras aldrig.
- Svenskt UI har separat capability, andra bekräftelsesteg, minst 52 px
  touchmål, synligt fokus, text/symbol utöver färg, minnesburet intent och
  endast explicit same-id-retry efter okänd commit.
- Full lint, typecheck, enhets-, PostgreSQL-, E2E-, produktions-, build- och
  Androidgrind körs och redovisas exakt.

## Utanför snittet

- bulkåtertagande, fri reason och generell resultateditor,
- utan tidtagning, manuella tider, punch-/splitändring och
  kontrollneutralisering,
- automatisk OOC eller withdrawal från import, entryflagga eller readout,
- Eventor-uppladdning, multi-race, stafett/lag, GPS, kartor,
  SPORTidentparser och riktig USB.

## Utfall

- Det avgränsade OOC-återtagandet är implementerat i domän, kontrakt,
  migration 0021, applikation, historik/finalisering, IOF-regressioner och en
  separat svensk administrationsyta.
- Withdrawaljournal, restaureringsrevision och audit appenderas atomiskt och
  idempotent. Samma request-id och oförändrat intent returnerar samma write;
  ändrad actor eller minsta intentavvikelse ger konflikt.
- Utan senare teknik restaureras beslutets exakta originaltarget. Med senare
  teknik restaureras endast det requestbundna absoluta tekniska huvudet.
  Historisk fallback, omvald källa och restaurering mot manuella/opublicerade
  huvuden är fail-closed.
- Publik förblir format 5. Historik och nya finaliseringar använder format 7,
  IOF återgår till befintlig `OK`/`MissingPunch` och intern provenans lämnar
  aldrig XML. Äldre frysta Complete-bytes/hash förblir immutable.
- Ingen utan-tidtagning-status, generell editor, manuell tid,
  kontrollneutralisering, Eventor, multi-race, stafett, GPS,
  SPORTidentparser eller riktig USB har påbörjats.

## Verifiering

- En färsk isolerad PostgreSQL 17.11/PostGIS 3.6.4-databas migrerades
  0000–0021 med exit 0; kedjan innehåller 22 SQL-migrationer. En separat
  schemafokuserad 0020→0021-uppgradering passerade också.
- `CI=true pnpm lint`: exit 0; alla 10 workspaceprojekt med lintscript samt
  produktionsprobernas ESLint passerade.
- `CI=true pnpm typecheck`: exit 0; alla 10 workspaceprojekt med
  typecheckscript samt produktionsprobernas TypeScript passerade.
- `CI=true pnpm test`: exit 0; 148 testfiler och 948 tester passerade: domän
  116, transport 49, IOF 91, kontrakt 169, SI-verktyg 20, station 38,
  databas 42, applikation 42 och webb 381. Worker saknar avsiktligt
  testfiler och avslutade med exit 0 via `--passWithNoTests`.
- `TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55437/o_tid_task006l_final
  CI=true pnpm --filter @o-tid/application test:integration`: exit 0;
  112/112 PostgreSQL/PostGIS-tester passerade på 3,93 sekunder.
- Full `CI=true pnpm test:e2e` mot samma isolerade databas: första körningen
  gav 23 passerade och ett fel i en för snäv svensk textassertion. Assertionen
  bands till den faktiska framgångstexten och full omkörning gav exit 0;
  24/24 Playwrighttester passerade på cirka en minut.
- `CI=true pnpm test:production:simulator --reporter=list`: första sandboxade
  körningen nådde inte testlogiken (`listen EPERM`); omkörning med lokal
  portbindning gav exit 0 och 2/2 produktionsprober på 554 ms.
- `CI=true pnpm build`: exit 0; samtliga 10 projekt med buildscript passerade,
  inklusive stationens webbundle/Capacitor-copy och optimerad Next.js 16.3.3-
  build med OOC-återtagningssidan och dess API-rutter.
- `CI=true pnpm android:test` och `CI=true pnpm android:lint`: vardera exit 1
  före Gradle med `Unable to locate a Java Runtime`.
- `CI=true pnpm android:assemble`: exit 1 med samma Javafel efter att
  webbundle och Capacitor-copy lyckats. Inget native-resultat redovisas som
  godkänt.

## Kvarvarande antaganden

- Withdrawal betyder endast att ett manuellt OOC-beslut var fel. Första och
  enda reason är `ERRONEOUS_MANUAL_OUT_OF_COMPETITION`; automatisk återtagning,
  bulkåtgärd och fri reason antas inte vara tillåtna.
- ”Direkt teknisk” fortsätter betyda befintlig cause-union med verkligt
  readout-id och strikt publicerat `OK|MP`. Restaureringen antas alltid vara
  källans canonicala outcome utan ny beräkning.
- IOF-mappningen är verifierad mot den repo-pinnade officiella XSD-semantiken
  och lokala fixtures, inte genom uppladdning till Eventor eller en extern
  tävlingsinstallation.
- Samtidighet och avbrott är verifierade med syntetiska payloads och lokal
  PostgreSQL/PostGIS, inte med flera fysiska stationer eller
  SPORTident-hårdvara.
- Reverse proxy, backup/PITR, full arkivrestore, last, långvarigt strömavbrott
  samt operativ användning i regn, skarpt ljus och med handskar är inte
  verifierade.
- Värden saknar projektets JDK 21. Androids Gradlegrindar och riktig
  SPORTident-/USB-hårdvara förblir därför overifierade respektive `untested`.

## Nästa minsta vertikala uppgift

TASK 006M bör endast specificera ett explicit individuellt beslut om ”utan
tidtagning” mot ett exakt aktuellt, publicerat tekniskt resultat. En ADR måste
först låsa intern status/reason, ranking, IOF 3.0-sanningsenlig mappning,
provenans, ömsesidig uteslutning och finalisering. Snittet ska inte samtidigt
införa withdrawal, manuella tider, kontrollneutralisering, Eventor, stafett,
GPS, SPORTidentparser eller riktig USB.
