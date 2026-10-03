# TASK101: Explicit produktionsprofil för read-only Eventor-import

Påbörjad 2026-09-19 efter TASK098. ADR-0116 är skriven före kod.

## Användarvärde

En arrangör kan, efter privat betrodd provisionering, använda samma granskade
importflöde mot Eventor Sverige som mot Testeventor utan att blanda miljöer,
läcka nyckeln eller få en falsk bild av att synk eller uppladdning stöds.

## Avgränsning

- En fast `production-se`-profil för `https://eventor.orientering.se` vid
  adaptergränsen, parallellt med oförändrad `testeventor-se`.
- Endast befintlig metadataimport och TASK098:s individuella, explicit
  mappade Entry-import; samma strikta XML-subset och hashing.
- Immutable profilbunden anslutning/provenans, serverkrypterad ApiKey och
  explicit privat CLI-provisionering.
- Syntetiska tester för båda profiler. Ingen verklig nyckel, Eventor-request
  eller produktionspersondata under utveckling.

## Utanför uppgiften

- Eventor-skrivning, start-/resultatuppladdning, automatisk uppdatering eller
  avanmälning, brick-/starttidsimport, team/stafett och bred synk.
- Klientvald origin, ny browserinloggning, ny behörighetsmodell, GPS, karta,
  station eller USB.
- Liveacceptans; den är en senare, ägarstyrd operativ kontroll.

## Acceptans

1. En connection och importjournal har immutable `testeventor-se` eller
   `production-se`; äldre Testeventor-rader är giltiga oförändrade och samma
   externa event-id kan finnas en gång per profil.
2. Den krypterade nyckeln är bunden till profilen; korsad profil, fri URL,
   redirect eller fel origin avvisas före importwrite.
3. Adapterläsning använder exakt profilens dokumenterade origin och befintliga
   event-/eventklass-/entry-endpoints, ApiKey endast i header, samma timeout,
   bytegränser och strikta individuella parserregel.
4. UI och CLI visar/kräver en explicit profil (CLI: `--profile testeventor-se`
   eller `--profile production-se`) utan att nyckeln når browser,
   argv, URL, svar eller logg.
5. Eventor-importens befintliga idempotens, grants, lokala rättningsspärrar och
   read-only-avgränsning gäller identiskt per profil.
6. Riktade adapter-, kontrakts-/schema-, PostgreSQL- och ett browser/CLI-fall
   passerar med syntetiskt underlag. Liveanrop påstås inte.

## Berörda delar

`packages/eventor`, `packages/contracts`, `packages/database`,
`packages/application`, provisionerings-CLI och befintlig Eventor-adminvy.
Domänresultat, station, fysisk USB, karta/rutt, GPS och stafett ändras inte.

## Verifieringsplan

Ett adapterfall per profil låser origin/path/header och felgränser. Ett
PostgreSQL-fall låser immutable profil, AAD och profilseparerad extern
provenans. Ett befintligt browserflöde visar vald profil men använder route-
dispatch med syntetiskt svar. Berörda lint/typecheck/build körs efter sista
ändringen. Ingen bred workspace- eller live-Eventor-körning behövs.

## Genomförd verifiering (2026-09-20)

- `CI=true pnpm --filter @o-tid/eventor exec vitest run test/eventor.test.ts`:
  exit 0, 1 fil / 18 tester. Det nya syntetiska fallet låser både
  produktionsorigin, sökvägar och ApiKey-header utan nättrafik.
- `CI=true pnpm --filter @o-tid/contracts exec vitest run test/eventor-import.test.ts`:
  exit 0, 1 fil / 5 tester. Kontraktet accepterar endast de två stängda
  profilerna och ingen URL.
- `CI=true pnpm --filter @o-tid/application exec vitest run test/eventor-secret.test.ts`:
  exit 0, 1 fil / 34 tester. Production-envelope kan inte öppnas som
  Testeventor.
- På ny, tom, isolerad PostgreSQL17/PostGIS på loopback migrerades schemat
  och `CI=true pnpm --filter @o-tid/application exec vitest run
  test/integration/task-006v.test.ts -t TASK101` gav exit 0: 1 passerat och
  8 avsiktligt bortvalda fall. Samma externa event-id importerades syntetiskt
  en gång per profil och journalen hölls separat.
- `CI=true pnpm exec playwright test tests/e2e/task-006v.spec.ts` mot en ny,
  migrerad, isolerad PostgreSQL17/PostGIS på loopback gav exit 0: 2 passerade
  browserfall. Adminvyn visar den lagrade produktionsprofilen medan upstream-
  XML fortfarande injiceras syntetiskt.
- Lint/typecheck passerar med exit 0 för `@o-tid/eventor`, `contracts`,
  `database`, `application` och `web`; scriptets lint/typecheck och E2E-filen
  passerar också. `CI=true pnpm --filter @o-tid/web build` gav exit 0.

Ingen faktisk Eventor/Testeventor-request, API-nyckel, produktionspersondata
eller skrivning till Eventor användes. CLI:s `--profile` är typ- och
lintkontrollerad samt binder till samma servervaliderade profil; en verklig
produktionsprovisionering kräver fortfarande ägarens privata nyckel och en
separat operativ acceptans.
