# ADR-0004: Polling för offentlig resultatvy i TASK 001

- Status: Ersatt för normaldrift av ADR-0135 i TASK129; polling behålls som reserv
- Datum: 2026-08-30

## Kontext

TASK 001 tillåter SSE eller en dokumenterad första pollinglösning. Monotona SSE-ID,
återanslutningshistorik och cache kräver ett separat, sammanhållet snitt.

## Beslut

Den offentliga sidan hämtar en serverrenderad snapshot och pollar resultat-API:t
var femte sekund. API:t returnerar endast senaste publicerade revision.

## Konsekvenser

Första flödet blir körbart utan en halvfärdig realtimekanal. Polling är inte
dimensionerad för produktionsmålet 1 000 publikklienter och ska ersättas av SSE i
ett senare minsta vertikalt steg, med egen ADR om händelselagring.

## Efterföljande beslut

TASK129 genomför den avsedda begränsade ersättningen i ADR-0135. Den publika
klienten använder då SSE som wake-up för samma resultat-GET, med
återanslutningshistorik och reset. Den här femsekunderspollingen finns kvar
som uttrycklig reserv när stream eller nät inte fungerar.
