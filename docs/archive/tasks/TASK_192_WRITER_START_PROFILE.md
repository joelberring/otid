# TASK192: icke aktiverad startprofil för writers

Status: avgränsat kodsteg klart 2026-09-25 under TASK180; **inte** tekniskt
skrivstopp eller Linux-acceptans.

## Syfte

Gör ADR-0160:s första Linux/systemd-processgräns konkret. En webb- eller
migrationsprocess som startas genom profilen ska neka start när den beständiga
controller-markören finns eller dess frånvaro inte kan styrkas. Writer-
credentials läses först efter den kontrollen och förs inte i argument,
unittext eller logg. Installerade serviceidentiteter, DB-writer-principal
och objektcredentials måste vara skilda från backupens läscredential.

## Avgränsning före implementation

- Lägg en liten Linux-bunden startkontroll och credential-launcher i
  `ops/systemd`, med två **icke installerade** exempelenheter för webb och
  migration. Ingen controller eller markörskapare levereras här.
- Deklarera vilka ytterligare CLI-/worker-starter som återstår. Den
  installationsägda profilen får inte aktiveras förrän de har en styrd
  startväg eller avlägsnad writer-credential.
- Den befintliga HTTP-grinden och omanagerade lokala utvecklingen ändras inte.
  Inga tävlings-, backup-, DB- eller objektdata berörs.
- Riktad kontroll: negativ/positiv logik för startgrinden, shellsyntax och
  statisk enhetsgranskning. En macOS-körning kan inte verifiera systemd,
  stopp/dränering, DB-sessioner, MinIO-objektsteg, omstart eller release.

## Acceptans som fortfarande återstår i TASK180

Riktig Linux/systemd-installation med isolerad syntetisk PostgreSQL/PostGIS
och MinIO; alla writerklasser och credentials inventerade; controller sätter
och synkar markören före dränering; ny HTTP/CLI/migration nekas; pågående
objektsteg avslutas; writer-processer/sessioner noll; krasch/reboot håller
spärren; explicit separat release. Först därefter kan ett tekniskt stoppbevis
diskuteras. `writeStopConfirmed` härleds aldrig ur denna startprofil.

## Levererat och verifierat

- `ops/systemd/check-writer-start.mjs` nekar andra plattformar/profiler,
  annan markörsökväg, närvarande markör, osäker/oläsbar katalogkedja och
  utbytt markörförälder. Alla katalogled måste vara verkliga root-ägda
  kataloger utan grupp-/världsskrivrätt.
- `writer-start.sh` kontrollerar före credentialläsning och före `exec`.
  `otid-web.service.example` och `otid-db-migrate.service.example` anger
  fasta kommandon och filbaserad credentialöverlämning. De är inte
  installerade eller aktiverade.
- `node --test ops/systemd/check-writer-start.test.mjs`: **3/3** passerade,
  exit 0. ESLint för de två `.mjs`-filerna, `node --check` och `sh -n`:
  **exit 0** vardera. En faktisk launcherstart på denna macOS-värd nekades
  med `OTID_WRITER_START_CLOSED`, avsedd **exit 78**. Ingen typkontroll eller
  build berör dessa fristående `.mjs`-/shell-/unitexempel.
- `systemd-analyze` saknas på denna Darwin-värd. Inga riktiga unit-,
  credential-, PostgreSQL-, MinIO- eller processdräneringsprov gjordes.

Kvarvarande antaganden: installationen kan avsätta en root-ägd beständig
markörkatalog, dedikerad writer-identitet/principal och privata
credentialkällor; varje faktisk CLI/worker-writer måste få styrd startväg
eller sakna direkt skrivcredential. Miljövariabelbridgen är fortfarande
synlig för kod i samma serviceprocess och är inte ett least-privilege-bevis.
