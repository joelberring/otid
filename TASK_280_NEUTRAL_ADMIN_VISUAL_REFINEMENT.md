# TASK280: lugnare visuell hierarki i arrangörs- och tävlingsadministration

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Mål och gräns

Förfina den befintliga neutrala ljus/grå stilen i `/organizer` och
`/admin/[raceId]/manage`. Vardagliga rubriker, etiketter och knappar ska
inte konkurrera med faktisk tävlingsinformation. Täta tabeller och minst
44 px tryckytor ska bevaras. Ingen ny funktion, datarepresentation,
behörighet eller domängräns införs; ingen ADR behövs.

## Acceptans

- Neutral grafit, vit/grå bakgrund och lågmälda linjer dominerar båda
  arbetsytorna. Rubrikstorlek och textvikt ger tydlig men lugn hierarki,
  utan nya typsnitt eller stora kort.
- Rött är reserverat för kritiska resultatfel som felstämpling, gult för
  saknad eller osäker information och grönt för positiva skeenden såsom
  ledare i speakerläget. Status ska alltid ha text, inte bara färg.
- Fokusmarkering, minst 44 px tryckytor och mobil/desktop-layouter
  bevaras. Inga globala CSS-ändringar ska oavsiktligt ändra läsestation
  eller publika sidor.
- Riktad statisk kontroll, en befintlig syntetisk browsergenomgång per
  berörd vy och web-build räcker. Ingen databas- eller hårdvarusvit.

## Ingår inte

Nytt tema, kopiering av Codex eller MeOS gränssnitt, ändrade
resultatregler, ny speakerfunktion, omarbetad navigation eller
komponentbibliotek.

## Genomfört och verifierat

Den befintliga grafitgrå basen behölls. Arrangörssidan har lättare
rubrik-/etikettvikter, platta sektioner på större skärmar och ljusa
sekundära loppknappar i stället för upprepade mörka block. Tävlingsytan
har lättare normal text och knappar; dess två huvudarbetspaneler är
platta på desktop. Särskilt markerade varningsåtgärder, synligt
tangentbordsfokus, minst 44 px tryckytor och röd/gul/grön statussemantik
ändrades inte. Inga globala stilar eller domän-/API-regler ändrades.

Syntetiska Chromiumbilder för arrangörslistan vid 390/1280 px och den
stora tävlingsöversikten vid mobil/desktop granskades. Ingen horisontell
scroll eller bortfallen åtgärd sågs i de riktade fallen.

| Kontroll | Resultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts --grep 'TASK271/TASK278'` | exit 0, 1/1 (slutkörning) |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK234` | exit 0, 1/1 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts --grep 'compact workspace'` | exit 0, 2/2; läsande översikt, inte `/manage` |
| `CI=true pnpm --filter @o-tid/web build` | exit 0; Next 16.3.3, 22 statiska sidor |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK167` | exit 1; äldre fall förväntar 5 mobilknappar under `Arbetslägen`, men nuvarande mobil-UI har en kombinationsruta. Faller före CSS-granskningen. |

## Kvarvarande antaganden

- Syntetiska browserstorlekar bevisar inte läsbarhet i regn/sol,
  handsksituation eller fysisk skärm. Någon full kontrast- och
  skärmläsaraudit har inte gjorts i detta snitt.
- Den äldre TASK167-assertionen är föråldrad sedan mobilnavigeringen
  ändrades. Den riktade TASK234-kontrollen täcker nuvarande mobilval;
  den breda testfilen bör rättas separat, inte tolkas som ett CSS-fel.

Nästa minsta vertikala uppgift: gör den valda deltagarens resultat och
kontrollföljd synliga före redigeringsverktyg i `/manage`, med explicit
val av ändringsläge och ett enda riktat syntetiskt browserfall.
