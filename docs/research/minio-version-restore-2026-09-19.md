# MinIO-versioner vid operativ återställning

- Datum: 2026-09-19
- Användning: faktaunderlag för ADR-0115 / TASK099
- Ingen anslutning till en O-Tid- eller MinIO-miljö har gjorts för denna research.

## Källor

- [MinIO Object Versioning](https://docs.min.io/aistor/administration/objects-and-versioning/versioning/)
  beskriver att MinIO tilldelar version-ID vid versionshanterad skrivning och
  att klienten inte kan ange ett eget version-ID.
- [MinIO Recover after site failure](https://docs.min.io/aistor/operations/failure-and-recovery/recover-after-site-failure/)
  beskriver att en `mc mirror`-baserad kopia inte återställer versionsattribut
  och hänvisar till replikeringsfunktioner när versionmetadata måste finnas kvar.
- [MinIO mc mirror](https://docs.min.io/aistor/reference/cli/mc-mirror/)
  beskriver verktyget som en spegling av aktuella objekt, inte ett
  versionsbevarande backupformat.
- [MinIO mc cp](https://docs.min.io/aistor/reference/cli/mc-cp/) säger
  uttryckligen att `mc cp` saknar versionsinformation och
  ändringstid, och hänvisar till bucket-, batch- eller site-replikering när
  alla versioner och versionsinformation måste följa med.
- [MinIO mc replicate add](https://docs.min.io/aistor/reference/cli/mc-replicate/mc-replicate-add/)
  beskriver bucket-replikering som server-till-server-synk av alla versioner,
  versionsinformation och metadata. Den kräver versionering på båda buckets
  och samma MinIO AIStor-version på källa och mål.
- [MinIO mc replicate resync](https://docs.min.io/aistor/reference/cli/mc-replicate/mc-replicate-resync/)
  beskriver aktiv återställningssynk av redan befintliga objekt genom en redan
  konfigurerad regel med `existing-objects`. Den noterar att klienter före
  `RELEASE.2025-07-28T19-02-30Z` kräver regelns target-ARN i stället för ett
  `ALIAS/BUCKET`-värde; O-Tids pinnade `mc` är äldre än den gränsen.
- [MinIO mc replicate rm](https://docs.min.io/aistor/reference/cli/mc-replicate/mc-replicate-rm/)
  beskriver att bucketregler tas bort med regel-id eller `--all --force` och
  att detta inte raderar redan replikerade objekt. Sidan gäller AIStor och är
  därför endast ett underlag för TASK137:s nödvändiga prov mot O-Tids pinnade
  OSS-MinIO- och mc-kombination.

## Slutsats för O-Tid

`pm_object_manifest` innehåller MinIO-version-ID och den befintliga PM-läsaren
frågar objektlagringen med just det ID:t. En vanlig S3/MinIO-läsning följd av
`putObject`, `mc cp` eller `mc mirror` till en ny målmiljö ger därför inte ett
bevis på återställning: målmiljön skapar egna version-ID:n medan den
återställda PostgreSQL-dumpen fortfarande pekar på källans ID:n.

TASK099 får inte implementera eller dokumentera en sådan kopia som restore.
Före en skrivande objektrestore behöver driftprofilen välja en dokumenterat
versions-ID-bevarande MinIO-återställningsmekanism och ett isolerat prov måste
visa att den återställda vanliga PM-läsaren kan slå upp varje manifestversion
med det ursprungliga version-ID:t. En översättning av historiska
`pm_object_manifest`-referenser är en annan arkitektur och kräver en separat
ADR; den ingår inte här.

## Replikeringshypotes och produktgräns (2026-09-22)

Den aktuella AIStor-dokumentationen gör bucket-replikering till den enda
konkreta kandidat som är relevant för O-Tids versionsbundna PM-manifest:
den säger att `mc replicate` synkroniserar alla versioner,
versionsinformation och metadata, till skillnad från `mc cp` och `mc mirror`.
Det är dock **inte** ett bevis för projektets driftprofil. O-Tid pinnas till
den öppna serverimagen `minio/minio:RELEASE.2025-07-23T15-54-02Z`, medan de
officiella sidorna är märkta *MinIO AIStor*. Dokumenten får därför inte
tolkas som ett godkännande att aktivera en produktionsreplika eller som bevis
att den pinnade OSS-releasen bevarar samma version-ID.

Före ett teknikval krävs ett isolerat, tvåinstansprov mot exakt den pinnade
serverreleasen. Det ska använda två tomma privata loopbackinstanser, en
versionshanterad syntetisk bucket och den befintliga PM-läsaren. Provet måste
visa att minst två historiska versioner av samma objekt går att läsa i målet
med källmanifestets oförändrade `versionId`, hash och längd. Det får inte
logga eller lägga credentials i argument, och det får inte ändra
`docker-compose.yml`, en användarbucket eller en produktionsmiljö. Om den
exakta jämförelsen fallerar, eller om testverktyget saknar den pinnade
serverreleasen, kvarstår TASK099:s nuvarande spärr.

Eftersom källobjekten i ett restorefall skapades före en ny regel räcker inte
en passiv väntan på replikeringsscannern som positivt bevis. TASK133 ska
skapa en regel med `existing-objects`, läsa dess target-ARN lokalt från
`mc replicate ls --json` och begära en explicit `mc replicate resync start`
mot just det ARN:et. Den pinnade klienten är äldre än alias-stödet för detta
kommando. ARN:et är testinternt och får varken skrivas till repo, konsol eller
testrapport.

ADR-0138 och TASK133 avgränsar endast detta kompatibilitetsprov. De väljer
inte bucket- eller site-replikering som O-Tids driftarkitektur och de gör
inte TASK099 till en färdig backup/restore.

## Regelrensning före operativ adapter (2026-09-22)

ADR-0140 väljer en kortlivad resync per backup-id och kräver att regeln är
borta innan O-Tid-writers återupptas. MinIOs aktuella `mc replicate rm`-
dokumentation säger att borttagning av regel inte raderar redan replikerade
objekt, men denna dokumentation är inte bevis för O-Tids pinnade äldre
klient/server. TASK137 utökar därför samma privata tvåinstansrunner med tre
obligatoriska postvillkor: källan hade inga regler före start, den privata
listan är tom efter rensning och den vanliga PM-läsaren kan fortfarande läsa
båda historiska målversionerna med samma `versionId`, hash och längd.

Ingen source-bucket med en befintlig replikationsregel får användas av första
backupkedjan. Detta gör den säkra `--all --force`-rensningen möjlig även efter
ett processavbrott, utan att TASK099 behöver uppfinna regelägarskap eller
prioritering. Det faktiska provet behöver fortsatt exakt de privata hashpinnade
binärerna; en grön statisk TypeScript-kontroll ersätter inte den körningen.
