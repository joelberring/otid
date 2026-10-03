# ADR-0128: offentlig, härledd metadata för exakt publicerad rutt

- Status: Accepterad och implementerad i TASK118
- Datum: 2026-09-21

## Kontext

TASK117 visar en exakt samtyckt, administratörssläppt GPX-rutt som pixelbana
på en exakt karta. Den publika vyn saknar dock grundläggande information om
spåret: deltagaren kan inte se dess distans eller om GPX-filen har
tidsstämplar. Att exponera råa WGS84-punkter för att låta browsern beräkna det
skulle bryta TASK117:s pixel-only-gräns.

Två-ruttsjämförelse, tidsuppspelning och sträckanalys kräver separata beslut om
urval, samtycke för båda parter och synkronisering. De ingår inte här.

## Beslut

TASK118 lägger till en ren domänfunktion som beräknar total geodesisk distans
med en dokumenterad haversine-variant över vardera sekventiella GPX-segment.
Inga linjer dras över segmentgränser. Resultatet avrundas endast för visning;
den interna beräkningen är deterministisk och använder metersvärde med
bråkdelar.

Den publika route-resolvern härleder följande från den exakta aktiva
TASK117-ruttversionen, utan ny tabell eller writer:

- total distans i meter;
- punkt- och segmentantal;
- första/sista tidsstämpel och varaktighet endast när alla lagrade punkter har
  `recordedAt` och den globala källordningen är monoton (vilket även kräver
  monoton tid inom varje segment);
- annars ett explicit tidslöst läge.

Samma kontroll av aktivt TASK116-samtycke, TASK117-release, aktiv
kartpublication och exakt georeferens gäller som för pixelbanan. Metadata
svarar därför inte längre när samtycke, route eller karta återtas. Svaret är
`no-store` och innehåller inga WGS84-punkter, interna ID:n, hashvärden eller
objektlagerfält.

Metadata är inte resultatdata: den ändrar aldrig status, sträcktider, ranking,
resultatrevisioner eller rå GPX. Det är inte en GPS-precision- eller
tidssynkroniseringsgaranti.

## Konsekvenser

Den publika resultatvyn blir mer användbar utan att börja analysera vägval.
Senare snitt får välja flera rutter, deltagarurval, tidsaxel,
kontrollkoppling, tempo/höjd, FIT/TCX, mobilinspelning och OMAP separat.
