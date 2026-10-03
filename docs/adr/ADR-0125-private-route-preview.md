# ADR-0125: privat förhandsgranskning av en exakt rutt på exakt rasterkarta

- Status: Accepterad, implementerad i TASK115
- Datum: 2026-09-21

## Kontext

TASK111–113 lagrar en privat, immutable GPX-rutt och TASK114 lagrar en privat,
immutable WGS84→pixel-kalibrering för exakt en rastermanifestversion. De två
gränserna är avsiktligt separata: dagens deltagarlänk lämnar endast en
lagringskvittens och kartsläppet har ingen ruttsemantik. En faktisk överläggning
är ett nytt åtkomst- och visningsbeslut, även om data redan finns.

## Beslut

TASK115 inför en rent läsbar, privat `MANAGE_RACE`-förhandsgranskning av exakt
en lagrad rutt på exakt en lagrad PNG/JPEG-kartversion.

- Administratören väljer explicit route-manifest, map-manifest och
  georeferensrevision. Servern väljer aldrig automatiskt senaste objektet.
- Servern verifierar att route, map och georeferens hör till samma race och att
  georeferensens `manifestId` är den valda kartan. Den läser bara immutable
  `route_point` och validerat georeferensunderlag; browsern får aldrig leverera
  koordinater för överläggningen.
- Endast härledda pixelpunkter, med explicit punktgräns och utan WGS84-,
  object-store-, grant- eller beareruppgifter, kan lämna den privata
  adminprojektionen. Den exakta privata kartbilden levereras från en separat
  skyddad läsväg som använder manifestets lagrade objektversion.
- Alla svar är `private, no-store`. Vyn skapar ingen journal, publicering,
  resultatförändring eller deltagarpreferens. Vanlig skyddad GET behöver ingen
  CSRF-token eftersom den inte muterar state; eventuella framtida val/sparning
  är en separat skrivväg med CSRF och idempotens.
- En saknad, felaktig, utanför-bild, racefrämmande eller blandad
  map/georeferens/rutt avvisas fail-closed. Inget senaste-val, ingen
  extrapolering och ingen fabricerad rutt får ersätta felet.

## Konsekvenser

Detta ger arrangören en kontrollerbar privat visning före någon
integritets- eller publikeringpolicy beslutas. Det är inte en Livelox-koppling
eller -efterbildning.

TASK115 omfattar inte deltagarvy, publik ruta, GPS-live, flera rutter,
jämförelse, uppspelning, vägvalsanalys, tidsanimering, OMAP-import, kontroller/
banor ovanpå karta eller lag/stafett. Varje publikt ruttbeslut kräver ett nytt
ADR med deltagarens samtycke och explicita regler för synlighet och återtagande.
