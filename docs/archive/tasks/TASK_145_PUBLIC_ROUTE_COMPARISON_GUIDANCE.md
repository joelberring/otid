# TASK145: begriplig vägledning när publik ruttjämförelse saknas

Status: slutförd och riktat verifierad 2026-09-22.

## Syfte

En besökare som har valt två deltagare för den befintliga publika
ruttjämförelsen ska få en kort svensk vägledning när de två valen inte kan
jämföras. I dag visas samma generella fel för ett legitimt men inkompatibelt
val som för ett tillfälligt tekniskt fel.

## Avgränsning

- Återanvänd den befintliga tokenfria, skrivskyddade ruttjämförelsevägen.
- Tolka endast dess avsiktliga HTTP 404 som att den valda kombinationen inte
  kan visas. Svaret ska fortsatt inte avslöja om orsaken är saknat samtycke,
  återtagen release, annan historisk karta/bana eller annan privat grind.
- Visa en annan, neutral text vid nätfel, 5xx eller ogiltigt kontrakt.
- Behåll exakt två rutter, befintlig releasegrind, pixelgeometri, relativ
  GPX-uppspelning och officiella resultatsplits oförändrade.

## Arkitektur

Detta är en klientpresentation av redan etablerade publika HTTP-statusar. Det
ändrar inte kontrakt, datamodell, behörighet, resultatregel eller teknikval;
ingen ADR behövs.

## Acceptans

1. En HTTP 404 visar en begriplig, neutral förklaring och inga interna eller
   personliga identiteter.
2. Annat fel visar fortsatt ett generellt, temporärt otillgänglighetsbesked.
3. Ett giltigt jämförelseunderlag påverkas inte.
4. Det riktade browserfallet är läsbart utan horisontell sidscroll vid 390 px.

## Utanför uppgiften

Ingen fler-ruttsjämförelse, kart-/OMAP-import, vägvals- eller tempoanalys,
GPS-live, ny lagring, ny writer, stafett eller USB-funktion ingår.

## Utfört

Klienten skiljer nu den befintliga, avsiktligt informationsfattiga HTTP 404-
grinden från nät-/server-/kontraktsfel. En 404 beskriver enbart att den valda
kombinationen saknar två jämförbara publika rutter på samma historiska karta
och bana. Den röjer inte vilken intern release-, samtyckes- eller
provenienskontroll som avvisade kombinationen. Övriga fel är fortsatt
temporära och generella.

Riktad verifiering med syntetiska UUID:n och en ny tom migrerad
PostgreSQL17/PostGIS-databas:

- `CI=true pnpm --filter @o-tid/web typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/web lint`: exit 0.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.public-map.json`:
  exit 0.
- `CI=true pnpm exec eslint tests/e2e/task-106-public-map.spec.ts
  tests/e2e/playwright.public-map.config.ts --parser-options
  '{"projectService":false,"project":"tests/e2e/tsconfig.public-map.json"}'`:
  exit 0.
- `CI=true ... pnpm exec playwright test --config
  tests/e2e/playwright.public-map.config.ts --grep 'TASK121|TASK145'`: exit 0,
  3/3 browserfall.
- `CI=true pnpm --filter @o-tid/web build`: exit 0; Next kompilerade på 2,0 s,
  TypeScript på 1,4 s och byggde 10/10 statiska sidor.

Ingen full workspace-svit, fysisk mobil, verklig GPS-rutt, OMAP, extern tjänst,
Eventor, SPORTident eller tävlingsdata användes.
