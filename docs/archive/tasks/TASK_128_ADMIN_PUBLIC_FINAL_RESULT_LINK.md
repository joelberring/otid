# TASK128: kopierbar publik länk efter loppsfinalisering

Status: genomförd. Ingen ny ADR krävs: ADR-0134 har redan beslutat den publika,
explicita slutresultat-URL:en. Detta snitt återanvänder bara den beslutade
vägen i den privata finaliseringsvyn.

## Användarvärde

När arrangören har fastställt hela loppet ska hen direkt kunna öppna eller
kopiera den exakta publika slutresultatlänken för deltagare och publik.

## Avgränsning

- Endast efter ett bekräftat `RACE`-svar i den befintliga
  `FINALIZE_RESULTS`-vyn.
- URL: `/results/{raceId}/finalizations/{finalizationId}`.
- Ingen ny API-rutt, migration, writer, read-model, publiceringsregel,
  export, klassfinaliseringslänk eller clipboard-fallback som lagrar data.

## Acceptans

1. Ett bekräftat RACE-fastställande visar en öppna- och kopieraåtgärd för
   exakt dess publika slutresultat-URL.
2. CLASS-fastställande visar aldrig motsvarande åtgärd.
3. Clipboard-innehåll och DOM-länk innehåller endast vägen med race- och
   opaque finaliserings-id; inga hash-, snapshot-, klass-, aktörs- eller
   proveniensfält.
4. Kopieringsfel lämnar finaliseringsresultatet intakt och ger ett tydligt
   svenskt besked. Ingen automatisk retry eller extern delning sker.

## Verifiering

- Web UI-test: 5/5 passerade.
- E2E-typkontroll och ESLint: exit 0.
- Browser: 1/1 passerade på 390 px med riktig Next-vy och syntetiska
  finaliseringssvar. Provet bekräftar RACE-intentet, exakt DOM-länk och det
  absoluta clipboardvärdet utan intern metadata.
- Web lint, typecheck och produktionsbuild: exit 0. Browserprovet använder
  ingen databas, ingen extern tjänst och ingen fysisk mobil.
