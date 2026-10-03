# ADR-0123: deltagarbunden privat GPX-ruttuppladdning

- Status: Accepterad, implementerad i TASK111–113; lokal verklig MinIO-acceptans verifierad
- Datum: 2026-09-20

## Kontext

Den publika deltagarrapporten har resultat, sträcktider och, efter TASK106,
en explicit publicerad rasterkarta. Den är med avsikt en anonym läsyta:
`publicResultId` är en stabil visningsidentitet, inte en behörighet. Att låta
den länken skriva en GPS-rutt skulle göra en gissbar/delbar resultat-URL till
en deltagaridentitet och skrivcredential.

Projektets kartmodell anger samtidigt att GPS-rutter är privata tills en
uttrycklig publiceringsregel finns. TASK106:s kartasset- och PM-flöden är
separata, formatbundna objektgränser. De får inte vidgas till ett oavsiktligt
generellt filuppladdnings-API.

## Beslut

TASK111 inför en egen, smal route-gräns. En `MANAGE_RACE`-administratör kan
utfärda en tidsbegränsad, hash-only route-upload-grant för exakt en race-scopad
entry. Den resulterande hemliga länken är den enda deltagarvägen till en privat
upload-/previewyta. Grantet ger inte administratörsrätt, resultat-, brick- eller
rådataåtkomst och ersätter inte en framtida deltagaridentitet.

Administratörens browser skapar grant-id och 32-byte bearerhemlighet, skickar
endast secretens SHA-256 tillsammans med immutable request-id, och konstruerar
själv uppladdningslänken. Exakt retry kräver samma browserminne och återger
samma metadata, aldrig hemligheten. Efter omladdning kan servern bara visa
icke-hemlig grantmetadata; operatören spärrar då den gamla och utfärdar en ny
länk vid behov. Högst en ospärrad, ej utgången grant får finnas för en entry.
En grant får gälla högst 30 dagar från utfärdandet. En separat immutable
`route_upload_grant_revocation` spärrar den före utgång utan att mutera
utfärdandet. Grantets 32-byte bearerhemlighet lagras endast som SHA-256 och
jämförs timing-säkert, med en konstant dummyhash vid okänt grant-id.

Första GET på den hemliga länken validerar grantet server-side, skapar en kort
route-upload-session och omdirigerar till en URL utan hemlighet. Sessionen är
host-only, HttpOnly, Secure och SameSite=Lax; skrivrequests kräver också en
separat CSRF-cookie/header. Linkrouten använder `no-store` och
`Referrer-Policy: no-referrer`, och ingen route får logga URL:en eller bära
hemligheten i browserlagring. Revocation/utgång stoppar nya sessioner och
writes; de ändrar inte redan lagrad routehistorik.

Första formatet är GPX 1.1 trackdata: endast `trk`/`trkseg`/`trkpt`, med
WGS84-latitud/longitud enligt GPX-specifikationen. Ruttplaner och waypoints
avvisas, liksom DTD/entity och okända rootformat. Originalets bytes lagras
privat, versionbundet och immutable. En separat bounded parser producerar en
ordnad punktprojektion med valfri tid/höjd; den är inte resultatlogik och körs
inte i React eller HTTP-handlern.

Den första parsningen begränsas till 8 MiB faktiska UTF-8-bytes, 100 000
trackpunkter och 2 000 segment. Filnamn är otrusted displaydata med högst 120
tecken och används aldrig som objektnyckel. En punkt med `time` måste vara en
giltig RFC3339-tid med UTC-offset; parsern bevarar punktordningen och varken
sorterar, fyller i eller tidsförskjuter GPS-data.

Uppladdningen är tvåstegad med immutable reservation/attempt/manifest och
request-id. Exakt retry återger samma kvittens; osäker objektlagring ger aldrig
en fabricerad manifestpost. TASK111 har ingen publik route-release; ingen route
eller lagringsidentifierare läcker via publika resultatprojektionsfält.

TASK111 lagrar GPS i WGS84 men gör ingen kartöverlagring. TASK106:s rasterbild
har ingen CRS eller georeferering, och det vore fel att rita GPS-punkter som om
de var kartkoordinater. Publik release och verkligt överlägg kräver ett senare,
explicit georefererings- och publiceringsbeslut.

## Konsekvenser

Detta ger deltagaren en enkel väg från egen GPX-fil till en spårbar privat
rutt, och arrangören behåller fortsatt full kontroll eftersom publik release
inte finns ännu. Det bygger en självständig grund för framtida ruttanalys utan
Liveloxberoende eller konto som grundkrav.

Det inför en ny säkerhetsgräns och additiva immutabla tabeller, inte en generell
rollmodell. Vid incident stängs grant- och upload-routes; lagrade
manifester, original och journalhistorik bevaras. Återställning måste omfatta
både databas och exakt objektversion.

OMAP-rendering, CRS, kontrollmatchning, tidsförskjutning, fler-ruttvisning,
live-GPS, FIT/TCX och fysisk mobil/GPS-acceptans är fortsatt separata beslut.

## Alternativ

- Göra den publika deltagarlänken skrivbar avvisas: den är ingen credential.
- Återanvända PM- eller kartadaptern avvisas: de är medvetet format- och
  capabilitybundna.
- Vänta på ett komplett deltagarkonto avvisas: det fördröjer första privata
  GPX-vägen utan att ge bättre minimal åtkomst.
- Rita WGS84 direkt på rasterkartan avvisas: kartan saknar georeferering.
