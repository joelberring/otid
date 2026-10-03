# TASK297 – prioritera deltagarens resultat före banans kontrollföljd

## Beslut och avgränsning

Den nuvarande INFO-ordningen lägger tilldelad bana före gällande resultat.
En lång kontrollföljd kan därför skjuta ned felstämplingsstatus och
äldre-underlagsvarning. Visa grunduppgifter → gällande resultat → tilldelad
bana → historiska resultatkontroller. Detta är presentation, inte en ändrad
domängräns, resultatregel eller teknik; ingen ny ADR behövs.

## Acceptans

- Samma innehåll, behörighetsgrindar och resultathistorik som tidigare.
- Felstatus, orsak, äldre underlag och explicit omberäkning förblir synliga;
  inga kritiska tillstånd göms i en disclosure.
- Tilldelad bana skiljs fortsatt från historiskt resultatunderlag.
- Gråvit neutral bas, inga nya kort eller typsnitt. Mobilens deltagarfakta
  och bana får plana sektioner i stället för kapslade kort.
- Befintliga redigeringsknappar/banåtgärder behåller44 px mål och spärrar.
- Återanvänd endast TASK281/283/290/292:s browserfall vid390/1280 px.
  Prova ordning, status och frånvaro av oavsiktlig skrivning; ingen ny svit.

## Verifiering

- Web lint och typecheck: exit 0.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json`: exit 0.
- Riktad ESLint för `tests/e2e/task-167-payment-filter.spec.ts` med samma
  E2E-projekt: exit 0.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK297`:
  slutligen exit 0, 1/1 på11,9 s. Samma enda befintliga fall, ingen ny svit.
- `CI=true pnpm --filter @o-tid/web build`: exit 0, Next16.3.3,
  22/22 statiska sidor.

Första browserkörningen: exit1 efter45 s, inloggningsstatus återgick till
”Behörighet saknas eller har gått ut” innan UI-assertionerna nåddes.
Omkörningen passerade utan ändring av autentisering. En möjlig race mellan
inledande GET-session och manuell inloggning har identifierats i läsning,
men orsaken är inte bevisad eller åtgärdad i detta snitt.

Slutprovet visar ordning vid390/1280 px, platta mobila sektioner och44 px
knappar, bibehållen status/historisk bana, banhopp, saknat/opublicerat
resultat, läsfel/403 och noll oavsiktliga skrivningar. Desktop- och
mobilbilder granskades. Inget innehåll eller resultathistorik togs bort.

## Kvarvarande antaganden och nästa steg

Syntetisk Next/browser-acceptans, inte fysisk mobil, riktig credential,
serverauktorisering eller fältbruk. Första inloggningsstoppet ska inte
räknas som löst av en grön omkörning.

Nästa minsta uppgift: isolera initial sessionsläsning mot manuell
inloggning i befintligt browserflöde och rätta endast en bevisad race.
