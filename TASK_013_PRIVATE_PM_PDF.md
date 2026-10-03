# TASK 013 – Ett PM från privat PDF till explicit publicering

Status: pågår; arkitektur/ADR först. Inga PM-routes är aktiva.

Fullt mål är arrangörens uppladdning → durabel privat lagring → verklig
PDF/antiviruskontroll → granskning → explicit publicering → publik nedladdning
→ återtagande. Ett race har högst ett aktuellt publicerat PM. Scope minskas
inte till enbart kontrakt eller ett falskt scanresultat. ADR-0061 styr snittet.

## Berörda lager

- contracts: strikta intents och små privata/publika DTO:er.
- database/application: reservation, manifest, scanjobb/rapport, journal,
  capability och transaktionell publiceringshead.
- nytt Node-only infrastructure-paket: privat MinIO-version + scanneradapter.
- worker: durable PostgreSQL-jobb och isolerad verktygskörning.
- web: säkra HTTP-vägar och svensk arrangerar-/publikvy.
- drift/test: separat versionsaktiverad bucket, PG, verktygsprofil och restoreprov.

Ingen resultatlogik, karta, GPS, stafett, USB eller ny Eventoråtkomst ingår.
Ingen användarfil behövs för tester; syntetiska PDF-fixtures används.

## Genomförandeordning och aktiveringsgrindar

1. Factual research och ADR före kod. Strikta client-intents först; de ger
   aldrig klienten rätt att ange scanstatus eller lagringsreferens.
2. Pinnad SDK/verktygsprofil, testbar privat objektadapter, additiv migration
   och restore-not. Ingen ersättning med produktionslagring i minne/lokal fil.
3. Reservation/upload/reconciliation och worker med fail-closed kontroll,
   policy-/version-/hashbindning, lease fencing och resursgränser.
4. Auth/CAS-publicering och återtagande, säkra privata/publika läsvägar,
   limiter och sedan UI. Ingen route aktiveras före underliggande acceptans.
5. Fulla kommandon och verkligt genomgående browser-/restoreprov.

## Kravvis acceptans

- Auth/capability/race/Origin/CSRF före body; concurrency mot logout/revoke.
- Strikt request, storleksgräns i faktisk stream, falsk MIME/signatur,
  trunkerad/krypterad PDF, hash/längdfel och otillåtna extrafält avvisas.
- Samma init/överföring/publicering-retry skapar inte nytt logiskt dokument;
  ändrad actor/race/intent ger konflikt. Avbruten överföring bevarar reservation.
- Kvot reserveras före objekt-PUT och räknar även osäkra utfall. 100
  reserveringar/race, 8 försök/reservation och 8 GiB debiterat utrymme kan
  inte överskridas genom parallella requests eller SDK-retries.
- PG-rollback efter lyckad PUT, tappat kvittenssvar, dubbla workers och
  leaseutgång lämnar inget felaktigt READY eller publikt objekt.
- Riktig MinIO: anonym GET/listing nekas, exakta versioner bevaras och byte-
  identitet kontrolleras även när latest ändras eller fel version saknas.
- Riktig qpdf/ClamAV: giltig syntetisk PDF passerar; kryptering, trasig PDF,
  detektion, saknad/gammal signaturdatabas, timeout, gränsöverskridande,
  okänd exitkod och cleanupfel får aldrig godkänt scanutfall.
- Pending/rejected/failed/utgången scan publiceras inte. Sen gammal worker
  kan inte skriva godkänd rapport. Client kan aldrig skicka egen READY/proof.
- Publicering fryser exakt titel/manifest/scanrapport; ny upload ändrar inte
  publicerad fil. Samtidiga beslut serialiseras med expected revision.
- Publik hämtning är bara aktuell head och ger exakta verifierade bytes;
  hashfel/lagringsfel/återtagande ger ingen body eller direkt object-URL.
- Browser: verklig login/upload/pending/ready/publish/download/withdraw samt
  authfel, nätfel, sent svar och same-id-retry. Ingen PDF-inline eller privat cache.
- Restore till tom testmiljö återskapar manifest + exakt objektversion;
  borttappat/tamprat objekt upptäcks. Inget material i användarens miljö raderas.
- lint, typecheck, test, integration, relevant browser och build redovisas
  exakt. Förutsättningar och eventuellt ej verifierade krav listas öppet.

## Inledande evidens

2026-09-07: agentens read-only-inventering bekräftar att adapter, scanner och
worker saknas. Docker/minio/mc/qpdf/clamscan saknas på PATH. Detta är ännu
ingen blockerad huvuduppgift: kontrakt/schema/adaptrar kan byggas, men komplett
TASK013 får inte påstås verifierad utan verklig verktygs-/lagringsmiljö.

## Första implementation: requestkontrakt

packages/contracts/src/pm-document.ts innehåller nu init-, publish- och
withdraw-request samt operationsegna idempotencynycklar enligt ADR-0061.
Titlar avvisas om de behöver normalisering; ingen tyst ändring av retryintent.
Testerna täcker bytegränser, Unicode/NFC/styrtecken, SHA/MIME, revisioner,
operationernas nyckelseparation och förbjudna storage-/scan-/actorfält.
Kontraktspaketet gav exit 0: 42 filer / 270 tester, varav 26 nya tester.
Logg: /private/tmp/otid-013-contracts.log.

Agenten inventerade miljön och granskade ADR/task read-only. Invändningen om
oklar historikkvot åtgärdades i ADR före någon lagringsimplementation:
historik bevaras inom explicit kumulativ kvot, inte obegränsat lagringslöfte.
Ingen PDF, objektlagring, scanstatus, capability eller route har införts genom
dessa kontrakt. Full TASK013 är fortfarande öppen.

Workspaceverifiering för denna kontraktsdel körs med CI=true pnpm lint,
typecheck, test och build. Loggar: /private/tmp/otid-013-{lint,typecheck,unit,build}.log.
Samtliga fyra kommandon avslutades med exit 0. Enhetssvit: 221 filer /
1 458 tester, inklusive de 26 nya requestproven. Ingen ny PM-runtime är byggd.
PG/MinIO/verktygs-/browserprov är inte körda för den ännu obefintliga runtimekedjan;
de kvarstår som obligatoriska acceptanskrav, inte som tidigare passerade prov.

## Lagringsadapter, fortfarande utan aktiverad runtimekedja

packages/infrastructure har nu en Node-only MinIO 8.0.7-adapter. Den kontrollerar
versionering och frånvaro av bucket-policy, kräver exakt manifestversion,
verifierar SHA/längd före PUT och efter versionsbunden readback, avbryter hela
operationen på deadline och lämnar bara saniterade fel. Max 10 MiB ägs av
adaptern innan första await; senare mutation av callerbuffer ändrar inte PUT.
Fast region, avstängda SDK-retries och en egen transportgräns hindrar andra PUT.
GET utan version, offentliga/på annat sätt okända policyer och 'null'-version
avvisas. Ingen delete, presigned URL eller fallback till latest exponeras.

Detta är inte application-tjänsten: reservation, kvot, retryjournal, scanner,
auth och publiceringshead återstår och får inte ersättas med adapteranrop.
Ingen databas, bucket, verklig tävling eller fil har skapats via adaptern.

SDK-version och transitiv metadata: docs/research/pm-storage-sdk.md.
Första install försöket gav exit 1 (CI:s frozen lockfile). Explicit
CI=true pnpm install --no-frozen-lockfile --ignore-scripts gav exit 0 och
uppdaterade pnpm-lock.yaml. Inga installscripts eller scanners kördes.
Första riktade typecheck fångade Buffer-generik i testet; första lint hittade
regexescape och unsafe stream-chunk-typ. Dessa rättades utan ändrade säkerhets-
assertioner. Produktions-HTTPS mot lokal server förtydligades som tillåtet;
HTTP:s loopback-development-undantag avvisas alltid i NODE_ENV=production.

Verifiering 2026-09-07:

- Faktisk SDK mot syntetisk Node HTTP: slutligen 19 prov passerade. Bland annat
  maxstorlek, 503/avbruten PUT utan retry, hängande PUT/GET med socketstängning,
  fel version/hash/längd, policy/versionsfel och callerbuffer-mutation.
- CI=true pnpm lint/typecheck/test/build: exit 0 i workspacekörningen.
- Därefter nytt konfigurationsprov: paketets lint/typecheck och full pnpm test
  kördes om, exit 0; slutlig enhetssvit 222 filer / 1 477 tester.
- Produktionskoden ändrades inte efter lyckad workspace-build; sista tillägget
  var endast test och dokumentation.

Loggar under /private/tmp/otid-013-storage-*.log, särskilt workspace-*,
lint-final, typecheck-final och unit-final. Riktig MinIO/durabilitet/auth/SigV4,
PG-atomik, verktyg och browser är ännu inte verifierade. HTTP-servern i proven
kontrollerar inte signaturen och ersätter aldrig verkliga lagringsprov.
Nästa steg inom TASK013 är en isolerad riktig MinIO-miljö/versionsacceptans,
innan adapter kopplas till reservation och scanjobb. Hela snittet är öppet.

## Plan för verklig lokal MinIO-verifiering

Kör samma RELEASE.2025-07-23T15-54-02Z som Compose, som officiell darwin-arm64-
binär i unik privat tempkatalog. Verifiera SHA-256 mot officiell releaseasset
före körning. Ingen systeminstallation, publik port, annan bucket eller
teknikändring. Skapa separata syntetiska credentials, bind både API/console
till 127.0.0.1 och kör tester med explicit disposable-target-bekräftelse.
Stoppa processen efter prov; bevara testdata för omstartskontroll, radera inte
material eller versionshistorik. Unit/protokollprov och verklig integration
ska vara separata kommandon. Native single-node är inte produktions-HA/TLS.

### Utfall: verklig MinIO och processomstart

Körningen slutfördes: 1 integrationsfil / 3 tester passerade. Därefter skrevs
en separat originalversion och en nyare version på samma key; efter ren
serveromstart lästes originalmanifestets bytes oförändrade. Servern är stoppad
(separat processkontroll gav ingen match), testkataloger och versioner bevarade.
Logg: /private/tmp/otid-013-minio-run.log; privat integrationslogg:
/private/tmp/otid-minio-run-ybeVew/integration.log.

Kommando: CI=true pnpm --filter @o-tid/infrastructure exec tsx test/run-minio.ts
/private/tmp/otid-pm-minio.WRtNLd/minio. Hash/pinning och provgränser dokumenteras
i docs/research/pm-storage-sdk.md. Testet verifierar inte PDF-innehåll, scanner,
least-privilege, TLS, HA eller backup/restore till en ny server. Ingen PM-route
har aktiverats. Nästa steg inom snittet är den additiva reservation-/manifest-/
scanjobbsmigrationen med återställningsnot och riktiga PostgreSQL-prov.

Efter integrationsdelen kördes CI=true pnpm lint, typecheck, test och build;
samtliga gav exit 0. Enhetssviten är separat: 222 filer / 1 477 tester.
Loggar: /private/tmp/otid-013-minio-{lint,typecheck,unit,build}.log. Inga nya
PostgreSQL-/browser-/scannerprov kördes för testharneskändringen. Dessa krav
kvarstår för det fullständiga PM-flödet.

## Pågående durabel databasgrund

ADR0061:s tillägg fastställer immutable reservationer/försök/manifest,
slotbaserad kvot och pending scanjobb. Berörda implementationer är endast
database och application:s PostgreSQL-integrationstester; ingen PM-route,
CLI-utfärdning eller worker aktiveras i schemafasen. SQL-constraints ska
verifiera racescope, capability, kvot även vid samtidiga inserts, filens exakta
SHA/längd/försök, versionsbunden servernyckel och immutable historik. Manifest
och jobb kräver gemensam commit. Application-fencing och scanrapporter krävs
fortfarande före publicering; ett pending jobb är aldrig ett godkännande.

Testdatabas är otid_006w_review_schema på loopback 55432, inte demo eller
Skärgårdshelgens privata databas. Migrationsläge före ändring: 38 registrerade
migrationer (0000–0037). Ingen gammal databas raderas eller återseedas.

### Verifierat schemautfall

Migration0038 och Drizzleschema är införda, med rollback/restore-not i
packages/database/migrations/README.md. Agenten skrev databassubstratet;
main granskade och skrev riktiga PG-prov. Före migration rättades leasechecken
så att bara ena leasefältet aldrig tillåts, samt versions-id till adapterns
tecken-/längdgräns. Generation mappas till bigint utan JS-avrundning.

Riktad första PG-körning: 8 tester, exit 0. Efter bigint-provet passerade
hela application-integrationssviten: 23 filer / 257 tester, varav 9 nya PM-prov,
exit 0. CI=true pnpm lint, typecheck, test och build gav alla exit 0;
enhetssvit 222 filer / 1 477 tester. Loggar under
/private/tmp/otid-013-pm-schema-{pg,full-pg,lint,typecheck,unit,build}.log.

Inga nya MinIO-/scanner-/browser-/hårdvaruprov kördes för schemasteget.
PG-proven använder avsiktligt syntetiska manifest, inte ett PDF-scanbevis.
End-to-end-upload, exact-retry i application, worker-fencing, scanrapport,
publicering och gemensam PG/objektrestore återstår. Nästa minsta steg inom
TASK013 är authskyddad reservation och försöksallokering med exact-retry/kvotprov,
innan nätöverföring kopplas in.

## Reservations-/försökstjänst

MANAGE_PM_DOCUMENT har nu egen application-loginpolicy/prefix och strikta
loginkontrakt. Ingen CLI/HTTP aktiveras. reservePmDocumentAsAdmin håller
mutation-auth, race UPDATE och request-id-advisorylås i samma RC-transaktion.
Exact-retry jämför actor/race/titel/MIME/SHA/längd innan kvoten kontrolleras.
Reservation och audit committas tillsammans utan ändrad raceSnapshotVersion.

allocatePmUploadAttemptAsAdmin är serverintern: varje allokering är en ny
debitering, inte en retry av föregående PUT. Den binder reservationens actor
och race, returnerar redan sparat manifest utan debitering och serialiserar
åttaförsöksgränsen. Ingen storage-PUT eller manifestcommit utförs ännu.
ADR0061 förtydligar exakt denna gräns. Publicering/scan kan inte aktiveras av
ett reservationssvar; det strikta svaret tillåter inga lagrings-/scanfält.

Första typecheck hittade ett felaktigt Date-anrop i nytt test; det rättades.
Första riktade PG-sviten hade 8 godkända och 1 fel: testet väntade unauthorized
för en giltig session med fel roll, där befintlig policy använder forbidden.
Implementationen ändrades inte för att få detta prov grönt. Full PG-svit
efter rättning: 24 filer / 266 tester, exit 0, inklusive 9 nya tjänsteprov.
Proven omfattar samtidiga retries/debiteringar, full kvot, stale actor/race/
intent, CSRF/expiry, sen transaktionsrollback och revoke som vinner authlåset.

Inga nya MinIO-/browser-/scanner-/hårdvaruprov: tjänsterna gör inga nätanrop
och PM saknar fortfarande genomgående runtime. Nästa minsta steg inom samma
snitt är bytevaliderad objektöverföring med slutlig auth och atomisk commit
av exakt manifest plus pending scanjobb, inklusive tappade svar/rollbackprov.

Slutlig workspaceverifiering: CI=true pnpm lint/typecheck/test/build gav exit 0.
Efter sista kontraktsproven kördes paket-lint/typecheck och full enhetssvit om:
224 filer / 1 481 tester, exit 0. Ingen produktionskod ändrades efter build.
Loggar /private/tmp/otid-013-pm-reservation-{full-pg,lint,typecheck,unit-final,build}.log.

## Objektöverföring och slutlig manifestcommit

Application har nu en liten serverintern lagringsport och transferPmDocumentAsAdmin.
Body läses efter auth och durabel debitering, med fast storleksbegränsad buffer,
total 30 s läsdeadline samt hashkontroll. En verifierad PUT/readback följs av
ny aktuell auth och kort RC-transaktion för manifest/pendingjobb/audit.
Portmanifestets schema och attempt/race/SHA/längd valideras. En förlorande
konkurrent återger redan valt manifest; inget orphanobjekt raderas.

Kontraktet för manifest flyttades till contracts och återanvänds av riktiga
MinIO-adaptern. Runtimeberoenderiktning: infrastructure → contracts;
application använder bara port/kontrakt. Infrastructure:s nya app/database/
Drizzle-beroenden är endast devDependencies för ett genomgående verkligt prov.

Det verkliga MinIO/PostgreSQL-provet passerade: ett race reserveras, PUT görs
en gång, manifest/PENDING-jobb sparas, retry läser ingen ny body eller PUT och
exakt fryst version ger samma bytes. Samma runner körde dessutom de tre gamla
MinIO-proven och processomstart med äldre version. Syntetiska bytes är inte
en parser-/antivirusgodkänd PDF. Privat körunderlag:
/private/tmp/otid-minio-run-HdhKlg/integration.log. Servern är verifierat stoppad.

PG-felproven använder uttrycklig lagringsdubbel för att styra tappat svar,
corrupt body, fel manifest, spärr/expiry under PUT, samtidighet och rollback.
Detta är separat från det verkliga MinIO-provet. HTTP-reader måste honorera
AbortSignal och dess streamavveckling/limiter ska provas innan routeaktivering.
Verklig scanner, rapporter/worker-fencing, publicering/UI och kombinerad restore
återstår inom samma TASK013; detta är inte en färdig dokumentfunktion.

Verifiering: CI=true pnpm lint/typecheck/test/build slutligen exit 0;
226 filer / 1 485 enhetstester. Full application PostgreSQL-svit exit 0:
25 filer / 276 tester, inklusive 10 överföringsprov och faktisk 30 s timeout.
MinIO: 3 fristående + 1 kombinerat PG-prov, samt processrestart, exit 0.
Loggar /private/tmp/otid-013-transfer-{lint-final,typecheck,unit,build,full-pg,minio}.log.
Första lint hittade en onödig async-generator i testet; den rättades och hela
workspacekedjan kördes om. Nästa steg är verklig PDF-/antivirusskanning kopplad
till det durabla jobbet, med worker-fencing och immutable scanrapport.

### Native motorbevis 2026-09-07

Verklig qpdf 12.4.1 och ClamAV 1.5.4 har nu provats med officiell
signaturdatabas i privat katalog utan installation. Tio motorsteg passerade,
inklusive ensidig PDF, kryptering, trasig PDF, saknad databas och EICAR.
Runnern kontrollerar exitkod och faktisk scan-summary. Se
docs/research/pm-native-scanner-probe.md för proveniens, certifikatproblem
och kvarstående grindar. Detta ger inte READY/publicering.

CI=true pnpm lint/typecheck/test/build: alla exit 0; 226 filer / 1 485 tester.
Nativeprov och sista paketlint/typecheck: exit 0. Första sandboxkörningens
HTTP-listen EPERM rättades genom teståtkomst, inte sänkta assertions.
PG/MinIO/browserprov upprepades inte för denna test-/dokumentationsändring.

Nästa minsta steg är worker-lease/fencing och immutable scanrapport inom
samma TASK013. Produktionsisolering och komplett publiceringsflöde återstår;
uppgiften är inte klar.

### Durabel lease 2026-09-08

Migration0039 och serverintern claim/release är implementerade enligt
ADR-0061: femminuters DB-lease, immutable attemptjournal, SKIP LOCKED,
bigintgeneration och aktuell owner/generation/expiry i release-UPDATE.
Gamla workers får inte återlämna ett övertaget/utgånget jobb. Ingen rapport
eller godkänd fil skapas av dessa operationer; workerloop är avstängd.

Full application PG: 26 filer / 288 tester, exit 0, inklusive 12 leaseprov.
Isolerad databas har 40 migrationer. CI=true pnpm lint/typecheck/test/build:
exit 0, 226 filer / 1 485 enhetstester. Se docs/status.md för fellogg och
slutloggar. Ingen privat tävling/demo eller användarfil påverkades.

Nästa minsta steg i samma öppna uppgift är immutable scanrapport med atomisk
fencingkontroll vid rapportcommit. Produktionsprofil och hela dokumentflödet
är fortfarande acceptanskrav; leaseprov ensamt bevisar inte scan/publicering.

### Immutable rapport 2026-09-08

Migration0040, strikt evidens och recordPmScanReport är implementerade.
Rapport/final jobstatus committas atomiskt med current owner/generation och
både jobblease och immutable attemptdeadline i SQL. Exakt retry ger samma
rapport; ändrat innehåll konflikterar. Originalmanifestet binds exakt.
Application härleder utfallet; native-profilens PASSED är alltid
publishable=false och kan inte aktivera PM. Saknade motorer förblir null.

CI=true pnpm lint/typecheck/test/build: alla exit 0; 228 filer / 1 503
enhetstester. Full PG: 27 filer / 301 tester, inklusive 13 rapportprov;
41 migrationer i isolerad testdatabas. Sista paketlint/typecheck exit 0.
Se docs/status.md för exakta loggar och begränsningar. Motorobservationerna
i dessa tester är syntetiska; ingen scanner/publiceringsruntime aktiverades.

Nästa minsta steg är strikt scanneradapter från verkliga motorobservationer
till rapportmodellen, fortfarande utan native-publiceringsrätt. Hela TASK013:s
isolerings-, publicerings-, browser- och restoreacceptans kvarstår.

### Strikt outputadapter 2026-09-08

Rena infrastructure-parsers för qpdf, ClamAV och sigtool används nu av den
verkliga nativeproben. Hela outputformatet och processstatus kontrolleras;
okänd/felaktig/trunkerad output eller stderr ger inget clean-underlag.
Proben använder egen skrivskyddad, hashkontrollerad kopia av exakt verifierade
CVD-filer. Tre sigtool-verifieringar och tio motorsteg passerade, exit 0.
Metoden sigtool-default-cvd är inte bevis för tvingad X509/FIPS-verifiering.

CI=true pnpm lint/typecheck/test/build: exit 0; 229 filer / 1 528 enhetstester,
inklusive 25 parserprov. Se docs/status.md och research för exakta loggar,
hashar, verklig tidszonsvariant och kvarstående begränsningar. Ingen full
scannerkomposition/rapportcommit eller produktion aktiverades av detta steg.

Nästa minsta steg är en workeriteration: exakt objektversion → verklig
kontroll → atomisk rapport. Nativeprofilen ger fortsatt ingen publiceringsrätt.
Hela TASK013 är öppen tills övrig isolerings-/UI-/publicerings-/restoreacceptans
verifierats; parserprov ensamt ersätter inget av dessa krav.

### Sammanhängande workeriteration 2026-09-08

runPmScanIteration och createNativePmScannerProbe kopplar nu verklig exakt
objektversion till skanning och atomisk rapport. Manifest/bytes ägs vid
adaptergränserna; timeout/abort lämnar ingen fabricerad rapport. Nativebarn
har separat 60 s monoton deadline och kopplad abort; privata temporära kopior
tas bort först efter processavslut. Originalobjekt och testhistorik bevaras.
Ingen daemon eller offentlig PM-väg aktiveras. publishable=false gäller alltid
för denna profil; produktionsisolering är fortfarande ett fullständigt krav.

Verkligt MinIO/PG/nativeprov finns opt-in i test/run-minio.ts när både isolerad
TEST_DATABASE_URL och OTID_PM_NATIVE_SCANNER_ROOT är satta. Testerna använder
egna syntetiska PDF-filer och kontrollerar verklig PASSED/FAILED-evidens,
lagrad canonical hash, FINISHED och retry utan extra skanning. Se docs/status.md
för slutliga körresultat och kvarstående acceptans.

Slutverifiering: CI=true pnpm lint/typecheck/test/build exit 0; 230 filer /
1 542 enhetstester. Full PostgreSQL-integration exit 0, 28 filer / 316 tester.
Riktig MinIO/PG/nativeomkörning exit 0: 3+1+2 tester samt äldre version efter
serveromstart. Ingen produktions- eller publiceringsacceptans härleds av detta.

### Linux-isoleringsprofil 2026-09-08

ADR-0062 anger konkret resurs-/nät-/filgräns, image/runtimeidentitet och krav
på betrodd livscykel/watchdog. Startplanens deterministiska infrastructure-
funktion implementeras separat från exekvering och kan inte skapa scanproof.
Den kontrollerar strikta identiteter/paths och tillåter inga klientvalda
flaggor, hemligheter, mounttillägg eller implicit imagehämtning.

Aktuell miljö saknar Docker/Podman/Colima/Lima. Inga containers eller VM:ar
har startats och ingen Linuxisolering påstås verifierad. Runtimeförberedelse,
pinnad Linuximage, faktisk preflight, containerlivscykel och resurs-/kraschprov
återstår före produktionsrapport. Detta ersätter inte snittets fulla acceptans.

Slutverifiering för planfunktionen: lint/typecheck/test/build exit 0; 231
filer / 1 591 enhetstester inklusive 49 nya profiltester. Ingen verklig
Linux-runtime körd. Se docs/status.md för miljögrind och exakta loggar.

### Kontroll av prestartmetadata 2026-09-08

Infrastructure kontrollerar nu strikt tillförd image-/container-inspect mot
startplanen och ett exakt create-returnerat container-ID. Avvikande miljö,
mounts, privilegier, resurser, namespaces eller livscykeltillstånd avvisas.
ADR-0062 dokumenterar beslut och gränser före implementation. De syntetiska
API-fixturerna är inte verkliga runtimeobservationer eller godkända releasepins.
Ingen daemonkontakt, skanning eller publicering aktiveras. Verklig insamling,
runtime/image-release och isolerings-/kraschprov återstår i det fulla snittet.

Slutverifiering av metadataändringen: CI=true pnpm lint/typecheck/test/build
exit 0, 232 filer / 1 792 enhetstester. Av dessa är 201 nya syntetiska
prestarttester. Ingen faktisk container kördes. Exakta loggar och ej omkörda
integrations-/hårdvaruprov redovisas i docs/status.md.

### Läsadapter för daemon-inspect 2026-09-08

ADR-0062 utökades före implementation med en explicit Unix-sockettransport.
Infrastructure läser image och container med två fasta GET-anrop, gemensam
10s monoton deadline, 1MiB per svar och 16KiB headergräns. Fel/abort stänger
egen anslutning och lämnar bara sanerat fel; lyckat svar går genom befintlig
metadatafunktion. Ingen CLI, TCP-fallback, retry, start eller publicering.
Socketen ska ägas av samma nonroot-UID i privat kanonisk 0700-katalog.
Testsvar är syntetiska även när transporten använder riktiga Unix-socketar.
Verklig daemon-/releaseverifiering och hela isolerings-/livscykelacceptansen
återstår; detta ersätter inte TASK013:s användarflöde eller produktionsgrind.

Slutverifiering av läsadaptern: CI=true pnpm lint/typecheck/test/build exit 0;
233 filer / 1 855 enhetstester, varav 63 nya Unix-HTTP-prov. Inga tester
skippades i enhetssviten. Separata databaser/browser/hårdvara kördes inte om;
verklig Docker är ännu inte provad. Nästa minsta steg är separat Linux-
testmiljö och riktig daemonkompatibilitet, inte att ge syntetiska svar
release- eller publiceringsrätt. Full acceptans kvarstår enligt ovan.

### Verklig Linux-testvärd 2026-09-08

Privat hashverifierad Lima2.2.0/VZ + Ubuntu24.04 arm64 skapades och startades
med 2 CPU/4GiB RAM/12GiB disk. Effektiv konfiguration och faktisk gäst visar
inga hostmounts, separat nonroot-UID och cgroup v2. Grundassertioner exit 0;
gästen stoppades med exit 0 och underlaget bevaras. Docker är ännu inte
installerat: detta är inte Docker-, scanner- eller produktionsacceptans.
Se docs/pm-linux-test-host.md. Inga applikationskällor eller dependencies
ändrades; tidigare full workspaceverifiering är oförändrad, inte omkörd här.
Nästa minsta steg är rootless Docker och verifierad runtime/cgroup i gästen.

### Rootless Docker i testgästen 2026-09-08

Versionslåst Docker29.8.0/rootless-extras/containerd installerades från
signerat officiellt APT-underlag med registrerade DEB-hashar. User-daemon
visar rootless/systemd/cgroup2; system-daemoner är masked/inactive. Inga
AppArmor/sysctl-lättnader, inga extra cgroupoverrides. Setup, runtimeassertioner
och stop exit 0. VM:n är stoppad och bevarad; inga containers körda än.
Nästa minsta steg är syntetisk container med faktisk leaf-cgroup- och inspect-
adapterkontroll. Detta är inte full isolering, PM-användarflöde eller publicering.
