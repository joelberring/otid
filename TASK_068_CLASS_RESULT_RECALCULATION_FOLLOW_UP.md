# TASK068: uppföljning av äldre resultat efter ändrat startupplägg

Implementerad och riktat verifierad 2026-09-18 som nästa minsta vertikala snitt efter TASK067. Ingen
produktionsdriftsättning ingår.

## Användarvärde

Efter att en administratör har ändrat en klass mellan fri start och minutstart
ska det gå att se vilka deltagare i den valda klassen som har ett lagrat
resultat från en äldre tävlingsversion och öppna den befintliga individuella
omräkningsgranskningen.

## Sanningsgräns

En äldre `snapshotVersion` visar att resultatet kan behöva omräknas, men den
bevisar inte att just startuppläggsändringen är orsaken eller att det gällande
publika resultatet kommer att ändras. Gränssnittet använder därför endast
formuleringen "kan behöva omräkning" och visar revisionsversionen.

## Avgränsning

- Uppföljningen är klassbegränsad och använder befintlig validerad
  `/recalculation-candidates` tillsammans med roster från samma snapshot.
- Endast deltagare med en senaste resultatrevision vars snapshot är äldre än
  aktuell race-snapshot visas.
- Readiness visas, men är fortsatt bara underlag för om den befintliga
  tekniska omräkningen kan förberedas.
- Genvägen hämtar färskt roster och omräkningsunderlag och öppnar befintlig
  `RECALCULATION` för vald deltagare.
- Klicket skapar ingen request-id, POST, omräkning eller resultatrevision.
- Ingen ny route, migration, behörighet, offlinekö eller automatisk omräkning.

## Arkitektur

Ingen ny ADR krävs. Snittet ändrar inte teknikval eller domängränser och
återanvänder den befintliga explicita omräkningen. Jämförelsen är en ren,
deterministisk webbprojektion över två servervaliderade svar med samma
snapshot. Serverns befintliga versionskontroller avgör fortfarande all
skrivning.

## Berörda paket

- `apps/web`
- det befintliga riktade TASK065–067-browserfallet

## Acceptans

1. En vald klass kan läsa aktuellt omräkningsunderlag utan skrivning.
2. Endast klassens resultat från en äldre snapshot visas; aktuell eller saknad
   revision påstås inte behöva omräkning.
3. UI:t säger "kan behöva omräkning" och tillskriver inte orsaken till
   startregeländringen.
4. Genvägen väljer deltagaren och öppnar befintlig omräkningsvy med ett färskt
   GET-underlag.
5. Ingen POST sker innan administratören separat granskar och bekräftar den
   befintliga omräkningen.

## Verifieringsplan

Kör enhetstest för den rena klassprojektionen, web lint/typecheck/build,
E2E-ts/lint och endast det namngivna TASK068-browserfallet. Ingen ny bred
regression eller separat PostgreSQL-integrationsgrupp behövs.

Genomfört: den valda klassen kan hämta det befintliga omräkningsunderlaget,
visa endast senaste revisioner från en äldre race-snapshot och öppna den
befintliga individuella omräkningsvyn. Browseracceptansen verifierar att
genvägen inte skapar POST eller resultatrevision.
