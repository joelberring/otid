# TASK255: neutral och kompakt separat Ej start-vy

Status: klar 2026-09-27.

## Användarutfall

Målpersonal ska snabbt kunna se vilka deltagare som faktiskt kan få ett
manuellt Ej start-beslut, vilka som redan har resultat och vad ett beslut
innebär. Desktop ska använda täta rader i stället för stora kort; mobilen
ska behålla tydlig ordning, minst 52 px tryckytor och inget sidspill.

## Arkitekturgräns

Detta är en ren presentationsförbättring av den befintliga separata
`DECIDE_DID_NOT_START`-vyn. Befintlig serverauktorisering,
resultatrevision, idempotency-key, CSRF, kandidatberedskap och
same-id-retry förblir oförändrade. Beslutet får inte förväxlas med
startpersonalens offlineavprickning eller bevis för att ingen är kvar i
skogen. Inga nya domänregler, beroenden, API:er, migrationer eller
teknikval tillkommer; ingen ADR behövs.

## Riktad acceptans

- Neutral vit/grå sidkrom, en konsekvent textskala och kompakt synlig
  gräns för den separata behörigheten och beslutets effekt.
- Lista med namn, klubb, klass, deltagarversion, status, befintlig
  revision och åtgärd. Den blockerade åtgärden ser avaktiverad ut och
  är semantiskt disabled. Saknad/konflikter och osäkert svar signaleras
  med text och sparsam gul/röd accent, aldrig färg ensamt.
- Internet, session och antal beslutsbara kandidater visas utan en hög
  fast toppyta. Osäker commit får en direkt synlig retry-panel med
  bevarat request-id; ingen automatisk omsändning.
- Ett riktat UI-prov och ett syntetiskt browserfall vid 390/1366 px
  täcker normal lista, blockerad åtgärd och same-id-retry. Berörd
  lint/typecheck/build körs; ingen verklig databas eller credential.

## Ingår inte

Ingen ny funktion för avprickning, DNS-återtagande, skogskontroll,
resultatmotor eller administratörsbehörighet. Ingen fysisk mobil-
eller SPORTident-acceptans.

## Utfall och verifiering

Den separata sidan visar internet, session och antal beslutsbara
deltagare kompakt. Desktop använder en tät sexkolumnslista; mobil visar
samma fakta i enkolumnsordning med 52 px-knappar. Rubriken omfattar
också deltagare med tidigare resultat, som syns men inte kan markeras.
Permanenta kontroller är neutrala grå; blocked/disabled har både text
och avaktiverad knapp. Pågående skrivning visas som pågående, medan
endast ett osäkert utfall får gul retry-panel och fokus på den explicita
same-id-knappen. Ingen ny offlinekö eller automatisk retry har införts.

- Riktade UI-/klientprov: 6/6, exit 0.
- Syntetiskt Chromiumprov: 1/1, exit 0 vid 390/1366 px. Normal- och
  retrybilder granskades utan horisontellt sidspill; exakt requestkropp
  och idempotensnyckel återanvändes.
- Webblint, typecheck och build: exit 0 var för sig.
- Riktad E2E-TypeScript och ESLint: exit 0 var för sig.

Första browserstarten nekades av sandlådans loopbackport (`EPERM`);
isolerad lokal omkörning passerade, även efter sista färgjusteringen.
Agentens första `pnpm`-anrop utan `CI=true` stoppades före skripten av
pnpm:s no-TTY-installationsgrind; de slutliga CI-körningarna ovan
passerade.
Det äldre verkliga HTTP/PostgreSQL-provet kördes inte utan uttryckligen
isolerad testdatabas. Ingen riktig credential, fysisk mobil eller
SPORTident-hårdvara verifierades.
