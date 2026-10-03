# TASK 130: direktuppdaterad publik deltagardetalj

## Status

Klar.

## Mål

En redan öppen publik detaljsida för en deltagare ska hämta om exakt sin egen
offentliga resultatdetalj direkt när TASK129:s race-scopade SSE-signal kommer.
Den ska behålla femsekunderspolling när EventSource eller nätet inte fungerar.

## Beslut och avgränsning

ADR-0135 och TASK129 gäller oförändrat. Ingen ny ADR, migration, endpoint,
kontraktsversion eller händelsepayload behövs: detaljsidan återanvänder samma
no-PII `refresh`/`reset`-signal och hämtar alltid sin redan runtimevaliderade
`/api/public/races/{raceId}/results/{publicResultId}`-resurs.

Ingår endast i `PublicResultDetail`:

- gemensam validerad refresh för SSE och femsekundersreserv;
- spärr mot överlappande hämtningar och cleanup när sidan lämnas;
- tydligt `unavailable` om den exakta publika detaljen inte längre finns.

Ingår inte: resultatlogik, ny data i SSE, karta, rutt, GPS, uppspelning,
favoriter, deltagarkonto, Eventor, stafett, SPORTident eller USB.

## Acceptans

1. `refresh` och `reset` leder till en ny validerad läsning av exakt samma
   race- och `publicResultId`; strömmen väljer aldrig en annan deltagare.
2. En resultaträttning blir synlig på en redan öppen detaljsida utan att
   invänta femsekunderspollingen.
3. Icke-OK, ogiltigt format eller saknad detalj visar fortsatt den befintliga
   otillgänglighetsgrinden; transportfel behåller senast verifierad vy.
4. Dubblett-signaler och poll får inte skapa överlappande hämtningar.
5. Sidan stänger EventSource vid cleanup och ingen kart-/ruttdata påverkas.

## Verifiering

Browserprovet använder en uttryckligen isolerad migrerad PostgreSQL/PostGIS
med syntetisk tävling och lokal loopback. Kör sekventiellt med andra writers.

```bash
CI=true pnpm --filter @o-tid/web exec vitest run src/lib/public-result-event-stream-client.test.ts src/components/public-results-ui.test.tsx
CI=true pnpm --filter @o-tid/web lint
CI=true pnpm --filter @o-tid/web typecheck
CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.public-result-detail-event-stream.json
CI=true pnpm exec eslint tests/e2e/task-130-public-result-detail-event-stream.spec.ts tests/e2e/playwright.public-result-detail-event-stream.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.public-result-detail-event-stream.json"}'
CI=true pnpm exec playwright test --config tests/e2e/playwright.public-result-detail-event-stream.config.ts
CI=true pnpm --filter @o-tid/web build
```

## Resultat

- webbenhet: 2 filer, 11 tester passerade;
- web lint och typecheck: exit 0;
- E2E TypeScript och ESLint: exit 0;
- Playwright: 1/1 passerade på 6,0 s vid 390 px;
- webproduktionsbygge: exit 0 (kompilering 3,8 s, TypeScript 1 217 ms).

Browserprovet använde bara en lokal, isolerad PostgreSQL/PostGIS med syntetisk
IOF-import och stationssimulator. Det öppnade Adas detaljsida efter ett
godkänt resultat och verifierade att en andra avläsning med saknad kontroll
uppdaterade samma sida till felstämplat inom fyra sekunder.

## Kvarvarande antaganden

- TASK129:s SSE endpoint och dess pollingreserv är aktiva i webbdrift.
- Fysisk mobil, extern HTTPS-proxy och publik lastacceptans ingår fortsatt
  inte i detta rena klientåteranvändningssnitt.
