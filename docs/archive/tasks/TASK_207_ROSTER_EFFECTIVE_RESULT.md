# TASK207: gällande resultat direkt i deltagartabellen

Status: implementerat och riktat verifierat 2026-09-27; PostgreSQL-acceptans återstår.

## Operatörsutfall

Administratören ska kunna se namn/klubb, klass, gällande resultatstatus och
eventuell löptid, bricka och start i samma sökbara deltagartabell. Text ska
skilja mellan inget publicerat resultat, återtaget/inget aktivt resultat,
aktuellt resultat och resultat från äldre tävlingsunderlag. Personpanelen
fortsätter visa orsaker, kontrolltider och rättningsåtgärder. Inget på denna
tabellrad räknar om eller publicerar ett resultat.

## Avgränsning och dataväg

Utöka den befintliga privata `MANAGE_RACE`-rosterläsningen med en kompakt
effektiv-resultatprojektion från samma bulkresolver och repeatable-read-
snapshot som redan bestämmer `resultFreshness`. Återanvänd den strikta
lagrade-resultatparsern och speakerresultatets status/tid-kontrakt. Ingen
N+1-läsning via personroute, ny mutation, migration, offentlig API-yta,
automatisk omräkning eller ny resultatregel. Bumpa endast kandidat-*svarets*
formatVersion till 2 eftersom varje rad får ett obligatoriskt fält; befintliga
skrivkontrakt för klassbyte behåller version 1. Se ADR-0163.

På större skärm används en femte kompakt Resultat-kolumn. Mobil får en tät
tvåkolumnig rad med alla uppgifter utan horisontellt sidspill. Ingen ny
kortomramning, dekorativ ikon, global typografi eller fast toppyta.

## Proportionerlig verifiering

Riktade kontraktstester för de tre resultattillstånden, tidens giltighet och
snapshot-kopplingen; riktad serverintegration endast mot uttryckligen
isolerad PostgreSQL/PostGIS; ett befintligt syntetiskt browserfall vid
390/900/1280 px för innehåll och layout. Paketens lint/typecheck och web
build. Ingen verklig tävling, Eventornyckel eller bred testsuite.

## Utfall och kvarvarande antaganden

Kandidat-*svaret* är nu version 2 och ger varje deltagare ett diskriminerat
effektivt resultat. Servern använder redan vald publicerad revision,
bulkresolvern och den strikta parsern i samma repeatable-read-läsning. Ett
aktivt resultat visar svensk status och endast en av kontraktet tillåten
löptid; äldre underlag visas uttryckligen. Ingen aktiv/publicerad revision
visas utan fabricerad tid eller status. Resultatkolumnen ligger mellan klass
och bricka på dator/padda. Mobilen visar namn samt klass/resultat och
bricka/start i en tvåkolumnig tabellrad utan ny omramning. Orsak,
kontrollföljd och beslut ligger kvar i personkortet.

Riktade kontroller: kontraktstest **4/4**, webbenhetstest **5/5** och det
befintliga syntetiska browserfallet **1/1** vid 390, 900 och 1280 px;
samtliga **exit 0**. Browsern verifierade status/tid/äldre- och
ingen-resultat-texter, befintlig person-/startkoppling och inget horisontellt
sidspill. Mobil-, padd- och datorbilder granskades. Contracts, application
och web lint/typecheck samt browser-TypeScript/ESLint gav **exit 0**.
Contracts/application/web build gav **exit 0**. Första browserstarten
nekades av sandboxens loopbackspärr (**exit 1, EPERM**); omkörningen med
lokal behörighet passerade.

Den utökade PostgreSQL-integrationen är skriven men **inte körd**:
`TEST_DATABASE_URL` är inte satt, ingen lokal server svarar på 5432 och
PostGIS-extension finns inte i den lokala PostgreSQL-installationen.
Antaganden kvar: bulkprojektionen håller samma valda/effektiva revisioner
som detaljläsningen för riktiga resultathistoriker; stor roster (~10 000)
och långa verkliga namn/statusar har inte fältaccepterats. Skärmläsare,
stark textzoom och fysisk mobil/padda återstår också.
