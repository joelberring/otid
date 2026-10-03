# TASK135: avkortad bana som separat kortklass

## Status

Slutförd och riktat verifierad 2026-09-22. ADR-0139 accepterades före produktkod. Kontrakt,
additiv migration, application-writer, resultatläsare och svensk
administratörsvy är implementerade. Resultatläsaren räknar dessutom om
SHA-256 för hela den kanoniska frysta journalgrunden före den litar på dess
lagrade hash. Verifieringen kördes enbart mot en ny syntetisk, isolerad
PostgreSQL17/PostGIS-databas och lokal Next/HTTP.

## Användarvärde

Tävlingsadministratören kan vid en operativ avkortning flytta exakt utvalda
deltagare till en tydligt namngiven kortklass med egen kortbana. En löpare som
redan har läst ut ett tekniskt `MP` kan få samma bevarade brickavläsning
utvärderad mot den uttryckliga kortbanan. Lång- och kortbana får aldrig ge en
gemensam eller missvisande resultatordning.

## Avgränsning

- En aktuell race-scopad klass, ett strikt icke-tomt prefix av dess aktuella
  kontrollföljd och högst 100 explicit valda Entries.
- Ny lokal Course/version 1/Class med unika namn och samma `PUNCH`/`FIXED`-
  regel som källklassen. Ingen extern identitet eller direktanmälan.
- Valda entries utan någon resultatrevision flyttas. Enbart aktuell `CARD_READOUT`-orsakad `MP` med
  bevarad exact `readoutId` får omvärderas; `OK`, manuella beslut, saknad eller
  nyare grund avvisas före write. Omvärderad revision blir publicerad atomiskt;
  en resultatlös flytt får ingen fabricerad status och blockerar därför ny
  Complete-finalisering tills verkligt resultat eller separat beslut finns.
- Ny Course/Class, entry-flyttar, eventuella nya revisioner, immutable
  header/items-journal, audit och exakt en snapshotsökning görs atomiskt.
- Inga förändringar av rawdata, CardReadout, aktiv brickkoppling, tidigare
  revisioner, äldre finaliseringar, mappar/rutter, Eventor, GPS, stafett eller
  riktig USB.

## Acceptans

1. Preview visar källklass/-bana, kort prefix, högst 100 explicit valda
   entries bland kvalificerade kandidater och varje entries verkliga effekt: endast flytt eller flytt plus ny
   omvärdering. Ingen preview skriver.
2. Commit skapar exakt en ny lokal kortbana/version/klass med oförändrad
   startregel och flyttar exakt de hashbundna entries atomiskt. Lång- och
   kortklass rankas, visas och exporteras separat genom befintliga class-
   gränser; den lokala kortklassen får inget fabricerat IOF-id.
3. En valbar teknisk `MP` blir endast den utvärdering som bevarad readout och
   kortbana faktiskt ger. En `OK`, manuellt beslut, stale snapshot/entry/result
   eller ändrad prefix/name/actor ger konflikt utan delwrite.
4. Samma request-id återger samma receipt; annat intent/actor/scope eller
   parallell ingest/omräkning före commit ger konflikt. Journal, rådata,
   historiska revisioner och äldre Complete-bytes är immutable. En publicerad
   kortbaneomvärdering valideras från sin reciproka journal i publik vy, export,
   speaker och ny finalisering.
5. `/manage` visar en svensk tvåstegsgranskning med källklass, nya namn,
   kortad kontrollföljd och deltagare. Tappat svar återförsöks med samma intent
   och 390 px ger ingen horisontell sidscroll.

## Berörda delar

`domain` återanvänder sin rena utvärdering; `contracts`, `database`,
`application` och `web` får den nya avgränsade beslutskedjan. Stationens
transport/protokoll, Eventor, kart-/ruttlager och offentlig resultatranking
får inte få separat speciallogik.

## Proportionell verifiering

1. Befintlig ren resultatmotor används för samma readout mot lång/kort
   kontrollprefix och separata klassrankningar; ingen ny domänvariant byggs.
2. Kontraktsprov och ett rent application-prov som avvisar ändrad fryst
   journalgrund bakom gammal hash, samt ett isolerat PostgreSQL/PostGIS-fall
   för atomisk commit, exakt replay, stale konflikt, historik, korrekt separat
   Snapshot-export, Complete-spärr för resultatlös flytt, bevarad `FIXED`-
   starttid och omvärderad `MP`.
3. Ett riktat routefall samt ett 390 px Playwright-flöde med preview, tappat
   commitsvar och retry. Browserfallet använder samma isolerade adminmiljö
   som den etablerade klassadministrationen.

### Utfört 2026-09-22

- En ny, isolerad PostgreSQL17/PostGIS-databas migrerades med `pnpm db:migrate`
  (exit 0). Ingen demo-, privat eller verklig tävlingsdatabas kontaktades.
- Kontraktsprovet passerade 3/3, provenance-provet 1/1 och den riktade
  PostgreSQL-integrationen 3/3. Integrationen bevisar atomisk `MP`-flytt,
  resultatlös flytt med Complete-spärr, stale-konflikt, exakt retry och
  bevarad `FIXED`-starttid.
- Webbruttens prov passerade 37/37. E2E TypeScript och ESLint passerade, och
  Playwright-fallet passerade 1/1 på 6,1 sekunder med riktig lokal Next/HTTP,
  tappat commitsvar, exakt retry och 390-pixelvy utan sidscroll.
- Berörd database-, application- och weblint/typecheck samt application- och
  webbuild passerade (alla exit 0). Den riktade databaskörningen hittade en
  implementationsbugg där tomma namnuppslag behandlades som konflikt; den
  rättades till kontroll av faktiskt antal träffar. Ingen arkitektur- eller
  domänregel ändrades.
4. Lint, typecheck och build för berörda paket. Ingen bred regression eller
   hårdvaru-/Eventor-liveprov.

## Migrations- och återställningsnot

Additiv migration med immutable journal och ny revisionsproveniens. Vid fel
stängs writer/UI och rättas framåt; ingen CourseVersion, klass, entryhistoria
eller resultatrevision raderas. Full restore är fortsatt skild från denna
uppgift enligt ADR-0115.

Migrationen utökar revisionens enum, contract- och proveniensunioner samt
lägger nullable provenance + immutable header/items med reciproka constraints.
Exact replay binder actor, source, prefix, namn, sorterad entrygrund, skapade
id:n och publiceringsresultat. Race, valda entries och deras resultathuvuden
låses före commit.

## Kvarvarande designgränser

- Detta är en separat kortklass, inte individuell eller blandad banvariant.
- Återtagande, flera kortvarianter, kartgeometri/publik rutt och Eventor-
  uppdatering behöver egna beslut.
- Kortklassen publiceras inte i startlistan förrän administratören uttryckligen
  publicerar en ny fryst lista.
