# TASK253: neutral och kompakt separat finaliseringsvy

Status: klart 2026-09-27.

## Användarutfall

Den separata finaliseringssidan ska visa internet, behörighet, loppets
beredskap, klassernas blockerare och loppåtgärden utan en stapel av stora
färgade kort. På desktop ska klasslistan vara kompakta rader. På mobil ska
status, klass och retry vara tydligt ordnade med stora tryckytor, utan
horisontellt spill. Text ska förklara situationen utan att färg ensam bär
betydelsen.

## Gräns

ADR-0028 och docs/domain-rules.md behåller klass före lopp, frysta
append-only beslut, blockers, separat `FINALIZE_RESULTS`-behörighet och
exakt samma idempotenta återförsök. TASK253 ändrar bara presentation,
typografi och svensk hjälptext. Ingen ny teknik, domänregel, migration,
API, publicering eller resultatlogik införs; ingen ny ADR behövs.

## Riktad acceptans

- Grundytor, knappar och avdelare är neutrala; gul/röd används endast
  tillsammans med text för blockerare, offline/osäkert utfall eller fel.
- Operativ status och den varaktiga säkerhetsgränsen syns högt upp utan
  en stor varningsruta. Inloggning förblir separat.
- Klasslistan och loppbeslutet får tydlig hierarki och informationstäta
  rader; blockerare och senaste revisionen kan fortfarande läsas.
- Fryst retry och explicit lokal avbrytning är fullt synliga även vid
  390 px, med samma request-id och utan automatisk retry.
- Ett befintligt syntetiskt browserfall granskar 390/1366 px,
  publik länk och sidspill. Kör bara berörd UI-test, lint/typecheck/build
  och riktad browserkontroll; ingen riktig databas eller credential.

## Ingår inte

Ingen förändring av finaliseringskandidater, bevis, exporter, andra
administrationssidor eller fysisk enhetsacceptans.

## Utfall och verifiering

Finaliseringssidan har en neutral vit/grå bas. Internet, session och
loppsberedskap är kompakta textstatusar högt upp; den separata behörigheten
och beslutets oföränderlighet syns utan en stor gul ruta. Åtta syntetiska
klasser får plats som täta rader på desktop med klass, antal, status,
blockerare, historik och åtgärd. Loppbeslutet skiljs med en tunn avdelare.
På 390 px staplas samma information, med fullbredds 52 px-knappar och
utan sidspill. Faktiska blockerare är textmärkta och röda; ett okänt
commitutfall behåller sin gula textmärkta retryyta. Den interna
`FINALIZE_RESULTS`-koden heter finaliseringsnyckel i primär UI-text.

`CI=true pnpm --filter @o-tid/web exec vitest run
src/components/result-finalization-admin-ui.test.tsx`: **5/5**, exit 0.
Web lint/typecheck/build: **exit 0**. E2E-TypeScript och riktad E2E-ESLint:
**exit 0**. Syntetiskt Next/Chromiumprov på 3127: **2/2**, exit 0,
inklusive publik länk, åtta klasser, blockerad klass/lopp, 390/1366 px,
tryckyta och inget sidspill. Desktop- och mobilbilder granskades. Första
browserförsöket nekades av sandlådans loopbackport (`EPERM`); godkänd
loopbackkörning passerade.

`tests/e2e/task-001.spec.ts` fick bara sitt förväntade synliga fältnamn
uppdaterat. Det äldre PostgreSQL-beroende genomgångsprovet kördes inte:
ingen uttryckligen isolerad `DATABASE_URL`/`TEST_DATABASE_URL` fanns.
Fristående lint av den filen gav exit 1 eftersom den saknas i projektets
ESLint/TypeScript-project-service, och en typfri ESLint-omkörning gav
exit 2 eftersom reglerna kräver typer. Även `playwright --list` stoppades
av konfigurationens isolerade databasgrind (exit 1); ingen databas
anslöts. Detta är en kvarvarande verifieringslucka, inte ett grönt
end-to-end-bevis. Fysisk touch och verklig credential prövades inte.
