# TASK071: filter för äldre resultat i administratörens deltagarlista

Implementerad och riktat verifierad 2026-09-18 som nästa minsta vertikala
snitt efter TASK070. Ingen produktionsdriftsättning ingår.

## Användarvärde

Administratören ska kunna begränsa den kompakta deltagarlistan till deltagare
med ett gällande resultat från en äldre tävlingsversion, utan att söka fram
eller öppna varje deltagare.

## Arkitektur och avgränsning

- Filtret använder endast det befintliga serverhärledda
  `resultFreshness === "OLDER_SNAPSHOT"` från ADR-0099.
- Filtreringen är lokal och läsande. Den gör inga nya HTTP-anrop, skrivningar
  eller automatiska omräkningar.
- Söktext och aktualitetsfilter kombineras som ett snitt.
- Byte av filter återställer listans sida till den första, men bevarar valt
  deltagarärende i arbetsytan.
- Utloggning återställer filtret. Vanlig uppdatering bevarar det på samma sätt
  som befintlig söktext.
- Ingen kontrakts-, server-, databas-, behörighets- eller dependencyändring.

Ingen ny ADR behövs: detta är en presentationsfunktion ovanpå den redan
beslutade och validerade semantiken i ADR-0099. Ingen licensfråga tillkommer.

## Berörda delar

- `apps/web/src/components/race-administrator-workspace.tsx`
- `apps/web/src/components/race-administrator-workspace.module.css`
- `apps/web/src/i18n/race-administrator-sv.ts`
- befintligt riktat TASK065–070-browserfall

## Acceptans

1. Avstängt filter visar både aktuell/utan resultat och äldre resultat enligt
   befintlig sökning och pagination.
2. Aktiverat filter visar endast `OLDER_SNAPSHOT` och räknaren avspeglar det
   filtrerade antalet.
3. Sökning och filtret ger skärningen av villkoren; söktexten bevaras när
   filtret växlas.
4. Filterbyte återställer pagination till sida ett och bevarar valt ärende.
5. Växlingen gör inget nytt `transfer-candidates`-anrop och ingen skrivning.
6. Utloggning rensar filterläget.

## Verifieringsplan

Kör webblint och webtypecheck, E2E-tsconfig och riktad ESLint, samma enda
TASK071-browserfall mot isolerad PostgreSQL samt webbuild. Ingen ny enhets-
eller bred regressionssvit behövs för denna lilla presentationstråd.

## Utfall

Den gemensamma deltagarlistan har nu en touchvänlig checkbox "Visa endast
äldre resultat". Den använder enbart rosterposternas serverhärledda freshness,
kombineras med sökningen och nollställer sidindex. Vald deltagare och söktext
bevaras. Utloggning rensar filtret.

Ett riktat browserfall med 27 syntetiska deltagare verifierar två sidor,
filtrering till exakt den äldre posten, söksnitt, bevarat urval och noll nya
rosteranrop. Statiska kontroller och webbuild är gröna; exakta resultat finns
i `docs/status.md`.
