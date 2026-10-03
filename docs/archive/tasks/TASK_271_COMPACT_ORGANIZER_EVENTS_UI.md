# TASK271: kompakt och neutral arrangörsöversikt

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Avgränsat utfall

På `/organizer` ska ett inloggat arrangörskonto snabbt se sina event och
deras lopp, välja rätt arbetsyta och hitta skapandet. En tätare desktopvy
ger listan mer utrymme; mobilen behåller en tydlig lodrät ordning och
tryckytor. Gråvita ytor och få textstödda signalfärger följer den beslutade
UI-riktningen. Endast API:ets befintliga eventnamn, startdatum, tidszon,
OWNER/ADMIN-roll och loppnamn/-datum/-id får visas. Antal lopp får härledas
från den redan laddade listan; ingen ny status eller behörighet får antydas.

ADR-0144 och ADR-0145 styr konto, eventägande, adminrollen, skapande och
raceinträde. Presentationen ändrar inte dessa gränser. Ingen ny ADR eller
migration krävs. En Sol-agent får äga enbart arrangörskomponentens
rendering, dess CSS-modul och berörda svenska etiketter. Huvudagenten äger
granskning, ett syntetiskt browserfall, verifiering och dokumentation.

## Acceptans

- Tävlingslistan får större andel av desktopbredden; varje event och dess
  lopp är visuellt tydligt åtskilda utan stora kort eller hög sidkrom.
- Eventnamn, datum/tidszon och faktisk OWNER/ADMIN-roll samt loppnamn,
  loppdatum och befintlig öppna-knapp är läsbara vid 390/1280 px.
- OWNER:s medadministratörsöppnare hör fortsatt till exakt rätt event och
  visas inte för ADMIN. Den befintliga latenta panelen, inbjudningar,
  idempotenta skapandeförsök, logout och POST-inträde ändras inte.
- Mobilen har enkel ordning, inget horisontellt spill och minst 44 px
  åtgärdsknappar. Eventuella härledda antal får inte beskrivas som live-data.
- Ett syntetiskt browserfall med flera event/lopp och blandade roller
  kontrollerar ordning, läsbarhet och scope; riktad web lint/typecheck/build
  och små enhetstester. Ingen verklig databas eller credential.

## Ingår inte

Nytt konto-/rollsystem, sök-API, deltagarstatus, live-resultat, Eventor,
skapande av fler lopp, inbjudningsändringar, race-/domänlogik och mobil-
eller skärmläsaracceptans i fält.

## Genomfört och verifierat

Tävlingslistan använder cirka 70 % av desktopbredden. Varje event har
ett eget kompakt avsnitt med namn, svensk text för den faktiska
OWNER/ADMIN-rollen, datum, tidszon och antal redan inlästa lopp. På dator
står varje lopps namn och datum på samma rad före befintlig öppna-knapp;
på mobil ligger åtgärden direkt under namn/datum. Rubriken i mobil har
full bredd och konto/utloggning en egen låg rad. Skapandet ligger kvar i
egen panel och samtliga tidigare skapande-, inbjudnings- och
raceinträdesfunktioner är orörda.

En Sol-agent gjorde den avgränsade UI-ändringen. Efter bildgranskning
förkortades rolletiketterna till svenska, desktopraderna tätades och
mobilrubriken fick full bredd. Ett gammalt enhetstest sökte en tidigare
`width:100%`-regel för ägarens uppvisningsknapp; det är ersatt med kontroll
av minsta 44 px och vänsterställd text. Den första browserkörningen gav
exit 1 enbart därför att testet antog exakt ett GET per resurs i Nexts
utvecklingsläge. Det reviderade testet tillåter upprepade läsningar men
avvisar varje annat API-anrop; slutkörningen passerade.

| Kommando | Exakt slutresultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/organizer-workspace.test.tsx` | exit 0, 1 fil, 4/4 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.workspace.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-271-organizer-events-visual.spec.ts tests/e2e/playwright.workspace.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.workspace.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts --grep 'TASK223\|TASK271'` | exit 0, 3/3 Chromiumfall; nytt fall vid 1280/390 px |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-produktionsbygge och offline-appskal |

Browserharnessen avlyssnar samtliga `/api/**`-anrop och tillåter endast
syntetiska GET-svar för session och eventlista i det nya fallet. Sex
event, tolv lopp och växlande OWNER/ADMIN granskas. Befintliga två
TASK223-fall provar även ett obekräftat skapande och samma-id-retry.

## Kvarvarande antaganden

- Den laddade eventlistan är komplett för den inloggade sessionen; inget
  live-/synkanspråk görs av antalet lopp.
- Syntetisk browser verifierar inte riktig kontoinloggning, serverns
  OWNER/ADMIN-auktorisering, PostgreSQL eller skapandets commit.
- Fysisk mobil, skärmläsare och faktisk arrangörsanvändning är oprövade.

Nästa minsta vertikala uppgift: gör den befintliga arrangörsinloggningen
och tomma listan lika neutrala och begripliga i en separat, läsbar vy,
utan nya konto- eller behörighetsregler.
