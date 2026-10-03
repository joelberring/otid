# TASK087: lokal sökning och klassfilter för publikresultat

Påbörjad 2026-09-19 som nästa minsta B3-snitt efter TASK086.

## Användarvärde

En löpare, ledare eller publikbesökare kan hitta rätt namn eller klass utan att
skrolla genom hela resultatlistan. Sökning och klassfilter fungerar tillsammans
på mobil och dator.

## Arkitektur och avgränsning

- Filtreringen sker lokalt mot samma redan validerade `PublicResultListResponse`
  som publiceras i dag. Ingen ny API-parameter, databasfråga, cachepolicy,
  pollingintervall eller behörighetsgräns införs.
- En liten ren webbfunktion normaliserar case och svenska diakritiska tecken och
  matchar givet namn, efternamn, fullt namn och klass. Den skapar eller ändrar
  inga resultatfakta.
- Klassurvalet är de sorterade unika klasserna i senast mottagna publika svar.
  Om en vald klass försvinner i en senare pollinguppdatering faller vyn tydligt
  tillbaka till alla klasser; en giltig vald klass och söktext bevaras.
- Varning för blandade banversioner härleds från det filtrerade urvalet, så en
  dold klass inte ger vilseledande varning.
- Tomt urval skiljs från avsaknad av publicerade resultat och döljer aldrig ett
  fel om senaste uppdatering misslyckats.
- Ingen deltagaridentitet, UUID, revision, rådata, GPS, karta, stafett, fysisk
  hårdvara eller verklig skrivare införs.

Ingen ADR krävs: detta är en lokal läsprojektion över ett oförändrat publikt
kontrakt och ändrar inga domängränser eller teknikval.

## Berörda delar

- `apps/web/src/lib/public-results-filter.ts` med riktat enhetstest,
- `apps/web/src/components/public-results.tsx`,
- `apps/web/src/components/public-results-ui.test.tsx`,
- `apps/web/src/i18n/sv.ts`,
- `apps/web/src/app/globals.css`.

## Acceptans

1. Namn- och klassökning är case- och diakritikoberoende och kombineras med
   valt klassfilter.
2. Alla klasser och tom söktext återställer listan. Ett tomt urval har egen
   svensk förklaring.
3. Polling behåller söktext/fortsatt giltig klass och visar nya matchningar;
   försvunnen vald klass återställs säkert.
4. Bara synliga klassers mixed-course-varning visas.
5. Kontrollerna är textligt märkta, touchvänliga och passar det befintliga
   640 px-kortläget utan horisontell sidscroll.

## Verifieringsläge 2026-09-19

- `CI=true pnpm --filter @o-tid/web exec vitest run
  src/lib/public-results-filter.test.ts src/components/public-results-ui.test.tsx`:
  exit 0, 2 testfiler och 8 tester på 14 ms;
- web lint och typecheck: exit 0;
- web build: exit 0; 1,4 s kompilering, 3,4 s TypeScript och 7/7 statiska
  sidor på 51 ms.

Filtertestet täcker svensk normalisering, namn-/klassintersektion och
återställning. Komponenttestet täcker svenska, märkta kontroller ovanpå det
befintliga responsiva resultatkortet. Ingen ny browser-/PostgreSQL-kedja behövs
eftersom varken serverbeteende eller persistens ändras. Fysisk mobilrendering
ingår inte.
