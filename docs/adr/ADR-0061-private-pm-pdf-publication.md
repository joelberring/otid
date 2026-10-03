# ADR-0061: privat PM-PDF, kontrollerad publicering och återtagande

- Status: Accepterad arkitektur; produktionsaktivering spärrad av TASK013:s acceptans.
- Datum: 2026-09-07
- Tillägg till privat MinIO/modulär monolit, ingen förändring av resultatdomänen.

## Kontext och scope

V1 kräver PM/dokument. MinIO är redan beslutad men saknar adapter; worker är
en placeholder. Filuppladdning kan därför inte ärva IOF-importens atomiska
PostgreSQL-lagring. Objektlagring och databas har ingen gemensam commit.
PDF-signatur eller MIME är inte tillräcklig validering. Primärkällor och faktisk
miljö finns i docs/research/pm-pdf-upload.md.

Första kompletta snittet gäller ett aktuellt publicerat PM per race, med
bevarad historik inom dokumenterad uppladdningskvot. Ersättning är ny
uppladdning/publiceringsrevision, aldrig overwrite. Inga kartor, rutter,
godtyckliga bilagor, inline-PDF-viewer eller Eventorhämtningar ingår.

## Behörighet och API-intents

En specifik MANAGE_PM_DOCUMENT-capability omfattar uppladdning, granskning,
publicering och återtagande i exakt ett race. Högst 8 h credential/1 h session,
egen prefix-/cookiepolicy enligt befintlig capabilityarkitektur. Detta är
avsiktligt en dokumentbehörighet, inte generell tävlingsadmin.
CLI utfärdar till privat stdout; ingen bypass i produktion eller demo.

Init är strikt JSON {formatVersion:1,title,byteLength,sha256,mediaType:'application/pdf'}.
title är NFC, 1–120 Unicode-kodpunkter (inga ensamma surrogater), utan inledande/avslutande blanksteg,
kontrolltecken eller bidi-styrtecken. Titel normaliseras inte tyst vid retry.
byteLength är heltal 1–10485760. SHA-256 är exakt lowercase 64-hex.
Idempotency-Key är pm-upload:<canonical-lowercase-uuid>.
Servern genererar uploadId; klienten får inte ange bucket/key/version/scanutfall.

Publiceringsintent är {formatVersion:1,uploadId,expectedPublicationRevision}.
Återtagande är {formatVersion:1,publicationId,expectedPublicationRevision}.
Revision är 0 vid ännu opublicerat race för publish, annars positiv int32;
withdraw kräver positiv revision. Separata pm-publish:/pm-withdraw:-nycklar.
Servern binder actor, race, operation och exakt intent i requestjournal;
ändrad actor/intent för samma request-id ger konflikt. UI håller pendingintent
i minnet och erbjuder explicit same-id-retry, aldrig tyst ny publicering.

## Privat uppladdning utan distribuerad transaktion

1. Auth/Origin/CSRF före body; kort mutationstransaktion reserverar request,
   uploadId, SHA/längd/titel och kvot. Upp till 100 reserveringar per race,
   10 MiB per fil; avbrutna reserveringar räknas tills betrodd städning sker.
   Högst 8 överföringsförsök per reservation, varje försök debiteras med full
   deklarerad längd före PUT, även vid okänt utfall. Totalt högst 8 GiB
   debiterade objektbytes per race; inga automatiska PUT-retries som kringgår
   försökstilldelningen. Nytt försök efter kvot kräver betrodd reconciliation.
2. Separat begränsad binary-upload genom webbservern, ingen presigned URL.
   Både deklarerad och faktiskt läst storlek/hash verifieras. Varje överförings-
   försök får egen opak servernyckel. Fel body skapar inget färdigt dokument.
3. Versionsaktiverad privat MinIO tar emot bytes. Servern återläser exakt
   version, verifierar SHA/längd och sparar immutable objectmanifest + durable
   scanjobb med slutlig auth/CAS. Ingen DB-transaktion hålls under nätöverföring.
4. Okänd commit/retry letar upp samma reservering; redan komplett uppladdning
   refererar samma manifest. En konkurrerande förlorande objektversion blir
   privat orphan, inte ett andra logiskt dokument. Om DB-commit saknas visas
   inte uppladdningen som komplett, även om objekt finns.

Manifest binder bucketkonfiguration-id, opak key, exakt versionId, SHA och
längd. Ingen konsument får GET 'latest'. ETag ersätter aldrig SHA-256.
Opålitligt filnamn eller titel används inte i key, sökväg eller shellargument.
Appen får inte radera/överskriva refererade versioner. SDK: minio i ett nytt
Node-only infrastructure-paket; ingen hemmaskriven S3-signering. Exakt version
och transitiv licenslista låses före adapterimplementation.

Betrodd reconciliation kan identifiera reserveringar och orphanförsök men
raderar inget automatiskt i TASK013. Separat städkommando kräver dry-run,
exakta versions-id, referenskontroll och dokumenterad retention/restore.
Refererad dokument-/publiceringshistorik får aldrig kvotbefrias genom radering
i detta snitt. Den ackumulerade kvoten är en avsiktlig driftgräns, inte ett
löfte om obegränsad lagring; utökning/retention kräver separat beslutat arbete.
Ingen befintlig bucket eller databas migreras för att få lokala tester gröna.

## Scan i befintligt workerskal

PostgreSQL äger durable jobb, lease/attempt och append-only scanrapporter;
worker tar jobb med SKIP LOCKED, tidsbegränsad lease och fencing-generation.
Sen gammal worker får inte acceptera ett resultat efter att lease tagits över.
Retry/krasch får förbli pending/failed men aldrig göra filen publicerbar.
Jobbstate är orkestrering, inte resultatstatus. Ingen Redis eller ny tjänstgräns.

Worker återläser och hashkontrollerar manifestets exakta version, skriver till
unik privat temporärkatalog och kör qpdf + clamscan utan shell. Båda är
separata verktygsprocesser, inte importerad extern källkod. Verktyg/binärversion,
scanpolicy, signaturdatabasversion/tid, manifesthash och attempt ska sparas.
Ingen stdout/stderr med dokumentinnehåll eller lokal sökväg får lämnas till UI/logg.

Acceptans kräver okrypterad PDF, qpdf --check exit 0 utan varningsmaskering
och komplett ClamAV-scan utan detektion, fel, timeout eller överskriden gräns.
Signaturdatabasen får vara högst 3 dygn gammal vid scan. Saknad binär/flagga,
okänd exitkod, gammal DB eller ofullständig kontroll är fail-closed.
Den särskilda --is-encrypted-exitsemantiken får inte blandas med --check.
Verktygens exakta versioner/flaggor ska pinnas och provas innan worker aktiveras.

Workerprocessen körs utan root, nätåtkomst eller produktionshemligheter i
scannerprocessernas miljö, med begränsad CPU/minne/tempdisk, outputgräns och
total deadline. Signaturuppdatering sker separat betrott, inte av filen/jobbet.
Exakta resursgränser och sandboxmekanism måste finnas i driftsprofil och provas
med timeout/expansion/misslyckad cleanup; ett Node-timeout ensamt räcker inte.

Ingen CDR/omskrivning i detta snitt: arrangörens original och dess checksumma
bevaras. Dokument får inte beskrivas som garanterat ofarliga. Ingen inline-
rendering; endast attachment-nedladdning. Detta innebär kvarvarande risk för
PDF-läsare och aktivt innehåll även efter scan, vilket visas i granskningsflödet.

## Publicering, nedladdning och återtagande

Publicering är separat kort mutationstransaktion: auth UPDATE enligt befintlig
ordning, race-scope och PM-head UPDATE, exact-retry, expected revision, READY-
manifest och godkänd aktuell scanpolicy kontrolleras innan append-only
publiceringsrad/audit skapas atomiskt. Rapporten ska vara högst 24 h gammal
vid nytt publiceringsbeslut; annars krävs ny scan, inte override i UI.
Publiceringen fryser titel, uploadId, manifest och scanreportId. Senare upload
ändrar inte det publika PM:et. RaceSnapshotVersion/stationspaket ändras inte.

Publik metadata och fil kräver ingen login men endast aktuell PUBLISH-head.
Version-specifik URL ger 404 om publicationId inte längre är aktuell.
Ingen direkt bucket-URL, listning, presigned URL eller offentlig ACL.
Servern hämtar exakt objektversion med byte-/tidsgräns, verifierar hash innan
en bodybyte lämnas och kontrollerar sedan head igen i kort lästransaktion.
Withdraw som vinner slutgrinden ger 404; redan auktoriserad pågående leverans
kan avslutas. Återtagande kan inte radera besökarens nedladdade kopia.

Svar: private/no-store även för publika filbytes, attachment med genererat
pm.pdf-namn, application/pdf, nosniff, CSP sandbox, ingen CORS eller Range-
leverans i första snittet. Privata metadata kräver ADR-0059 protected-read.
Fel exponeras som begränsade felkoder, aldrig storage/scanner-detaljer.

Drift måste begränsa upload/scan/download-rate och samtidiga bytes. En konkret
gemensam limiter (inte processlokal räknare i flerprocessdrift) med testad
klientidentitet/proxykonfiguration är aktiveringskrav innan publika routes.
Ingen adminfunktion får bypassa avvisad scan. Incident kan stänga hela
PM-leveransen; policybyte kan avvisa äldre scanrapporter för leverans.

## Migration, rollback och acceptans

Additiv schema-/capabilitymigration med restore-not ska föregå runtime.
Objektversionering/least-privilege ska verifieras på separat testbucket.
Vid incident stängs PM-routes/worker; manifest, rapporter och publikhistorik
raderas inte. Återställning ska omfatta både PG och exakt refererade versioner;
en DB-backup utan objekt är inte en fungerande dokumentbackup.

TASK013 kräver riktig PG/MinIO/verktygsintegration och browserflöde för
uppladdning, väntan, granskning, publicering, byteidentisk nedladdning och
återtagande. Testdoubles får prova felgränser men aldrig ensam styrka READY.
Arkitektur är beslutad; saknade versions-/sandbox-/limiterdetaljer är uttryckliga
implementationsgrindar, inte godkända genvägar eller bevis på färdig funktion.

## Native motorprov, inte produktionsprofil

Lokala kompatibilitetsprov får använda hashpinnade Homebrew-byggen av qpdf
12.4.1 och ClamAV 1.5.4 i privat tempkatalog utan systeminstallation. De
verifierar exitsemantik och riktig motor/signaturdatabas, inte full isolering.
Qpdf:s officiella aktuella release saknar här en macOS-binär. ClamAV:s
officiella PKG används som separat verifierad certifikatkälla; dess SHA/GPG
kontrolleras men macOS-paketsignaturproblemet får inte döljas. Bibliotek från
befintlig Homebrew gör provet icke-hermetiskt. Proven är aldrig produktions-
READY-bevis och får inte aktivera worker/publicering. Exakta artefakter och
provresultat dokumenteras i research före produktionsprofilens senare beslut.

## Durabel scanlease, 2026-09-07

Första jobbsteg allokerar en fast femminuterslease i kort READ COMMITTED-
transaktion med FOR UPDATE SKIP LOCKED. PENDING eller utgången LEASED kan
tas; FINISHED kan inte tas. PostgreSQL clock_timestamp används efter låset,
inte arbetarens väggklocka. created_at i framtiden ger ännu inget jobb.
Generation ökar som exakt bigint och får aldrig slå runt. Vid maxvärdet
nekas fortsatt allokering tills betrodd drift hanterat jobbet.
Oscopead köhämtning hoppar över uttömd generation så andra jobb inte svälts;
en explicit riktad hämtning returnerar generation-exhausted. DB-tid överförs
som validerade epochmillisekunder eftersom rå Drizzle-SQL inte garanterar
JavaScript Date för timestamptz. Ingen lokal klocka används som fallback.

Varje allokering sparar en immutable pm_scan_attempt med upload-id,
generation, opak worker-id, leased_at och lease_until. Attempt och jobbtillstånd
committas atomiskt. Jobbets befintliga manifest är immutable och återges med
exakt objektversion. Valfritt upload-id-filter är serverintern schemaläggning,
inte en publik behörighet eller klientvald köfunktion. Claim-retry efter
okänd commit återtar inte ett redan leasat jobb; det väntar på leaseexpiry.

En arbetare kan lämna tillbaka sitt jobb till PENDING endast medan samma
owner/generation ännu är giltig enligt aktuell DB-klocka efter låsning.
Den slutliga UPDATE RETURNING innehåller state/owner/generation och
lease_until > clock_timestamp(); ingen Node Date-jämförelse avgör giltigheten.
Detta raderar inte attempt och skapar inte scanrapport eller READY. Ingen
heartbeat/förlängning införs här: en senare scannerprofil måste rymma hela
arbetet inom fem minuter eller ändra policyn genom ADR före aktivering.
Framtida rapportcommit ska använda samma lås-/fencinggrind atomiskt med
rapporten; release-provet bevisar inte redan den rapporttransaktionen.

Migrationen är additiv. Befintliga 0038-leases kan sakna historisk attempt;
ingen historik fabriceras. De får löpa ut och nästa claim skapar första
journalförda generationen. Worker/runtime är fortfarande avstängd.

## Immutable scanrapport, 2026-09-08

En rapport journalför exakt upload/generation/worker med composite FK till
attempt, och upload-FK till immutable manifest. Rapport-id skapas av servern.
Strikt begränsad evidens innehåller start/sluttid, exakt manifest, policy,
executionProfile, observerad byteverifiering/cleanup, verktygens version och
binärhash, exit/signal/timeout/output-/felindikatorer samt faktisk AV-summary
och signaturfilernas version/hash/byggtid. Saknade observationer är null, inte
fabricerade framgångsvärden. Inga paths, filnamn, stdout/stderr eller filbytes.

Application härleder PASSED/REJECTED/FAILED från evidensen; caller anger inte
READY eller publiceringsrätt. Endast native-probe-v1 är accepterad profil i
denna första evidensversion, och varje sådan rapport har publishable=false
även vid PASSED. En verklig isolerad profil kräver separat accepterat ADR-
tillägg, scanneracceptans och publiceringsgrind före aktivering. Native
verktyg/hashar binds till de redan provade artefakterna; policy pm-pdf-v1.
Daily-databasens byggtid får vara högst tre dygn gammal vid skanningens slut;
main/bytecode får vara äldre men inte framtida, och alla tre måste vara
signaturverifierade. Aktualitet på main mäts inte som daily-uppdateringsålder.

Commit låser jobb och jämför tidigare rapport före expiry: samma worker och
exakt canonical JSON + SHA returnerar samma rapport även vid senare retry.
Ändrad payload/worker ger konflikt, inte overwrite. Ny rapport kräver aktuell
owner/generation, existerande attempt, exakt manifest, skanningsintervall inom
attemptens lease och sluttid inte efter DB-tid. Rapportinsert och FINISHED-
uppdatering committas atomiskt. Sista UPDATE RETURNING kräver aktuell
lease_until > clock_timestamp(); utebliven rad kastar rollback av rapporten.
Även immutable attempt.lease_until måste fortfarande gälla i slutgrinden;
en ändrad jobblease ger inte ett historiskt försök längre giltighet.
FINISHED betyder avslutad kontroll, inte godkänd/publicerad fil. Ingen omstart
av FINISHED exponeras i detta steg; explicit omskanning införs senare utan
att radera rapporterna eller återanvända generationen.

Recorded_at är DB-klocka, aldrig inskickad worker-tid. Evidenshashen räknas
med befintlig canonicalJsonBytes. Rapporten är immutable; en hash ensam
ersätter varken bytejämförelse vid retry eller kontrollerad scannerkomposition.
Migration0040 är additiv och backfillar inga resultat från gamla jobb.
Ingen ny runtime/route aktiveras av rapportlagringen.

## Verktygsutskrifter till observationer, 2026-09-08

Infrastructure tolkar pinnade qpdf/ClamAV-utskrifter vid adaptergränsen.
Processens stdout och stderr hålls separata; stderr, okänd/extra/dubbel rad,
avklippt output, signal eller timeout får aldrig tolkas som lyckad kontroll.
Parsern kräver hela den förväntade sammanfattningen, exakt en målfilsrad och
exakt en skannad fil. Processmetadata bevaras som begränsade runfält, aldrig
rå text i rapporten. Filvägen kommer från serverns eget temporärmål och ska
matcha exakt; inget klientfilnamn används för matchning eller processargument.

Qpdf:s ordinarie förbehåll om fel som verktyget inte kan upptäcka är en del
av den exakta framgångstexten, inte en dold varning. Krypteringsfrågan kräver
tom output och egen exitsemantik. ClamAV kräver en enda full SCAN SUMMARY
med känd motorversion, syntaktiskt giltiga räknare/tider och konsekvent
OK/detektion mot exitkod och infektionstal. Okänt format ger felobservation,
inte gissad clean-status. Summary ensam verifierar inte signaturdatabasens
proveniens; den måste hämtas separat från faktiskt verifierat databaspaket.

Nativeproben använder separat skrivskyddad kopia av exakt daily/main/bytecode
CVD och deras versionsmatchade detached-signaturfiler. Andra databasformat,
dubbla/extra filer nekas. Verifierare och scanner får samma kopia; inventory
och alla hashar återkontrolleras efteråt. Inget FreshClam-anrop görs under
scan. Detta är fortfarande inte en hermetisk produktionssandbox.

Sigtool --info måste ge exit 0, tom stderr och komplett Verification OK.
Provet märker detta sigtool-default-cvd: det bevisar verktygets normala
CVD-verifiering, inte att certifikatkedjan användes i stället för legacy
inbäddad signatur. Certifikatfilens pin är därför en konfigurationskontroll,
inte separat certifikatverifieringsbevis. Byggtidens signerade tidszonsfält
omräknas strikt till UTC; sigtool visar minutprecision, konservativt avrundad
nedåt vid framtida ålderskontroll. Proven skapar ännu ingen full scanrapport.

## En workeriteration och native-adapter, 2026-09-08

Application orkestrerar ett jobb med små betrodda read/scan-portar. Claim
committas före objektläsning; exakta manifestbytes ägs och SHA/längd verifieras
före scan. Inga nät-/verktygsanrop sker i DB-transaktioner. Portanrop omfattas
av total monoton 240 s deadline och AbortSignal. Ett sent portresultat efter
timeout får inte fortsätta till rapportcommit. Throw/timeout/ogiltiga läsbytes
ger begränsat attempt-failed och bevarad LEASED/journal tills expiry; ingen
fabricerad rapport eller cleanupframgång. Giltig evidens går via befintlig
recordPmScanReport och dess slutliga DB-fencing. Ingen automatisk daemon/route.

Infrastructure får en uttryckligen native-compatibility-probe-adapter,
förbjuden vid NODE_ENV=production och begränsad till samma pinnade privata
darwin-arm64-underlag. Den äger filbytes, skapar egen privat temporärkatalog,
kontrollerar verktyg/certkonfiguration, fryser signaturkopian och använder
samma outputparsers. Varje barn har 60 s deadline/outputgräns och är kopplat
till iterationens abort. Processmiljön innehåller inga serverhemligheter.
Nativeprofilen är fortfarande inte nät-/CPU-/minnesisolerad produktion.

Adaptercleanup tar bara bort egna namngivna temporära kopior och egna tomma
kataloger efter att barnprocesserna stängts. Ursprungligt objekt, källsignaturer
och användarfiler berörs aldrig. Okända kvarvarande filer/cleanupfel ger
cleanupSucceeded=false och privat bevarad rest, inte rekursiv borttagning.
Full evidens kan nu produceras av faktiskt nativeprov, men publishable=false
förblir obligatoriskt och produktionsaktivering spärrad. Verklig PG/MinIO/
native-integration ska skiljas från portdoubles och dokumenteras separat.

## SDK-pinning, 2026-09-07

MinIO JavaScript SDK pinnas till 8.0.7 i packages/infrastructure. Registret
erbjuder inte 8.0.8, trots masterbranchens version; ingen masterkod antas som
installerad. Paketets Apache-2.0 och transitiva dependencies inventeras efter
installation. SDK-signering används, inte en egen SigV4-implementation.
retryOptions.disableRetry=true och fast region krävs; hela operationen ska
kunna avbrytas genom Node-transportens AbortSignal, inklusive responsebody.
Max 10 MiB buffer med 64 MiB partSize ger en enda PUT i detta snitt.
Riktiga HTTP-felprov ska verifiera att 503 eller tappat svar inte orsakar en
andra PUT. Detta är SDK/transportprov, inte MinIO-durabilitetsacceptans.
Okrypterad HTTP kräver exakt 127.0.0.1, explicit loopback-development och
NODE_ENV annat än production. Production kräver HTTPS med ordinarie Node-
certifikatvalidering, även om lagringsservern råkar ligga på loopback. En lokal
HTTPS-server är inte samma sak som utvecklingsundantaget. SDK-klienten kan
inte stänga av TLS-validering genom adapterns strikta configkontrakt.

## Durabel uppladdningsgrund

Reservation är en immutable rad med race, actor/capability, request-id, exakt
titel/MIME/SHA/längd och serverallokerad slot 1–100. Unik (race, slot) gör
100-gränsen konkurrenssäker; request-id är globalt unikt. Application ska
låsa auth enligt befintlig ordning, sedan race, kontrollera exact-retry och
allokera ledig slot. Ingen kvot frigörs genom radering i detta snitt.

Varje debiterat överföringsförsök är immutable med eget UUID, reservation och
försöksnummer 1–8, unik (reservation, nummer), samt samma race/SHA/längd via
sammansatt FK. Full längd debiteras genom radens existens före varje PUT.
100 × 8 × 10 MiB = 8 000 MiB, vilket redan ligger under 8 GiB-gränsen.
Därför behövs ingen separat mutable kvoträknare med risk för journalavvikelse.
Allokering och exakt återförsök ska ändå verifieras i application-transaktioner.

Ett immutable manifest väljer högst ett lyckat försök per reservation och
binder store-id, servernyckel, exakt objektversion, SHA/längd och race med FK.
Nyckeln måste motsvara pm/<race>/<attempt>. Ingen sådan rad är scanbevis.
Manifest och första pending scanjobb ska committas i samma transaktion;
deferred korsreferens säkerställer att ett nytt manifest inte blir jobblöst.
Scanjobb binder manifestet och innehåller bara orkestreringsstate, generation,
leaseägare och deadline. Worker-CAS och immutable rapporter införs innan någon
worker eller publicering aktiveras; schema ensamt bevisar inte korrekt fencing.

Databasens MANAGE_PM_DOCUMENT-enum och åttatimmarsregel införs före reservationens
scope-FK. Utfärdning, cookiepolicy och HTTP aktiveras separat med authprov.
Detta ändrar inte tävlingssnapshot, resultatrevisioner eller stationspaket.

Reservationsinit använder mutation-auth först i READ COMMITTED-transaktionen,
sedan race UPDATE och request-id-advisorylås. Exakt actor/race/titel/MIME/SHA/
längd jämförs före kvotkontroll så en full kvot inte bryter ett gammalt retry.
Reservation och audit committas tillsammans; svaret är strikt validerat och
innehåller inget storage-id eller scanpåstående.

Försöksallokering är en separat serverintern operation, inte ett publikt
idempotent endpointkontrakt. Varje ny anropad allokering utan färdigt manifest
debiterar ett nytt försök under samma auth/race-lås. Redan färdigt manifest
returneras internt utan ny debitering. SDK får anropas högst en gång för varje
returnerat attempt-id. Efter okänt PUT-utfall återanvänds aldrig attempt-id för
en ny PUT; en ny allokering debiteras. Full HTTP-upload/reconciliation ska
testa detta innan aktivering. Inga nätanrop görs i dessa transaktioner.

Audit använder befintlig generisk PAIRING_ADMIN_ACCESS_CREDENTIAL-aktör med
exakt actor-id och MANAGE_PM_DOCUMENT i metadata. Titel, filbytes och tokens
behövs inte i audit. Separata PM-actions identifierar reservation/debitering.
Filbytes betyder här filens innehåll; antal debiterade bytes och checksumma
är tillåtna operationsmetadata för kvot/proveniens, inte dokumentinnehåll.

## Överföringsgräns

Application orkestrerar genom en liten injicerad serverintern lagringsport;
web/worker-komposition använder den riktiga MinIO-adaptern. Portens manifest
valideras med samma privata kontrakt som adaptern och binds till tilldelat
attempt/race/SHA/längd. Kontraktet är formvalidering, inte bevis från klienten.
Inga routes får ta emot manifest eller välja port/config från requesten.

Efter auth och durabel försöksdebitering får ett serverkontrollerat body-reader-
anrop läsa högst deklarerad längd under total läsdeadline. Hash kontrolleras
före PUT. Fel eller timeout behåller debiteringen men skapar inget manifest.
Porten anropas en gång. Dess readback måste vara klar före ny authtransaktion
med aktuell serverklocka, race-lås och atomisk manifest/job/audit-commit.
Konkurrerande förlorare återger redan valt manifest; deras objekt förblir
privata orphanversioner. Inget nätanrop hålls under DB-lås och inga orphans
raderas automatiskt. En redan committad retry behöver inte läsa om body eller
skicka PUT. Lagringskvittensen ger inget scan-/publiceringsbevis.
