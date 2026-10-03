# TASK278: hitta egen tävling eller lopp utan lång scroll

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Mål och gräns

En inloggad arrangör med många event ska kunna hitta rätt tävling och
öppna dess lopp direkt i den befintliga `/organizer`-listan. Sökningen är
enbart lokal i den redan auktoriserade eventprojektionen: event- eller
loppnamn matchas utan skillnad på versaler/gemener. Ett matchande event
visas helt, med sina ursprungliga lopp, faktisk OWNER/ADMIN-roll och
befintliga åtgärder. Ordning och serverns behörighetsurval ändras inte.

ADR-0144/0145 gäller oförändrat. Ingen ny API, databas, roll, extern
sökkälla eller ADR behövs för denna lokala presentation.

## Acceptans

- Ett kompakt svenskt sökfält visas endast när en inloggad session har
  minst ett laddat event. Det filtrerar både event- och loppnamn i samma
  lästa lista utan nya HTTP-anrop och kan rensas med en minst 44 px stor
  åtgärd. En nollträff är skild från kontots verkligt tomma eventlista.
- Sökningen kan inte överföra OWNER-åtgärder till ett ADMIN-event.
  Befintligt race-inträde och medadministration förblir knutna till
  respektive ursprungligt event/lopp.
- Vid 390 och 1280 px finns ingen horisontell scroll eller stor ny ruta.
  Sökning/rensning och ett nollträffsläge provas i ett syntetiskt
  browserfall med flera event och lopp; riktad lint/typecheck och web-build.

## Ingår inte

Serversökning, pagination, ny sortering, automatisk navigation,
ny kontorättighet, ändrad eventprojektion, fysisk mobil eller fältacceptans.

## Arbetsfördelning

En Sol-agent äger enbart arrangörskomponentens lokala filter, CSS och
svenska copy. Huvudagenten äger acceptansprovet, granskning och
dokumentation.

## Genomfört och verifierat

En Sol-agent lade en lokal NFC-normaliserad, svensk versal-/gemenoberoende
sökning ovanför den redan lästa eventlistan. Matchning på event- eller
loppnamn behåller hela eventsektionen, alla lopp i ursprunglig ordning,
faktisk roll och befintliga handlingar. Fältet visas bara när listan
innehåller event; söktexten rensas vid utloggning och utgången session.
Noll träffar har egen textstatus och blandas inte ihop med tomt konto.

Första bildgranskningen visade att rensknappen tog en hel extra rad på
390 px. Den ligger nu bredvid fältet även på smal mobil, utan att
minska dess 44 px tryckyta. Bilder från 320, 390 och 1280 px granskades;
ingen horisontell scroll. Provet återanvänder TASK271:s enda syntetiska
Chromiumfall med sex event, tolv lopp och växlande OWNER/ADMIN. Det
kontrollerar sökning på lopp och event, rensning, nollträff samt att
filtreringen inte gör något ytterligare `/api/**`-anrop.

| Kontroll | Slutresultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.workspace.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-271-organizer-events-visual.spec.ts tests/e2e/playwright.workspace.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.workspace.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.workspace.config.ts --grep TASK278` | exit 0, 1/1 syntetiskt Chromiumfall (slutkörning) |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next 16.3.3 och offline-appskal |

## Kvarvarande antaganden

- Filtreringen förutsätter att den redan auktoriserade eventlistan är
  komplett för sessionen. Den gör inget anspråk på serversökning eller
  liveuppdatering.
- Syntetisk browserstorlek är inte fysisk mobil- eller
  skärmläsaracceptans. Den tidigare isolerade TASK277-kontrollens
  autentiseringsbevis täcker inte detta nya filter i verklig drift.

Nästa minsta vertikala uppgift: verifiera att samma inloggade konto kan
hitta och öppna ett sent tillagt event med sökningen efter ny session mot
en isolerad riktig PostgreSQL-databas; behåll den befintliga scopegränsen.
