# TASK277: isolerat prov av ägare → konto → separat eventgrant

Status: genomförd och isolerat verifierad 2026-09-29.

## Mål och gräns

Verifiera att TASK275–276:s sammanhängande arrangörsväg fungerar genom
verklig HTTP och PostgreSQL 17/PostGIS: OWNER skapar event och
kontoinbjudan, mottagaren aktiverar endast konto, får inte eventåtkomst,
och OWNER granskar först därefter en separat ADMIN-grant.

Återanvänd TASK160:s befintliga isolerade browserharness. Ändra bara dess
UI-steg för den nya underpanelen och ”Granska eventåtkomst”; ingen ny API,
schema, credentialmodell eller domänregel. ADR-0153/0145 gäller oförändrat.

## Säker körmiljö

- Starta en ny temporär PostgreSQL 17/PostGIS-instans i en namngiven privat
  katalog under `/private/tmp`, bunden endast till `127.0.0.1` på en ledig
  testport. Använd inga `.env.local`-värden, demo- eller tävlingsdata.
- Skapa exakt den tomma syntetiska källbasen `otid_task160_test`, migrera
  den och verifiera version, PostGIS, databasnamn och CREATEDB innan provet.
  Sätt `TEST_DATABASE_URL` uttryckligen bara för provkommandot.
- TASK160-harnessen skapar en unik underdatabas och privat tempkatalog.
  Efter provet: kontrollera teardown, stoppa den egna servern och bevara
  eller exakt identifiera eventuella rester; ingen bred radering.

## Acceptans

- Befintligt browserfall öppnar kontoinbjudan, gör issue/activation, visar
  att mottagaren saknar event och att race-enter nekas före grant.
- En `REDEEMED`-rad erbjuder ”Granska eventåtkomst”. Klicket förifyller
  exakt loginName, fokuserar granskningen och skickar ingen grant-POST.
  Först ett separat knappval får 201 från den befintliga grant-rutten;
  raden visar sedan aktiv eventåtkomst och mottagaren kan öppna eventet.
- Kör endast E2E-TypeScript/ESLint och detta enda riktiga browserfall,
  plus web lint/typecheck/build om produktkod måste ändras. Redovisa
  exakt utfall och eventuella rester. Fysisk mobil och verklig privat
  kodöverlämning påstås inte verifierade.

## Ingår inte

Verklig tävling, Eventor, andra konton, e-post/SMS, GPS, SPORTident,
produktionsdrift eller en bred databastestsvit.

## Utfall och exakt verifiering

Det befintliga TASK160-browserfallet öppnar nu den inlösta inbjudningens
”Granska eventåtkomst”, kontrollerar exakt förifyllt login och fokus på
granskning samt räknar noll grant-POST före ett separat knappval. Efter
OWNER:s explicita POST kontrolleras 201, exakt ett anrop, läsbar status
”Eventåtkomst aktiv” och att mottagaren först då får öppna arbetsytan.
Före grant saknar mottagaren eventet och race-enter svarar 404.

En ny privat temporär PostgreSQL-instans skapades under
`/private/tmp/otid-task277-pg17.SqxumYWS` på enbart loopbackport 55460.
Källbasen var exakt `otid_task160_test`: PostgreSQL 17.11, PostGIS 3.6.4,
`CREATEDB` för testrollen och 85 applicerade migrationer. Inga befintliga
`.env.local`-värden eller verkliga data användes. Den unika underdatabasen
skapades och togs bort av harnessen. Efter provet fanns endast källbasen
och PostgreSQL:s standardbaser; källbasen hade 0 rader i
`event_account_invitation_issue`. Den temporära servern stoppades med
`pg_ctl stop -m fast`. Den privata katalogen och syntetiska källbasen
bevaras i stoppat tillstånd; ingen bred radering gjordes.

| Kontroll | Resultat |
| --- | --- |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task160-organizer.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-160-owner-account-invitation.spec.ts tests/e2e/playwright.task160-organizer.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.task160-organizer.json"}'` | exit 0 |
| `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55460/otid_task160_test pnpm exec playwright test --config tests/e2e/playwright.task160-organizer.config.ts` | exit 0, 1/1 Chromiumfall (11,8 s) |

En första sandboxad `initdb` avvisades av macOS delat minne
(`shmget: Operation not permitted`, exit 1) och tog själv bort den
ofullständiga datakatalogen. Samma nya katalog initierades därefter med
lokal processbehörighet, exit 0. Ingen alternativ befintlig databas valdes.

## Kvarvarande antaganden

- Provet använde syntetisk kodöverlämning mellan två browserkontexter,
  inte en riktig privat kanal eller en fysisk mobil. 390 px och frånvaro
  av horisontellt spill är browserbevis, inte regn-/handsk-/fältacceptans.
- Kontoaktivering verifierar inte mottagarens verkliga identitet; OWNER
  måste fortfarande granska mottagaren utanför systemet före grant.
- En enda sekventiell körning bevisar inte samtidiga inbjudningar,
  nätavbrott eller produktionsdrift. Serverns separata auktorisationsgräns
  förblir avgörande även om UI-listor blir gamla.

Nästa minsta vertikala uppgift: ett kort funktionärsprov på fysisk mobil
av just inbjudan→aktivering→manuell grant; rätta endast första konkreta
begriplighets- eller fokusproblemet som det visar.
