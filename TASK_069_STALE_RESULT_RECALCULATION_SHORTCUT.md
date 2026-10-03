# TASK069: genväg från äldre gällande resultat till omräkning

Implementerad och riktat verifierad 2026-09-18 som nästa minsta vertikala snitt efter TASK068. Ingen
produktionsdriftsättning ingår.

## Användarvärde

När den valda deltagarens gällande resultat bygger på en äldre
race-snapshot ska administratören kunna öppna den redan befintliga explicita
omräkningsgranskningen direkt från resultatkortet, utan att först leta bland
deltagaråtgärder eller klassuppföljning.

## Avgränsning

- Genvägen visas endast för `ACTIVE_RESULT` där
  `resultSnapshotVersion < snapshotVersion`.
- Befintlig rådgivande text behålls: äldre underlag kan behöva omräknas, men
  orsaken och påverkan på publikresultatet påstås inte vara bevisade.
- Klicket väljer befintlig `RECALCULATION` och hämtar färskt roster och
  omräkningsunderlag för samma deltagare.
- Klicket skapar ingen request-id, POST, omräkning eller resultatrevision.
- Befintlig readiness, separat granskning, bekräftelse och exakt retry är
  oförändrade.
- Ingen ny route, migration, behörighet, offlinekö eller automatisk omräkning.

## Arkitektur

Ingen ny ADR krävs. ADR-0074 styr fortsatt det gällande resultatkortet och
den befintliga explicita omräkningsvägen äger fortsatt all skrivning.
TASK069 kopplar endast ihop två befintliga, serverbundna adminytor i webben.

## Berörda filer

- `apps/web/src/components/race-administrator-workspace.tsx`
- `apps/web/src/i18n/race-administrator-sv.ts`
- det befintliga riktade TASK065–068-browserfallet

## Acceptans

1. Aktuellt, saknat eller återtaget resultat får ingen genväg.
2. Ett aktivt resultat från äldre snapshot visar rådgivande varning och en
   direkt genväg.
3. Klicket öppnar befintlig omräkningsvy för samma deltagare med färskt
   validerat GET-underlag.
4. Ingen POST eller ny resultatrevision uppstår innan administratören separat
   granskar och bekräftar befintlig omräkning.

## Verifieringsplan

Kör web lint/typecheck/build, E2E-ts/lint och endast det namngivna
TASK069-browserfallet. Ingen ny enhets-, route- eller PostgreSQL-grupp behövs
eftersom ingen projektion, route eller servermutation tillkommer.

Genomfört: ett aktuellt aktivt resultat saknar genvägen. När samma resultat
blir äldre än race-snapshoten visas befintlig varning och en direkt knapp som
öppnar befintlig omräkningsvy med färskt underlag. Browseracceptansen
verifierar noll omräknings-POST och oförändrad resultatrevision.
