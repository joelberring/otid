# TASK244: granska privat lagrad karta före släpp

Status: genomförd 2026-09-27.

## Användarutfall

En tävlingsadministratör kan välja en redan lagrad PNG/JPEG-karta på
`/admin/[raceId]/map` och uttryckligen öppna bilden för granskning
**innan** publicering. Kartan visas i samma kompakta arbetsyta, går att
öppna i full storlek och behåller sin privata status. Ett misslyckat
bildsvar är ett synligt fel, inte ett påstående att kartan saknas.

## Arkitektur- och säkerhetsbeslut före implementation

ADR-0120 och `docs/architecture.md` ger redan `MANAGE_RACE` rätt till
privat granskning; ingen ny ADR, migration, teknik eller domängräns
behövs. En separat privat GET för exakt `raceId` och `uploadId` får
läsa endast ett immutable manifest som hör till samma lopp och en
matchande reservation. Servern validerar session och lopp både före
och efter objektläsning, använder manifestets exakta objektversion och
adapterkontroll av mediatyp, längd, signatur och SHA-256. Ingen
objektnyckel, bucket-URL, version-id eller privat manifestdata lämnar
servern. Svaret är `private, no-store`, `nosniff`, `no-referrer`,
`same-origin` och inte inramningsbart. Saknad/annan tävlings kandidat
ger 404; ogiltig identifierare 400; otillåten session 401/403;
lagringsfel 503 utan delvisa bytes. Återtagande av **publik** karta
stoppar inte behörig privat granskning av originalet.

Klienten hämtar inte alla kartor automatiskt. En explicit
”Granska vald karta”-handling laddar endast den valda kandidaten;
valbyte, omhämtning eller tappad session tömmer den gamla bilden.
Publicering är fortsatt en separat handling med befintlig checkbox.
Svenska status-/feltexter ligger i i18n-filen. Normal sidkrom förblir
neutral, bildens egna färger påverkas inte.

## Riktad acceptans

- Okänd, felaktig eller korsande kandidat kan inte hämta privata bytes.
- Exakt lagrad kandidat läses versions-/hashkontrollerat; session
  återkontrolleras efter läsningen och svaret innehåller inga lagrings-ID.
- Browser med syntetiska API-/bildsvar visar explicit vald bild, valbyte,
  fel och befintlig publiceringsbekräftelse vid 390/1280 px.
- Riktad lint, typecheck, relevant test och build. DB-bunden integration
  körs bara med uttryckligen isolerad PostgreSQL; riktig MinIO/privat
  tävling påstås inte vara prövad annars.

## Ingår inte

Automatisk publicering, OMAP, georeferensändring, GPS, ruttanalys,
nya roller eller publik läsning av opublicerad karta.

## Utfall och kontroll

Den privata `/map/previews/[uploadId]`-vägen kräver en aktuell
`MANAGE_RACE`-session och ett manifest med matchande reservation inom
samma lopp. Lagringsadaptern läser exakt objektversion med hash-,
längd- och formatskontroll; efter läsningen kontrolleras session och
manifest på nytt innan privata bildbytes lämnas ut. Klienten visar
endast uttryckligen vald kandidat, tömmer den vid valbyte/omläsning
och visar textmärkt fel i stället för en falsk tom bild. Publicering
förblir en separat bekräftad skrivning. Ingen migration eller ny ADR
behövdes inom ADR-0120:s befintliga gräns.

Webbens och applications berörda ESLint/TypeScript-kontroller gav
exit 0; E2E-ESLint/TypeScript gav exit 0. Riktade Vitest-prov passerade
6/6 (3 HTTP-gräns, 3 befintlig kart-UI). Riktig Next-/Chromium-sida
med syntetiska API-/bildsvar passerade 4/4 för TASK242+244 och 1/1
vid omkörning av TASK244 efter sista textändringen. 390/1280 px och
fel/success-status granskades visuellt. Checkin-förberedelse och
Next-produktionsbuild gav exit 0. En första blandad ESLint-invokation
med E2E-tsconfig för webbfiler gav konfigurationsfel; den rättade,
uppdelade lintkörningen gav exit 0.

Databasbunden TASK106-integration kördes inte: `TEST_DATABASE_URL`
saknas för en uttryckligen isolerad PostgreSQL. Ingen riktig MinIO,
privat tävling, produktionssession eller kartbild i fält prövades;
browserfixturens PNG är 1×1 pixel och visar placering, inte
kartläsbarhet.
