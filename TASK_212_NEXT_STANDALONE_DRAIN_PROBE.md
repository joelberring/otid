# TASK212: opt-in-prov för Next standalone-dränering

Status: **statiskt verifierat opt-in-provunderlag, inte Linux-kört och inte ett
tekniskt skrivstopp**.

## Syfte och gräns

Detta är nästa smala kontroll av TASK180:s öppna avslutningsfråga. Provet kör
den byggda och pinnade Next 16.3.3-standalone-serverns verkliga route-upload-
`PUT`. Två syntetiska uppladdningar passerar en verklig isolerad PostgreSQL/
PostGIS-databas och en verklig privat, versionshanterad S3/MinIO-bucket. En
separat HTTPS-fixture vidarebefordrar S3-protokollet oförändrat men håller de
två verkliga objekt-`PUT`-anropen. Den ena HTTP-klienten förblir ansluten; den
andra stänger sin riktiga TCP-socket först när servern redan väntar i
objektsteget. Provet skickar därefter `SIGTERM`, kräver att standalone-
processen lever medan objektsteget är blockerat, släpper båda S3-anropen och
kräver två lyckade objekt-`PUT`, två slutliga manifest och två kompletta
punktmängder innan processens exit 0.

Fixturen är inte en egen Next-server, route eller produktionshook. Den avslutar
TLS vid en test-only objektproxy eftersom produktionslägets route store kräver
HTTPS; standalone-processen litar endast på det privata syntetiska CA-
certifikatet via `NODE_EXTRA_CA_CERTS`. TLS-verifiering förblir aktiverad.
Gate-certifikatet måste vara signerat av detta CA och täcka IP-SAN
`127.0.0.1`. Alla S3-
preflightanrop (bucket versioning och policy), själva PUT och den
versionsbundna verifieringsläsningen går vidare till det riktiga objektlagret.
Om de inte fungerar når proben aldrig grönt utfall.

## Obligatorisk disponibel miljö

Kör endast på en ny Linux-värd/VM avsedd att förstöras efteråt. Databasen ska
vara tom, redan migrerad, nås via `127.0.0.1` och heta `otid_task212_` följt
av minst åtta hextecken; proben kontrollerar att `event` är tom före skrivning.
Exakt samma URL ska finnas
i `DATABASE_URL` och `TEST_DATABASE_URL`. MinIO/S3-endpointen måste vara
loopback, bucketen privat, versionshanterad och heta `otid-task212-` följt
av minst åtta hextecken.
Credentials och TLS-nyckel/certifikat lämnas endast i privat processmiljö och
får inte vara produktions- eller tävlingscredentials. Bygg först exakt den
release som ska provas med `pnpm --filter @o-tid/web build`; kör sedan från
repositoryroten och ange den exakta absoluta sökvägen till denna byggs
`apps/web/.next/standalone/apps/web/server.js`.

Obligatoriska variabler är:

```text
TASK212_CONFIRM=isolated-linux-next-standalone-writer-drain
DATABASE_URL=postgresql://<syntetisk-credential>@127.0.0.1:<port>/otid_task212_<hex>
TEST_DATABASE_URL=<exakt samma sträng>
TASK212_STANDALONE_SERVER=/absolut/.../apps/web/.next/standalone/apps/web/server.js
TASK212_STANDALONE_PORT=<ledig loopbackport>
TASK212_PUBLIC_ORIGIN=https://synthetic.invalid
TASK212_GATE_PORT=<annan ledig loopbackport>
TASK212_TLS_KEY=/privat/absolut/test.key
TASK212_TLS_CERT=/privat/absolut/test-server.crt
TASK212_TLS_CA_CERT=/privat/absolut/test-ca.crt
TASK212_ROUTE_STORE_ID=<syntetiskt UUID>
TASK212_MINIO_ENDPOINT=http://127.0.0.1:<privat-port>/
TASK212_MINIO_BUCKET=otid-task212-<hex>
TASK212_MINIO_REGION=<region>
TASK212_MINIO_ACCESS_KEY=<syntetisk>
TASK212_MINIO_SECRET_KEY=<syntetisk>
```

Kör
`TSX_TSCONFIG_PATH=tests/e2e/tsconfig.task212-writer-drain.json node --import tsx tests/e2e/task-212-writer-drain-probe.ts`.
Scriptet
failar före anslutning om Linux-/confirm-/namn-/loopback-/sökvägsgrinden inte
är uppfylld. Det skapar bara syntetiska event/race/entry/grant/uploadrader i
den uttryckligen valda databasen och tar inte bort bevismaterial. Återställ
hela VM:n efter granskning.

## Godkänt utfall och kvarvarande luckor

Endast raden `TASK212_STANDALONE_DRAIN_OBSERVED` med `objectPuts: 2` och
`manifests: 2`, exit 0 samt bevarade privata server-/MinIO-/PostgreSQL-loggar
är ett grönt utfall för denna **enskilda standalone-fråga**. Timeout,
signalexit före release, 503, saknat manifest eller ett enda objekt-`PUT` är
fail-closed och inget partiellt bevis.

Proben använder riktig TCP-abort men inte systemd. Den bevisar inte installerad
unit/cgroup, TimeoutStopSec, controller, beständig markör, noll writer-
sessioner, förbjudna CLI-/migrationsstarter, credentialisolering, alla writer-
klasser, backup eller release. Därför får TASK180/D1b.4 inte markeras
verifierad av detta test ens om det blir grönt. Nästa Linux/systemd-acceptans
måste fortfarande kombinera utfallet med ADR-0160:s fulla installationsgrind.

## Lokala, skrivfria kontroller

På macOS körs endast:

```bash
pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task212-writer-drain.json
pnpm exec eslint tests/e2e/task-212-writer-drain-probe.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.task212-writer-drain.json"}'
```

Det verkliga provet får aldrig köras utan de explicit isolerade resurserna.

## Utfall 2026-09-27

Efter granskning kräver proben lokal PostgreSQL med tom `event`-tabell,
ett lokalt MinIO-bucket med särskilt testnamn, skilda loopbackportar och ett
privat CA för TLS-verifiering. Endast två distinkta versionssatta S3-rutt-`PUT`
räknas. Väntan på blockering, anslutet svar och processavslut har
gränser; timeout ger inget positivt utfall.

`CI=true ./node_modules/.bin/tsc --noEmit -p tests/e2e/tsconfig.task212-writer-drain.json`
gav **exit 0**. Riktad ESLint för den nya TS-filen med projektets parser-
options gav **exit 0**. En import-/grindkontroll med det dokumenterade
`TSX_TSCONFIG_PATH`-kommandot gav avsiktligt **exit 1** och enbart
`TASK212_REQUIRES_LINUX`; den anslöt inte till databas, MinIO eller server.
Ingen Linux/systemd-acceptans eller körning av de två riktiga uppladdningarna
har skett.
