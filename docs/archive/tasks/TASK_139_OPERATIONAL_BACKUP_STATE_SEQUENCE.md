# TASK139: fail-closed återhämtningsstatus i backupordningen

Status: slutförd och riktat verifierad 2026-09-22.

## Syfte

Göra ADR-0140:s krav på en beständig, privat operation-status möjlig att
använda rätt i den redan rena backupordningen: ett processavbrott får aldrig
leda till att en replikationsregel kan finnas utan att en senare privat
recovery-adapter kan se vilket cleanup-läge som krävs.

## Arkitekturbeslut

Ingen ny ADR behövs. TASK139 verkställer ADR-0140:s redan accepterade
operation-state-krav. ADR:n förtydligas endast för första dumpsteget: före
dumpen finns ännu inget manifesthash, så den första strikta statusen har
`DUMP_PENDING` och uttryckligen `manifestSha256: null`. Alla senare steg
kräver det exakta canonicala manifesthash som källpreflighten just bevisat.

## Avgränsning

- `contracts` får ett strikt, canonicaliserbart och hemlighetsfritt
  operation-state-kontrakt med backup-id, fas, manifesthash eller den enda
  tillåtna pre-manifest-null, och deduplicerade/sorterade logiska `storeId`:n.
- `application` kräver en injicerad state-port och skriver nästa status före
  dump, målpreparering, möjlig replikering och cleanup, samt en slutlig
  `CLEANUP_VERIFIED` först efter lyckad regelrensning.
- Om state-porten inte kan kvittera avbryts backupen fail-closed. Vid fel medan
  en regel kan finnas försöker application fortfarande cleanup innan den
  återger fel och utfärdar aldrig kvittens.
- Ingen filesystemadapter, CLI, dump, PostgreSQL-, MinIO- eller `mc`-anrop
  byggs här. Nästa privata infrastructure-adapter måste skriva/uppdatera den
  faktiska 0600-filen och kan återuppta cleanup från samma kontrakt.

## Acceptans

1. `DUMP_PENDING` är den enda status utan manifesthash och kan sparas innan
   `createPostgresDump`; ett portfel där gör att dumpen aldrig anropas.
2. Efter källpreflight har varje status exakt samma canonicala manifesthash
   och stabila unika `storeId`:n som manifestet.
3. `REPLICATION_MAY_EXIST` sparas innan replikeringen startas och
   `CLEANUP_REQUIRED` sparas innan regelrensningen anropas.
4. Efter lyckad regelrensning sparas `CLEANUP_VERIFIED` före backupkvittens.
   Fel i denna skrivning ger ingen kvittens.
5. Ett statefel efter eventuell replikering kan aldrig hoppa över det
   befintliga cleanup-försöket. Ingen fas, portfel eller testdiagnostik bär
   credential, endpoint, target-ARN eller PM-nyckel.

## Proportionell verifiering

- Kontraktsprov för stricthet, den enda tillåtna null-hashen, canonical
  storeordning och avvisning av hemliga/otillåtna fält.
- Applicationprov för fasordning, fail-closed före dump, cleanup efter ett
  sent statefel och utebliven kvittens före `CLEANUP_VERIFIED`.
- Berörd contracts/application lint, typecheck och build med `CI=true`.
- Ingen databas, objektlagring, binär, credential, browser eller
  integrationstest används: operation-state-porten ersätts av minnesdubblar.

## Utanför uppgiften

TASK139 bevisar inte att en fil verkligen skrivs med mode 0600, att recovery
kan köra `mc`, att targetmiljön är tom eller att dump/restore fungerar. Det
kringgå inte heller TASK137:s kvarvarande opt-in-bevis för den exakta pinnade
MinIO-/mc-kombinationen.

## Utfört 2026-09-22

`OperationalBackupOperationState` är nu ett strict, canonicaliserbart kontrakt
med endast fem tillåtna faser. Endast `DUMP_PENDING` tillåter en null-hash och
tomt logiskt storeunderlag; efter källpreflight binds alla senare faser till
samma manifesthash och sorterade unika `storeId`:n. Extra fält som endpoint
eller target-ARN avvisas.

`captureOperationalBackup` kräver nu att en injicerad state-port bekräftar
`DUMP_PENDING` före dumpen, `TARGET_PREPARATION_PENDING` före målpreparering,
`REPLICATION_MAY_EXIST` före regelstart och `CLEANUP_REQUIRED` före cleanup.
Den skriver `CLEANUP_VERIFIED` först efter lyckad cleanup och först därefter
kan den ge en kvittens. Ett sent statefel startar inte om eller kringgår
cleanup; statefel eller cleanupfel lämnar ingen kvittens.

Riktad verifiering:

- `CI=true pnpm --filter @o-tid/contracts exec vitest run
  test/operational-backup-manifest.test.ts`: exit 0, 1 fil / 5 tester.
- `CI=true pnpm --filter @o-tid/application exec vitest run
  test/operational-backup-capture.test.ts
  test/operational-backup-source-preflight.test.ts
  test/operational-restore-verification.test.ts`: exit 0, 3 filer / 9 tester.
- Contracts och application lint, typecheck och build: samtliga exit 0.

Proven använder endast minnesportar. Den fysiska 0600-filen, recovery-CLI:n,
den pinnade MinIO-/mc-körningen och dump/restore är fortsatt separata,
okompletta delar av TASK099.
