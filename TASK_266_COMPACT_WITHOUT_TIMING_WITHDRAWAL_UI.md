# TASK266: kompakt neutral återtagning av Utan tidtagning

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Användarutfall

Funktionären ska snabbt skilja aktiva beslut från återtagen historik och
se exakt vilket tekniskt OK/MP-resultat som återställs. Desktop visar täta
rader, mobil samma beslutsfakta utan sidspill. Vanliga ytor och knappar är
neutrala; kritisk konsekvens och osäkert skrivutfall framgår även i text.

## Gräns före implementation

ADR-0038:s `WITHDRAW_WITHOUT_TIMING`, append-only återtagande, exakt fryst
absolut revisionshuvud och teknisk restaureringskälla ändras inte.
ADR-0084:s gemensamma administratörsbehörighet lämnas orörd. En senare
teknisk MP-källa får återställas även om det ursprungliga NT-targetet var
OK; presentationen får inte lova godkänt resultat när den frysta källan är MP.
Fryst intent, tvåstegsåtgärd, CSRF och byteidentisk same-id-retry bevaras.
Inga API-/kontraktsändringar, migrationer, nya beroenden eller domänregler.
Ny ADR behövs inte för detta rent presenterande snitt.

Filägare: Sol-agenten äger komponent, sida, en avgränsad TASK266-CSS-sektion
och `withoutTimingWithdrawal*`-texter. Huvudagenten äger granskning,
eventuell efterföljande visuell puts, ett browserfall i befintlig harness,
dokumentation och slutverifiering. Ingen samtidig skrivning i samma fil.

## Riktad acceptans

- Låg rad för enhetens nätläge, session och antal återtagbara. Ett obekräftat
  initialt sessionssvar får inte visas som en aktiv eller evigt kontrollerad
  session. Nätläge är inte bevis om nåbar server.
- Åtta desktopkolumner visar person/klubb, klass, deltagarversion,
  NT-revision, absolut huvud, exakt teknisk OK/MP-källa, status och åtgärd.
  Återtagen historik syns men kan inte väljas. Svenska orsaker, kort copy.
- Mobil behåller alla beslutsfakta utan horisontell scroll och med minst
  52 px höga åtgärder. Fokus flyttas utan animation till bekräftelse/retry.
- Bekräftelse och UNKNOWN/REAUTH visar samma frysta person, klass,
  deltagarversion, beslut, NT-revision, huvud, källa och tävlingsversion.
  Retry visar också request-id. Ingen POST före andra bekräftelsen,
  automatisk retry eller omvald källa. Svensk text vid obekräftat svar.
- Två befintliga UI-/klienttestfiler, ett syntetiskt browserfall vid
  390/1366 px, berörd lint/typecheck och web-build. Ingen verklig databas
  eller credential används.

## Ingår inte

NT-beslut, generell resultateditor, ändrad restaureringspolicy, servermutation,
IOF/finalisering, offlinekö, fysisk mobil, stafett, GPS eller SPORTident/USB.

## Genomfört och verifierat

Åtta täta desktopkolumner och ordnade mobilfält visar person/klubb, klass,
deltagarversion, NT-revision, absolut huvud, exakt teknisk OK/MP-källa,
beslutsstatus och åtgärd. Historiskt återtagna beslut är synliga men inte
valbara. Källstatus och orsak har svenska etiketter; en liten röd
”Felstämplad”-text markerar MP, utan färgade normalytor eller hela rader.
Sidhuvud, vanliga knappar och behörighetsinformation är neutrala.

Bekräftelse och explicit retry visar samma frysta granskningsfakta,
inklusive beslut-id och deltagarversion. Fokus flyttas utan animation.
TypeError får svensk text om obekräftat svar; initialt läsfel lämnar
sessionen ”Inte verifierad”. API, behörighet, CSRF, fryst intent och
minnesburen same-id-retry är oförändrade.

Verifiering efter sista kodändringen:

| Kommando | Exakt resultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/without-timing-withdrawal-admin-ui.test.tsx src/lib/without-timing-withdrawal-admin-client.test.ts` | exit 0, 2 testfiler, 5/5 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.result-finalization-public-link.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-266-without-timing-withdrawal-visual.spec.ts tests/e2e/playwright.result-finalization-public-link.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.result-finalization-public-link.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.result-finalization-public-link.config.ts --grep TASK266` | exit 0, 1/1 Chromiumfall vid 390/1366 px, 6,2 s |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-build och offline-appskal byggda |

Det enda browserfallet använder åtta syntetiska poster och avlyssnar alla
API-anrop. Det provar aktiv/historisk status, original OK-källa respektive
senare MP-källa, MP:s textstödda färgsignal, sidbredd, minst 52 px
mobilåtgärder, full fryst bekräftelse före POST, exakt inskickad body,
byteidentisk nyckel/body vid explicit retry och initialt 503-läsfel.
Fyra skärmbilder granskades: desktop, mobil, bekräftelse och retry.
Äldre PostgreSQL-beroende `task-001` kördes inte; dess NT-återtagnings-
lokatorer och svenska förväntningar uppdaterades endast.

## Kvarvarande antaganden

- Oförändrad serverpolicy används. Syntetiskt browserprov verifierar
  klientpresentation/retry, inte verklig servercommit eller produktion.
- Enhetens nätläge innebär inte att servern är nåbar. Sessionen blir
  verifierad först efter ett accepterat listningssvar.
- Täta rader och 52 px manöverdon är en utgångspunkt; fysisk mobil,
  regn/glare/handskar och bred tillgänglighetsacceptans återstår.

Nästa minsta vertikala uppgift: förtäta den befintliga separata
lottningens klassval och förhandslista i samma neutrala språk, utan
ändrad algoritm, versionsgrund eller commit-/retrysemantik.
