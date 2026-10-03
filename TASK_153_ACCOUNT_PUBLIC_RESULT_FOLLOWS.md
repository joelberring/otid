# TASK153: följ offentliga resultat mellan inloggade enheter

Status: syntetiskt verifierad 2026-09-23. Beslut: ADR-0147.
Inte fysisk mobil- eller fältverifierad.

## Användarutfall

En inloggad deltagare följer eller avföljer en offentlig resultatrad i den
befintliga listan och ser samma val efter ny inloggning i en annan browser.
Under ”Mitt resultat” syns följda publika resultat separat från egna
verifierade anmälningar. En anonym besökare kan fortsätta använda dagens
lokala favoriter utan konto.

## Minsta vertikala snitt

1. Additiv migration 0080 och ett immutable, kontobundet följ/avfölj-journal.
   Ingen backfill av `localStorage` eller resultathistorik.
2. Strikta kontrakt samt account-session/CSRF-skyddad applicationoperation
   för exakt retry, avslag vid ändrat intent och privat läsning. Följning av
   nytt mål kräver aktuell offentlig rad; listan hämtar resultatet på nytt
   genom befintlig offentlig V7-projektion vid varje läsning.
3. Använd befintlig favoritknapp i offentlig resultatlista. Utloggad väg
   förblir lokal; inloggad väg sparar på servern. Visa tydligt synkfel och
   låt osäkert svar provas om. Visa kompakt följd-lista på `/me`.
4. Riktade tester i berörda paket, en isolerad PostgreSQL-kontroll och ett
   390 px-browserflöde mot syntetisk databas. Kör lint, typecheck och build
   för berörda paket efter sista kodändring; redovisa exakta resultat.

## Acceptans

- Samma inloggade konto följer en publicerad rad i browser A och ser den i
  browser B efter ny inloggning. Annat konto ser den inte. Avföljning syns
  likadant på båda, även om det offentliga resultatet senare försvunnit.
- Okänt/opublicerat mål kan inte nyföljas. Om en redan följd rad dras tillbaka
  returnerar den skyddade listan `result: null` utan gamla resultatfält; en
  ny publicerad revision blir synlig via samma projektion.
- Exakt request-retry skapar inte extra aktivt läge; ändrad aktör, mål eller
  önskat läge med samma request-id avvisas. Samtidiga kommandon får en
  entydig ordning.
- Utloggades lokala favoriter fungerar före och efter kontoanvändning utan
  att automatiskt importeras, raderas eller exponeras i ett annat konto.
- Vyn är kompakt och tydlig på 390 px, utan horisontell scroll eller
  synkpåstående efter nätfel. Den öppna resultatlistan kräver aldrig login.

## Ingår inte

Ny deltagaridentitet, konto-onboarding/återställning, automatisk import av
gamla favoriter, offlinekö för kontoföljning, privata resultatfält, karta,
GPS, rutt, Eventor-liveanrop, SPORTident, stafett eller ny resultatregel.
Fysisk enhets-/fältverifiering återstår efter syntetiska prov.

## Säker testmiljö

PostgreSQL-provet kräver separat, uttryckligen vald syntetisk migrerad
PostgreSQL/PostGIS med CREATEDB. Testen får inte skriva i demo-/privat-/
tävlingsdatabas. Kör databaswriters sekventiellt. Browsern använder egen port
och separat byggkatalog och testar enbart syntetiska deltagare/resultat.

## Verifierat utfall 2026-09-23

- Riktade tester: databasschema 3/3, kontrakt 3/3, application mot separat
  migrerad syntetisk PostgreSQL 3/3 (inklusive samtidiga kommandon) och
  webbens route-/resultat-UI 13/13.
- Playwright mot riktig Next-server, separat syntetisk PostgreSQL och
  browserkontexter på 390 respektive 1280 px: 1/1 på 16,0 sekunder efter
  sista teständringen. Det provar anonym lokal favorit, inloggad följning,
  återöppning med samma konto på desktopbredd, avslag genom tom lista för
  annat konto, kontobunden avföljning och horisontell overflow.
- Lint, typecheck och build för database, contracts, application och web:
  samtliga exit 0 efter sista produktkodändring. Browserharnessens tsc och
  riktade ESLint: exit 0. Inga körningsunika testdatabaser återstod efter
  slutkörningen; den syntetiska källdatabasen bevarades och testservern stoppades.

Kvarvarande antaganden: konton provisioneras och överlämnas fortfarande
betrott/manuellt; lokal favoritlista importeras avsiktligt inte. `result:null`
prövades med en syntetisk journalpekare till en opublicerad anmälan, inte med
en fullständig produktionsväg för återtagande av ett tidigare publicerat
resultat. Fysisk mobil, faktisk nätförlust och fältbruk är inte verifierade.
