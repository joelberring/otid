# TASK089: publik deltagarspecifik resultatrapport

Påbörjad 2026-09-19 som nästa B3-snitt efter TASK088.

## Användarvärde

En person kan öppna en stabil länk från den publika resultatlistan till en
kompakt rapport för just det aktuella publicerade resultatet, med samma status,
tid, avvikelse och sträckor som i listan.

## Arkitektur och avgränsning

- Följ ADR-0108. En separat opaque, racebunden offentlig identitet får aldrig
  ersättas med namn, `entryId`, revisionsid, bricknummer eller extern identitet.
- Detaljvägen returnerar enbart redan publik, validerad resultatdata och faller
  stängt om resultatet inte längre är publicerat i den begärda race-scopen.
- Listan länkar med den nya public-result-identiteten; detaljsidan återanvänder
  samma kompakta komponentpresentationsregler och browserutskrift.
- Ingen inloggning, privat deltagarprofil, personlig historik, GPS, karta,
  stafett, rådata eller fysisk hårdvara införs.

## Berörda delar

- ADR-0108 och additiv databasidentitet/migration,
- contracts och application för strikt list-/detaljprojektion,
- offentlig detaljroute och Next-sida,
- resultatlistlänk, svenska texter och riktade test.

## Acceptans

1. Varje publicerad rad bär en racebunden opaque länkidentitet, aldrig internt
   UUID eller namn som nyckel.
2. Fel race, okänd token eller opublicerat resultat ger ingen resultatdata.
3. Namn-/klubbrättning och ny publicerad revision behåller länken; detaljen
   visar då senaste publicerade fakta.
4. Publicerad lista, detalj och utskrift visar samma säkra fält. Ingen rådata,
   bricka, audit eller intern UUID kan läcka.
5. Detaljsidan fungerar på 390 px och dator, med länk tillbaka till listan.

## Verifieringsläge 2026-09-19

- contracts lint/typecheck: exit 0; `test/public-results.test.ts`: 24/24 tester
  på 6 ms;
- database lint/typecheck: exit 0; `test/public-result-identity-schema.test.ts`:
  2/2 tester på 1 ms;
- application lint/typecheck: exit 0; riktad policy- och isolerad
  PostgreSQL-projektion: 3 testfiler, 9/9 tester på 66 ms (hela körningen
  746 ms);
- web lint/typecheck: exit 0; lokalt filter- och komponentprov: 2 testfiler,
  10/10 tester på 15 ms;
- riktad E2E TypeScript och ESLint: exit 0; Playwright: 1/1 test på 3,1 s mot
  riktig Next/HTTP, 390 px viewport och isolerad PostgreSQL17/PostGIS på
  loopback3123;
- web production build: exit 0; 2,7 s kompilering, 5,6 s TypeScript och 7/7
  statiska sidor på 54 ms; checkin-skalets hash `00ac7b3d5acc`.

Browserfallet öppnar en riktig publicerad rad, följer den opaque länken till
den serverrenderade detaljsidan, öppnar sträckor, kontrollerar frånvaron av
interna fält, 390 px utan sidscroll och att okänd token ger 404. Ingen fysisk
mobil, skärmläsare eller skrivare har verifierats. Ingen full workspace-, full
integrations- eller full browserregression kördes; de skulle inte ge starkare
belägg för denna avgränsade publika read-projektion.
