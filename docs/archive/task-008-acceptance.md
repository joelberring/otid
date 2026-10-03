# TASK 008 – acceptans 2026-09-06

Det avgränsade privata speakerunderlaget är klart som mjukvarusnitt enligt
TASK_008_PRIVATE_SPEAKER_BOARD.md och ADR-0058/0059/0060. Hela V1, fullständigt
speakerläge och produktions-/hårdvaruverifiering är inte klara.

## Kravvis evidens

Sökvägar i tabellen avser repositoryt. Inga mockade databasgränser används
som ersättning för PostgreSQL-proven nedan.

| Acceptans | Evidens |
| --- | --- |
| 1. Smal auth, skrivfri läsning och revocation-konkurrens | `packages/application/test/integration/task-008-speaker.test.ts`: race/capability, expiry, credential- och sessionsspärr under verkliga PG-låsväntningar, reader-first, MVCC-guard, auditfotavtryck. Separata web security/route/wrapper-prov. |
| 2. Senaste publicerade huvud före limit, stabil ordning/retry | Samma PG-fil: högre opublicerad revision, äldre tidsstämpel på högre publicerad revision, UUID-tie, fler än 25 entries, duplicate-ingest utan ny rad. |
| 3. Central manuell livscykel och full historik | `task-008-speaker-manual.test.ts`: DSQ, approval, DNF, OOC, NT över senare teknik, manuellt DNS och faktisk avpricknings-DNS/FINISH_CORRECTION. `task-008-speaker-history-cap.test.ts`: 25 importerade entries, riktiga readouts och DISQUALIFY/WITHDRAW-tjänster ger exakt 1 000 beständiga beslut och 25 effektivt DSQ-rader; DB-count 1 001 ger fel för hela läsningen. `speaker-board-boundaries.test.ts` täcker dessutom summering över samlingar före resolver. Korrupt revisionsunderlag avvisas i PG. |
| 4. Tillåtna tider och historisk klass med aktuella visningsuppgifter | Manuella PG-prov samt kontrakts-/renderprov förbjuder tider för NT/DNS/DNF/NO_ACTIVE_RESULT. Nytt prov i `task-008-speaker.test.ts` ändrar namn, klubb, klass och klassnamn via riktig IOF-import: originalrevision är oförändrad och visas med historisk klassidentitet/aktuellt namn; senare riktig ingest ger revision 2 i nya klassen. |
| 5. Minimering och strikt DTO | `packages/contracts/test/speaker-board.test.ts`, application boundary-prov och PG-svarets förbjudna fält: extra fält, fel slots/overflow, dubbla entry-id:n, lika tillåtna namn, effektiv status/tidsmatris. Ingen ranking härleds ur urvalet. |
| 6. Browser, offline och privat lagring | `tests/e2e/task-008-speaker.spec.ts`: loginrace, tomt lopp, faktisk ingest och autopoll, expiry, dold flik/abort, sena svar, nätfel/återanslutning, logout/revoke, Web Storage/cache och 390px-layout/touchmått. `task-008-speaker-manual.spec.ts`: faktisk DNS-withdrawal trots oförändrad snapshot och verklig tillbaka-navigation. |
| 7. Slutkommandon | Nedan redovisas både tidigare fel och slutliga gröna körningar. |

## Slutkommandon och exakta utfall

Alla körningar använde `CI=true`. Databastester och browser använde endast
`otid_006w_review_schema` på lokal PostgreSQL 55432. Browser hade lika
`DATABASE_URL` och `TEST_DATABASE_URL` till denna databas.

- `pnpm lint`: exit 0.
- `pnpm typecheck`: exit 0.
- `pnpm test`: slutlig omkörning exit 0; 219 filer, 1 427 tester.
- `pnpm build`: exit 0.
- `pnpm --filter @o-tid/application test:integration`: slutlig isolerad
  omkörning exit 0; 19 filer, 232 tester, 63,49 s. Historiktaket tog 23,236 s.
- `pnpm exec tsc --noEmit -p tests/e2e/tsconfig.speaker.json`: exit 0.
- Riktad ESLint för båda speaker-specarna och båda Playwright-konfigurationerna,
  med `projectService:false` och `tests/e2e/tsconfig.speaker.json`: exit 0.
- `pnpm exec playwright test --config tests/e2e/playwright.speaker.config.ts`:
  exit 0; 6/6, 23,9 s.
- `pnpm exec playwright test --config tests/e2e/playwright.speaker-production.config.ts`:
  exit 0; 1/1, 10,0 s. Faktisk `pageshow.persisted=false`, observerat
  `response-cache-control-no-store` och ny sessionkontroll före privat data.
- Efteråt: inga lyssnare på testportarna 3108/3110/3111 och inga kvarvarande
  `otid-speaker-production-*`-kataloger i testets tempkatalog.

Loggar: `/private/tmp/otid-008-acceptance-{lint,typecheck,unit-retry,build,integration-retry,browser-typecheck,browser-lint,browser,production}.log`.

## Fel före gröna slutkörningar

- Första riktade PG-körningen: 11/12 godkända, exit 1. Det nya klass-/namnprovet
  passerade, men befintligt CLI-prov nådde Vitests femsekundersgräns. Fyra
  riktiga CLI-processer har var sin 15 s timeout; provet har nu explicit
  65 s totalgräns. Inga assertioner eller kommandon togs bort. Slutlig full
  PG-körning bekräftar alla tolv prov i filen.
- Första `pnpm test`: exit 1, timeout i befintligt IOF-prov för 100 byteidentiska
  serialiseringar under samtidiga lint/typecheck/test-körningar. Omkörning
  utan lint/typecheck parallellt passerade med oförändrat IOF-prov och kod.
  Första loggen är `otid-008-acceptance-unit.log`.
- Första fulla PG-körningen: exit 1, 231/232 godkända. Raceöversiktens globala
  skrivfotavtryck såg +21 auditposter/+20 revisioner medan andra testskrivningar
  överlappade. Båda nya speakerproven passerade. Processkontroll före omkörning
  visade inga andra Vitest-processer; hela sviten passerade då utan ändring av
  skrivfrihetsprovet. Första loggen är `otid-008-acceptance-integration.log`.
- Agentens förstärkta riktade historikprov gav även sandbox-EPERM och två
  avslutade observationer utan testslutrapport. De räknas inte som godkända;
  main-agentens två fulla PG-körningar verifierade det förstärkta provet.

## Kvarvarande antaganden och begränsningar

- Äkta bfcache-gren är bara handlerprovad, inte fältverifierad; ADR-0060
  kräver inte att browsern cachelagrar privat no-store-data.
- Fysisk mobil, flera browsers, produktionslast och verklig hårdvara är
  overifierade. Syntetiskt simulatorunderlag innebär inte SPORTident-stöd.
- Migrering till 0036/0037, skrivstopp/restore enligt ADR-0059, TLS,
  credentialprovisionering och övrig produktionsdrift kräver separata driftsteg.
- Ingen privat tävling, manuell demodatabas, Eventornyckel, karta eller fil i
  Downloads ändrades. Ingen stafett, GPS eller riktig USB tillkom.
- Detta test-only-slutsteg ändrade inte produktionskod, schema, dependencies
  eller domänregler. Android-/hårdvarusviter och andra browserpaket kördes inte
  om eftersom dessa delar inte ändrades; de påstås inte nyverifierade här.

Nästa minsta vertikala uppgift: gör den befintliga privata klassbyteslistans
läsning spärrsäker under konkurrens med logout/revocation genom ADR-0059:s
protected-read-gräns, med ett reproducerande PostgreSQL-prov. Bredda inte
speakerfunktionen eller behörigheten samtidigt.
