# TASK151: ägare delar och återkallar ett events administration

Status: implementerad och riktat syntetiskt verifierad 2026-09-23.
Beslut: ADR-0145. Inte fältverifierad.

## Användarutfall

En inloggad ägare väljer ett av sina event under ”Mina tävlingar”, ger ett
befintligt arrangörskonto `ADMIN`, ser vem som har åtkomst och kan återkalla
den. Medadministratören ser endast det tilldelade eventet och kan öppna dess
befintliga `/manage`-vy för en vanlig raceadministratörsåtgärd. En gammal
session mister rätten vid nästa skyddade request efter återkallelse.

## Ordning och ägda gränser

1. Migration 0078: enum `ADMIN`, bibehållen unik OWNER, historiska återkallade
   ADMIN-grants och en immutable requestjournal. Uppdatera Drizzle-schema,
   migrationsjournal och restore-notering. Ingen gammal grant skrivs om.
2. Strikta GRANT/LIST/REVOKE-kontrakt och applicationtransaktioner. Exakt
   event/ägare/target verifieras server-side; lås event och grants i
   dokumenterad ordning. Mutationsretry är kontobundet och idempotent.
3. Den befintliga konto-enter/list-projektionen och centrala delegeringsauthen
   accepterar aktiv `OWNER|ADMIN`; grantstyrning förblir `OWNER`-only.
4. HTTP-rutter med befintliga kontocookies/Origin/CSRF/no-store; inga nya
   bearerhemligheter i browsern. Svensk kompakt eventbunden UI med
   granskning/återkallelse och synligt okänt commitläge.
5. Riktade kontrakts-/PostgreSQL-/browserprov och berörd lint, typecheck,
   tester, build. Inga breda sviter eller riktiga tävlingsdata.

## Acceptans

- OWNER ger en annan befintlig användare ADMIN på event A. Exakt retry
  skapar ingen ny grant; annan actor/target/event/intent med samma request-id
  ger konflikt. Två samtidiga olika requests ger högst en aktiv grant.
- ADMIN kan efter ny inloggning se A och utföra en vanlig befintlig
  `MANAGE_RACE`-åtgärd i ett av A:s lopp, men kan inte se/öppna event B eller
  hantera kontogrants. Ägaren kan fortfarande administrera A.
- OWNER återkallar exakt ADMIN-grant. Redan utställd race-session nekas vid
  nästa skyddade läsning **och** mutation; historisk grant, revocation och
  actor-audit kan läsas. Legacy racecredential och stations/offlineväg ändras
  inte. En ny begäran kan senare ge ADMIN igen med ny grant-id.
- 390 px-vyn har inga horisontella sidscrolls, minst 44 px tryckytor och
  begripligt tomt/laddande/fel/okänd-commitläge utan färg som enda signal.
  Publik resultatsida fungerar utan konto.

## Ingår inte

Självregistrering, e-post, icke-existerande konton, ägarbyte, roller utöver
ADMIN, nya operativa start-/mål-/stationsroller, nya Eventor-/PM-/kart- eller
ruttbefogenheter, GPS, stafett, SPORTident-hårdvara, produktionsdrift och
automatisk koppling av historiska event.

## Säkra testförutsättningar

Endast uttryckligen isolerad migrerad PostgreSQL/PostGIS med syntetiska
konton/event. `TEST_DATABASE_URL` får aldrig peka på demo, privat eller
verklig tävlingsdata. Kör databaswriters sekventiellt. Ett browserfall ska
prova både tillåten och nekad väg i riktig Next/browser mot samma isolerade
testdatabas; fysisk mobil och fältacceptans redovisas separat.

## Verifieringsrapport 2026-09-23

Migration 0078, strikta kontrakt, atomisk OWNER-styrd tilldelning/återkallelse,
aktiv ADMIN i ”Mina tävlingar”, konto→`MANAGE_RACE` och centralt spärrad gammal
delegation är implementerade. OWNER:s eventkort visar en infällbar kompakt
adminyta; den hämtas först när den öppnas. Ingen historisk grant skrivs om.

Riktade slutkontroller efter sista kod-/teständringen:

- Contracts: 2 filer, 6/6 tester passerade.
- Application/PostgreSQL: TASK151 och TASK150, 2 filer, 6/6 tester passerade.
  TASK151 provar samtidiga GRANT, exakt retry/ändrat intent, eventgräns,
  vanlig adminskrivning, gamla sessioner efter revoke, ny grant-id efter
  återtilldelning, actor-audit och oberoende legacycredential.
- Web: 4 filer, 18/18 tester passerade.
- Next/Playwright: TASK150 och TASK151, 2/2 browserfall passerade mot en ny
  körningsunik migrerad databas och syntetiska konton på loopback: 390 px,
  tilldelning, event-A/B-gräns, `/manage`-skrivning och spärrad skyddad läsning.
- Databas, contracts, application och web: respektive lint, typecheck och
  build gav exit 0. Browserharnessens TypeScript och ESLint gav exit 0.

Första browserförsöket avvisades före teststart eftersom källdatabasens namn
saknade harnessens obligatoriska suffix. Med den befintliga isolerade
`otid_task150_synthetic_v2`-källan passerade slutkörningen 2/2. Efteråt
fanns ingen körningsunik `otid_task150_e2e_...` eller `otid_task151_spec_...`
i testinstansen; PostgreSQL 17-instansen stoppades med datakatalogen bevarad.
En oavsiktlig bred contracts-körning under kontraktsarbetet hade ett annat
fel i `test/entry-transfer.test.ts:31`; det är inte omtestat eller förklarat
av TASK151:s riktade gröna körning.

Kvarvarande antaganden: medadministratören har ett redan betrott provisionerat
konto; varken självregistrering, e-postinbjudan eller kontoåterställning finns.
Browserprovet använder viewportar och syntetiska konton, inte fysisk mobil,
verklig tävling, HTTPS-drift eller fysisk SPORTident. Stations/offlinevägen
ändrades inte och dess fältacceptans återstår.
