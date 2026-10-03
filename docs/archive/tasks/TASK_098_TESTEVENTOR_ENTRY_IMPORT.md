# TASK098: Testeventoranmälningar till förberett individuellt lopp

Påbörjad 2026-09-19. ADR-0114 är skriven före kod.

## Användarvärde

Tävlingsadministratören kan hämta, granska och uttryckligen importera en
deltagarlista från Testeventor till redan förberedda klasser. Det minskar dubbel
registrering utan att röra banor, tider, resultat eller Eventor-nycklar.

## Avgränsning

- Endast individuella entries från Testeventor, för ett lopp som tidigare
  importerats enligt ADR-0046.
- En betrodd, återkallelig race-bunden grant till `IMPORT_IOF` krävs utöver
  anslutningens privata ägarcredential.
- Läs `eventclasses` + `entries`, visa preview och kräv uttrycklig en-till-en-
  klassmappning till befintliga interna Classes.
- Commit skapar bara nya eventoridentifierade entries. Identiska poster lämnas
  oförändrade; minsta avvikelse i befintlig importerbar data ger konflikt.
- Ingen automatisk klassmatchning, klass-/banskapande, avanmälan, bricka,
  starttid, avgift, resultat, publicering eller Eventorskrivning.
- Ingen produktions-Eventor, GPS, karta/rutt, stafett eller riktig USB.

## Acceptans

1. Den separata Eventoradaptern avvisar team, flerklass-entry, saknade
   identiteter samt ogiltig/överskriden XML innan den når applikationslagret.
2. En giltig preview visar källa, hash, klassvis antal och intern
   mappningskandidat utan att skriva race eller Entry.
3. Commit med full explicit mappning skapar rätt antal nya entries, med
   `external_source = 'eventor'`, och ökar snapshot exakt en gång.
4. Identisk retry returnerar samma receipt utan ny nätläsning eller dubblett.
   Förändrad källhash, mapping, actor eller request-id-intent konflikterar.
5. Befintlig lokal rättning, avvikande importerbara fält, bricka, resultat eller
   saknad extern entry skrivs aldrig över eller blir DNS.
6. Obehörig/spärrad grant eller anslutning ger ingen dekryptering och ingen
   write. API-nyckeln finns aldrig i klient, URL, logg eller testfixtur.
7. Riktade adapter-/kontrakts-/PostgreSQL-/browserprov och build passerar mot
   syntetisk upstream. Ett riktigt Testeventorprov redovisas separat och
   påstås inte utan en uttryckligen tillhandahållen privat testmiljö.

## Berörda delar

`packages/eventor`, `packages/contracts`, `packages/database`,
`packages/application`, CLI för grantadministration och `apps/web`.
Domänmotorn, IOF-adapter, station, resultat, ranking, export och publikvy är
utanför uppgiften.

## Utvecklingslogg (historiska delsteg)

Den rena Eventoradaptern har nu en strikt `parseEventorEntryImport` som enbart
projicerar de individuella klass- och deltagarfält som TASK098 behöver. Den
läser inte databas eller lagrar råa Eventorbytes. Den smala servertransporten
läser endast de två fasta Testeventor-resurserna, validerar båda svaren innan
en projektion returneras och ger separata SHA-256-hashar för deras kompletta
bytes. Riktad paketverifiering passerar: lint och typecheck exit 0, `vitest` 1
testfil/16 tester passerar. Endast syntetiska fetch-svar och en testnyckel har
använts. Grant, HTTP, journal, databaswrite och browservy är inte
implementerade ännu och denna delpåvisning utger sig inte för importacceptans.

Grantens första serverdel är nu också implementerad: migration0061 lägger
append-only grant, spärr och importreceipt med främmande nycklar till exakt
tidigare Eventorprovenans och exakt racebunden `IMPORT_IOF`-credential. Den
betrodda CLI:n kan utfärda eller spärra granten utan API-nyckel i argument,
input eller output. Application-/database-lint och typecheck samt CLI:s
TypeScript/ESLint passerar. Ett riktat PostgreSQL-prov är skrivet men inte
exekverat: den nyss startade tomma lokala PostgreSQL-instansen saknade systemets
PostGIS-tillägg och basmigrationen stoppade före testfallet. Ingen extern eller
befintlig databas användes. Själva preview/commit och webbflöde återstår.

Kontraktsdelen är implementerad och riktat verifierad med 3 nya kontraktstester
plus 5 befintliga Eventor-kontraktstester. Preview returnerar bara källklassnamn,
antal, interna klasskandidater och källhashar; den returnerar aldrig deltagarnamn,
klubb, EntryId eller rå XML. Commit kräver
unika explicita klassmappningar, båda källhasharna och sitt eget idempotency-id.
Ingen HTTP-route, fetch via grant eller entry-write är implementerad ännu.

Applikationslagrets läsande preview är nu implementerad men saknar ännu sin
HTTP-route och PostgreSQL-körning. Den autentiserar den racebundna
`IMPORT_IOF`-sessionen, låser granten före dess provenans, kontrollerar grant-,
anslutnings- och ägarspärr både före och efter fetch och öppnar nyckeln först
efter den första kontrollen. Application-/contracts-lint och typecheck passerar;
de nya kontraktsproven passerar 3/3. Atomisk commit och browserroute återstår.

Den skyddade preview-HTTP-routen finns nu på
`/api/admin/races/{raceId}/eventor-entry-import/preview`. Den använder den
befintliga importsessionens Origin-/CSRF-skydd, begränsad JSON-läsning och
privata `no-store`-headers. Web lint/typecheck och routeprovet passerar 2/2.
Det finns ännu ingen browserpanel eller skrivande commitroute.

Commitgrunden använder nu en normativ canonical mapping: mappningar sorteras
på `externalClassId` och SHA-256 beräknas över canonical UTF-8-JSON. Samma
mappning i annan browserordning får därför samma intent-hash. Application lint/
typecheck och det riktade intentprovet passerar 1/1. Den atomiska writerdelen
återstår.

Importjournalen har nu även en unik `intentHash` per lopp. Den omfattar grant,
aktör, båda källhasharna och den canonicaliserade mappningshashen, men inte
request-id:t. Därmed kan writern skilja exakt retry från en oavsiktlig dubbel
commit med nytt request-id. Database/application lint och typecheck passerar;
intentprovet passerar 1/1.

## Aktuellt verifierat läge

Den kompletta smala serverkedjan finns nu: den rena Eventoradaptern läser
endast `eventclasses` och `entries`, avvisar allt utanför den individuella
delmängden och ger separata SHA-256-hashar. Grant, spärr, immutable
importjournal och audit finns i den additiva migration0061. Den betrodda CLI:n
utfärdar eller spärrar grants utan att hantera en API-nyckel i argument, input
eller output.

Preview och commit använder den racebundna `IMPORT_IOF`-sessionen och samma
Origin-/CSRF-skydd som befintlig importadministration. Commit validerar en
canonical explicit klassmappning, läser om båda källdokumenten och skriver i en
transaktion endast saknade `external_source = 'eventor'`-entries, eventuell
snapshotökning, receipt och audit. En exakt retry återspelar receipt utan
nätläsning även om granten därefter spärrats; ny request med samma intent eller
minsta avvikelse ger konflikt. API-nyckel, rå XML och deltagarposter lämnar
aldrig den privata servergränsen.

Skyddade HTTP-routes finns på:

- `POST /api/admin/races/{raceId}/eventor-entry-import/preview`
- `POST /api/admin/races/{raceId}/eventor-entry-import`

Den senare kräver `eventor-entry-import:<uuid>` som idempotency-nyckel och
svarar med en validerad, privat receipt. Importsidan har en liten svensk panel
som tar grantens UUID, visar endast källklassnamn och antal, och kräver att
operatören väljer en komplett unik en-till-en-mappning före commit. Ett osäkert
nätfel behåller samma idempotency-nyckel för retry. Någon browser-E2E mot
PostgreSQL finns ännu inte, så panelen är endast enhets-/byggverifierad.

Riktad verifiering med enbart syntetiska fetch-svar:

- Eventor lint/typecheck: exit 0; adapterprov 1 fil, 16/16.
- Contracts lint/typecheck: exit 0; Eventor-kontraktsprov 2 filer, 8/8.
- Database och application lint/typecheck: exit 0; intentprov 1 fil, 2/2.
- Web lint/typecheck: exit 0; panel- och preview/commit-routeprov 2 filer,
  7/7; produktionsbygge exit 0 (checkin-skal `6d26a06d4199`, 7/7 statiska
  sidor på 53 ms).

TASK098:s namngivna PostgreSQL/PostGIS-prov har därefter körts mot en ny,
isolerad PostgreSQL17-instans på loopback med en syntetisk testdatabas.
`CI=true pnpm --filter @o-tid/application exec vitest run
test/integration/task-006v.test.ts -t TASK098` gav exit 0: 2 passerade, 6
avsiktligt bortvalda i samma fil. Basmigrationen inklusive PostGIS lyckades;
instansen stoppades efteråt och den privata testkatalogen bevarades. Ingen
extern eller befintlig databas och ingen riktig Eventor-/Testeventornyckel
användes.

Den riktade browseracceptansen har också körts mot en separat ny PostgreSQL17/
PostGIS-klunga på loopback. `CI=true pnpm exec tsc --noEmit -p
tests/e2e/tsconfig.eventor.json` och motsvarande riktad ESLint-körning gav
exit 0. `CI=true pnpm exec playwright test tests/e2e/task-006v.spec.ts --grep
TASK098` gav exit 0: 1 passerat fall. Fallet använder riktig lokal Next-server
och PostgreSQL, men ersätter bara de två skyddade entryimport-routes med en
direkt route-dispatch som för in strikt syntetiskt Testeventorunderlag. Det
verifierar importinloggning, personfri preview, D21-mappning, tappat commitsvar
och retry med samma idempotency-nyckel samt exakt en skapad entry. Ingen verklig
Eventor-/Testeventortrafik eller hemlig nyckel förekom.

## Commitsekvens

1. Browsern skickar grant, previewns båda hashvärden och komplett explicit
   mapping med ett nytt idempotency-id.
2. Servern validerar intent och en eventuell redan committad receipt före
   nätläsning. Endast exakt samma actor, grant och canonical intent får
   återspela receipt.
3. För en ny commit kontrolleras granten och provenansen, de två Testeventor-
   dokumenten läses utan databaslås, och deras hashvärden måste vara exakt de
   från intentet.
4. Servern kontrollerar grant/provenans igen, låser loppet, validerar varje
   mapping mot aktuella interna klasser och läser befintliga Eventorentries.
5. Enbart saknade entries infogas. Minsta avvikelse i redan importerbart fält,
   mapping eller deltagartak avbryter hela transaktionen.
6. Journal, audit och eventuellt exakt ett snapshotsteg committas tillsammans
   med entries. Saknade entries i en senare Eventorkälla lämnas orörda.
