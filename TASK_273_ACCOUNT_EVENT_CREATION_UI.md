# TASK273: kompakt kontobundet tävlingsskapande och fryst retry

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Utfall och gräns

Det kontobundna `/organizer`-skapandet ska använda sin smala sidopanel
effektivt och visa exakt vad som är på väg att skapas. Om serverns svar är
okänt ska arrangören se hela det frysta intentet och kunna återförsöka
exakt samma request-id, utan att det gamla formuläret inbjuder till en ny
avsikt. Efter bekräftad skapelse ska ett kvitto ersätta de gamla ifyllda
fälten. Nästa tävling kräver ett explicit nytt val. Med många event på
mobil ska skapandet vara nåbart från ett litet textlänksval nära sidans
rubrik, utan fast sidkrom eller stora nya kort.

ADR-0144:s kontobundna event+första lopp+OWNER-commit, åttatimmarssession
och account-id-bundna idempotens samt ADR-0145:s ADMIN-gräns är oförändrade.
Även ADR-0021:s separata bootstrapflöde är orört. Ingen ny ADR eller
migration behövs: detta är presentation av redan validerade fält/svar.
En Sol-agent äger arrangörskomponentens rendering, lokala UI-state,
CSS-modul och svenska copy. Huvudagenten äger syntetiskt browserfall,
granskning, verifiering och dokumentation.

## Acceptans

- Desktop 1280 px håller namn/lopp tydliga och grupperar datum/tidszon
  kompakt inom befintlig sidopanel. Mobil 390 px behåller läsordning,
  48 px formulärfält, minst 44 px handlingar och inget horisontellt spill.
- Vid obekräftat svar visas request-id, eventnamn, loppnamn, loppdatum
  och tidszon från **sparat attempt** före samma-id-retry/avbryt. Bara
  osäkert svar eller annat kontos sparade attempt får gul textstödd signal.
  Ingen ny POST-avsikt är möjlig medan attempt finns.
- Kvitto visar event-id, race-id och tid samt erbjuder befintlig
  race-enter-åtgärd med samma serverkontroll. Det gamla ifyllda formuläret
  är avmonterat tills arrangören väljer ”Skapa ytterligare tävling”.
- Fullt skapande, retry, CSRF, Origin, kontoauktorisering, invitation,
  rollgräns och `MANAGE_RACE`-delegation ändras inte. Listan uppdateras
  fortsatt efter lyckad skapelse utan att kvittot tappas vid läsfel.
- Ett syntetiskt browserfall provar okänd första POST, fryst retry,
  kvitto/ny blank form och 1280/390 px; tidigare små TASK223/271/272-fall,
  riktad web lint/typecheck/build. Ingen verklig databas/credential.

## Ingår inte

Nytt server-API, skapande av fler lopp i samma event, Eventorimport,
behörighetsändring, liveuppdatering, Postgres-/fältacceptans eller andra
resultatfunktioner.

## Genomfört och verifierat

En Sol-agent ändrade endast kontosidans UI/rendering, CSS-modul och svenska
texter. Datum/tidszon delar rad när sidopanelens faktiska bredd räcker;
namn/lopp behåller egna etiketter. Mobilens lilla rubriklänk leder till
skapandet efter en lång eventlista. Inga requestfunktioner eller
serverkontrakt ändrades.

Ett sparat försök monterar av formuläret och visar exakt request-id,
eventnamn, loppnamn, datum och tidszon ur det frysta attemptet före
explicit retry/avbryt. Ett annat kontos sparade försök visar samma
underlag men ingen retry med fel konto. Okänt svar är textstödd gult;
bekräftelse är neutralt gråvit.

Vid bekräftelse syns event-id, lopp-id, skapad tid, befintlig
`enterRace`-handling och ett explicit val för nästa tävling. Den gamla
ifyllda formen är avmonterad; valet visar en ny blank form och tar bort
det gamla kvittot. Kvitto-/attempt-rubrik får fokus utan animation.
Bildgranskning av 390 px hittade att ett kvitto först hamnade under den
återladdade listan; fokus flyttas nu efter slutförd listuppdatering och
ett browserpåstående kräver att kvittot faktiskt ligger i viewporten.
I samma pass rensades inaktuellt kvitto när kontosessionen avslutas, samt
redundant global lyckad-status.

| Kommando | Exakt slutresultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/organizer-workspace.test.tsx src/lib/organizer-client.test.ts` | exit 0, 2 filer, 9/9 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.workspace.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-223-organizer-visual.spec.ts tests/e2e/task-273-organizer-create-visual.spec.ts tests/e2e/playwright.workspace.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.workspace.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts --grep 'TASK223\|TASK271\|TASK272\|TASK273'` | exit 0, 5/5 syntetiska Chromiumfall efter UI-fix |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts --grep TASK273` | exit 0, 1/1 efter sista bildtillägget, 4,7 s |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-produktionsbygge och offline-appskal |

Första samkörningen gav exit 1, 3/5: TASK223:s äldre prov väntade grön
kvittokant, medan det nu avsiktligt neutrala kvittot hade grå kant.
Testförväntan uppdaterades. En mellanliggande typecheck gav exit 2 när
ett nytt React-ref saknade initialt värde; det rättades före slutkörning.
Browserfallet avlyssnar `/api/**`, simulerar 503 följt av 201 och jämför
exakt idempotency-key och body efter reload. Inga verkliga tävlingar,
credentials eller PostgreSQL-rader används.

## Kvarvarande antaganden

- Syntetiska 503/201 bevisar inte faktisk account-id-bunden atomisk
  PostgreSQL-commit, serverns CSRF/Origin-kontroll eller grantvillkor.
- Kvittoets lokala tid visas i browserns tidszon; exakt instant finns i
  `<time dateTime>` men fysisk användning i olika tidszoner är oprövad.
- Fysisk mobil, skärmläsare och arrangörsflöde med verkliga behörigheter
  återstår; testets fyra äldre event är syntetiska.

Nästa minsta vertikala uppgift: förtäta ägarens eventbundna
medadministratörslista och tilldelningsgranskning, utan ändrade
OWNER/ADMIN-regler eller inbjudnings-API.
