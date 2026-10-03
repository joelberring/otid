# TASK275: begriplig och kompakt kontoinbjudan för eventägare

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Mål och beslutad gräns

Gör den ägarstyrda kontoinbjudan på `/organizer` kortare i normalvyn och
tydlig när den används. Skilj de två stegen: en kod skapar bara ett konto;
eventåtkomst kräver senare en separat, aktiv OWNER-tilldelning. En kod som
just skapats eller ett osäkert utfärdande ska aldrig tappas genom att en
panel stängs eller en ny form råkar skickas.

ADR-0153, ADR-0145, arkitekturens och offline-dokumentens gräns är
oförändrade. Koden finns endast i sidminne, hash skickas, och efter
omladdning kan klartexten inte återskapas. Ingen ADR eller migration krävs
för detta presentationssnitt. Ingen ny rättighet, API-rutt, servermutation,
lokal lagring eller automatisk grant införs.

## Acceptans

- I stängt läge syns en liten tydlig ingång för ”Bjud in nytt konto” under
  medadministrationen; den långa listan/formen tar inte höjd. Första öppning
  får hämta listan; därefter bevaras sidminnets kod/attempt när ingången
  stängs och öppnas igen.
- I öppet läge visas en tät läsbar lista med namn, login, status, utgångstid
  och spärrhandling enbart för väntande koder. 1280 och 390 px ger ingen
  horisontell scroll, med minst 44 px handlingar och 48 px fält.
- Skapandeformuläret visar vem som får kontot och förklarar att eventåtkomst
  inte följer med. Efter bekräftad issue visas kod, mottagare, utgångstid,
  privat kopiering och explicit rensning; ny issue är inte möjlig förrän
  koden rensats. Texten påstår inte att OS-urklippet rensas.
- Vid osäkert issue-/revoke-svar syns det frysta request-id:t, exakt
  event-id och mål före samma-id-retry. Formuläret visas inte samtidigt.
  Koden visas först efter bekräftad issue. Inga hemligheter i logg/testbild.
- Ett enda syntetiskt browserfall provar stängd/öppen vy, 503→bekräftad
  byteidentisk retry, kodens sidminne genom kollaps samt 1280/390 px.
  Riktad lint/typecheck, litet befintligt komponentprov och web-build.

## Ingår inte

Verklig privat kodleverans, e-post, kontoverifiering, omedelbar ADMIN-
tilldelning, recovery, serverauktorisering, PostgreSQL-/mobilfältacceptans
eller ändring i idempotens/CSRF/Origin.

## Arbetsfördelning

En Sol-agent äger enbart rendering/lokalt vy-state/CSS/svenska texter i
arrangörskomponenten. Huvudagenten äger riktat syntetiskt browserprov,
granskning, verifiering och dokumentation.

## Genomfört och verifierat

Kontoinbjudan har en liten separat öppningsknapp under eventets
medadministration. Listan hämtas först när denna underpanel öppnas; panelen
förblir därefter monterad vid både egen och yttre kollaps. Det bevarar
sidminnets engångskod eller ett pågående försök utan URL/Web Storage.
Öppen lista är tät och textligt statusmärkt. Koden visas först efter
bekräftad issue och blockerar nytt formulär tills ägaren uttryckligen
väljer ”Rensa koden från sidan”. Copy förklarar privat överlämning och att
en eventuell kopia i enhetens urklipp inte påverkas.

Okänt issue visar fryst request-id, event-id, normaliserad inloggning och
visningsnamn före samma-id-retry. Okänt revoke visar motsvarande request-
och invitation-id. Formuläret visas inte samtidigt med något pågående
försök eller bekräftad kod. Den avgränsade medadministratörsytan har nu
en tunn regel i stället för en stor grå bakgrundsruta. Inga server-/crypto-
eller behörighetsanrop ändrades. Befintligt TASK160-databasbrowserprov
anpassades till den nya underpanelens öppningssteg och aktuell knapptext,
men kördes inte mot databas i detta UI-snitt.

| Kommando | Exakt slutresultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 efter sista UI-ändringen |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/organizer-workspace.test.tsx src/lib/organizer-client.test.ts` | exit 0, 2 filer, 9/9 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.workspace.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-275-invitation-visual.spec.ts tests/e2e/playwright.workspace.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.workspace.json"}'` | exit 0 |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task160-organizer.json` | exit 0, endast kompilering av äldre databasprov |
| `CI=true pnpm exec eslint tests/e2e/task-160-owner-account-invitation.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.task160-organizer.json"}'` | exit 0, endast lint av äldre databasprov |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts --grep 'TASK223\|TASK271\|TASK272\|TASK273\|TASK274\|TASK275'` | exit 0, 7/7 syntetiska Chromiumfall |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-produktionsbygge och offline-appskal |

Det nya enda browserfallet avlyssnar `/api/**`, provar 503→201 med
byteidentisk kropp/idempotensnyckel, avsaknad av klartext i POST/Web
Storage, kod i sidminne genom kollaps, explicit rensning och 1280/390 px
utan horisontellt spill. Tre syntetiska bilder granskades utan synlig kod.
Första browserkörningen gav exit 1 eftersom Nexts utvecklingsläge gjorde
två läsande React-effekter; provet kontrollerar nu att ingen extra läsning
sker vid kollaps/återöppning. En första E2E-lint gav exit 1 för en
otillräckligt typad Storage-iteration; den rättades före slutkontrollerna.

## Kvarvarande antaganden

- Syntetiska svar bevisar inte faktisk OWNER-auktorisering, atomisk
  PostgreSQL-journal, privat kodöverlämning eller fysisk mobil.
- Klartextkoden finns endast tills sidan lämnas eller ägaren rensar den.
  En kopia i OS-urklippet kan finnas kvar och hanteras inte av appen.
- Äldre TASK160-provet är typ-/lintkontrollerat men inte kört mot en ny
  isolerad migrerad testdatabas efter denna presentationsändring.
- Skärmläsare och verkliga användarflöden återstår att fältpröva.

Nästa minsta vertikala uppgift: ge raden för ett aktiverat konto en tydlig
väg till **granskning** av befintlig ADMIN-tilldelning i samma event,
utan automatisk grant eller ny API-rättighet.
