# TASK265: kompakt neutral beslutsvy för Utan tidtagning

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Användarutfall

En behörig funktionär ska snabbt hitta deltagare som kan markeras utan
tidtagning, förstå varför andra är blockerade och granska exakt tekniskt
OK-underlag före beslut. Desktop visar tät lista, mobil samma fakta i
prioriterad ordning utan sidspill. Gråvita vardagsytor och måttlig textstorlek
ska göra beslutsflödet lugnt; kritiska tillstånd bär också text.

## Gräns före implementation

ADR-0037:s `DECIDE_WITHOUT_TIMING`, direkt publicerat tekniskt `OK/COMPLETE`,
status-only NT och fail-closed export/finalisering ändras inte. Den gemensamma
adminbehörigheten enligt ADR-0084 lämnas orörd. Exakt fryst intent,
tvåstegsbekräftelse, CSRF, minnesburet försök och uttrycklig byteidentisk
same-id-retry bevaras. Inga API-/kontraktsändringar, migrationer, dependencies,
nya statusar eller ändrade domängränser införs. Ingen ny ADR behövs för
detta rent presenterande snitt.

Filägare: Sol-agenten ansvarade för komponenten, sidan, en avgränsad
CSS-sektion och `withoutTiming*`-texterna. Huvudagenten granskade och
förfinade presentationen efter överlämning samt äger det enda browserfallet,
dess befintliga harness, dokumentation och slutverifiering. Ingen samtidig
skrivning i samma fil eller testdatabas ingick.

## Riktad acceptans

- Låg neutral statusrad för enhetens nätläge, session och antal beslutsbara,
  kort svensk behörighets- och konsekvenstext.
- Täta desktoprader visar deltagare, klubb, klass, deltagarversion, exakt
  OK-källrevision och begripligt blockeringsskäl. Blockerade rader är läsbara
  men inte valbara. MP får inte framställas som valbar källa.
- Mobil behåller fakta utan horisontell scroll och med minst 52 px höga
  beslutsåtgärder. Fokus flyttas till bekräftelse respektive retry.
- Bekräftelse visar fryst person, klass, teknisk källa och tävlingsversion
  innan någon POST. Den icke-rankade, tidslösa publika konsekvensen förklaras.
  Osäker commit och återautentisering hålls isär; endast explicit same-id-retry
  sänder igen, aldrig ny källa eller nyckel automatiskt.
- Två befintliga UI-/klienttestfiler, ett syntetiskt browserfall vid
  390/1366 px, berörd lint/typecheck och web-build. Ingen verklig databas
  eller credential används.

## Ingår inte

NT-återtagning, generell resultateditor, ändrad behörighet, servermutation,
resultatmotor, IOF-mappning, offlinekö, fysisk mobil, stafett, GPS eller USB.

## Genomfört och verifierat

Sex täta desktopkolumner visar person/klubb, klass, deltagarversion,
teknisk OK-revision, beslutsskäl och åtgärd. Mobil parar ihop korta fält,
behåller källa/skäl och minst 52 px höga åtgärder utan sidspill.
Samtliga readinesskoder har svenska förklaringar; källans COMPLETE visas
som ”Godkänt resultat”. Blockerade deltagare är läsbara men inte valbara.
Behörighets- och konsekvenstexten är kortare och vanliga knappar neutrala.

Bekräftelse och okänt skrivutfall visar fryst person, klass, teknisk
revision/status/orsak och tävlingsversion. Retry visar också samma request-id.
Fokus flyttas utan animation till aktuell panel. Inskickat intent och
auth-/CSRF-/retryflöden är oförändrade. En misslyckad initial läsning lämnar sessionen
”Inte verifierad”, inte i ett falskt fortgående kontrolläge. Browserns
TypeError visas med en svensk, orsaksmässigt neutral text om obekräftat svar.

Verifiering efter sista kodändringen:

| Kommando | Exakt resultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/without-timing-admin-ui.test.tsx src/lib/without-timing-admin-client.test.ts` | exit 0, 2 testfiler, 5/5 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.result-finalization-public-link.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-265-without-timing-visual.spec.ts tests/e2e/playwright.result-finalization-public-link.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.result-finalization-public-link.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.result-finalization-public-link.config.ts --grep TASK265` | exit 0, 1/1 Chromiumfall vid 390/1366 px |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-build och offline-appskal byggda |

Browserfallet använder åtta syntetiska kandidater och avlyssnar alla
API-anrop. Det provar blockerade rader, exakt inskickad OK-källa och
versioner, ingen POST före bekräftelse, synlig mobilåtgärd, byteidentisk
nyckel/body vid explicit retry, svensk feltext och obekräftad session efter
503 vid initial läsning. Desktop, mobil, bekräftelse och retry granskades
som fyra skärmbilder.
Det första visuella provet passerade men visade engelsk nätfelstext;
den rättades och slutkörningen ovan passerade. Inga verkliga credentials
eller tävlingsdata användes. Äldre PostgreSQL-beroende `task-001` kördes inte;
bara dess NT-lokatorer och förväntad svensk presentation uppdaterades.

## Kvarvarande antaganden

- Oförändrad NT-policy och servermutation används. Syntetiskt browserprov
  bevisar klientpresentation/retry, inte verklig servercommit eller produktion.
- Enhetens rapporterade nätläge är inte bevis om nåbar server; sessionen är
  verifierad först efter accepterat svar på kandidatläsningen.
- Täta rader och 52 px åtgärder är en utgångspunkt. Fysisk mobil,
  solljus/regn/handskar och bred färg-/tillgänglighetsacceptans återstår.

Nästa minsta vertikala uppgift: samma neutrala, kompakta presentation för
den separata återtagningsvyn Utan tidtagning, utan ändrad restaureringspolicy.
