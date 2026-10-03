# TASK272: tydliga arrangörslägen före första tävlingen

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Utfall och gräns

`/organizer` ska ge omedelbar, läsbar återkoppling när ett konto saknar
session eller ännu inte har något event. Inloggningsfel ska visas intill
inloggningen, inte sist på en annars tom sida. Den befintliga vägen för
aktivering av en privat inbjudningskod ska kunna hittas utan att engångskoden
framstår som en tävlingscredential. Ett inloggat konto utan event ska kunna
välja den redan befintliga skapandeytan eller förstå att en eventägare kan
ge medadministratörsåtkomst till ett befintligt event.

ADR-0144/0145 styr konto, sessioner, inbjudan, OWNER/ADMIN och skapande.
Ingen självanmälan, automatisk grant, ny loginmetod eller ändrad API-gräns
införs. Det här är en presentationsändring; ingen ADR eller migration behövs.
En Sol-agent får ändra endast berörd rendering/styling/svensk copy i
arrangörskomponenten. Huvudagenten äger syntetisk browserkontroll, granskning,
verifiering och dokumentation.

## Acceptans

- Utloggad vy vid 390/1280 px har en låg neutral inloggning med synliga
  etiketter, minst 48 px fält, minst 44 px handlingar, inget sidspill och
  begripliga länkar till befintlig `/activate` och `/recover`.
- 401 från inloggning visar svensk återkoppling om ogiltiga uppgifter i
  direkt anslutning till formuläret och tömmer lösenordsfältet; inget
  lösenord hamnar i URL eller lagring. Under pågående anrop syns status
  utan att falskt påstå lyckad inloggning.
- Tomt eventresultat skiljs från läsfel. Texten beskriver både nytt
  skapande och den befintliga möjligheten att en ägare ger ADMIN på ett
  event; ett synligt val leder till befintligt skapandeformulär.
- Roll-/skapande-/inbjudningslogik, idempotency, CSRF och race-enter lämnas
  orörda. Tidigare TASK223/271-gränser får inte regressa.
- Ett syntetiskt browserfall provar utloggad, 401 och tomt konto på
  390/1280 px; riktad web lint/typecheck/build samt få relevanta tester.

## Ingår inte

Nytt kontoskapande, e-post, ändrad lösenordspolicy, riktig credential-
eller databasacceptans, nytt behörighetssteg, Eventor eller produktionstest.

## Genomfört och verifierat

Inloggningsstatus och feltext ligger nu direkt under formulärets handling.
401 ger en röd, textstödd felrad; pågående och andra meddelanden är neutrala.
Länkarna till befintlig `/recover` och `/activate` är synliga och har
44 px höjd även på mobil. Hjälptexten skiljer en privat inbjudningskod
som aktiverar **kontot** från en separat OWNER-tilldelning av eventåtkomst.
Det befintliga lösenordet rensas fortfarande efter loginförsök och varken
anropsfunktioner eller sessionsgränser har ändrats.

En tom, framgångsrikt läst eventlista beskriver både nytt skapande och
ägarens möjlighet att ge ADMIN på ett befintligt event. En ankarlänk leder
till det redan befintliga skapaformuläret. Läsfel använder fortfarande
sin separata felrad och påstås inte vara en tom lista. Desktop-/mobilbilder
för utloggat, 401 och tomt konto granskades vid 1280/390 px.

En Sol-agent gjorde den avgränsade UI-/copyändringen. Den första
browserkörningen gav exit 1 efter att de tre äldre fallen passerat:
provet räknade även Nexts egen utvecklingsverktygs-`alert` utanför appens
`main`. Lokatorn avgränsades till appen, varefter alla fyra fall passerade.
En ytterligare testjustering kontrollerar att det syntetiska lösenordet
inte hamnar i URL/Web Storage och tar bilden före ankarscroll; endast
TASK272-fallet behövde då köras om och passerade.

| Kommando | Exakt slutresultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/organizer-workspace.test.tsx` | exit 0, 1 fil, 4/4 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.workspace.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-272-organizer-entry-states-visual.spec.ts tests/e2e/playwright.workspace.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.workspace.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts --grep 'TASK223\|TASK271\|TASK272'` | exit 0, 4/4 Chromiumfall efter appavgränsad lokator |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts --grep TASK272` | exit 0, 1/1 efter sista testjusteringen, 3,2 s |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-produktionsbygge och offline-appskal |

Browserfallet simulerar 401 från sessionsläsning och första inloggning,
sedan lyckad kontosession och tomt eventresultat. Alla `/api/**`-anrop
avlyssnas; inga riktiga credentials, användardata eller databas används.

## Kvarvarande antaganden

- Riktig session, 401-policy, serverns eventgrants och lösenordsverifiering
  följer ADR-0144/0145 men prövas inte av denna syntetiska UI-kontroll.
- `/activate` och `/recover` är befintliga separata flöden; länkarna provar
  inte att kodutfärdning eller återställning fungerar i drift.
- Fysisk mobil, skärmläsare och arrangörsanvändning är ännu oprövade.

Nästa minsta vertikala uppgift: gör kontobundet skapande och dess
obekräftade same-id-retry lika kompakta och fullständigt granskbara som
TASK270:s separata bootstrapflöde, utan att ändra auktorisering.
