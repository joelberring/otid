# TASK294 – från klass till tilldelad bana

## Avgränsning

Klassöversiktens bannamn ska öppna exakt aktuell tilldelad banversion i
befintlig Före → Banor. Återanvänd TASK292:s ID-bundna mål/fokus, inte
namnsökning. Ingen ny API, domänregel, databas, sida eller ADR behövs.

## Acceptans

- Varje klassrads bana är en neutral kompakt textåtgärd med externaliserad
  svensk åtkomstetikett och minst44 px tryckyta.
- Exakt banversion öppnas/fokuseras; saknat mål ger befintlig textstatus
  utan fallback till annan bana.
- Läsande navigation spärras under pågående skrivflöde.
- Befintlig ban→klass-navigation och varningsflöden bevaras.
- Ett befintligt TASK227/TASK293-browserfall återanvänds, ingen ny svit.

## Verifiering

Klart 2026-10-02. Sol-agent implementerade, huvudagent granskade och körde
kontrollerna. Klass-ID måste ha exakt en matchning i aktuellt underlag.
Dess banversions-ID öppnas genom samma snapshotbundna mål som TASK292;
deltagargenvägen behåller kontrollen mot vald deltagares klass. Klassens
tidigare navigationsmarkering rensas. Ingen namnfallback eller skrivning.

Banåtgärden ligger i befintlig tabellcell, neutralt understruken med
klassrad/klassnamn/bana/version i svensk åtkomstetikett. Desktopens extra
vertikala cellpadding togs bort för just banfältet efter bildgranskning;
44 px tryckyta bevaras och övriga fält är vertikalt centrerade.

Exakta resultat:

- `CI=true pnpm --filter @o-tid/web lint`: exit 0.
- `CI=true pnpm --filter @o-tid/web typecheck`: exit 0.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json`: exit 0, även efter sista teständringen.
- Riktad ESLint av `tests/e2e/task-227-class-finder.spec.ts` med samma
  E2E-tsconfig: exit 0, även efter sista teständringen.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK294`:
  första1/1 på16,0 s, efter bildgranskningens densitetsrättning slutlig1/1
  på17,0 s, båda exit0. Ett befintligt fall, ingen ny svit/fixture/databas.
- `CI=true pnpm --filter @o-tid/web build`: båda exit0, slutligt
  Next16.3.3/22 statiska sidor. Kördes separat från browsern.

Browsern provar exakt Bana12-fokus/kontrollföljd vid390/1280 px,
saknad Bana13 utan öppnad fallback, bevarad ban→klass-navigation och
varningsflöden, desktoprad högst50 px och noll oavsiktliga skrivningar.
Desktopbild granskades. Loopback3167 saknade lyssnare efter browsern.

## Kvarvarande antaganden och nästa snitt

Det syntetiska UI-provet verifierar inte serverauktorisering, fysisk mobil
eller fältbruk. ID-bindningen är kodgranskad; likalydande banor är bevisade
i TASK292:s separata återanvända fall, inte en ny TASK294-fixture.
Nästa minsta snitt: klassnamnet i klassöversikten väljer rätt klass direkt
för de befintliga klassinställningarna, utan separat väljande i formulären.
