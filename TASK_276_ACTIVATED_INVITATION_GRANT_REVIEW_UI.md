# TASK276: från aktiverat konto till separat ADMIN-granskning

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Mål och gräns

En eventägare ska från en inlöst kontoinbjudan kunna hitta det befintliga
formuläret för eventåtkomst, med exakt inloggningsnamn förifyllt och en
tydlig manuell granskning. Klicket får aldrig i sig ge ADMIN. Det här
sluter ett besvärligt UI-glapp i den redan beslutade tvåstegsvägen men
ändrar inte identitets- eller behörighetsregeln.

ADR-0153 och ADR-0145 gäller oförändrat: `REDEEMED` betyder att ett konto
aktiverats, inte att mottagarens identitet är verifierad eller att eventgrant
finns. Endast aktiv OWNER får göra en separat ADMIN-POST till exakt event.
Inga nya statusar, API:er, migrationer, kopplingar till anmälan eller
automatisk grant. Ingen ny ADR krävs för ett presentations-/fokusflöde.

## Acceptans

- Endast en `REDEEMED`-rad utan redan synlig aktiv grant erbjuder
  ”Granska eventåtkomst”. `PENDING`, `REVOKED` och `EXPIRED` erbjuder
  ingen sådan handling. En redan aktiv ADMIN visas textligt utan ny
  tilldelningsväg; servern förblir auktoritativ vid inaktuell lista.
- Klicket gör **ingen** POST. Det förifyller det normaliserade loginName i
  samma events befintliga grantform och flyttar fokus till en läsbar
  granskning utan att öppna tangentbordet på mobil. Texten kräver att
  ägaren kontrollerar mottagaren och väljer ”Ge eventåtkomst” separat.
- Pågående eller fryst grant/revoke får inte ersättas av ett nytt
  förifyllningsval. Om ägaren ändrar inloggningen rensas inbjudnings-
  kontexten. Byte till annat event kan inte överföra mål mellan event.
- 1280/390 px: tät neutral radlista, minst 44 px handlingar, ingen
  horisontell scroll eller ny stor ruta. Aktiv, saknad och osäker status
  visas med text, inte enbart färg.
- Ett syntetiskt browserfall provar statusgränser, ingen POST vid
  förifyllning, explicit grant inklusive fryst retry och de två
  viewportarna. Riktad lint/typecheck, liten befintlig komponenttestsvit
  och web-build. Ingen riktig credential eller PostgreSQL.

## Ingår inte

Verklig identitetskontroll, automatik efter kontoaktivering, e-post,
kontokatalog, ny eventroll, raceadministration, deltagarkoppling,
databas-/fältacceptans eller ändring av befintlig ADMIN-mutation.

## Arbetsfördelning

En Sol-agent äger arrangörskomponentens lokala UI-state, koppling,
rendering, CSS och svenska copy. Huvudagenten äger syntetiskt browserprov,
granskning, verifiering och dokumentation.

## Genomfört och verifierat

En inlöst inbjudningsrad erbjuder nu ”Granska eventåtkomst” bara när
medadministratörslistan har lästs utan fel och inget aktivt ADMIN-grant för
exakt inloggningsnamn finns där. En redan aktiv grant märks textligt,
medan misslyckad behörighetsläsning ger en konservativ uppmaning att
kontrollera listan först. Väntande, spärrade och utgångna inbjudningar
saknar tilldelningsväg.

Klicket fyller enbart i det befintliga eventbundna grantformuläret och
fokuserar dess läsbara granskning utan att öppna mobiltangentbordet. Texten
förklarar att ägaren måste kontrollera mottagaren utanför systemet och
separat välja ”Ge eventåtkomst”. Manuell redigering rensar inbjudnings-
kontexten. Pågående eller fryst ADMIN-mutation blockerar nytt val både i
knapp och handler. Inga POST-, auth-, crypto- eller kontraktsflöden ändrades.

| Kommando | Exakt slutresultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/organizer-workspace.test.tsx src/lib/organizer-client.test.ts` | exit 0, 2 filer, 9/9 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.workspace.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-276-invitation-grant-review.spec.ts tests/e2e/playwright.workspace.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.workspace.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts --grep 'TASK223\|TASK271\|TASK272\|TASK273\|TASK274\|TASK275\|TASK276'` | exit 0, 8/8 syntetiska Chromiumfall |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-produktionsbygge och offline-appskal |

Det nya enda browserfallet visar alla fyra inbjudningsstatusar och en
redan aktiv grant på två event. Det kontrollerar att förifyllning, fokus
och manuell redigering inte skickar POST, medan uttrycklig grant ger 503
följt av byteidentisk 201-retry och synlig aktiv åtkomst. 1280/390 px
saknar horisontellt spill. Tre syntetiska bilder granskades. Ingen riktig
credential, kod, databas eller tävling berördes.

## Kvarvarande antaganden

- Inbjudningslistan och grantlistan är två separat hämtade ögonblicksbilder;
  serverns färska OWNER-/målkontroll är fortfarande den auktoritativa
  gränsen när grant faktiskt skickas.
- Syntetisk browser bevisar inte riktig PostgreSQL-/auth-samverkan,
  identitetskontroll, fysisk mobil eller skärmläsaracceptans.
- Behörighetsläsfel ger ingen förifyllningsväg, men ett funktionärsprov
  behövs för att se om återhämtningsvägen är tydlig nog i drift.

Nästa minsta vertikala uppgift: prova den nu sammanhängande
ägare→inbjudan→aktivering→manuell grant-vägen med en isolerad migrerad
PostgreSQL-databas och mobilbrowser; åtgärda bara det första konkreta
hindret som provet visar.
