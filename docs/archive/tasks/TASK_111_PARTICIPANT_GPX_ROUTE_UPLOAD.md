# TASK111: deltagarbunden privat GPX-rutt

Status: påbörjad. ADR-0123 är skriven före produktkod. Parser-, grant-,
lagrings- samt deltagar- och administratörsflödena är implementerade och
riktat verifierade, inklusive ett 390 px-browserprov med syntetiska
HTTP-svar. Verklig objektlagring/MinIO är fortfarande inte verifierad.

## Användarvärde

Efter tävlingen kan en deltagare med en av arrangören utfärdad, race- och
deltagarbunden uppladdningslänk lämna en egen GPX-rutt och se en privat,
verifierad mottagningskvittens. Det är första användbara steget från
resultatrapport till O-Tids egen efteranalys, utan Livelox-data eller konto.

## Avgränsning

- Endast GPX 1.1 med minst två ordnade `trkpt` i `trk`/`trkseg`; `rte` och
  fristående `wpt` är inte en tävlingsrutt i detta snitt.
- En deltagarbunden route-upload-grant utfärdas av en `MANAGE_RACE`-
  administratör och är enda vägen till deltagarens privata upload-/previewyta.
  Den publika resultatlänken är aldrig skrivbehörighet. Utfärdande och explicit
  spärr är båda immutable och idempotenta; högst en ospärrad, ej utgången grant
  får finnas per entry. Administratörens browser skapar själva hemligheten,
  skickar bara SHA-256 och bygger länken lokalt; efter omladdning kan servern
  bara visa metadata och administratören måste spärra/utfärda om länken.
  Granten får gälla högst 30 dagar.
- Uppladdningslänken innehåller en hash-only bearerhemlighet endast vid första
  öppningen. Servern växlar den till kort, host-only session och CSRF-cookie,
  svarar med `no-store`/`Referrer-Policy: no-referrer` och omdirigerar till en
  URL utan hemlighet före filuppladdning.
- Originalets bytes sparas privat och immutable med serverberäknad SHA-256,
  längd och exakt objektversion. Parserutfallet innehåller endast ordnade
  WGS84-punkter, valfri höjd och valfri tid; övriga GPX-fält och extensions
  sparas inte i den normaliserade projektionen.
- En fil får vara högst 8 MiB, innehålla högst 100 000 `trkpt` i högst 2 000
  segment och ha högst 120 tecken i visningsfilnamn. En angiven punkt-tid
  måste vara giltig RFC3339 med UTC-offset; punktordning bevaras och tider
  sorteras eller rättas aldrig automatiskt.
- Samma idempotensnyckel och bytes återger samma routekvittens. Ändrad aktör,
  grant, deltagare eller bytes för samma intent konflikterar.
- Den privata uploadytan tar emot deltagarens valda filnamn och visar en
  minimal kvittens med punkt- och segmentantal samt om filen har tidsstämplar.
  Den visar inte hash, lagringsidentifierare, karta eller punktdata.

## Utanför uppgiften

- OMAP/PDF/SVG/GeoTIFF-rendering, CRS, georeferering, kontrollöverlägg,
  banpåtryck och ruttanalys.
- GPX-ruttplaner, waypoints, FIT, TCX, import från externa konton, live-GPS,
  tidsförskjutning, automatisk start-/målmatchning och fler-ruttuppspelning.
- Deltagarkonto, generell identitetsmodell, ledargrupp, betalning, stafett,
  stationens offlinekö och SPORTident.

## Berörda delar

- `packages/contracts`: strikt GPX-intent, privat DTO och upload-grant-kontrakt.
- `packages/database`: additiva immutable grant-, reservation-, manifest- och
  punktjournaler med rollback-/restore-not.
- `packages/infrastructure`: separat privat ruttobjektadapter; kart- och
  PM-adaptrarna återanvänds inte som generiska fil-API:n.
- `packages/application`: bounded GPX-parsing utanför skrivlås, atomisk
  idempotens och smala privata läsprojektioner.
- `apps/web`: administratörens grant-/spärrflöde och deltagarens privata
  upload/kvittens.

## Acceptans

1. Endast en giltig, begränsad GPX 1.1-track med WGS84-latitud/longitud och
   minst två punkter kan bli lagrad; DOCTYPE/entity, ogiltig UTF-8, fel
   namespace/version, `rte`/ensam `wpt`, för stor fil eller för många punkter
   avvisas före manifest- eller punktskrivning.
2. Originalbytes, hash, längd, parsernamn/version och punktordning är
   immutable. Samma bytes kan inte tyst bytas mot senare normalisering.
3. En grant är hash-only, race-/entry-bunden och tidsbegränsad. Den kan inte
   läsa eller skriva annan deltagare, rådata, bricka eller administrativa
   uppgifter; spärr/utgång stoppar nya requests men ändrar inte lagrad rutt.
   Hemligheten byts före filrequest till kort host-only session med CSRF och
   läcker inte i referer, loggad URL eller browserlagring.
4. Tappat svar efter commit återhämtas med samma idempotensintent och skapar
   varken en andra route, ett andra manifest eller dubbla punkter.
5. Privat route, grant, filnamn, hash, punkt- eller lagringsidentifierare
   finns aldrig i publik resultatlista/detalj eller cache. TASK111 har ingen
   publik rutt-URL eller release.
6. Varken den privata eller publika webben ritar GPS-punkter över TASK106:s
   rasterkarta. En rasterkarta utan CRS får inte utge sig för att vara
   georefererad.

## Verifieringsplan

Fokuserade kontrakts-/parserprov täcker GPX-gränsen, punktordningen, hash och
parserfel. Ett isolerat PostgreSQL/PostGIS-prov täcker grant, grantslista,
exact retry och immutability. Ett 390 px-browserprov med syntetiska
participant-API-svar täcker filval, tappat reservationssvar, samma
idempotensnyckel vid retry, svensk kvittens och frånvaro av interna id:n i
sidan. Bearer-redirecten och objektlagringsadaptern har separata riktade prov.
Ingen fysisk GPS, MinIO, faktisk arrangörskarta eller fältmobil påstås vara
verifierad.

## Källor

- `docs/research/gpx-1-1-2026-09-20.md`
- `docs/map-and-route-model.md`
- `docs/adr/ADR-0120-private-raster-map-release.md`

## Genomfört hittills

`packages/route-xml` innehåller nu en ren, bounded GPX 1.1-parser. Den tar
faktiska UTF-8-bytes, avvisar DTD/DOCTYPE/ENTITY före XML-tolkning, kräver
GPX-namnrymd/version/creator och accepterar enbart `trk`/`trkseg`/`trkpt` med
validerade WGS84-koordinater. Byte-, segment- och punktgränserna är kodade och
punktordning/tid bevaras utan automatisk rättning.

`CI=true pnpm --filter @o-tid/route-xml lint`, `typecheck` och `test` passerar.
Parserprovet har 1 testfil och 7 tester.

`packages/contracts` har även ett strikt privat TASK111-kontrakt för
grantutfärdande/-spärr, GPX-reservation, lagringskvittens och internt
objektmanifest. Bearerhemligheten får aldrig förekomma i svarskontraktet.
Contracts lint/typecheck passerar och det riktade kontraktsprovet passerar 3/3.
Ingen faktisk grant, session eller fil lagras av detta kontraktssteg.

Migration0068 lägger nu till de sju separata, append-only tabellerna för grant,
spärr, kort session, reservation, överföringsförsök, objektmanifest och
punktordning. En grant kan ha högst en reservation och manifestet binds till
exakt privat objektversion. `route_point` har `(upload_id, sequence)` som
immutable ordning; den är inte karta, banmatchning eller resultatdata.

Database lint/typecheck och det riktade schemaprovet passerar; schema-provet har
1 fil och 3 tester. Hela migrationskedjan, inklusive 0068, passerade på en
isolerad lokal PostgreSQL17/PostGIS-instans. En skrivskyddad katalogfråga
bekräftade de sju route-tabellerna och samtliga sju immutability-triggers,
varefter instansen stängdes. Ingen demo- eller tävlingsdatabas användes.

`packages/application` har nu avgränsade `MANAGE_RACE`-funktioner för att
utfärda respektive spärra en hash-only grant. De använder befintlig
CSRF-skyddad administratörssession, låser alltid race före entry, verifierar
högst 30 dagars giltighet, håller högst en aktiv grant per entry under låset
och journalför båda besluten med exakt idempotent retry. Den privata
PostgreSQL-integrationen passerar 2/2 på en ny tom isolerad databas. Bearer-länkens applikationsfunktion finns nu också: den
validerar canonical 32-byte-hemlighet timing-säkert med dummyhash för okänd
grant, skapar en maximalt entimmes hash-only session/CSRF-token och kontrollerar
grantets expiry och spärr vid varje privat request.

Deltagarservicen har nu en separat reservation/attempt/transferkedja med den
privata sessionen som enda auktoritet. Den läser maximalt deklarerade bytes,
kontrollerar SHA-256, kör GPX-parsern före `put`, validerar att lagringssvaret
har exakt race-/attempt-nyckel och sparar sedan manifest samt varje
segment-/punktföljd som immutable rader. Samma reservation efter lagring
återger kvittensen utan ett nytt `put`. En riktad PostgreSQL-test använder en
syntetisk objektport och bevisar grant → länkväxling → reservation →
manifest/punkter → retry → spärr; den passerar 2/2.

`packages/infrastructure` har nu en separat `route-object-store` med prefixet
`route/<race>/<attempt>`, egen `RouteObjectManifest`, private-policy- och
versionskontroll samt read-after-write mot exakt objektversion. Konfigurationen
kommer endast från serverns `OTID_ROUTE_STORE_*`; den kan inte skickas in från
en browser. Adapterprovet passerar 2/2 och webbens fail-closed
konfigurationsprov passerar 2/2. Någon publik read-route finns inte.

`apps/web` har den privata HTTP-gränsen: första bearer-GET skapar host-only
Lax-session och CSRF-cookie, svarar `no-store`/`no-referrer` och gör en 303 till
den tokenfria `/route-upload`. Reservation och byteöverföring kräver alltid
samma origin, CSRF och den HttpOnly-session som JavaScript inte kan läsa.
Den lilla svenska klientkomponenten begränsar filvalet till `.gpx`/8 MiB,
hashar bytes lokalt, reserverar med ett minnesbundet idempotensintent och kan
återförsöka både ett osäkert reservations- och överföringssvar. Den använder
ingen browserlagring och visar varken bearerhemlighet, grant/upload-id eller
objektreferens. Webbens riktade
typecheck/lint passerar; fyra testfiler med sex tester täcker cookie-namnområde,
bearer-redirect/CSRF-gräns, konfigurationsspärr och formulärskal. Det ersätter
inte verifiering mot riktig MinIO.

`/admin/<race>/route-upload` återanvänder endast den befintliga
`MANAGE_RACE`-sessionen. Den läser den privata deltagarlistan och en separat,
hash-fri grantmetadatahistorik, skapar id/32-byte-hemlighet i administratörens
browser och skickar bara SHA-256 till den privata grant-routen. Den färdiga
länken visas endast i operatörens sidminne tills kopiering eller rensning;
efter omladdning kan den inte återskapas. Spärr kräver en kort administrativ
orsak och har ett eget minnesbundet exakt retry-intent. Den nya grantslistan
ingår i samma isolerade PostgreSQL-test (2/2); webbens riktade testsvit är nu
sex filer med åtta tester. Ett separat 390 px-Playwrightfall passerar 1/1
mot riktig lokal Next/browser med syntetiska API-svar: första reservationssvaret
avbryts, andra POST:en måste bära samma idempotensnyckel och den sparade
kvittensen saknar interna identifierare. Ingen grant, länk eller historik
visas publikt.
