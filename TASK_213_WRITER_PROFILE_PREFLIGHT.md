# TASK213: läsande preflight för systemd-v1-writerprofilen

Status: **förberedd preflight, ej fysisk acceptans**.

Detta delsteg inför en Linux-/root-bunden, helt läsande och fail-closed
preflight för ADR-0160:s nuvarande `systemd-v1`-profil. Kommandot installerar,
aktiverar, startar, stoppar eller laddar inte om någon unit. Det ändrar inga
filer och läser inga credentialvärden.

Preflighten kräver exakt tre installerade O-Tid-units: webb, migration och den
fasta speaker-spärrningen. Worker, `otid-`-prefixade drop-ins i
`/etc/systemd/system` och varje annan sådan O-Tid-unit avvisas. De tre
unitfilerna måste vara byte-identiska med de granskade `.service.example`-
filerna i releasen, så extra startdirektiv inte kan smygas in i en unit.
Varje unit måste använda den separata `otid-writer`-identiteten, exakt fast
kommando via `writer-start.sh`, exakt `/var/lib/o-tid/controller/closed` och
den granskade privata `LoadCredential=`-mappningen. Release-roten, de
utpekade startfilerna, unitmallarna, units, controllerkatalogen och
credential-/requestkällorna måste ha en rootägd, icke grupp-/världsskrivbar
katalogkedja ända från `/`. Hemliga filer måste dessutom sakna grupp-/världsrätt,
vara vanliga enkellänkade och icke-tomma. En befintlig markör måste vara en
rootägd, tom 0600-fil.

Riktad lokal verifiering använder endast injicerad syntetisk filsystems- och
identitetsmetadata:

```bash
node --test ops/systemd/check-writer-profile.test.mjs
CI=true pnpm exec eslint ops/systemd/check-writer-profile.mjs ops/systemd/check-writer-profile.test.mjs
node --check ops/systemd/check-writer-profile.mjs
node --check ops/systemd/check-writer-profile.test.mjs
```

Att köra själva preflightkommandot kräver en disponibel Linuxinstallation och
root, men även ett grönt utfall är bara en ögonblicksbild. Det bevisar inte att
systemd faktiskt har laddat unitfilerna, att units inte kan startas via alias,
transient units eller annan supervisor, att DB-/MinIO-principalens server- och
bucketprivilegier är korrekta, att root eller lagringsadministratör saknar andra
credentials, att övriga filer under releasen är oföränderliga för writern
eller att process-/credentialisolering håller vid körning. Det
installerar inget, provar inga verkliga credentials och är inte TASK180:s
dränerings-, sessions-, samtidighets- eller tekniska stoppbevis. Dessa frågor
kräver fortfarande fysisk Linux/systemd-/PostgreSQL-/MinIO-acceptans enligt
ADR-0160. Inget nytt ADR-beslut behövs för denna läsande kontroll.

## Utfall 2026-09-27

Efter granskning kontrolleras även varje sökvägs rootägda katalogkedja,
uniternas byte-identitet mot releasens mallar, frånvaro av `otid-`-drop-ins
och de utpekade startfilernas ägare/rättigheter. Den fulla releasens övriga
filer samt systemds faktiskt laddade konfiguration är fortfarande öppna.

`node --test ops/systemd/check-writer-profile.test.mjs`: **5/5, exit 0**.
Riktad ESLint och `node --check` för båda filerna: **exit 0**. Direkt anrop
på macOS gav avsiktlig **exit 1** med
`WRITER_PROFILE_PREFLIGHT_FAILED; NOT_ACCEPTED` före filsystems-I/O. Ingen
Linuxinstallation eller credential lästes. Typkontroll/build är inte
tillämpliga för dessa fristående `.mjs`-/dokumentfiler.
