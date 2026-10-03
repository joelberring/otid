# PM som PDF – primärkällor, 2026-09-07

Självständig specifikation; ingen extern implementationskod har kopierats.

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html):
  MIME och signatur räcker inte ensamma. Källan beskriver begränsade filtyper,
  storleksgränser, genererade lagringsnamn, auth/CSRF, antivirus/CDR och lagring
  utanför webbroot. O-Tids val av 10 MiB, egen publiceringsjournal och privata
  MinIO-versioner är egna beslut, inte OWASP-krav.
- [qpdf CLI](https://qpdf.readthedocs.io/en/stable/cli.html#option-check):
  --check bedömer syntaktisk struktur; exit 0 är inte bevis för ofarligt innehåll.
  Varningar ger normalt 3, fel 2. --is-encrypted har särskild exitsemantik och
  måste kontrolleras separat. Använd inte --warning-exit-0 i valideringsvägen.
  [Projektets licens](https://raw.githubusercontent.com/qpdf/qpdf/main/LICENSE.txt)
  ska tas med i dependency-/distributionsinventeringen när binären införs.
- [ClamAV scanning](https://docs.clamav.net/manual/Usage/Scanning.html) och
  [officiell clamscan-manual](https://raw.githubusercontent.com/Cisco-Talos/clamav/main/docs/man/clamscan.1.in):
  PDF-scanning finns. --alert-exceeds-max gör resursgränsöverskridanden
  synliga; --fail-if-cvd-older-than kan avvisa för gammal signaturdatabas.
  Installerad versions flaggor/exitkoder måste verifieras med riktiga prov;
  main-grenens dokumentation är inte en installerad binär.
- [MinIO JavaScript SDK](https://github.com/minio/minio-js): S3-kompatibel
  Node-klient med Apache-2.0-licens. Val av SDK undviker egen SigV4/
  multipartimplementation. Exakt version och transitiva dependencies ska
  granskas och pinnas innan adaptern införs; inget SDK har installerats här.

## Faktisk miljö, läst utan ändringar

docker-compose.yml har MinIO och init av privat otid-private, men ingen
versionsaktivering eller applikationsadapter. Worker är TASK_001_PLACEHOLDER.
Docker, minio, mc, qpdf och clamscan saknas på PATH. pdfinfo finns, men ersätter
inte antivirus eller qpdf-kontroller. Inga dokument har lästs/skannats och inga
containers eller signaturnedladdningar har startats.

## Slutsats

Filinnehåll måste förbli privat tills verifierad scanrapport och explicit
publiceringsbeslut finns. Skanning är riskminskning, inte garanti om att en
PDF är ofarlig. Verklig lagring, verktyg, felgränser och återstart måste provas
innan något PM-flöde räknas som klart. Se ADR-0061 och TASK013.
