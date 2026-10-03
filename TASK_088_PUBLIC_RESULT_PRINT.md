# TASK088: browserutskrift av filtrerade publikresultat

Påbörjad 2026-09-19 som nästa minsta B3-snitt efter TASK087.

## Användarvärde

En arrangör, löpare eller publikbesökare kan skriva ut det aktuella, redan
filtrerade publika resultatunderlaget från webbläsaren. Pappersversionen är
tät, läsbar i gråskala och utan webbens navigation eller filterfält.

## Arkitektur och avgränsning

- Detta är enbart `@media print` ovanpå den befintliga publika resultatsidan.
  Ingen knapp, route, PDF-generator, fil, API, datahämtning eller
  skrivarspecifik integration införs.
- Utskrift använder exakt samma redan filtrerade rader som skärmresultatet;
  den kör ingen lokal omräkning och hämtar inte data på nytt.
- Print återställer semantisk tabelllayout och tabellhuvud, döljer navigation
  och interaktiva sök-/klasskontroller och behåller status- och
  mixed-course-varningar textligt i svartvitt.
- Ingen deltagaridentitet, UUID, rådata, revision, GPS, karta, stafett eller
  verklig skrivare omfattas.

Ingen ADR krävs: CSS-presentation av redan publika data ändrar inga
domängränser eller teknikval.

## Berörda delar

- `apps/web/src/app/globals.css`,
- utökat riktat webkomponenttest som skyddar public-result-markup- och
  printreglerna.

## Acceptans

1. Utskrift avspeglar det aktuella lokala namn-/klassurvalet.
2. Navigation och interaktiva filterkontroller syns inte på papper.
3. Tabellen återställs från mobilkort till tabell med repetitivt huvud,
   svartvit statusinformation och obrutna resultatrader.
4. Ingen ny data, interna id:n eller o-filtrerade rader kan tillkomma i
   printläget.

## Verifieringsläge 2026-09-19

- `CI=true pnpm --filter @o-tid/web exec vitest run
  src/lib/public-results-filter.test.ts src/components/public-results-ui.test.tsx`:
  exit 0, 2 testfiler och 9 tester på 14 ms;
- web lint och typecheck: exit 0;
- web build: exit 0; 564 ms kompilering, 1,0 s TypeScript och 7/7 statiska
  sidor på 50 ms.

Markup-/CSS-provet bekräftar att redan filtrerade rader skrivs, kontroller och
navigering döljs och semantisk tabell med repetitivt huvud återställs. Ingen
fysisk skrivare, PDF eller ny browser-/PostgreSQL-kedja ingår.
