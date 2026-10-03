# TASK 011 – Spärrsäker privat omräkningskandidatlista

Status: klar som avgränsad säkerhetsrättning, 2026-09-07. Hela V1 är inte klar.

## Avgränsning före implementation

För listResultRecalculationCandidatesAsAdmin ska autentisering och privat
DTO-läsning omfattas av samma transaktion enligt accepterad ADR-0059.
Nuvarande kod gör en fristående preflight före race SHARE och kan därmed
returnera deltagardata efter att en spärr committat i mellanrummet.

Berört produktionspaket: packages/application, results.ts. Behåll
READ COMMITTED, race SHARE, RECALCULATE_RESULT, strikt befintligt kontrakt,
ordning, readiness och urval av senaste avläsning/resultatrevision.
Själva omräkningsmutationen, UI, rådata, publicering och offlinekö ändras inte.
Ingen migration, dependency, teknik- eller domängränsändring behövs.
ADR-0059 tillämpas; inga externa licensbelagda källor används.

## Acceptans

- Reproducerande PostgreSQL-prov visar credential- och sessionsspärr i
  preflight/läsningsgapet före fix.
- Spärr som vinner före authgrinden avvisar läsningen.
- Auktoriserad läsare håller spärrgrinden till commit; väntande spärr
  committar därefter och nästa request avvisas.
- Fel capability/race och utgången session avvisas. DTO/readiness och
  skrivfrihet kontrolleras med syntetiska fixtures.
- Lint, typecheck, enhetstester, full PostgreSQL-svit och build körs med
  exakta resultat. Inga andra DB-skrivande tester körs samtidigt.

Agenten äger enbart det nya integrationstestet; main äger taskdokument,
produktionsfix, sekventiella testkörningar och slutrapportering.
Privat tävlingsdatabas, lokala demodatabaser och Eventornyckel lämnas orörda.
Browser-/Android-/hårdvaruprov körs inte om för denna servergränsändring;
detta är inte ett bevis på full produktionsberedskap.

## Reproducerat och rättat

Pre-fix-körningen med -t 'already authorized' gav exit 1: 2 failed och
3 bortvalda. Båda proven committade credential-/sessionsspärr medan läsaren
väntade på race SHARE efter sin preflight; gammal kod returnerade privat OK
i stället för unauthorized. Logg: /private/tmp/otid-011-red.log.

Produktionsändringen flyttar protected-read-auth till början av den befintliga
transaktionen och returnerar status/DTO därifrån. Inga projektionsfält eller
omräkningsregler ändras. Agenten granskade ändringen read-only.

Första fulla riktade post-fix-körningen gav 4/5, exit 1. Samtliga
samtidighetsprov passerade; DTO-provet antog felaktigt Bo i D21.
fixtures/iof/entry-list.xml anger H21, vilket assertionen rättades till.
Ingen produktionsändring gjordes för detta fixturefel. Den efterföljande
fulla integrationskörningen passerade även alla fem TASK011-prov.

## Verifieringskommandon

Alla körningar använder CI=true. PostgreSQL-kommandona använder
TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema.

```bash
pnpm --filter @o-tid/application exec vitest run test/integration/task-011-recalculation-list.test.ts -t 'already authorized'
pnpm --filter @o-tid/application exec vitest run test/integration/task-011-recalculation-list.test.ts
pnpm lint
pnpm typecheck
pnpm --filter @o-tid/application test:integration
pnpm test
pnpm build
```

Full PostgreSQL: exit 0, 21 filer / 243 tester, 76,50 s.
Lint och typecheck: exit 0. Loggar: /private/tmp/otid-011-lint.log,
otid-011-typecheck.log, otid-011-integration.log i samma katalog.
Enhetssvit: exit 0, 220 filer / 1 432 tester. Build: exit 0.
Loggar: /private/tmp/otid-011-unit.log och /private/tmp/otid-011-build.log.

Kvarvarande antaganden: migration 0037 måste vara installerad innan denna
kod används. Låsväntan under produktionslast är inte lasttestad här.
Full browser-, fysisk mobil- och SPORTident-fältverifiering återstår och
påstås inte av dessa serverprov. Övriga legacy-preflight-läsare är separat arbete.
