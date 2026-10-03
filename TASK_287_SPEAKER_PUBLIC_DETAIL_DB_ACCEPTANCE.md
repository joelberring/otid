# TASK287: speaker till publik deltagardetalj mot isolerad PostgreSQL

Status: genomförd, riktat HTTP-/databasverifierad 2026-10-01.

## Mål och gräns

Återanvänd TASK089/090:s enda verkliga browserfall för att öppna
TASK286:s exakta ledarlänk, från administratörens Speaker till publik
deltagardetalj och kontrolltider. Ingen ny svit eller produktändring.
Sol-agenten utökar bara befintligt test; huvudagenten kontrollerar
miljön och kör riktad E2E-lint/typecheck samt just detta fall.

## Isolering

Återanvänd vår egen stoppade PostgreSQL17-kluster i
`/private/tmp/otid-task277-pg17.SqxumYWS/data` efter process-/portkontroll.
Skapa ny tom `otid_task287_synthetic_20261001`, migrera enbart den och
sätt samma uttryckliga DATABASE_URL/TEST_DATABASE_URL. Ingen demo,
`.env.local`-databas, Eventornyckel eller användardata. Next binder
loopback3123. Bevara syntetiska DB-rester och stoppa egen PG efteråt.

## Acceptans och justerad negativ gräns

- Exakt lagrat publicResultId i ledarlänken, inte namnmatchning.
- Riktig popup öppnar rätt publicerade person och kontrolltider.
- Speakerflikens term/underlag kvarstår; privat feed får inga gissade länkar.
- Befintligt okänt publicResultId ger 404 utan privata uppgifter.

TASK286 nämnde återkallat resultat som nästa negativa kontroll. Det
finns ingen identifierad generell återkallningsåtgärd för vanliga
publicerade resultat. Revisioner är immutabla: testet får inte slå
`published=false` på historiken för att fabricera ett sådant flöde.
Därför verifieras befintlig okänd-ID-gräns här; verkligt återkallat
resultat är uttryckligen inte bevisat eller implementerat av detta snitt.

Ingen domän-/API-/teknikändring, ADR, fysisk mobil, hårdvara eller bred
resultatsvit ingår. Produktbygget från TASK286 ändras inte av testet.

## Genomfört och resultat

TASK089/090:s enda befintliga fall fick TASK287 i titeln. Efter dess
publika mobil-/favoritkontroller utfärdas syntetisk MANAGE_RACE-behörighet
för samma lopp. På desktop1280 öppnar administratören Under → Speaker,
hämtar ledare uttryckligen, söker Ada och öppnar namnlänken. Popupen
har exakt lagrat publicResultId, Ada Löpare, sluttid 20:00 och kontroll
31 med tid 10:00. Speakerterm ”Ada” ligger kvar. Ingen privat feedlänk
finns. Befintlig publik detaljkontroll hittar inte interna ID-/råfält;
okänt resultat-ID ger 404. Ingen API-trafik avlyssnas eller fabriceras
för det tillagda speakerflödet. Popupen stängs i finally.

- `CI=true pnpm db:migrate`, med uttrycklig TASK287-DATABASE_URL:
  exit 0, migrationer klara.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.public-result-detail.json`:
  exit 0 efter slutlig teständring.
- `CI=true pnpm exec eslint tests/e2e/task-089-public-result-detail.spec.ts tests/e2e/playwright.public-result-detail.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.public-result-detail.json"}'`:
  exit 0 efter slutlig teständring.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.public-result-detail.config.ts --grep TASK287`,
  med lika isolerade DATABASE_URL/TEST_DATABASE_URL: exit 0,
  **1/1 på 12,3 s**, en enda browserkörning.
- Produktlint/typecheck/build återkördes inte: ingen produktkod ändrades.
  TASK286:s webblint/typecheck/build har exit 0. Denna körning verifierar
  verklig HTTP/DB, inte ett nytt produktbygge.

## Miljö och bevarade rester

Läsande version/processkontroll identifierade PostgreSQL17.11, PID28098,
loopback55460 i vår angivna kluster. Testdatabasen var ny och migrerades
före fixturen; PostGIS3.6.4 verifierades. En första läsande antalfråga
använde fel plural-tabellnamn och fick SQL-fel, utan någon skrivning;
korrekt fråga visade en rad vardera i event, race, entry, result_revision,
raw_device_message och pairing_admin_access_credential. Endast syntetiska
data, bevarade för felsökning. Ingen databas raderades. Egen pg_ctl-stop
exit 0; efterkontroll fann inga lyssnare på55460/3123.

## Kvarvarande antaganden

- Popupen är verkligt HTTP-/DB-verifierad på desktop; fysisk mobil,
  skärmläsare, regn/glare och internetinstallation är inte bevisade.
- Mobilens publika detalj och favoritflöde ingick i samma befintliga fall;
  mobilens speakerlänk är bara syntetiskt layoutverifierad i TASK286.
- 404 för okänt ID är inte ett prov av ett återkallningsarbetsflöde.
- Ett enda enkelt OK-resultat/klass används; delad ledning och MP/status-
  presentation är endast TASK284–286:s syntetiska UI-bevis här.

Nästa minsta vertikala uppgift: ett manuellt acceptanspass av samma
speaker → deltagardetalj-väg på en fysisk mobil i uttryckligen vald
testinstallation. Återanvänd flödet; bygg ingen ny testsvit.
