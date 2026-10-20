# Arkitektur

Gäller från steg 23 (ADR-0173). Äldre version: `docs/archive/architecture-2026-10-18.md`.

## Delar

Modulär monolit: en Next.js-app och paket i `packages/*`. PostgreSQL (vanlig `postgres:17`, ingen PostGIS) är enda lagringen.

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
2. Route-lagret läser policyn i `lib/security-policy.ts` (exakt Origin, kontots sessionskaka, CSRF-par,
   begränsad body, privata svar), kontrollerar rollen (`lib/race-roles.ts`, `requireRaceRole`) och validerar
   kroppen med kontraktet.
3. Tjänsten i `packages/application` (`…AsAdmin`) kontrollerar sessionen och rollen igen, låser raderna den
   behöver, räknar med `packages/domain` och skriver i en transaktion: ny rad, ny `result_revision` vid
   resultatpåverkan och en auditpost.
4. Databasen bär sista skyddet: immutabilitetstriggers, check-villkor och unika index.

I arbetsytan (`components/race-administrator/operations.ts`) går ett anrop i taget. En skrivning (ett försök som väntar
på kvitto, eller ett anrop som anges som skrivning) låser bara formuläret som sparas och hindrar andra åtgärder tills den är
klar; en läsning låser inget och avbryts om användaren startar något annat (steg 24). Läsningar som startar av sig själva
(när ett steg visas) väntar tills inget anrop pågår (`operation.current`), så att de inte avbryter varandra. Formulären har `noValidate` och visar
svenska fältfel med `Field error` (`lib/form-validation.ts`); startsättens ord finns bara i `i18n/start-rule-sv.ts`.

Gemensamma hjälpare: UUID-mönstret och idempotensnycklarnas form (`UUID_PATTERN`, `uuidSchema`,
`prefixedUuidPattern`) finns i `contracts/src/ids.ts` (domänen, som saknar beroenden, har sitt `UUID_PATTERN` i
`domain/src/types.ts`); SHA-256 och kanonisk hash i `application/src/serialization.ts` (`sha256Hex`,
`canonicalHash`). Kontonivåns tjänster saknar suffix (`createOrganizerEvent`, `listMyEvents`).

## Behörighet

- En sessionsnivå (steg 23): kontot loggar in med e-post och lösenord (hashat) och får en sessionskaka
  (httpOnly, `Path=/`, SameSite=Strict, 30 dagar) och en CSRF-kaka bunden till sessionen. Det finns inga
  tävlingssessioner, delegationer eller egna kakor per funktion; arbetsytan öppnar en tävling direkt.
- `requireRaceRole(tx, { raceId, sessionToken, csrf…, role, requireCsrf }, now, lock)` i
  `application/src/race-session.ts` är den enda rollkontrollen: rollen på tävlingen kommer från kontots
  behörighet på eventet (`event_administration_grant`). `OWNER`/`ADMIN` ger `ADMIN` (allt), `FUNCTIONARY` ger
  `FUNCTIONARY` (avläsning, direktanmälan, kvar i skogen, start, speaker). Utan behörighet blir svaret
  `unauthorized`, med för låg roll `forbidden`. Skrivningar kräver CSRF-paret och låser behörigheten
  (`update`); läsningar låser delat (`share`) så att en samtidig återkallelse ger `unauthorized`.
- Tabellen över funktionärens rutter finns bara i `lib/race-roles.ts`. Journaler och audit sparar kontot som
  aktör (`actor_account_id`, `actorKind` `USER_ACCOUNT`).
- Superadmin sätts med kommando på servern (`pnpm account:superadmin`).
- Publika sidor och `/api/public/*` läser bara publicerat innehåll och kräver ingen inloggning.
- Live (PLAN.md steg 30, `/t/{kod}/live`, `GET /api/public/races/{id}/live`): `readPublicLive`/`projectPublicLive` i
  `application/src/public-live.ts` projicerar den publika resultatlistan, radiotiderna och när varje resultat kom in (första
  avläsningen) till senast i mål, ledare per klass ("Ny ledare" i 5 min) och radiopassager; inga bricknummer, interna id:n eller
  strukna. Uppdateras som resultatlistan (`lib/use-public-race-data.ts`: resultatströmmen + hämtning var femte sekund). Följda
  löpare och klubbar finns bara i webbläsarens localStorage (`lib/follow-store.ts`).
- Se `docs/security-privacy.md`.

## Var resultatlogiken finns

- Bedömningen av en avläsning: `packages/domain/src/evaluate-card-readout.ts` (regler i `docs/domain-rules.md`).
  Samma funktion körs i avläsningsskalet (preliminärt besked) och på servern (auktoritativt).
- Brickans stämplingar mot banan och tävlingsdagen (deltagarkortet och avläsningens besked, PLAN.md steg 27):
  `packages/domain/src/card-punch-list.ts`; påverkar inte bedömningen.
- Rankning och listor: `class-ranking.ts`, `split-table.ts`, `relay.ts`, `rogaining.ts` i `packages/domain`.
- Lagring: `result_revision` är append-only. Varje ändring av ett resultat (avläsning, beslut, omräkning,
  ändrad tid) lägger till en revision med orsak, motorversion och underlag. Alla skrivställen går genom
  `appendResultRevision` (nästa revisionsnummer, underlagshash, publicering) och, när en avläsning bedöms,
  `evaluateAndStore` i `application/src/result-revisions.ts`. Inget i React, route handlers eller SQL räknar
  resultat.
- Statusbeslut: `setEntryStatus` (`application/src/entry-status.ts`) är det enda flödet för ej start, ej
  fullföljt, disk, utom tävlan, utan tidtagning, godkänt manuellt, ändrad start- och måltid och återtagande.
  Förfrågan bär löparens `expectedRevision`; en annan senaste revision ger konflikt. Historiken är revisionerna.
- Adminåtgärder kontrollerar inte tävlingens version. En inaktuell bedömning syns i stället i löparens
  underlagshash (ADR-0169), som fastställandet kräver är aktuell.

## Avläsning och offline

- Avläsningsskalet byggs separat (`apps/web/scripts/build-shells.mjs`) till `/readout/` med en service worker,
  så att sidan öppnas utan nät.
- Skalet hämtar ett avläsningspaket (tävlingens snapshot med paketversionen `race.snapshot_version`, som bara
  höjs av `bumpReadoutPackageVersion` när paketets innehåll ändras), läser stationen via Web Serial,
  bedömer lokalt och lägger avläsningen i en kö i IndexedDB (`src/readout/store.ts`).
- Kön skickas till `POST …/administrator/readouts` (`application/src/ingest.ts`). Mottagningen är idempotent
  på enhet, löpnummer och hash; samma avläsning två gånger ger samma kvitto. Råa bytes sparas oförändrade.
- En post tas bort ur kön först när servern har kvitterat den. En avläsning som avvisats lokalt (`LOCAL_INVALID`) prövas igen
  när sidan laddas och skickas om den är giltig nu (steg 36).
- Läs om från rådata (PLAN.md steg 36, `application/src/readout-reread.ts`): deltagarens avläsning avkodas på nytt från
  originalets råramar; en ändrad sparas som nytt råmeddelande (`sportident-reread`, pekar på originalet), ny avläsning och
  revision (READOUT_REREAD) för samma deltagare. Originalet ändras aldrig.
- Direktanmälan av okänd bricka på avläsningssidan (PLAN.md steg 25) köas i samma IndexedDB med egen
  idempotensnyckel och bedöms om lokalt. Anmälningar skickas före avläsningarna
  (`POST …/administrator/readout-registrations`, `application/src/readout-registration.ts`); servern kopplar
  en redan mottagen okänd avläsning via bricknumret, och är brickan anmäld någon annanstans gäller den anmälan.
- Löpardatabasen (PLAN.md steg 29, `application/src/runner-database.ts`): en per Eventor-organisation, hämtad med tävlingens
  nyckel (`eventor`: `competitors`, `organisations`, strömmande läsning av stora svar i `eventor/src/stream.ts`) och
  ersatt i en transaktion. Avläsningspaketet har `runnerLookup` (egna och tillagda klubbars löpare, högst 10 000, och
  klubbarna; ingår inte i paketversionen) och `readOutEntryIds`. Vid okänd bricka (`readout/runner-lookup.ts`) fylls
  namn och klubb i ur paketet, klasserna rangordnas med domänens `rankClassesByCourseFit` och anmälda utan bricka eller
  avläsning föreslås; en vald koppling köas som direktanmälan med `target: "EXISTING_ENTRY"` (utfallet `LINKED`).
  Hela landet söks på servern när nätet finns. Mätt: 10 000 löpare ≈ 1,5 MB JSON i paketet.

## Import och källor

- Källor (Inställningar → Källor, `application/src/source-sync*.ts`): Eventor och banfiler (CourseData) med
  förhandsvisning av skillnader innan något sparas.
- Filimport av EntryList, StartList och varianttilldelning: `/admin/[raceId]/imports` (`application/src/import-iof.ts`).
- Export: IOF StartList och ResultList från listorna och "Resultaten är klara"; hela loppet som JSON
  (`application/src/race-export.ts`, format i `docs/export.md`).

## Databas

- Schemat finns i `packages/database/src/schema/*.ts` (samlat i `schema.ts`); migrationerna börjar med
  `0000_baseline.sql` följd av `0001_ett_statusflode`, `0002_en_session` och `0003_paketversion` (steg 23) och
  `0004_tavlingsfunktioner` (steg 25: maxtid, banlängd, Eventor-id, diskorsak, `readout_registration`) och
  `0005_avancerad_lottning` (steg 26: `entry.seed_rank`, `race.start_draw_settings`) och `0006_rattelser_efter_piloten`
  (steg 27: `entry.struck_at`, `race.official_result_finalization_id`), `0007_utan_postgis` (steg 28) och `0008_lopardatabas`
  (steg 29: `runner_database`, `runner_database_competitor`, `runner_database_club`, utfallet `LINKED`).
  Varje schemaändring kräver en ny migration.
- `pnpm db:migrate` committar nya enum-värden först och kör sedan varje migration i en egen transaktion.
- Externa id:n (Eventor, IOF) lagras med källa men är aldrig primärnycklar.
