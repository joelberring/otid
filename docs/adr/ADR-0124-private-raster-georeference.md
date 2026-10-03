# ADR-0124: privat, versionsbunden georeferens för rasterkarta

- Status: Accepterad, implementerad i TASK114
- Datum: 2026-09-21

## Kontext

ADR-0120 lagrar och kan publicera en renderbar PNG/JPEG-karta, men den är en
ren visningsresurs utan CRS eller koordinatsemantik. ADR-0123 lagrar privata
WGS84-GPX-punkter. Att rita punkterna ovanpå rasterbilden utan en kontrollerad
transform skulle falskt antyda lägesnoggrannhet. Varken OMAP-rendering eller
en publik ruttläsare är ännu en beslutad väg.

## Beslut

TASK114 inför en separat, privat och immutable georeferensjournal för en exakt
`map_object_manifest`-version. Endast en `MANAGE_RACE`-administratör kan skapa
den, med ett idempotent request-id och ett explicit operatörsangivet
affint trepunktsunderlag.

Första formatet är medvetet snävt:

- exakt CRS är alltid `EPSG:4326`, med x = longitud och y = latitud;
- pixelkoordinater har origo i rasterbildens övre vänstra hörn, x åt höger och
  y nedåt;
- transformen `lon = a*x + b*y + c`, `lat = d*x + e*y + f` binds till exakt
  manifest, angiven bildbredd/-höjd och exakt tre manuella tie points;
- både pixel- och WGS84-triangeln måste vara icke-kollinear och transformen
  måste vara inverterbar; alla punkter måste ligga inom angiven rasterextent
  och WGS84-gräns; servern räknar och sparar det numeriska residualmåttet.
  Exakt tre punkter ger ingen oberoende fältnoggrannhet och residualen är
  därför inte ett påstående om verklig kartprecision;
- samma manifest kan få flera immutable kalibreringar, men en nyare kalibrering
  ersätter aldrig historiken. Den privata adminprojektionen väljer högsta
  journalrevision först efter att den själv kan valideras.

Georeferens, tie points, bilddimensioner och residual är privata.
Publik kartrelease enligt ADR-0120 ändras inte och läser aldrig dessa data.
Ruttpunkter, deltagaridentitet, kontroller, banor, OMAP och GPS visas inte.

## Konsekvenser

Detta ger ett korrekt, spårbart geometriskt underlag för en senare uttrycklig
privat ruttförhandsgranskning, utan att den vägen redan aktiveras. En
administratör ansvarar för kalibreringen; systemet påstår inte automatisk
tolkning av raster eller OMAP.

En framtida annan CRS, fler än tre markkontrollpunkter med robust passning,
automatisk georeferering, georefererad filimport, ban-/kontrollöverlägg eller
publik ruttvisning kräver ett nytt ADR-beslut.
