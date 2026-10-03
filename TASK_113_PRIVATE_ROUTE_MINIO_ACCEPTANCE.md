# TASK113: verklig privat MinIO-acceptans för GPX-rutt

Status: implementerad och verifierad 2026-09-21. Detta är en driftsverifiering av
ADR-0123:s befintliga privata, versionsbundna objektgräns. Ingen ny ADR behövs:
lagringsmodell, accessgräns, publicering och domänobjekt ändras inte.

## Användarvärde

En deltagarens redan implementerade privata GPX-uppladdning får ett verkligt
lagringsbevis innan den används som grund för senare ruttfunktioner. Ett nytt
objekt eller ett senare skrivförsök får inte tyst ändra den tidigare
lagrade rutten.

## Avgränsning

- Återanvänd den befintliga pinnade, lokala MinIO-runnern och dess privata
  slumpcredentials, datakatalog och loopback-server.
- Verifiera `createRouteObjectStore` med en egen slumpad privat, versionsaktiverad
  bucket och enbart syntetiska GPX-bytes.
- Bevisa privat bucket, exakt hash/längd, race-/attempt-bunden nyckel,
  read-after-write med det returnerade versions-id:t, äldre version efter
  overwrite och efter MinIO-processomstart.
- Felaktig hash/längd, saknad objektversion, public bucket-policy och
  avstängd/suspenderad versionering ska fail closed.
- Testet skriver inte PostgreSQL, kör ingen webbläsare och exponerar inga
  ruttpunkter eller manifest till publik HTTP.

## Acceptans

1. `put` returnerar korrekt GPX-manifest med icke-null versions-id och `read`
   återger byteidentiskt original.
2. Anonym objektläsning och bucket-listning nekas av MinIO.
3. Ett direkt senare PUT på samma objekt ger ny version, medan ursprungligt
   manifest fortfarande läser originalet, även efter ren MinIO-omstart med
   samma privata datakatalog.
4. Saknad version, ändrade bytes/hash/längd, offentlig bucket-policy och
   suspenderad versionering avvisas utan att SDK-fel eller credentials läcker.
5. Runnern startar bara den hashpinnade macOS arm64-binären lokalt och lämnar
   testdata kvar; den rör aldrig användar- eller produktionsbucket.

## Utanför uppgiften

- Ny databasmodell, browser- eller deltagar-UI, objektläsning i publika
  resultat, georeferering, kartor, GPS-live, FIT/TCX, analys, stafett, USB och
  återställning till annan objektlagringsmiljö.

## Genomförande och verifiering

`test/integration/route-minio.test.ts` körs från den befintliga, hashpinnade
MinIO-runnern tillsammans med PM:s integrationsprov. Det använder egen
slumpad bucket och verifierar privat åtkomst, versionering, exakt originalbytes
och fail-closed-fallen. Runnern har dessutom en separat ruttmanifestkontroll
över en MinIO-processomstart med samma privata datakatalog.

Riktad verifiering 2026-09-21:

- infrastructure typecheck, lint och build: passerar;
- befintligt enhetsprov för route-adaptern: 2/2 passerar;
- två isolerade körningar med den officiella
  `RELEASE.2025-07-23T15-54-02Z` macOS-arm64-binären, vars SHA-256 var
  `0939ce5553ce9e6451b69e049fbf399794368276b61da8166f84cbd8c7f2d641`:
  PM-MinIO 3/3 och route-MinIO 3/3 passerar; den andra körningen avslutas med
  att både PM- och GPX-originalversion överlever varsin processomstart.

Första körningen nådde samma två integrationssviter framgångsrikt, men den
äldre PM-omstartschecken föll tillfälligt efter start; den andra, nya helt
isolerade körningen passerade komplett. Ingen produktion, användarfil,
tävlingsdatabas eller permanent MinIO-server användes.

Detta är en lokal single-node-loopbackacceptans, inte produktions-TLS,
least-privilege, HA eller backup/restore till annan objektlagring.
