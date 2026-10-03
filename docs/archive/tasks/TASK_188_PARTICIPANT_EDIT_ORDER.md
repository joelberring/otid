# TASK188: vanliga personändringar intill personfakta

Status: klar 2026-09-25. Dokumenterad före kod.

## Användarutfall

I tävlingens deltagarvy visas vald persons befintliga fakta och korta
resultatbesked först. Den valda vanliga ändringen (namn/klubb, klass,
bricka, fast starttid eller betalningsmarkering) visas direkt därefter.
Kontrolltider, resultatbeslut, historik och frivillig kontokoppling får
tydlig plats längre ned. Pågående granskning och okänt sparutfall behåller
sina befintliga lås och synliga konsekvenser.

## Gräns

Endast renderingsordning i befintlig `/manage`. Återanvänd samma formulär,
gällande resultat, handlingar och API-anrop. Ingen domänregel, behörighet,
resultatrevision, migration eller teknik ändras; därför behövs ingen ny ADR.
Mobilens separata lista/detalj och 44 px huvudmål bevaras.

## Kontroll

Utöka det befintliga syntetiska browserfallet för TASK167/183/187: på
1280×800 kontrollera vald person, kort resultat och vanligt ändringsformulär
före kontrolltabell/sekundära detaljer i DOM och inom relevant vy. Verifiera
att den sekundära resultatmenyn fortfarande kan öppnas. Behåll 390/900-
kontrollerna och kör riktad lint, typecheck, ett browserfall och build.
Ingen ny testsuite eller riktig databas.

## Utfall och verifiering

Aktiv ändring av klass, bricka, betalstatus, fast starttid eller identitet
kommer nu efter personfakta och kort gällande resultat. Kontrollföljd och
sträcktider, resultatbeslut/historik och frivillig kontokoppling följer efter
den aktiva vardagsändringen. Befintliga formulär, lås, API-anrop och
behörighetskrav är oförändrade. Skärmbilder från det syntetiska browserprovet
visar desktop och mobil; ingen riktig tävlingspost ändrades.

- Web TypeScript: `node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json` — exit 0.
- Ändrad webbfil ESLint: `node node_modules/eslint/bin/eslint.js apps/web/src/components/race-administrator-workspace.tsx` — exit 0.
- E2E TypeScript: `node node_modules/typescript/bin/tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json` — exit 0.
- Ändrad E2E-fil ESLint med samma projektkonfiguration — exit 0.
- Browser: `CI=true ./node_modules/.bin/playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts` — slutligt 1/1 passerade, exit 0, 18,1 s. Första försökets loopback-bindning blockerades av sandbox (`EPERM`, exit 1); omkörning med godkänd lokal server nådde ett äldre viewport-påstående efter att den nya menyinspektionen hade skrollat sidan. Testet återställer nu skrollpositionen och kontrollerar också att det aktiva formuläret ryms i 1280×800. Slutlig omkörning passerade.
- Next produktionsbuild med icke-fungerande byggplaceholder för `DATABASE_URL` — exit 0, sidgenerering 22/22.

Antaganden: en aktiv ändring i taget är fortsatt rätt arbetssätt; testets
syntetiska 390/900/1280 px representerar layouten men är inte ett fysiskt
mobil-/paddaprov. Sekundära resultatbeslut kan öppnas i menyn; detta snitt
testar inte ett nytt beslut eller skrivning mot riktig databas.
