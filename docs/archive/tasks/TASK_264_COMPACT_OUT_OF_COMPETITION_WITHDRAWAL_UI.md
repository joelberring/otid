# TASK264: kompakt neutral vy för återtagande av Utom tävlan

Status: genomförd 2026-09-29 (avgränsad 2026-09-27).

## Användarutfall

En behörig funktionär ska utan lång scroll hitta ett aktivt Utom tävlan-
beslut, skilja det från historiskt återtagna beslut och se vilken exakt
teknisk OK/MP-revision som återställs. Desktop visar tät tabell och mobil
visar samma beslutsunderlag i begriplig ordning med stora beröringsmål.
Neutrala ytor dominerar; signal för osäkert skrivutfall och blockerad åtgärd
måste också anges med text.

## Gräns före implementation

ADR-0036:s `WITHDRAW_OUT_OF_COMPETITION`, frysta absoluta revisionshuvud,
exakta restaureringskälla, tvåstegsåtgärd, CSRF och byteidentiska
same-id-retry ändras inte. Ingen omräkning, omvald källa, ny status,
API-/kontraktsändring, migration eller dependency införs. Äldre historik,
offlineväg, serverbeslut och publikresultat lämnas orörda; ny ADR behövs
inte för detta rent presenterande snitt.

## Riktad acceptans

- Låg statusrad för nät, session och antal återtagbara beslut, kort
  behörighets-/konsekvenstext.
- Täta desktoprader visar person, klubb, klass, deltagarversion,
  OOC-revision, absolut revisionshuvud, exakt teknisk källa och status.
  Historiska beslut är läsbara men kan inte väljas.
- Mobil behåller samtliga beslutskritiska fakta utan sidspill.
  Bekräftelsen visar fryst person, klass, beslut, huvud, källa och
  tävlingsversion före POST. Osäker commit och återautentisering förblir
  skilda; endast explicit same-id-retry får sända igen.
- Riktade UI-/klientprov, ett syntetiskt browserfall vid 390/1366 px samt
  berörd lint/typecheck/build. Ingen verklig databas eller credential.

## Ingår inte

Ingen ändring av skapandet av Utom tävlan, servermutation, revisionshistorik,
gemensam administratörsvy, fysisk mobil, SPORTident eller GPS.

## Genomfört och verifierat

Återtagningsvyn visar nät, session och antal återtagbara beslut i en låg
statusrad. Desktop har täta rader med separat OOC-revision, absolut
revisionshuvud och exakt OK/MP-källa. Mobil parar ihop korta fält utan
sidspill; historiskt återtagna beslut är läsbara men inte valbara.
Resultatorsaker och nyckeltext visas på svenska. Fryst bekräftelse och
okänt skrivutfall visar person, klass, beslut, huvud, källa och
tävlingsversion. Fokus flyttas till beslutspanelen; bara uttrycklig
byteidentisk same-id-retry kan sända igen.

Verifiering efter sista UI-ändringen:

| Kommando | Exakt resultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/components/out-of-competition-withdrawal-admin-ui.test.tsx src/lib/out-of-competition-withdrawal-admin-client.test.ts` | exit 0, 2 testfiler, 5/5 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.result-finalization-public-link.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-264-out-of-competition-withdrawal-visual.spec.ts tests/e2e/playwright.result-finalization-public-link.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.result-finalization-public-link.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.result-finalization-public-link.config.ts --grep TASK264` | exit 0, 1/1 Chromiumfall vid 390/1366 px |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-build samt offline-appskal byggda |

Browserfallet använder åtta syntetiska beslut och avlyssnar alla API-anrop.
Det kontrollerar exakt inskickat huvud/källa, ingen POST före bekräftelse,
synlig mobilåtgärd och identisk nyckel/body vid uttryckligt återförsök.
Fyra skärmbilder av desktop, mobil, bekräftelse och retry granskades
visuellt. Inga verkliga credentials, tävlingsdata eller databas användes.
Det äldre PostgreSQL-beroende `task-001`-provet kördes inte; endast dess
återtagningsrubrik och nyckellabel uppdaterades för den nya UI-texten.

## Kvarvarande antaganden

- Befintlig behörighet och servermutation används oförändrade. Det
  syntetiska browserprovet bevisar klientpresentation/retry, inte verklig
  servercommit eller produktion.
- Täta desktoprader och minst 52 px höga mobilåtgärder är lämpliga som
  utgångspunkt; fysisk mobil, regn, handskar och solljus återstår att prova.
- Befintliga textbundna semantiska färger räcker mot den neutrala basen;
  ingen bred färg-/tillgänglighetsacceptans görs i detta snitt.

Nästa minsta vertikala uppgift: samma kompakta neutrala presentation för
den separata beslutsvyn Utan tidtagning, utan ändrad beslutspolicy eller API.
