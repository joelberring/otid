# TASK096: måltidsmarkering i vald deltagares resultatsammanfattning

Genomförd 2026-09-19 efter TASK095. Ingen ADR behövs: detta är en lokal,
skrivskyddad presentation av redan validerat privat rosterunderlag.

## Användarvärde

När administratören öppnar en deltagare framgår samma måltidsrättningskedja
även i den kompakta resultatsammanfattningen, utan att personen måste tolka
en revisionssiffra eller gå tillbaka till listan.

## Avgränsning

- Återanvänd endast den redan laddade rosterpostens TASK095-markör.
- Visa en kort externiserad svensk text endast när den valda deltagaren också
  har ett aktivt resultat i resultatsammanfattningen.
- Ingen ny query, endpoint, kontraktsändring, behörighet, journal, migration,
  resultataction eller omräkning.
- Ingen GPS, karta/rutt, stafett eller riktig USB.

## Acceptans

1. En vald deltagare med aktuell rättning visar `Måltid rättad` i
   resultatsammanfattningen.
2. En vald deltagare med aktuell återställning visar `Måltidsrättning
   återtagen` där.
3. Ingen markör visas för tekniskt, icke-aktivt eller omarkerat resultat.
4. Den befintliga 390 px-arbetsvyn får ingen sidscroll eller ny panel.

## Berörda paket och verifiering

Endast `web`. En utökning av den befintliga 390 px-resan efter TASK094/TASK095
verifierar den verkliga privata resultatsammanfattningen; berörd lint,
typecheck och production build körs.
