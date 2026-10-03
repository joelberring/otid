# TASK100: synligt uppdateringsläge i publikresultat

Påbörjad 2026-09-19 efter den publika resultatrapporten och lokala favoriter.

## Användarvärde

En löpare eller anhörig på mobil eller dator kan se att resultatlistan uppdateras
automatiskt och får en tydlig varning när den senaste uppdateringen misslyckas.
Listan behåller då endast redan verifierade publika resultat, utan att antyda att
de är nya.

## Arkitektur och avgränsning

- Återanvänd befintlig femsekunderspolling och redan validerat publikt
  resultatkontrakt; inga nya API-fält, serveranrop, cachepolicyer, databastabeller
  eller publiceringsregler tillkommer.
- Tidpunkt visas först efter ett lyckat klientpoll-svar och bygger endast på
  klientens lokala klocka. Den är ett gränssnittskvitto, aldrig en auktoritativ
  tävlingstid eller en ny resultatfakta.
- Vid fel behålls senast validerade rader och den befintliga textliga varningen.
  Ett fel får inte tömma, ändra eller fabricera resultat.
- Statusen ska vara textlig och tillgänglig via `aria-live`; färg ensam får inte
  bära betydelsen. Den ska inte tryckas.
- Ingen inloggning, identifierare, GPS, karta, rutt, offlinekö eller SSE införs.

Ingen ADR behövs: detta är en lokal presentation ovanpå ett oförändrat publikt
läsunderlag och ändrar inga teknikval eller domängränser.

## Berörda delar

- `apps/web/src/components/public-results.tsx`
- `apps/web/src/components/public-results-ui.test.tsx`
- `apps/web/src/i18n/sv.ts`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/results/[raceId]/page.tsx`
- `docs/status.md`

## Acceptans

1. Resultatsidan talar alltid om att den kontrollerar nya resultat automatiskt
   var femte sekund.
2. Efter ett lyckat klientpoll-svar visas lokal klocktid för den bekräftade
   uppdateringen, utan SSR-/hydratiseringsskillnad.
3. Ett fel visar fortsatt den tydliga textvarningen och behåller senast
   validerade resultat.
4. Statusen är textlig, `aria-live` och syns även när resultatlistan är tom;
   den skrivs inte ut.
5. Berörd komponenttest, web lint/typecheck och produktionsbuild passerar.

## Genomfört 2026-09-19

`PublicResults` visar nu alltid en kort textlig och `aria-live`-märkt
uppdateringsstatus, även när det ännu saknas publicerade resultat. Efter ett
lyckat, runtimevaliderat poll-svar visas klientens lokala klocktid; den läses
aldrig under SSR utan först efter klientuppdateringen. Ett misslyckat svar
behåller de senast validerade raderna och visar den befintliga
textvarningen. Statusen utelämnas från browserutskrift.

Den gamla statiska upprepningen av samma uppdateringsbudskap togs bort från
resultatsidans sidhuvud, så den enda statusen är den levande komponentstatusen.

Ingen route, databas, kontrakt, publiceringsregel, pollingfrekvens eller
identifierare ändrades. Ingen ADR behövdes.

Riktad slutverifiering:

- `CI=true pnpm --filter @o-tid/web exec vitest run
  src/components/public-results-ui.test.tsx`: exit 0, 1 fil / 9 tester.
- `CI=true pnpm --filter @o-tid/web lint`: exit 0.
- `CI=true pnpm --filter @o-tid/web typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/web build`: exit 0; checkin-skal
  `ce19fda93e4e`, 3 publika assets och 7/7 statiska sidor.

Ingen fysisk mobil, skärmläsare eller verkligt nätfel i browser är provat.
Komponentens statiska rendering verifierar att initialläget saknar lokal
klocktid och därmed inte skapar en SSR-/hydratiseringsskillnad.
