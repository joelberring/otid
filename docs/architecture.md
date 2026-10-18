# Arkitektur

Gäller från steg 23 (ADR-0173). Äldre version: `docs/archive/architecture-2026-10-18.md`.

## Delar

Modulär monolit: en Next.js-app och paket i `packages/*`. PostgreSQL/PostGIS är enda lagringen.

| Del | Ansvar |
| --- | --- |
| `apps/web` | Next.js: sidor, HTTP-API (`src/app/api`), adminarbetsytan, publika sidor, avläsningsskalet (`src/readout`) och radiopollern (`src/instrumentation.ts`). |
| `apps/si-tools` | CLI: portlista, rå capture och replay mot SPORTident-station. |
| `packages/domain` | Ren resultatlogik utan I/O: bedömning av bricka, rankning, lottning, gafflingar, stafett, rogaining, status. |
| `packages/sportident` | Ren protokolltolkning: ramar, CRC, brickavkodning. |
| `packages/device-transport` | Bytetransport (Web Serial, falsk station), capture och replay. |
| `packages/application` | Användningsfall: transaktioner, behörighetskontroll, revisioner, audit. |
| `packages/contracts` | Zod-scheman för HTTP-kontrakten (in- och utdata). |
| `packages/database` | Drizzle-schema, en baslinjemigration och `migrate`. |
| `packages/iof-xml` | IOF XML 3.0 (CourseData, EntryList, StartList, ResultList) och GPX-spår. |
| `packages/eventor`, `packages/roc` | Klienter för Eventor och ROC/OResults (radiokontroller). |

Beroenderiktning: `apps/web` → `application` → `domain`, `database`, `contracts`, `iof-xml`, `eventor`, `roc`.
`domain` och `sportident` beror inte på något annat paket i repot.

## Lager i en adminåtgärd

1. `apps/web/src/app/api/admin/races/[raceId]/administrator/<åtgärd>/route.ts` skickar vidare till
   `lib/race-administrator-route-handlers.ts`, som delar upp på `lib/race-administrator-routes-*.ts`.
2. Route-lagret kontrollerar Origin, cookie och roll (`lib/race-roles.ts`, `requireRaceRole`) och validerar
   kroppen med kontraktet.
3. Tjänsten i `packages/application` (`…AsAdmin`) kontrollerar sessionen och rollen igen, låser raderna den
   behöver, räknar med `packages/domain` och skriver i en transaktion: ny rad, ny `result_revision` vid
   resultatpåverkan och en auditpost.
4. Databasen bär sista skyddet: immutabilitetstriggers, check-villkor och unika index.

## Behörighet

- Kontot loggar in med e-post och lösenord (hashat). Sessionen är en httpOnly, SameSite=Lax-cookie.
- När ett konto öppnar en tävling skapas en tävlingssession med rollen från eventet: `OWNER`/`ADMIN` ger
  `MANAGE_RACE` (allt), `FUNCTIONARY` ger `RACE_FUNCTIONARY` (avläsning, direktanmälan, kvar i skogen, start,
  speaker). Tabellen över funktionärens åtgärder finns bara i `lib/race-roles.ts`.
- Superadmin sätts med kommando på servern (`pnpm account:superadmin`).
- Publika sidor och `/api/public/*` läser bara publicerat innehåll och kräver ingen inloggning.
- Se `docs/security-privacy.md`.

## Var resultatlogiken finns

- Bedömningen av en avläsning: `packages/domain/src/evaluate-card-readout.ts` (regler i `docs/domain-rules.md`).
  Samma funktion körs i avläsningsskalet (preliminärt besked) och på servern (auktoritativt).
- Rankning och listor: `class-ranking.ts`, `split-table.ts`, `relay.ts`, `rogaining.ts` i `packages/domain`.
- Lagring: `result_revision` är append-only. Varje ändring av ett resultat (avläsning, beslut, omräkning,
  ändrad tid) lägger till en revision med orsak, motorversion och underlag. Inget i React, route handlers
  eller SQL räknar resultat.

## Avläsning och offline

- Avläsningsskalet byggs separat (`apps/web/scripts/build-shells.mjs`) till `/readout/` med en service worker,
  så att sidan öppnas utan nät.
- Skalet hämtar ett avläsningspaket (tävlingens snapshot med version), läser stationen via Web Serial,
  bedömer lokalt och lägger avläsningen i en kö i IndexedDB (`src/readout/store.ts`).
- Kön skickas till `POST …/administrator/readouts` (`application/src/ingest.ts`). Mottagningen är idempotent
  på enhet, löpnummer och hash; samma avläsning två gånger ger samma kvitto. Råa bytes sparas oförändrade.
- En post tas bort ur kön först när servern har kvitterat den.

## Import och källor

- Källor (Inställningar → Källor, `application/src/source-sync*.ts`): Eventor och banfiler (CourseData) med
  förhandsvisning av skillnader innan något sparas.
- Filimport av EntryList, StartList och varianttilldelning: `/admin/[raceId]/imports` (`application/src/import-iof.ts`).
- Export: IOF StartList och ResultList från listorna och fastställandet.

## Databas

- Schemat finns i `packages/database/src/schema.ts`; migrationerna börjar med `0000_baseline.sql` (steg 23).
  Varje schemaändring kräver en ny migration.
- `pnpm db:migrate` committar nya enum-värden först och kör sedan varje migration i en egen transaktion.
- Externa id:n (Eventor, IOF) lagras med källa men är aldrig primärnycklar.
