# TASK072: antal äldre resultat i administratörens filter

Implementerad och riktat verifierad 2026-09-18 som nästa minsta vertikala
snitt efter TASK071. Ingen produktionsdriftsättning ingår.

## Användarvärde

Administratören ska se hur många deltagare som har ett gällande resultat från
en äldre tävlingsversion innan listfiltret aktiveras.

## Arkitektur och avgränsning

- Antalet härleds lokalt ur hela det redan validerade rosterunderlaget som
  antalet poster med `resultFreshness === "OLDER_SNAPSHOT"`.
- Söktext, pagination och filterläge påverkar inte antalet; det beskriver hela
  den inlästa tävlingens aktuella rosterunderlag.
- När rosterunderlaget inte är inläst visas inget fabricerat nollvärde.
- Ingen ny HTTP-läsning, skrivning, omräkning eller beständig state införs.
- Ingen kontrakts-, server-, databas-, behörighets- eller dependencyändring.

Ingen ny ADR behövs: ADR-0099 definierar freshness-semantiken och TASK071
definierar det lokala filterbeteendet. Ingen licensfråga tillkommer.

## Berörda delar

- `apps/web/src/components/race-administrator-workspace.tsx`
- `apps/web/src/i18n/race-administrator-sv.ts`
- befintligt riktat TASK065–071-browserfall

## Acceptans

1. Aktuellt rosterunderlag visar etiketten "Visa endast äldre resultat (0)".
2. När en rosterpost blir `OLDER_SNAPSHOT` visar samma etikett `(1)` utan ett
   separat rosteranrop.
3. Antalet förblir `(1)` när filtret aktiveras och när en sökning ger noll
   synliga träffar.
4. Oinläst roster visar etiketten utan tal och aldrig en fabricerad nolla.
5. Befintlig filtrering, pagination, bevarat urval och noll skrivningar är
   oförändrade.

## Verifieringsplan

Kör webblint och webtypecheck, E2E-tsconfig och riktad ESLint, samma enda
TASK072-browserfall mot isolerad PostgreSQL samt webbuild. Ingen ny enhets-
eller bred regressionssvit behövs för den rena presentationen.

## Utfall

Filteretiketten visar nu hela det inlästa rosterunderlagets antal äldre
resultat. Den visar inget tal innan underlaget finns, och totalen ändras inte
av sökning, pagination eller filterläge. Ingen ny läsning eller skrivning
tillkom.

Det befintliga riktade browserfallet verifierar `(0)` före versionsändringen,
`(1)` efter den, samt att `(1)` kvarstår när sökningen ger noll synliga
träffar. Statiska kontroller och webbuild är gröna; exakta resultat finns i
`docs/status.md`.
