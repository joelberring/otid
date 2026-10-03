# TASK108: verifierbar rapport över planerade fasta starttider

Påbörjad 2026-09-20 efter TASK107. Detta är ett lässnitt för arrangörens
befintliga startplan, inte startbokning eller en ändring av tävlingsregler.

## Användarvärde

En administratör kan se vilka tidigare **lottade** fasta starttider som nu är
upptagna, vakanta eller saknar tilldelad deltagare. Det gör det möjligt att
förbereda ett senare klassbyte utan att gissa från manuellt inmatade tider.

## Avgränsning

- Endast `FIXED`-klasser och endast den senaste immutabla
  `class_start_draw_request` för respektive klass används som källa för
  planerade tider.
- Finns ingen sparad lottning visas uttryckligen att en beräkningsbar plan
  saknas. `PUNCH`/fri start räknas aldrig som lediga minutstarter.
- En aktuell fast tid måste motsvara exakt en tid i den sparade planen. Okänd
  manuell tid, dubblett eller ogiltig tidsnoggrannhet gör hela klassens
  planrapport otillgänglig; systemet hittar inte på vakanser då.
- En deltagare utan fast tid visas separat och upptar ingen planerad tid.
  En tidigare lottad tid utan aktuell deltagare visas som vakant.
- Deltagartak är fortfarande antal anmälda deltagare, inte antal starttider,
  och redovisas separat.
- Rapporten är endast tillgänglig för befintlig `MANAGE_RACE`-session och
  skriver aldrig deltagare, starttider, kapacitet, resultat, rådata eller
  journaler.
- Ingen tilldelning/reservation av lucka, automatisk klassflytt, ny lottning,
  omräkning, avprickning, GPS, karta, stafett eller hårdvara ingår.

## Berörda delar

- `packages/contracts`: strikt privat administratörsprojektion.
- `packages/application`: snapshot-bunden, läsande projektion av
  lottningsjournal och aktuellt roster.
- `apps/web`: kompakt svensk rapport i befintlig administratörsvy.
- `tests`: riktade kontrakts-, PostgreSQL-, route- och browser/UI-prov.

## Acceptans

1. En lottad `FIXED`-klass visar varje planerad tid som upptagen med korrekt
   deltagare eller vakant, samt deltagare utan starttid.
2. En klass utan draw-journal, eller ett roster med manuell tid/dubblett som
   inte stämmer med journalen, visar inte en fabricerad tillgänglig tid.
3. `PUNCH` ingår inte i rapporten och klasskapacitet kan inte tolkas som en
   startlucka.
4. Läsningen har ingen write-effekt och skyddas av den befintliga
   `MANAGE_RACE`-behörigheten.
5. Vyn är läsbar på 390 px utan horisontell sidscroll och visar högst en
   begränsad sida av den kompletta planlistan åt gången.

## Arkitekturfråga

Ingen ADR krävs för detta snitt: det använder en redan accepterad immutabel
lottningsjournal som läskälla och skapar inget nytt domänbeslut. Innan en
vakant tid får tilldelas eller reserveras krävs en ADR som avgör om endast
senaste lottning gäller, hur passerade tider hanteras, vem som får tilldela
dem, om nya deltagare omfattas och hur slotkollisioner journalförs atomiskt.

## Genomfört 2026-09-20

En strikt kontraktsprojektion, snapshot-bunden application-läsning och privat
`MANAGE_RACE`-route finns nu. Den kompakta adminpanelen hämtar rapporten först
när operatören öppnar den, visar högst 20 planerade tider per klass och har
ingen skrivknapp. Varje slot kommer från den senaste sparade lottningen; ett
aktuellt roster med dubblett eller manuell avvikande tid får `PLAN_CHANGED`
och visar inga slots. PUNCH saknas från projektionen helt.

Riktad verifiering:

```bash
CI=true pnpm --filter @o-tid/contracts lint
CI=true pnpm --filter @o-tid/contracts typecheck
CI=true pnpm --filter @o-tid/contracts exec vitest run test/fixed-start-slot-plan.test.ts
CI=true pnpm --filter @o-tid/application lint
CI=true pnpm --filter @o-tid/application typecheck
TEST_DATABASE_URL=<isolated-postgres> CI=true pnpm --filter @o-tid/application exec vitest run test/integration/task-108-fixed-start-slot-plan.test.ts
CI=true pnpm --filter @o-tid/web lint
CI=true pnpm --filter @o-tid/web typecheck
CI=true pnpm --filter @o-tid/web exec vitest run src/components/fixed-start-slot-plans.test.tsx src/lib/race-administrator-route-handlers.test.ts
CI=true pnpm --filter @o-tid/web build
CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json
CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.race-administrator.json"}'
DATABASE_URL=<isolated-postgres> TEST_DATABASE_URL=<isolated-postgres> CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK108
```

Alla kommandon passerade. Kontraktsprovet: 2/2. PostgreSQL-provet: 1/1.
Webbens komponent-/routeprov: 36/36. Det riktade 390 px-browserprovet:
1/1 på 9,6 s mot lokal Next/HTTP på loopback 3122 och isolerad PostgreSQL17.
Produktionsbygget kompilerade på 1,807 s, TypeScript på 2,1 s och genererade
7/7 statiska sidor på 99 ms.
