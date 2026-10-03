# TASK274: kompakt eventbunden medadministration

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Mål och beslutade gränser

Gör ägarens vy för medadministratörer på `/organizer` tätare och lättare att
överblicka. Visa tydligt vilket event som avses, vilka konton som har aktiv
åtkomst och vilka tilldelningar som återkallats. Vid tilldelning ska den
normaliserade inloggningsidentiteten och eventet vara synliga före skickning;
vid okänt svar ska det frysta försöket gå att återförsöka utan ny avsikt.

ADR-0145 gäller oförändrat: enbart OWNER tilldelar/återkallar ADMIN för ett
exakt event och ett befintligt internt konto. ADMIN får inte delegera.
Kontoinbjudan ger inte eventbehörighet. Ingen ny ADR eller migration behövs
om detta förblir ett rent presentationssnitt. Inga serverkontrakt,
auktoriseringskontroller, idempotensnycklar eller requestflöden ändras.

## Acceptans

- Desktop 1280 px: tät läsbar lista med namn, inloggning, aktiv/återkallad
  status och relevant åtgärd; befintlig historik bevaras. Mobil 390 px:
  samma information i tydlig prioritet utan horisontellt spill.
- Eventkontext, antal aktiva/återkallade och exakt granskning av mål visas
  textligt, inte enbart med färg. Neutral gråvit bas, sparsam signal för
  okänt fel och tydlig status; inga stora dekorativa kort eller fast krom.
- Inbjudan till nytt konto hålls begripligt åtskild från eventtilldelning,
  utan att engångskod eller annan pågående inbjudningsstate tappas.
- Befintligt OWNER-villkor, expanderingsknapp, återkallelsebekräftelse,
  samma-id-retry/avbryt, CSRF/Origin och serverrutter är oförändrade.
- Ett syntetiskt browserfall provar eventavgränsning, aktiv och återkallad
  rad, granskning/samma-id-retry och 1280/390 px. Därefter riktad web
  lint/typecheck, litet befintligt komponentprov och web-build. Ingen
  verklig databas eller credential.

## Ingår inte

Nya roller, inbjudningsbackend, automatisk ADMIN-grant, flerloppshantering,
speaker/raceadministration, riktig PostgreSQL-acceptans eller generell
ombyggnad av arrangörssidan.

## Arbetsfördelning

En Sol-agent äger rendering, CSS-modul och svenska texter i arrangörsvyn.
Huvudagenten äger syntetiskt browserprov, granskning, verifiering och
dokumentation.

## Genomfört och verifierat

Medadministratörspanelen visar nu eventnamn och exakt event-id, antal aktiva
och återkallade tilldelningar, inloggningsnamn, historiktider och textlig
status i täta rader. Desktop placerar tilldelningsfält och knapp på samma
rad; mobil visar en kolumn. Granskningen skiljer uttryckligen ett befintligt
kontos eventåtkomst från kontoinbjudan. Vid okänt svar ersätter det frysta
försöket formuläret och visar åtgärd, eventnamn/id, request-id och mål före
samma-id-retry. Den separata inbjudningsdelen ligger kvar visuellt avgränsad.

Efter att ägaren öppnat panelen en gång förblir den monterad när den
kollapsas. Därmed tappas inte en privat engångskod eller ett pågående försök
ur sidminnet bara för att panelen stängs; koden skrivs fortfarande inte till
Web Storage. Requestflöden, behörigheter och API är oförändrade.

| Kommando | Exakt slutresultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/organizer-workspace.test.tsx src/lib/organizer-client.test.ts` | exit 0, 2 filer, 9/9 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.workspace.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-274-coadmin-visual.spec.ts tests/e2e/playwright.workspace.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.workspace.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts --grep 'TASK223\|TASK271\|TASK272\|TASK273\|TASK274'` | exit 0, 6/6 syntetiska Chromiumfall |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-produktionsbygge och offline-appskal |

TASK274-provet avlyssnar alla `/api/**`-svar, visar OWNER:s aktiva och
återkallade historik utan ADMIN:s delegeringskontroll, simulerar 503 följt
av 201 och jämför exakt idempotensnyckel och request-body. Det provar
kollaps/återöppning av fryst tilldelning samt 1280/390 px utan
horisontellt spill. Tre bilder granskades. Före slutkörningen föll provet
två gånger på skiftlägeskänsliga testlokatorer och en gång på att
kontoinbjudan också har inloggningsfält; lokatorerna gjordes entydiga.
Den sista lilla arrangörsregressionen passerade 6/6.

## Kvarvarande antaganden

- Syntetisk browser verifierar inte faktisk OWNER/ADMIN-auktorisering,
  idempotent PostgreSQL-commit, privat kodöverlämning eller fysisk mobil.
- En engångskod finns enbart i sidminnet och försvinner fortfarande vid
  omladdning eller navigation. Det är avsiktligt; ingen hemlighet har lagts
  i beständig browserlagring.
- Kontoinbjudan är funktionellt separat men fortfarande lång när den är
  öppen; dess egen layout och kodöverlämning behöver ett litet separat snitt.
- Skärmläsare och arrangörsacceptans med riktiga behörigheter återstår.

Nästa minsta vertikala uppgift: förtäta den separata kontoinbjudan inom
ägarens eventpanel och gör privat kodöverlämning tydlig, utan automatisk
eventgrant eller ny autentiseringspolicy.
