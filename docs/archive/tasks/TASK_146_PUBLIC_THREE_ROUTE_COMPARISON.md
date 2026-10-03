# TASK146: publik jämförelse av upp till tre deltagarrutter

Status: genomförd och riktat verifierad 2026-09-22.

## Syfte

Bygg den av ADR-0143 beslutade, skrivfria publika vyn där en besökare kan
jämföra två eller tre redan godkända deltagarrutter på samma historiska karta.
Det är en avgränsad förbättring av den befintliga eftertävlingsvyn, inte en
generell Livelox-ersättare.

## Ägda lager

- `packages/contracts`: versionsstyrd 2–3-ruttsquery och pixelbaserat DTO.
- `packages/application`: samma race-lås och samtliga befintliga
  route-release-/historikgrindar för varje vald rutt.
- `apps/web`: väljare, responsiv rutt-/split-/playbackvy och svensk text.
- `tests/e2e/task-106-public-map.spec.ts`: ett kompakt verkligt browserfall.

Ingen databasmodell, migration eller writer ägs av uppgiften.

## Acceptans

1. Två-ruttslänk fungerar som före ändringen; tre unika och historiskt
   kompatibla rutter visas med textlig röd/blå/grön identitet.
2. Samtliga tre måste passera samma publicerings-, samtyckes-, karta-,
   georeferens-, ban- och kontrollgeometrigrind. Dubblett, saknad eller
   blandad grund ger neutral 404 och ingen intern detalj.
3. Metadata, kontroller och officiella splits är endast synliga när den
   befintliga bevisgrunden gäller för alla rutter. Tredje ruttens GPX får inte
   skapa ny resultat- eller positionssemantik.
4. En gemensam relativ uppspelning visas endast när alla valda rutter har
   komplett monoton GPX-tid. Segmentgap och avslutad rutt behandlas som i
   TASK132 för varje markör.
5. 390 px-vyn har ingen horisontell sidscroll, färg används inte ensam och
   inga privata identifiers/koordinater läcker.
6. Riktad kontrakts-/application-/webverifiering omfattar lyckad två- och
   tre-ruttsläsning, en relevant avvisning, playback och ett browserflöde.

## Utanför uppgiften

Fler än tre rutter, persistent urval, favoriter utöver befintlig lokal
browserfunktion, OMAP, GPS-live, tempo-/vägvalsanalys, kontrollpassager,
mobilinspelning, FIT/TCX, kartimport, stafett och USB ingår inte.

## Resultat

Två-ruttslänkar behåller DTO-formatversion 2. En länk med en unik tredje
resultatidentitet får formatversion 3 och endast när alla tre passerar samma
befintliga historikgrind. Den publika resultatsidan kan välja två eller tre
rutter; tre-ruttsvyn har textliga röd/blå/grön-etiketter, kompakt splitsvisning
per kontroll och samma relativa GPX-uppspelning som tidigare. Ingen writer,
databasändring eller ny datakälla lades till.

Riktad verifiering passerade: contracts lint/typecheck och 3/3 kontraktstester,
application lint/typecheck och 1/1 PostgreSQL17/PostGIS-integrationstest,
web lint/typecheck och 14/14 berörda webbtester, E2E TypeScript/ESLint samt
4/4 390 px-browserfall. Webbygget passerade. Databasprovet använde en ny tom
lokal loopbackdatabas med endast syntetiska Ada/Bea/Cy-data.
