# TASK269: kompakt neutral avläsningshistorik

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Användarutfall och gräns

Målpersonalen ska snabbt hitta en avläsning och förstå stämplingar och
bevarade resultatrevisioner. Gråvita ytor, enhetlig typografi, täta rader
och små textstödda signaler ersätter stora färgade paneler.

ADR-0024/0065 lämnas orörda: racebunden läsbehörighet, serverfiltrerad
deltagarvy, explicit sidning, fryst revisionsvattenmärke, nuvarande namn
och omedelbar rensning av privata klientdata vid utloggning. Ingen ny
resultatlogik, request-/kontraktsändring, lagring eller beroende. Ingen
ny ADR behövs för detta presenterande snitt. Tider visas fortsatt i
enhetens tidszon; DTO:n anger inte tävlingens tidszon.

Sol-agent äger komponent, sida, isolerad TASK269-CSS och enbart historikens
i18n-nycklar. Huvudagenten äger granskning, ett syntetiskt browserfall,
verifiering och dokumentation. Befintliga anropsfunktioner lämnas intakta.

## Acceptans

- Låg sidkrom/verktygsrad, radlista på dator och läsbar mobilprioritering.
  Deltagare (nuvarande namn), bricka, avläst tid, första serverbedömning
  och detaljåtgärd finns kvar. Saknad bedömning är inte ett godkänt resultat.
- Vald detalj visar deltagare, bricka, start/mål, normaliserade stämplingar
  i originalordning inklusive upprepade koder och hela lästa revisionskedjan.
  Status, orsak, publiceringsläge, versioner och sträcktider försvinner inte.
- Lugn standardyta. MP/DSQ och saknade uppgifter får små semantiska signaler
  med text, aldrig enbart färg. Signalen gäller den visade bedömningen,
  inte ett påhittat aktuellt slutresultat.
- Fokus till nyvald detalj utan animation; äldre revisionssida återställer
  inte fokus till toppen. Cursorhämtning sker bara efter användarens val.
- 390/1366 px, ingen horisontell sidscroll, minst 52 px mobilåtgärder.
- Befintliga två små testfiler, ett browserfall med avlyssnade syntetiska
  HTTP-svar, web lint/typecheck/build samt E2E-TypeScript/ESLint. Ingen
  PostgreSQL, riktig credential, hårdvara eller resultatmutation.

## Ingår inte

Ny historikpolicy, målredigering, gemensam /manage-vy, råbytevisning,
offlinehistorik, stafett, GPS, USB eller fysisk tävlingsacceptans.

## Genomfört och verifierat

Separat historiksida har låg neutral topp, samma lilla grundtypografi och
en femkolumnslista på dator. Datorns radknappar är 40 px, medan mobilens
handlingar är minst 52 px. Vid smalare vy ordnas fälten om utan sidspill.
MP/DSQ markeras med en tunn röd linje och utskriven kod/orsak, okänd bricka
och saknad första bedömning med tunn bärnstenslinje och text. Normaltexten
är mörk, inte genomgående röd.

Vald detalj visar nuvarande deltagarnamn, bricka, avläst tid, start/mål,
första bedömning och två desktopkolumner för ordnade stämplingar respektive
bevarade revisioner. Upprepade kontrollkoder, publiceringsläge, versioner,
saknade/extra kontroller och sträcktider finns kvar. På mobil staplas de
två delarna. Tidszonsnotisen är explicit och gör inget påstående om
tävlingens tidszon. Fokus förs till ny vald detalj, inte till toppen vid
explicit hämtning av äldre revisioner.

Anropsfunktionerna, racebunden behörighet, inga-Web-Storage-gränsen,
fryst cursorhistoria och privat datarensning vid utloggning är oförändrade.
All historik hämtas explicit, utom första listläsningen. Sidan skriver
inga resultat.

Verifiering efter sista applikationskodändringen:

| Kommando | Exakt resultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/readout-result-history-admin-ui.test.tsx src/lib/readout-result-history-admin-client.test.ts` | exit 0, 2 filer, 6/6 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.result-finalization-public-link.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-269-readout-history-visual.spec.ts tests/e2e/playwright.result-finalization-public-link.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.result-finalization-public-link.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.result-finalization-public-link.config.ts --grep TASK269` | slutkörning exit 0, 1/1 Chromiumfall vid 1366/390 px, 3,7 s |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-produktionsbuild och offline-appskal |

Browserfallet avlyssnar alla `/api/**`-svar och använder endast syntetiska
data: 12+1 listposter, MP, okänd bricka, äldre post utan första bedömning,
upprepade stämplingskoder och två revisionssidor. Det provar explicit
sidning, fokus, mobilknappshöjd, inget horisontellt sidspill och att lokalt
privat innehåll rensas även om DELETE-utloggningen inte kan bekräftas.
Tre bilder granskades före sista färgjusteringen och den tätare desktoplistan
granskades efteråt.

Första vanliga browserkörningen gav exit 1 eftersom sandlådan förbjöd
loopback-bindning på port 3127. Isolerad, godkänd omkörning nådde testet
men gav exit 1 då Next dev gjorde två initiala identiska GET-anrop. Provet
ändrades till att kräva att inga cursorsidor läses automatiskt, utan att
anta exakt ett initialt GET. Efter detta och densitets-/fokusjusteringen
passerade slutkörningen. Befintligt PostgreSQL-bundet TASK001-browserfall
kördes inte.

## Kvarvarande antaganden

- Syntetiska HTTP-svar verifierar klientpresentation, inte serverns
  behörighetskontroll eller verklig resultathistorik i PostgreSQL.
- Enhetens tidszon kan skilja sig från tävlingens. DTO:n ger ingen tävlingszon;
  vyn märker därför uttryckligen tidernas innebörd.
- 13 rader och browser vid två bredder bevisar inte maximal tävlingslast,
  fysisk mobilanvändning, skärmläsare eller fältacceptans.

Nästa minsta vertikala uppgift: förtäta den separata sidan för att skapa
tävling, utan att ändra skapandets behörighet eller datamodell.
