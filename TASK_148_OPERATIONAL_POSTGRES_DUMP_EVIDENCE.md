# TASK148: privat PostgreSQL-dumpbevis utan dumpkörning

Status: genomförd och riktat verifierad 2026-09-22.

## Syfte

Tillhandahåll den minsta infrastrukturgränsen som kan mäta och SHA-256-hasha
en redan given privat PostgreSQL/PostGIS-dumpström till TASK099:s befintliga
`identity`/`sha256`/`byteLength`-bevis. Den ska kunna användas av en framtida
betrodd dumpworker, men väljer aldrig fil, sökväg, databas eller kommando.

ADR-0140 kräver redan att just detta bevis binds före source-preflight. Ingen
ny ADR behövs eftersom snittet inte väljer dumpteknik, filsystempolicy eller
driftmodell.

## Ägda lager

- `packages/infrastructure/src/operational-backup-dump.ts`: läsande
  streamadapter och hemlighetsfritt fel.
- `packages/infrastructure/src/index.ts`: export av adaptern.
- `packages/infrastructure/test/operational-backup-dump.test.ts`: riktade
  syntetiska strömfall.

## Acceptans

1. En giltig byte-ström med godtyckliga chunkgränser ger exakt befintligt
   dumpbevis med uppmätt längd och SHA-256.
2. Fel väntad hash eller längd, tom ström, ogiltigt chunkvärde eller fel från
   källströmmen avvisas med ett enda hemlighetsfritt fel.
3. Adaptern tar ingen filväg, öppnar ingen fil, kör ingen process, skapar ingen
   dump och ansluter inte till PostgreSQL eller MinIO.

## Utanför uppgiften

`pg_dump`, fil-/katalogreservation, credentials, dumpförvaring, manifestskrivning,
source-preflight, MinIO, `mc`, restore, migration, databas- eller objektwrite,
GPS, karta/rutt, stafett, SPORTident och USB ingår inte.

## Verifiering

Följande riktade kontroller passerade med exitkod 0:

- `CI=true pnpm --filter @o-tid/contracts lint`
- `CI=true pnpm --filter @o-tid/contracts typecheck`
- `CI=true pnpm --filter @o-tid/infrastructure lint`
- `CI=true pnpm --filter @o-tid/infrastructure typecheck`
- `CI=true pnpm --filter @o-tid/infrastructure exec vitest run test/operational-backup-dump.test.ts`
  (1 fil, 3 tester)
- `CI=true pnpm --filter @o-tid/infrastructure build`

Enbart minnesbaserade syntetiska byte-strömmar användes. Ingen dump skapades,
ingen privat fil lästes och ingen tjänstkontakt eller databasanslutning gjordes.
