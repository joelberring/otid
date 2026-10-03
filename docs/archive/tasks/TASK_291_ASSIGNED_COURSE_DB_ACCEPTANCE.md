# TASK291 – tilldelad och historisk bana efter klassbyte

## Avgränsning

Återanvänd TASK029:s befintliga desktopbrowserfall med riktig Next-HTTP
och en ny isolerad syntetisk PostgreSQL-databas. Endast detta fall får
två skilda banversioner med samma kontrollkod 31. Ingen produktkod,
domänregel, demo eller riktig tävling ändras; ingen ny testsvit.

## Acceptans

- Före första resultatet visas aktuell tilldelad Minutstartbana.
- Ingest och omberäkning behåller denna banversion i resultatrevisionen.
- Efter klassbyte tillbaka visas tilldelad Testbana, medan resultatets
  historiska kontrollunderlag fortfarande visar Minutstartbana.
- Det befintliga klassbytes-/retryflödets kontroller förblir gröna.

Detta är testdata/prov av beslutad arkitektur och kräver ingen ny ADR.
Fysisk mobil, hårdvara och verklig tävlingsacceptans ingår inte.

## Verifiering

Klart 2026-10-02. Riktad E2E-TypeScript/ESLint passerade med exit 0 även
efter testkorrigeringen. Första browser-
körningen gav exit 1: testet sökte INFO-sektionen medan klassbytesläget
fortfarande var öppet. Testets navigering rättas genom vanligt deltagarval,
inte genom produktändring eller kringgående av arbetsläget.

Ny databas: `otid_task291_synthetic_20261002`, PostgreSQL17.11.
Migration exit 0, PostGIS3.6.4. Andra körningen passerade: 1/1, 49,7 s,
exit 0. Endast befintliga 1366 px-fallet kördes. Ingen produktkod ändrades;
webblint/typecheck/build från TASK290 kördes därför inte om.

Efter två körningar finns 2 event, 2 lopp, 5 deltagarposter,
2 resultatrevisioner, 1 råmeddelande och 3 klassbytesbegäranden i den
syntetiska databasen. Data bevarades, egen PostgreSQL stoppades med exit 0.
Port55460/3122 saknade lyssnare efter avslut (lsof exit1, tomt svar).

Kommandon (DATABASE_URL/TEST_DATABASE_URL sattes till samma nya testdatabas):

```bash
CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep 'TASK029 samma login och verkligt klassbyte 1366'
```

## Kvarvarande antaganden och nästa snitt

Detta bevisar syntetisk datoranvändning mot riktig HTTP/PostgreSQL, inte
fysisk mobil eller fältbruk. Banorna har avsiktligt samma kontrollkod;
historisk banidentitet/version är verifierad, inte alla möjliga banbyten.
Nästa minsta utvecklingssnitt är en tydlig, kompakt hänvisning från
deltagarens tilldelade bana till dess befintliga läsande banöversikt.
