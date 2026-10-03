# TASK127: offentlig fryst vy för fastställda loppsresultat

Status: genomförd enligt ADR-0134.

## Användarvärde

Efter tävlingen ska deltagare kunna öppna och dela ett fastställt resultat som
inte ändras när arrangören senare publicerar en rättning i den levande
resultatlistan.

## Avgränsning

- Endast en explicit, immutabel `RACE`-finalisering från ADR-0028.
- Endast vitlistade, frysta resultatfält i en ny publik read-DTO.
- Direkt publik sida och read-only API med exakt `raceId` och
  `finalizationId`.
- Ingen migration, writer, adminändring, IOF-XML-nedladdning, route-/GPS-/
  kartfunktion, stafett eller hårdvara.

## Acceptans

1. En giltig explicit RACE-finalisering visar dess egna frysta resultat och
   fastställandetid; senare live-revisioner ändrar varken API-svar eller sida.
2. Fel race, CLASS-finalisering, saknad rad, korrupt manifest eller hash ger
   inte live-resultat som ersättning.
3. API-svaret och resultattabellen innehåller inga interna id:n, hashvärden,
   provenance, besluts-/aktörsfält, XML, start-/måltider eller splits. Det
   explicita `finalizationId` förekommer endast som den oundvikliga,
   ogenomskinliga URL-parametern i den delade länken.
4. En lång rad bryts på 390 px utan horisontell sidscroll.

## Verifiering

- Kontraktstest för den strikta publika DTO:n.
- Kontraktstest: 5/5 passerade.
- PostgreSQL-integration: 2/2 passerade mot isolerad syntetisk databas;
  ändrat live-eventnamn ändrar inte den frysta responsen och fel scope/race
  stängs utan fallback.
- Browser: 1/1 passerade vid 390 px med explicit URL, immutabelt cachehuvud
  och länk från live-resultaten.
- Berörda packages lint, typecheck och build dokumenteras i `docs/status.md`.
