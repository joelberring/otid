# TASK090: lokala favoriter i publikresultat

Påbörjad 2026-09-19 som nästa minsta deltagarsnitt efter TASK089.

## Användarvärde

En löpare, anhörig eller ledare kan på sin egen telefon eller dator markera
redan synliga deltagare som favoriter och snabbt begränsa den publika
resultatlistan till dem. Valet finns kvar i samma webbläsare när sidan laddas
om, men kräver varken konto eller installation.

## Arkitektur och avgränsning

- Favoriter är en lokal browserpreferens, inte en deltagar-, resultat- eller
  behörighetsmodell. Nyckeln består enbart av den redan publika `raceId` och
  `publicResultId`; namn, klubb, bricknummer och interna id:n sparas inte.
- Vyn filtrerar endast den redan validerade publika listan lokalt. Den ändrar
  inte polling, cache, serverfråga, kontrakt, databas eller publiceringsregel.
- Lagring ska vara defensiv: otillgänglig eller korrupt browserlagring gör bara
  favoritfunktionen tillfälligt otillgänglig och får aldrig dölja resultat eller
  blockera sidan.
- Funktionen får inte skapa inloggning, synka favoriter mellan enheter, bygga
  profil, exponera rawdata eller påbörja karta, GPS, spåranalys, stafett eller
  hårdvarustöd.

Ingen ADR behövs: en lokal, återställbar preferens ändrar inte teknikval,
beständig servermodell eller domängräns.

## Berörda delar

- liten ren helper för format/validering av lokal favoritnyckel,
- `PublicResults` med tydlig favoritmarkering och avgränsat filter,
- svenska texter och responsiv/printmedveten presentation,
- riktade helper-/komponenttester; ingen PostgreSQL- eller bred browserkedja
  om servergränsen förblir oförändrad.

## Acceptans

1. En format7-rad kan markeras och avmarkeras med text och touchvänlig knapp.
2. Favoriter överlever omladdning i samma browser och är strikt racebundna.
3. Filtrering till favoriter kan slås av och återställer den vanliga listan;
   den kombineras förutsägbart med befintlig namn-/klassökning.
4. Korrupt/otillgänglig lagring kan inte krascha, dölja eller ändra publik data.
5. Varken DOM, localStorage eller nätanrop innehåller interna id:n, brickor,
   rawdata, audit eller någon ny privat identifierare.

## Verifieringsläge 2026-09-19

- `CI=true pnpm --filter @o-tid/web exec vitest run
  src/lib/public-result-favorites.test.ts src/lib/public-results-filter.test.ts
  src/components/public-results-ui.test.tsx`: exit 0, 3 testfiler och 12/12
  tester på 18 ms;
- web lint/typecheck: exit 0;
- `CI=true pnpm exec tsc --noEmit -p
  tests/e2e/tsconfig.public-result-detail.json` och riktad E2E ESLint: exit 0;
- det återanvända, enda publika 390 px-browserfallet mot riktig Next/HTTP och
  isolerad PostgreSQL17/PostGIS: exit 0, 1/1 test på 3,4 s. Det markerar en
  favorit, kontrollerar `aria-pressed`, laddar om, växlar favoritfilter och
  bekräftar att lokal lagring innehåller endast opaque race-/resultatidentitet;
- web production build: exit 0; 3,0 s kompilering, 3,2 s TypeScript och 7/7
  statiska sidor på 50 ms; checkin-skalets hash `00ac7b3d5acc`.

Ingen serverwrite, migration, ny databas-/kontraktstest eller extra
browsermiljö behövdes. Fysisk mobil, privat webbläsarläge och skärmläsare är
inte verifierade.
