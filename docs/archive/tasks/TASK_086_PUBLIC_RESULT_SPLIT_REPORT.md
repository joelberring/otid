# TASK086: kompakt publik resultat- och sträckrapport

Påbörjad 2026-09-19 som B3:s minsta läsande snitt.

## Användarvärde

Löpare, målpersonal och publik kan snabbt hitta och förstå ett publicerat
resultat på mobil eller dator: placering/status, tid, tid efter, avvikelse och
kontroller/sträckor. Rapporten kan skrivas ut från webbläsaren utan
skrivarspecifik integration.

## Arkitektur och avgränsning

- Återanvänd endast det redan validerade, oinloggade `PublicResultListResponse`.
  Ingen route, databas, domänregel, ranking eller polling ändras.
- UI får aldrig härleda placering, tid efter, status eller sträckor. Den visar
  endast kontraktets publicerade fält.
- Desktop behåller en tät resultatlista. Vid högst 640 px blir varje resultat en
  semantisk, vertikal rad utan krav på horisontell sidscroll.
- Sträckor visas endast när resultatet redan innehåller dem, bakom ett native
  `details` med svensk text. Upprepad kontroll anges med förekomst, exempelvis
  `31 (2)`; sträcka och ackumulerad tid hålls isär.
- MP:s saknade/extra kontroller förblir synliga. DNS, DNF och NT får aldrig
  fabricerad tid, ranking eller sträckutvikning.
- Ingen deltagaridentitet, rådata, readout, revisionsid, intern UUID, GPS,
  karta, stafett eller verklig utskrift införs.

Ingen ADR krävs: detta är en avgränsad presentation av ett oförändrat publikt
kontrakt och ändrar inga domängränser eller teknikval.

## Berörda delar

- `apps/web/src/components/public-results.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/i18n/sv.ts`
- `apps/web/src/components/public-results-ui.test.tsx`
- ett riktat browserprov endast om den befintliga publika resultsidan behöver
  täcka den responsiva ytan.

## Acceptans

1. Ett OK-resultat visar deltagare, klass, placering, status, tid och tid efter
   från API:t utan lokal omräkning.
2. En expanderad sträckrapport visar kontroll/förekomst, sträcktid och
   ackumulerad tid i rätt ordning.
3. MP visar saknade/extra kontroller och behåller status, medan DNS/DNF/NT inte
   får påhittade tider eller sträckor.
4. Vyn är läsbar vid 390 px utan horisontell sidscroll; desktop förblir tät.
5. HTML innehåller inga interna identifierare, råorsaker eller opublicerade
   fält.

## Verifieringsläge 2026-09-19

- `CI=true pnpm --filter @o-tid/web exec vitest run
  src/components/public-results-ui.test.tsx`: exit 0, 6/6 tester på 6 ms;
- web lint och typecheck: exit 0;
- web build: exit 0; 677 ms kompilering, 3,4 s TypeScript och 7/7 statiska
  sidor på 52 ms.

Det riktade provet täcker svenska OK/MP/DNF/NT-texter, upprepade kontroller,
sträcka/ackumulerad tid, avvikelser, frånvaro av fabricerade detaljer och att
den publika tabellen har ett eget 640 px-kortläge utan `.scroll`-beroende.
Ingen separat browserkedja med syntetiskt publikt resultatsvar finns att
återanvända utan ny testinfrastruktur; verklig rendering på fysisk mobil och
skrivare är därför inte verifierad. Ingen bred regression eller
hårdvaruacceptans ingår.
