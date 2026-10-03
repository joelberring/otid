# TASK106: privat kartbild och explicit kartsläpp

Påbörjad 2026-09-20. ADR-0120 är skriven före produktkod.

Status: genomförd som avgränsat kartsläpp. Kontrakt, additiv datamodell,
privat versionsadapter, idempotent applikationskedja, skyddade
administratörsroutes, publik serverleverans och responsiva UI-skal är
implementerade och riktat verifierade. Riktig MinIO-/fysisk-mobilacceptans
kvarstår uttryckligen som driftsantagande.

## Användarvärde

Efter en individuell tävling kan arrangören göra **en vald, renderbar
kartbild** tillgänglig från den publika resultatsidan. Deltagaren behöver inte
leta efter en extern tjänst eller få en gissbar objektlagringsadress. Före
det explicita kartsläppet är samma karta privat.

## Avgränsning

- Exakt ett aktuellt publicerat kartunderlag per race, med append-only
  uppladdnings- och publiceringshistorik.
- Första format är endast validerad `image/png` och `image/jpeg`. Kartbilden
  visas i browsern med zoom och pan; den ersätts aldrig på samma objektversion.
- En `MANAGE_RACE`-administratör väljer, granskar, publicerar eller återtar
  kartan i samma race-bundna administratörssession som övriga tävlingsarbete.
- Objektlagringen är privat. Publik filhämtning går genom servern och
  kontrollerar aktuell release vid varje ny hämtning; inget bucketnamn,
  object key, version-id eller intern UUID exponeras.
- `.omap` är en privat källfil och kan inte väljas eller publiceras i detta
  snitt. En särskild renderer-/importadapter behövs innan OMAP kan bli en
  renderbar kartbild.
- Ingen PDF, SVG, GeoTIFF, world file, georeferering, banpåtryck,
  kontrollöverlägg, GPS/GPX/FIT/TCX, ruttkoppling, uppspelning, deltagarspår,
  stafett eller Livelox-data/UI ingår.

## Berörda delar

- `packages/contracts`: strikta upload-, preview-, publish- och
  withdrawal-kontrakt samt den lilla publika kartprojektionen.
- `packages/database`: additiv immutable kartasset-/manifest-/releasejournal
  med återställningsnot; PM-tabeller och PM-capability ändras inte.
- `packages/infrastructure`: en särskild privat kartasset-adapter ovanpå
  beslutat versionsstyrt objektlager, utan PM-prefix eller PDF-antaganden.
- `packages/application`: korta idempotenta reservationer, manifestcommit,
  release/withdraw och läsning. Resultatdomänen ändras inte.
- `apps/web`: administratörens tvåstegsflöde, publik race-/deltagarsidelänk
  och responsiv bildvisare.

## Acceptans

1. En giltig PNG/JPEG kan laddas upp till ett privat race-scopat asset;
   filens deklarerade och lästa hash, längd och bildtyp matchar innan manifest
   blir klart. Fel typ, fel hash/längd eller okänt lagringsutfall blir aldrig
   publicerbart.
2. Samma upload-/publish-/withdraw-intent med samma idempotensnyckel återger
   samma kvittens. Ändrad aktör, race eller intent konflikterar utan en andra
   logisk release.
3. Opublicerad, återtagen eller ersatt karta är inte åtkomlig via varken den
   publika sidan eller en gammal känd URL. En redan påbörjad leverans får
   avslutas, men nya hämtningar stängs av.
4. Den publika resultatsidan och enskilda deltagarsidan visar en svensk
   kartlänk endast när aktuell release finns. Bildvisaren fungerar utan login
   vid 390 px och desktop, med zoom/pan och utan horisontell sidscroll.
5. Svar innehåller inga interna lagringsidentifierare och får `nosniff` samt
   cachepolicy som inte gör en återtagen karta tillgänglig från delad cache.
6. PM-PDF-flödet, resultatens publicering/ranking, stationens offlinekö och
   privata OMAP-källor ändras inte.

## Verifieringsplan

Riktade kontrakts- och adapterprov täcker media-/hash-/längdgränsen,
request-replay, releasehistorik och fail-closed läsning. Ett isolerat
PostgreSQL-/objektlagerprov täcker manifestets exakta objektversion och
simultan release/withdraw. Ett 390 px-browserprov använder riktig Next/HTTP,
syntetisk publiceringsdata och en avlyssnad syntetisk PNG för att kontrollera
den publika visaren, zoom/pan, sidbredd och frånvaro av lagringsidentifierare;
det kontrollerar även det privata administratörsskalet. Berörd lint,
typecheck och webbuild körs efter implementation.

Ingen riktig MinIO-driftsacceptans, CDN/proxycache, fysisk mobil, renderare
för OMAP, karta med rättigheter från arrangör eller produktionstrafik påstås
vara verifierad av detta snitt.

## Aktuell verifiering 2026-09-20

- `CI=true pnpm --filter @o-tid/contracts exec vitest run test/map-asset.test.ts`:
  exit 0; 1 fil och 6 tester godkända.
- `CI=true pnpm --filter @o-tid/contracts lint`: exit 0.
- `CI=true pnpm --filter @o-tid/contracts typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/database lint`, `typecheck` och `test`:
  exit 0; 11 filer och 62 tester godkända.
- Hela migreringskedjan, inklusive migration0065, passerade mot en ny privat
  PostgreSQL17/PostGIS-databas; de fyra TASK106-tabellerna kontrollerades
  därefter med skrivskyddad katalogfråga.
- `CI=true pnpm --filter @o-tid/infrastructure exec vitest run
  test/map-object-store.test.ts`: exit 0; 1 fil och 3 tester godkända.
- `CI=true pnpm --filter @o-tid/infrastructure lint` och `typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/application exec vitest run
  test/integration/task-106-map-asset.test.ts`: exit 0; 1 fil och 1 test
  godkänt mot samma isolerade PostgreSQL17/PostGIS-databas. Det täcker även
  den privata MANAGE_RACE-projektionen före och efter withdrawal.
- `CI=true pnpm --filter @o-tid/application lint` och `typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/map-store.test.ts
  src/components/map-asset-ui.test.tsx`: exit 0; 2 filer och 4 tester
  godkända. De täcker fail-closed serverkonfiguration samt att admin- och
  publikskal saknar objektlagringsidentifierare.
- `CI=true pnpm --filter @o-tid/web lint` och `typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/web build`: exit 0; Next byggde de publika
  kart- och raceadministratörsrutterna som dynamiska Node-rutter.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.public-map.json` och
  riktad ESLint: exit 0.
- `CI=true pnpm exec playwright test --config
  tests/e2e/playwright.public-map.config.ts`: exit 0; 2 browsertester
  godkända på 7,9 s med riktig Next/HTTP på loopback 3125 och samma isolerade
  PostgreSQL17/PostGIS-databas. Bildbytesanropet avlyssnas med en syntetisk
  PNG; MinIO startas inte.

```bash
CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.public-map.json
CI=true pnpm exec eslint tests/e2e/task-106-public-map.spec.ts tests/e2e/playwright.public-map.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.public-map.json"}'
CI=true pnpm exec playwright test --config tests/e2e/playwright.public-map.config.ts
```

Proven täcker PNG/JPEG-gräns, 50 MiB-gräns, canonical titel/hash,
separata reservation-/lagringskvittenser, revision 0 för första release,
idempotensnycklar och frånvaro av interna lagringsfält i publik metadata.
Adaptern provar syntetiskt privat versionslager, magic-byte/mimetype,
versionsbunden läsning och sanerat fel. Webben använder endast privata
`OTID_MAP_STORE_*`-miljövariabler, svarar med `no-store`/`nosniff`, och
omvaliderar aktiv release efter bytesläsningen. Browserprovet bevisar riktig
publik sida och mobilbredd, men inte den serverburna MinIO-läsningen eftersom
bildsvaret avlyssnas. Proven är därför inte bevis för verklig MinIO,
proxy-/CDN-cache, fysisk mobilrendering eller en riktig arrangörskarta.
Integrationsprovet täcker raceadmin, reservation, exakt manifest, första
release, withdrawal, adminprojektion samt lika- och ändrat-intent-retry.

## Migrations- och återställningsnot

Migrationen ska vara additiv. Refererade manifest, releasejournal och
objektversion får aldrig raderas eller skrivas över av snittet. Vid incident
stängs kartupload-/release-routes och publik leverans; historik bevaras.
Återställning kräver både PostgreSQL och de exakt refererade privata
objektversionerna. En senare ersättning eller återtagande är en ny journalrad,
inte en destruktiv rollback.
