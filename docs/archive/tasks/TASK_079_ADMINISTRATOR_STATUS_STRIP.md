# TASK079: kompakt tävlingsstatus i gemensam administration

Påbörjad 2026-09-19 som genomförandeplanens första avgränsade A3-snitt efter
slutförd TASK078.

## Användarvärde

En administratör ska direkt efter inloggning kunna se tävlingens viktigaste
rosterläge utan att öppna detaljer eller scrolla genom deltagarlistan:
deltagare, klasser med fri respektive fast start, äldre resultat och ännu inte
återlämnade hyrbrickor. Underlagsversion och serverns lästid ska göra det
tydligt vilket underlag siffrorna kommer från.

## Arkitektur och avgränsning

- Återanvänd exakt den redan validerade `EntryTransferCandidates` som hämtas
  efter en racebunden `MANAGE_RACE`-session.
- Räkna alltid på hela `data.entries`/`data.classes`, aldrig på lokal sökning,
  filter, sida eller vald deltagare.
- `Äldre resultat` betyder endast `OLDER_SNAPSHOT`.
- `Ej återlämnade hyrbrickor` behåller TASK074/076:s definition: exakt en
  projicerad aktiv assignment med `isRental=true` och `rentalReturned=false`.
- Fri/minutstart räknar klasser med `PUNCH` respektive `FIXED`; siffrorna får
  inte beskrivas som reserverade startluckor eller ledig kapacitet.
- Ingen ny route, serverfråga, kontraktsversion, migration, capability,
  dependency, polling eller beständig data.
- Ingen SPORTident-USB, GPS, stafett, betalning eller annan senare funktion.

## Berörda delar

- `apps/web/src/components/race-administrator-workspace.tsx`
- `apps/web/src/components/race-administrator-workspace.module.css`
- `apps/web/src/i18n/race-administrator-sv.ts`
- befintligt browserfall i `tests/e2e/task-029-race-administrator.spec.ts`
- plan, funktionsmatris och status efter verifiering

## Acceptans

1. Före inloggning visas ingen privat status. Efter lyckad inloggning finns en
   namngiven region `Tävlingsstatus` före mobilnavigation och arbetskolumner.
2. Regionen visar deltagare, klasser, klasser med fri start, klasser med
   minutstart, äldre resultat och ej återlämnade hyrbrickor samt
   underlagsversion och serverns `generatedAt` i tävlingens tidszon.
3. Lokala sök-, filter- och sidval ändrar inte totalerna. Befintliga mutationer
   som laddar om rosterunderlaget uppdaterar remsan utan extra specialanrop.
4. Text bär betydelsen utan färg. Siffror är lättskannade och remsan bryts utan
   horisontell sidscroll på smal vy.
5. Befintliga adminåtgärder, mobilnavigation och privata utskriftsmål påverkas
   inte.

## Verifieringsplan

Utöka ett befintligt TASK029-browserfall med statusens initiala och uppdaterade
värden. Kör riktad E2E-TypeScript/ESLint, web lint/typecheck/build och endast
det namngivna browserfallet. Ingen databas- eller kontraktsenhetssvit behövs
eftersom serverbeteende och DTO är oförändrade.

## Arkitektur- och licensbedömning

Ingen ADR behövs: snittet ändrar inte teknikval, domängräns, behörighet eller
beständig semantik. Endast befintlig O-Tid-data och egen UI-kod används; ingen
AGPL-kod eller extern produktdata ingår.

## Slutfört 2026-09-19

Den autentiserade toppraden är ersatt av en semantisk region
`Tävlingsstatus`. Den visar totaler för deltagare och klasser, antal klasser
med fri respektive minutstart, resultat från äldre tävlingsversion och ännu
inte återlämnade hyrbrickor. En kompakt rad anger underlagsversion och serverns
`generatedAt` formaterad i tävlingens tidszon.

Statusen använder endast redan inläst full roster och uppdateras genom samma
befintliga reload som mutationerna. Browserfallet verifierar nollvärden,
PUNCH→FIXED, äldre resultat, hyrmarkering, återlämning och 390 px utan
horisontell sidscroll. Ingen ny serverkod, route, kontrakt eller databasändring
tillkom.

Riktad verifiering: web lint och typecheck, E2E-TypeScript/ESLint, ett
namngivet Playwrightfall och webbuild passerade. Full workspace- och
serverregression kördes inte eftersom inget serverbeteende ändrades.
