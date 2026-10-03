# TASK120: publik historisk banpåtryck på exakt deltagarrutt

Status: implementerad och riktat verifierad enligt ADR-0130.

## Användarvärde

Efter tävlingen kan besökaren se den historiskt korrekta kontrollordningen
ovanför en redan samtyckt och släppt deltagarrutt.

## Avgränsning

- Härledda pixelmarkörer på befintlig TASK117-routevy.
- Endast exakt historisk course-version, exakt karta/georeferens och komplett
  TASK119-geometri.
- Ingen migration, writer, ny målgrupp eller ny publiceringsknapp.

## Acceptans

1. En komplett syntetisk historisk matchning visar kontrollkod, ordning och
   pixelmarkör; inga interna ID:n eller WGS84 läcker.
2. Ändrad resultats course-version, karta, georeferens, samtycke, route- eller
   kartrelease eller ofullständig geometri avvisas fail-closed.
3. Svensk publikvy är läsbar vid 390 px. Ingen GPS-live, OMAP, ruttjämförelse,
   tempo eller analys ingår.

## Genomförande

- Publikruttens serverresolver använder samma publicerade, effektiva
  resultathuvud som resultatlistan. Den läser aldrig deltagarens aktuella
  klasskoppling för att välja bana.
- Endast en komplett TASK119-geometrirevision med samma historiska
  course-version, map-manifest, georeferens och map-hash som TASK117-releasen
  kan bidra med markörer. Varje mismatch ger `not-found` utan fallback.
- Det publika kontraktet innehåller endast `sequence`, `controlCode`, `x` och
  `y`. SVG-vyn visar ordning och kontrollkod ovanpå den redan pixelbaserade
  rutten; den lämnar inga interna identiteter eller koordinater.
