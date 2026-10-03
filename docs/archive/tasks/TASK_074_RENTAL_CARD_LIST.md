# TASK074: skrivskyddad hyrbrickslista

Påbörjad 2026-09-18 som nästa minsta vertikala snitt efter TASK073.

## Användarvärde

Tävlingsadministratören ska direkt kunna begränsa deltagarlistan till de
deltagare som just nu har en entydig aktiv hyrbricka och samtidigt se namn,
klass och bricknummer.

## Arkitektur och avgränsning

- Återanvänd den skyddade `MANAGE_RACE`-rostern och TASK073:s
  `activeAssignment.isRental`.
- Filtrera lokalt med exakt `entry.activeAssignment?.isRental === true`.
- Visa totalen för hela inlästa rostern i filteretiketten, oberoende av sökning
  och pagination.
- Kombinera filtret med befintlig sökning och äldre-resultat-filter samt
  återställ pagination till första sidan.
- Visa aktivt bricknummer i hyrträffen; inaktiva, saknade eller multipla
  assignments får aldrig fabriceras till en träff.
- Ingen ny route, databasfråga, capability, dependency eller ADR behövs.
- Ingen betalning, avgift, återlämningsskrivning, startlista, stationspaket,
  SPORTident-protokoll, GPS eller stafett ingår.

## Berörda delar

- `apps/web/src/components/race-administrator-workspace.tsx`
- `apps/web/src/i18n/race-administrator-sv.ts`
- befintligt riktat TASK029-browserfall

## Acceptans

1. Filtret visar endast entydiga aktiva assignments med `isRental: true`.
2. Hyrträffen visar namn, klass och bricknummer utan att antyda betalning eller
   återlämning.
3. Totalen räknas från hela den inlästa rostern och ändras inte av söktext,
   pagination eller andra filter.
4. Filterbyte återställer sidindex men bevarar sökning och valt ärende.
5. Filter och vy skapar inga nya HTTP-anrop eller skrivningar.

## Verifieringsplan

Kör webbens lint/typecheck, befintligt kontraktsprov för rentalfältet, E2E-
TypeScript/lint, ett enda browserfall `TASK074` och webb-build. Ingen bred
regressionssvit eller PostgreSQL-integration krävs eftersom servermodell,
mutation och persistens är oförändrade.
