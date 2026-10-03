# TASK136: bredare tävlingsadministration på desktop

## Syfte

Ge den befintliga arbetsytan `/admin/[raceId]/manage` mer horisontellt utrymme
på en vanlig operativ desktopskärm. Deltagarlista och vald deltagares arbetsyta
ska kunna visas med mindre radbrytning utan att publika sidor eller mobilvyn
blir tätare.

## Avgränsning

- Endast `main` på den befintliga administrationssidan får en egen klass.
- Från och med 1280 CSS-pixlar höjs just den sidans maximala bredd från 1120
  till 1520 pixlar.
- Den generella `main`-regeln, övriga administrationssidor och alla publika
  sidor ändras inte.
- Brytpunkten för arbetsytans mobilvy (720 px), dess list-/arbetsyteväxling,
  tryckytor och lokala tabellscrollar ändras inte.

## Arkitekturbeslut

Ingen ADR behövs. Detta är en lokal presentationsregel inom befintlig Next- och
CSS-arkitektur; den introducerar ingen data, behörighet, API-yta, beständighet
eller ny domänregel.

## Acceptans

1. Vid 1366 px kan `/manage` använda den tillgängliga desktopbredden för den
   befintliga tvåkolumnsarbetsytan.
2. Vid högst 1279 px gäller fortsatt den gemensamma 1120-pixelsramen.
3. Vid 390 px är arbetsytans befintliga responsiva beteende oförändrat och
   sidan får ingen horisontell scroll.

## Verifiering

- Utfört 2026-09-22: `CI=true pnpm --filter @o-tid/web lint` (exit 0),
  `CI=true pnpm --filter @o-tid/web typecheck` (exit 0) och
  `CI=true pnpm --filter @o-tid/web build` (exit 0). Next.js 16.3.3
  kompilerade produktionsbygget på 4,2 sekunder och TypeScript-steget på
  3,6 sekunder.
- Utfört 2026-09-22: E2E TypeScript och ESLint för den befintliga
  race-administratörskonfigurationen passerade (båda exit 0).
- Utfört 2026-09-22: Det befintliga `TASK065`-browserfallet passerade 1/1 på
  16,5 sekunder mot en uttryckligen vald syntetisk, isolerad
  PostgreSQL17/PostGIS-databas. Fallet bekräftar `max-width` 1520 px vid
  1366 px och 1120 px vid 390 px, utöver befintlig kontroll av horisontell
  sidscroll. Ingen okänd, demo- eller privat databas kontaktades.

## Utanför uppgiften

Ingen ny vystruktur, tabellkolumn, mobilregel, resultatlogik, hårdvara,
Eventor, GPS eller stafett ingår.
