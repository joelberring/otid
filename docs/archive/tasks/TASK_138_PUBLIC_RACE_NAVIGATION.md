# TASK138: direkt navigering mellan publik startlista och resultat

Status: slutförd och riktat verifierad 2026-09-22.

## Syfte

En deltagare eller anhörig som redan tittar på ett lopps publika startlista
eller resultat ska kunna gå direkt till den andra vyn för samma lopp, utan att
först återvända till tävlingsöversikten.

## Arkitekturbeslut

Ingen ADR behövs. Detta är en lokal presentation ovanpå två redan publicerade
läsytor. Det ändrar inte teknikval, domängränser, publiceringsbeslut,
behörighet, cachepolicy, API eller beständig data.

## Avgränsning

- Resultatsidan får en race-scopad länk till den redan befintliga publika
  startlistan.
- Startlistsidan får en race-scopad länk till den redan befintliga publika
  resultatlistan.
- En liten gemensam serverrenderad navigeringskomponent får hålla länkarna och
  svenska, externaliserade etiketter konsekventa.
- Startlistans publiceringsregel och resultatens live-/slutresultatvägar
  ändras inte. Länkarna antyder aldrig att startlistan är publicerad eller att
  resultat finns; respektive befintlig sida behåller sin egen fail-closed-vy.

## Acceptans

1. `/results/{raceId}` visar en tydlig länk till `/starts/{raceId}`.
2. `/starts/{raceId}` visar en tydlig länk till `/results/{raceId}`.
3. Båda sidor behåller länken till tävlingsöversikten och visar inte en länk
   till sin egen aktuella sida.
4. Etiketterna är svenska, textliga och ligger i ett semantiskt `nav` med ett
   tillgängligt namn.
5. Ändringen skapar inga nya nätanrop, cookies, lokala lagringsposter,
   resultatfält, startlistefält eller privata identifierare.

## Proportionell verifiering

- Ett litet renderingsprov verifierar båda riktningarnas exakta publika vägar,
  svensk text, semantisk navigering och frånvaro av självlänk.
- Berörd webblint, typecheck och produktionsbuild körs med `CI=true`.
- Ingen databas-, browser-, hårdvaru- eller bred regressionskörning behövs för
  två redan existerande, serverrenderade interna länkar. Next-produktionsbygget
  verifierar att båda dynamiska sidor kan kompileras.

## Utanför uppgiften

Ingen ny publik startsida, slutresultatlänk, karta, rutt, deltagardetalj,
resultatlogik, startstatus, Eventor, GPS, stafett eller hårdvarufunktion ingår.

## Utfört 2026-09-22

En gemensam serverrenderad `PublicRaceNavigation` används nu av båda befintliga
sidor. Resultatet länkar till samma lopps startlista och startlistan länkar
till samma lopps resultat; båda behåller vägen tillbaka till
tävlingsöversikten. Komponentens etiketter är svenska och externaliserade, och
respektive sida visar aldrig en självlänk.

Riktad verifiering:

- `CI=true pnpm --filter @o-tid/web exec vitest run
  src/components/public-race-navigation.test.tsx
  src/components/public-results-ui.test.tsx`: exit 0, 2 filer och 12 tester.
- `CI=true pnpm --filter @o-tid/web lint`: exit 0.
- `CI=true pnpm --filter @o-tid/web typecheck`: exit 0.
- `CI=true pnpm --filter @o-tid/web build`: exit 0. Next.js 16.3.3
  kompilerade på 4,0 sekunder och TypeScript-steget på 6,6 sekunder.

Ingen databas, extern tjänst, browsermiljö eller fysisk mobil användes. Det
nya renderingsprovet täcker de två stabila URL:erna och byggsteget kompilerar
de berörda dynamiska sidorna; detta är inte ett fälttest av deltagarupplevelsen.
