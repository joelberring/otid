# TASK193: fast betrodd start för speaker-spärrning

Status: avgränsat kodsteg klart 2026-09-27 under TASK180; **inte**
driftgodkänt skrivstopp eller installerad unit.

## Beslut före implementation

Tillåt exakt en betrodd CLI-writer i den icke installerade `systemd-v1`-
exempelprofilen: spärrning av en befintlig `VIEW_SPEAKER_BOARD`-credential.
Utfärdande och övriga CLI-kommandon förblir förbjudna. Detta följer
[ADR-0160](docs/adr/ADR-0160-technical-writer-stop-process-boundary.md)
utan att ändra domän, teknik, databas eller behörighetsmodell.

En fast oneshot-enhet går genom samma markörkontroller som webb och migration.
`database-url` och en separat JSON-begäran levereras med `LoadCredential=`.
Begäran innehåller endast `formatVersion: 1` och ett kanoniskt credential-id;
inget id, skäl eller hemlighet ligger i argument eller unitmiljö. Kommandot
skriver aldrig ett resultat till stdout/stderr. Innan databasen öppnas
reserveras en ny 0600-kvittens i en systemd-ägd 0700-katalog utanför
repository och stoppmarkörens root-ägda katalog. Namnet binds till
`INVOCATION_ID`; en kollision avvisas utan överskrivning. Unitens stdout och
stderr går till `/dev/null`; exitstatus är operatörens första felindikator.

Spärrningens befintliga transaktion är idempotent: ett nytt försök med samma
credential-id efter okänt kvittensutfall får `already-revoked` och ursprunglig
spärrtid, inte en andra audit. Varje försök får en ny kvittensfil. En tom fil
efter fel är **inte** en lyckad kvittens. Begäran får inte ändras mellan retry
och ett lyckat svar får bara läsas ur filen när enheten avslutats med exit 0.
Ingen automatisk omstart eller utökad generell CLI-launcher införs. Koden
använder Node med befintlig `tsx`-import, så den fasta starten inte behöver
`tsx`-CLI:ns lokala IPC-socket.

## Gräns och kontroll

Berör bara den nya CLI-ingången, en unitmall, inventering och dokumentation.
Det befintliga manuella `speaker:access:issue/revoke` ändras inte. Riktade
prov ska omfatta strikt begäran, 0600-reservation/kollision, fast unitkommando
och markör, TypeScript/ESLint och shellsyntax. Inget verkligt speaker-id eller
produktionsdatabas används. Linux `systemd-analyze verify`, journal-/filrätts-
kontroll, isolerad PostgreSQL-retry, controller/dränering och faktisk credential-
isolering är kvar innan enheten får installeras eller räknas som stoppbevis.

## Leverans och verifiering

- Ny separat `speaker:access:revoke:systemd` läser högst 16 KiB privat JSON
  från systemd-credentialfil utan att följa symlänk, avvisar extra fält och
  kräver kanoniskt UUID. Den reserverar sin nya 0600-kvittens före DB-open.
- `otid-speaker-revoke.service.example` är fast och saknar Install-/Restart-
  avsnitt. Den har samma stoppmarkör som webb/migration, separat begäran,
  privat StateDirectory 0700 och `StandardOutput/Error=null`.
- `CI=true pnpm exec tsc --noEmit -p scripts/tsconfig.json`: exit 0.
- Riktad ESLint för ny CLI/test och unitinventering: exit 0.
- Riktad Vitest för ny CLI-hjälplogik och återanvänd privat output: 2 filer,
  7/7 tester, exit 0. Node-test för startgrind/inventering: 5/5, exit 0.
- `sh -n ops/systemd/writer-start.sh`: exit 0. En avsiktlig start utan
  `DATABASE_URL` gav enbart generiskt fel och exit 1, utan DB-anrop.
- Första prov med `tsx`-CLI fastnade i macOS-sandlådans lokala socket
  (`EPERM`, exit 1). Den slutliga Node+`tsx`-importen undviker den vägen.
  Ingen Linux-/systemd-körning, journalinspektion eller PostgreSQL-retry
  har gjorts. Ingen appbuild berörs av detta CLI-/unit-/dokumentsnitt.

Kvarvarande antaganden: en riktig installation kan hålla requestkällan
root-ägd och privat, ge `otid-writer` en separat writer-principal och skapa
StateDirectory som verklig katalog med ägare/mode som outputhjälparen kräver.
`INVOCATION_ID` för den valda systemd-versionen måste kontrolleras i Linux-
acceptansen. En process som redan passerat startgrinden måste fortfarande
dräneras av den saknade controllern.
