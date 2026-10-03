# TASK118: publik metadata för en exakt rutt

Status: implementerad och riktat verifierad enligt ADR-0128.

## Användarvärde

På en redan tillgänglig deltagarrutt ser besökaren distans, antal punkter och
segment samt ett tidsintervall när GPX-filen verkligen bär fullständiga
tidsstämplar.

## Avgränsning

- Ren, deterministisk haversine-beräkning i domänen per GPX-segment.
- Härledd publik metadata på befintlig TASK117-routevy; ingen ny databastabell
  eller skrivväg.
- Samma fail-closed release-, samtyckes- och kartgräns som TASK117.

## Acceptans

1. Känd syntetisk tvåsegmentsrutt ger rätt meteravstånd, punkt- och
   segmentantal utan sträcka över segmentgräns.
2. Fullständiga monotona tidsstämplar ger start, slut och varaktighet;
   saknad eller oordnad tid visas tydligt som tidslös.
3. Publikt DTO innehåller inga WGS84-punkter, interna ID:n, hash- eller
   objektlagerdata och blir otillgängligt efter TASK117-withdrawal.
4. Svensk vy är läsbar vid 390 px. Resultat, GPS-live, jämförelse, tempo,
   höjd, FIT/TCX, OMAP och ny lagring ingår inte.

## Genomförande

- `packages/domain` räknar distans från de privata källpunkterna, men den
  publika projektionen lämnar endast härledd distans, antal punkter/segment och
  ett diskriminerat tidsläge.
- Saknad, ogiltig eller bakåtgående tidsstämpel ger `UNAVAILABLE`; inget
  varaktighetsvärde fabriceras.
- TASK117:s befintliga release-/withdrawalkontroll utförs före metadata läses.
  Efter withdrawal finns därför inte heller metadata.
