# TASK013: faktiskt native-motorprov, 2026-09-07

Detta är kompatibilitetsbevis, inte produktionsisolering eller READY-bevis.
Ingen användarfil, Eventornyckel eller tävlingsdatabas användes. Ingen
systeminstallation, ändrad systemtrust eller avaktiverad TLS-validering gjordes.

## Proveniens

Privat underlag: `/private/tmp/otid-pm-scanners.mVBBg0`, macOS arm64 26.6.2.
Homebrew-bottles hämtades separat, hashkontrollerades och extraherades privat.
Officiella distributörsmetadata finns på
[qpdf-formeln](https://formulae.brew.sh/api/formula/qpdf.json) och
[ClamAV-formeln](https://formulae.brew.sh/api/formula/clamav.json).

| Artefakt | SHA-256 för hämtat arkiv |
| --- | --- |
| qpdf 12.4.1 arm64_tahoe | `7e3e764df933760c100b2bd5d7177ebd0511733685e647e57d9e90afa01427c5` |
| ClamAV 1.5.4 arm64_tahoe | `f3d487c09435064df158bc3cac331c43543a9de9a71fb65add0cb7d65d71a0e4` |
| Yara 4.5.8 | `80ded2d2c86e1965afd2c4eba62f9b523bb1c43c52c0b457f32caf8aa3b2e219` |
| Jansson 2.15.1 | `363280ce32ec598136c0ddeb8c2ced1fb215f9d69444acfe3d0f11ddaa00bef3` |
| libmagic 5.48 | `c8c01258938e218cf9dcff85eaf7580b299821fab53f4d6706679d41d55b476b` |

Binärhashar kontrolleras dessutom av `test/probe-pm-scanners.ts`:
qpdf `0326859206213694229c4b0917cc0eedf11d023dc5b1aa517eeab7ba3e94aec4`,
clamscan `56d3158a49bc23a4fe6dea301705bb57f08d69c98cf0bdfd02dfcf9907071bd2`.
Bibliotek från befintlig Homebrew jpeg-turbo/json-c/openssl@3/pcre2/protobuf-c
används via explicit DYLD_LIBRARY_PATH. Därför är miljön inte hermetisk.

[Officiell ClamAV 1.5.4-release](https://github.com/Cisco-Talos/clamav/releases/tag/clamav-1.5.4)
har universal-PKG med SHA-256
`df7fa753e2f9f67f3bc99b2a40a3be7ef559088c68ad6bdf66b4b5764e965bd6`.
Separat GPG-signatur verifierades med officiellt dokumenterad nyckel i privat
nyckelring: fingerprint `5BADCA2665EF59DCF8A23D8B707F0DB480836771`, exit 0.
Detta ska inte blandas ihop med `pkgutil --check-signature`, som rapporterade
**invalid signature**. Paketet installerades inte. Dess extraherade program
fungerade inte portabelt (dyld, exit 134); endast CVD-certifikatkatalogen används
av det lokala Homebrew-provet. Ingen binär patchades eller signerades om.

## Signaturhämtning

FreshClam kördes en gång per försök, inte som daemon. Saknad certifikatkatalog
gav först exit 2, därefter gav separat databastest exit 8. Både configfältet
CVDCertsDirectory och miljön CVD_CERTS_DIR behövdes i denna privata miljö.
Se [ClamAV 1.5:s certifikatkrav](https://blog.clamav.net/2025/10/clamav-150-released.html).

Slutligt försök gav exit 0 och Database test passed för daily 28116
(355647 signaturer), main 63 (3287027), bytecode 339 (80).
Logg: `/private/tmp/otid-pm-scanners.mVBBg0/freshclam-cvd-env.log`.
Den innehåller också `ERROR: NULL X509 store`; orsaken är inte fastställd.
Detta får inte döljas eller användas som bevis för en godkänd produktions-
uppdateringskedja. Själva nedanstående clamscan-loggar innehöll inte detta fel.

## Faktiskt motorprov

Kommando:

```bash
CI=true pnpm --filter @o-tid/infrastructure exec tsx test/probe-pm-scanners.ts /private/tmp/otid-pm-scanners.mVBBg0
```

Slutligt prov exit 0. Privat underlag:
`/private/tmp/otid-pm-engine-probe-vOXYer/observations.json` och separata loggar.
Efter read-only agentgranskning skärptes runnern dessutom till att kräva
qpdf:s faktiska clean-summary utan övriga varningar/fel och ClamAV-version,
exakt en skannad fil, rätt infektionsantal och inga fel/varningar.
EICAR-fallet kräver just Eicar-Test-Signature FOUND. Dessa assertions är inte
en generell parser för produktionsrapporter. Binärversion och databasmetadata
behöver fortfarande en egen validerad, strukturerad produktionsrepresentation.
Slutligt skärpt prov passerade också, exit 0, med tio steg och samtliga
outputValidated=true i `/private/tmp/otid-pm-engine-probe-JVNWQf/observations.json`.
Ett mellanprov i `.../otid-pm-engine-probe-4tAd3x` avvisade felaktigt qpdf:s
ordinarie förbehåll om fel som verktyget inte kan upptäcka. Nu matchas hela
den exakta clean-summaryn; endast återstående fel-/varningstext nekas.

- qpdf/clamscan version: 0, versionerna 12.4.1 respektive 1.5.4.
- Ensidig egen PDF, 346 bytes: qpdf check 0, is-encrypted 2.
- Krypterad syntetisk kopia: skapande 0, is-encrypted 0.
- Avsiktligt trunkerad PDF: qpdf check 2.
- Tom signaturkatalog: clamscan 2.
- Original-PDF: clamscan 0, en fil skannad, 346 bytes, noll infekterade.
- Ofarlig EICAR-text: clamscan 1, Eicar-Test-Signature FOUND, en fil skannad,
  en infekterad enligt testmotorns terminologi, 68 bytes.

Första provet i `.../otid-pm-engine-probe-vCDEU1` stoppade korrekt på check 2:
qpdf --empty ger inga sidor. Fixturen ersattes med självständigt genererad
ensidig PDF med exakta xref-offsets; godkännandekravet sänktes inte.
Provet använder 60 s deadline/process och 256 KiB outputgräns, ej shell.
Databasålder krävs högst tre dygn; PDF-scan/encrypted/limit-alert-flaggor är
explicita. Exakta flaggor finns i runnern. Exitsemantiken jämfördes med
[qpdf CLI](https://qpdf.readthedocs.io/en/stable/cli.html) och
[ClamAV scanning](https://docs.clamav.net/manual/Usage/Scanning.html).

## Kvarstående grindar

Ingen nätisolering, CPU-/minnes-/tempdiskprofil, stale-database-fixtur,
expansionsbomb, misslyckad cleanup eller fullständig produktionslicensinventering
är verifierad här. Original-EICAR är inte ett test av detektion inne i PDF.
Rapportparser, immutable rapport, worker-fencing, UI, publicering och kombinerad
PG/objekt-restore saknas. Enbart exit 0 är inte ett komplett READY-bevis.
Inga PM-routes eller workers aktiveras av detta prov. Se ADR-0061.

## Faktisk outputadapter och CVD-verifiering, 2026-09-08

Infrastructure har nu strikta parsers för qpdf check/encryption, ClamAV-summary
och sigtool --info. De använder observerat komplett outputformat, separata
stdout/stderr och begränsade processfält. Signaturdokumentationen beskriver
[CVD och sigtool-verifiering](https://docs.clamav.net/manual/Signatures.html).
Parsern är inte själv en kryptografisk verifierare: den kräver att den verkliga,
pinnade processen avslutas normalt och lämnar hela Verification OK.-svaret.

Ytterligare pin: sigtool 1.5.4-binärens SHA-256
`e1fa10f39533544bd0584cd4f504182919397c7f023985135a845f1c91f137a0`.
Konfigurerad clamav.crt SHA-256
`60200e4b4b1b1b7257bb4550487aeb142034341f3300a8526e77a3134a940e9d`.
Det senare bevisar inte att X509/detached-signatur användes framför legacy
CVD-signatur. Resultatet märks därför **sigtool-default-cvd**, inte godkänd
certifikatkedja/FIPS. Produktionsprofilens tillitsmodell är fortfarande öppen.

Proben skapar en separat 0500-katalog med 0400-kopior av exakt tre CVD-filer
och tre versionsmatchade detached-signaturer. Updaterns freshclam.dat kopieras
inte. CLD/andra databasfiler/okända eller dubbla signerade basnamn nekas.
Sigtool och clamscan använder samma kopia; SHA kontrolleras före/efter
verifiering och hela kopians inventory/hash efter båda skanningarna.
Originaldatabasen uppdateras inte. Mode-bitarna ersätter inte produktions-
isolering; samma OS-användare kan fortfarande ändra rättigheterna.

Slutligt nativeprov exit 0, 13 steg. Underlag:
`/private/tmp/otid-pm-engine-probe-YLI0dC/parsed-observations.json`.

| Databas | Version | Byggtid i UTC, minutprecision | CVD SHA-256 |
| --- | --- | --- | --- |
| daily | 28116 | 2026-09-07 06:24 | `6b48bd52c82ccada65be1b5981ef1f0a5d0c78229718c07502dc28ce1ae3c9d7` |
| main | 63 | 2025-12-16 23:18 | `0b2182d229f46981ec8f535382222f7c9dfdd656b250ad47988b910a8d302365` |
| bytecode | 339 | 2025-09-11 12:29 | `6d4aa01f219e988060fc419f495d07f27e0cdf1a2cccc065971da922c76f7ffb` |

Alla tre gav exit 0 och Verification OK. med tom stderr. Giltig PDF gav
check 0/encryption 2 och AV 0 med en skannad/ingen infekterad fil. EICAR gav
AV 1 med en skannad/en upptäckt fil. Inga paths eller råa loggar finns i de
parsade observationerna; privata separata felsökningsloggar bevaras lokalt.

Första utökade provet stoppade i `.../otid-pm-engine-probe-FYMBZf` eftersom
bytecodes signerade byggtid innehöll -0400 trots LC_ALL=C/TZ=UTC. Parsern
stöder nu strikt explicit offset, kalenderkontroll och UTC-konvertering.
Regressionsprov täcker detta; ingen verifieringsmarkör eller exitgrind togs bort.
Mellanprovet `.../otid-pm-engine-probe-OQCfOn` passerade också, före tillägget
av den egna signaturkopian. Minutprecision avrundar åldersunderlaget konservativt
nedåt, inte mot ett påhittat exakt sekundvärde.

25 syntetiska parserprov täcker extra/dubbla/förkortade rader, stderr,
osäkra räknare, fel målfil/version, motsägande detektion, datum/tidszon,
saknad verifiering, timeout/signal och outputgräns. Full scannerkomposition,
cleanup/limiter och bindning från faktiskt MinIO-manifest till en atomiskt
sparad rapport är ännu inte körda. Detta steg skapar inte rapporter eller
publiceringsrätt, och ersätter inte TASK013:s resterande acceptans.

## Verklig workerkomposition, 2026-09-08

createNativePmScannerProbe använder nu samma pinnade underlag och parsers i
en avgränsad read/scan-iteration. Första kombinerade provets privata logg är
/private/tmp/otid-minio-run-26ESzc/integration.log: tre lagringstester, ett
transferprov och två verkliga PG/MinIO/native-scanprov passerade. En egen giltig
PDF gav PASSED/publishable=false med exakt lagrad canonical evidens/hash;
trasig PDF gav FAILED utan fabricerad AV-observation. Ett FINISHED jobb lästes
eller skannades inte igen. En äldre objektversion överlevde serveromstart.

Skannern tar bort endast sina egna namngivna PDF-/signaturkopior och egna
tomma temporärkataloger efter processavslut. Originalsignaturer, MinIO-objekt
och databashistorik bevaras. Hashkontroll efter skanning binder kopian till
de observerade verktygsresultaten. Detta visar fungerande nativekomposition,
inte godkänd nät-/CPU-/minnesisolering, X509-policy, produktion eller full
backup/restore. Produktionspublikation är fortsatt spärrad. Slutlig omkörning
efter timeoutförstärkning redovisas i docs/status.md.
