# TASK292 – öppna exakt tilldelad bana

## Mål och avgränsning

Från deltagarens INFO ska en diskret läsande åtgärd öppna Före → Banor
och den exakt tilldelade banversionens befintliga kontrollföljd. Samma
ban-/klassnamn får inte leda till fel post. Deltagarvalet bevaras så att
vanlig Deltagare-navigering ger en begriplig återgång.

Återanvänd arbetsytan och banöversikten; ingen ny API, domänregel, databas,
beroende eller resultatändring. Ingen ny ADR behövs för läsande navigation.

## Acceptans

- Tilldelad banversion öppnas och fokuseras, inte historisk resultatbana.
- Navigation spärras under pågående skrivflöde.
- Saknad/läsfel visas utan fallback till en likalydande bana.
- Neutral kompakt åtgärd med svensk externaliserad text och mobiltryckyta.
- Återanvänd TASK290:s browserfall; ingen ny testsvit eller databasprov.

## Verifiering

Klart 2026-10-02. Sol-agent implementerade, huvudagent granskade och
verifierade. `Visa i Banor` ligger som neutral textåtgärd på samma rad som
banans namn/version, med 44 px tryckyta och radbrytning på mobil.
Förälder kontrollerar aktuell klasstilldelning och workflowLocked, målval
binds till lopp/snapshot och rensas vid nytt underlag/vanlig navigation.
Översikten öppnar/fokuserar bara en entydig banversions-ID-matchning.
Saknad eller duplicerad matchning ger textstatus, ingen namnfallback.
Vanlig lokal bansökning är oförändrad.

Exakta resultat:

- `CI=true pnpm --filter @o-tid/web lint`: exit 0.
- `CI=true pnpm --filter @o-tid/web typecheck`: slutligen exit 0.
  Första körningen gav exit 2: exactOptionalPropertyTypes för valfri
  selectedCourseVersionId. Prop-typen rättades utan beteendeändring.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json`: exit 0.
- Riktad ESLint av `tests/e2e/task-167-payment-filter.spec.ts` med samma
  E2E-tsconfig: exit 0.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK292`:
  första 1/1 på9,4 s, efter slutlig typ-/entydighetskorrigering 1/1 på8,1 s,
  båda exit 0. Endast ett befintligt fall återanvänds; ingen ny svit.
- `CI=true pnpm --filter @o-tid/web build`: exit 0, Next16.3.3,
  22/22 statiska sidor. Kördes separat från browsern.

Browserfallet visar rätt kontrollföljd/fokus bland två banor med samma
namn och versionsnummer vid390/1280 px, deltagarval vid återgång,
saknat mål utan fallback och noll oavsiktliga skrivningar. Tidigare
resultat-/scroll-/403-kontroller finns kvar. Dator-/mobilbilder granskades;
ingen ny informationsruta. Loopback3167 stängd efteråt (lsof exit1).

## Kvarvarande antaganden och nästa snitt

Syntetiska API-svar bevisar UI, inte databasauktorisering eller fysisk
mobil/fältbruk. Duplicerad matchning är kodspärr, inte nytt browserfixture.
Nästa minsta snitt: klassnamnen i banöversikten öppnar motsvarande befintliga
klassupplägg, med samma exakta ID-navigering och utan automatisk ändring.
