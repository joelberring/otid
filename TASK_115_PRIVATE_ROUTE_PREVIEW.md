# TASK115: privat förhandsgranskning av en rutt över en kalibrerad rasterkarta

Status: implementerad och riktat verifierad enligt ADR-0125.

## Användarvärde

En tävlingsadministratör kan kontrollera att en deltagares redan privata GPX-
rutt hamnar rimligt på en uttryckligt vald, redan kalibrerad privat karta, utan
att göra rutten synlig för deltagare eller publik.

## Avgränsning

- Endast läsbar `MANAGE_RACE`-vy för en route-manifest, en PNG/JPEG-manifest
  och en explicit georeferensrevision i samma race.
- Servern läser immutable ruttpunkter och härleder begränsade pixelpunkter;
  browsern skickar aldrig koordinater.
- Privat, `no-store` kartbildsläsning använder exakt manifestets objektversion.
- Kompakt svensk adminvy med explicit val, felmeddelande och ingen automatisk
  "senaste"-fallback.

## Acceptans

1. Fel race, saknad rutt/karta/georeferens, fel manifestbindning, ogiltig
   pixelpunkt eller saknad exakt objektversion avvisas utan fallback.
2. En äldre explicit route/map/georeferens används fortfarande exakt efter att
   en ny route eller ny kalibrering lagts till.
3. Privat adminprojektion innehåller endast härledda pixelpunkter och nödvändig
   visningsmetadata, aldrig WGS84, grant, session, objektkey/bucket/version eller
   deltagarens publika resultatidentitet. Publika resultatsidor läser inget från
   vägen.
4. Browserfallet visar syntetisk karta och en syntetisk rutt på 390 px med
   korrekt privat auth; ingen publik rutt- eller kartväg anropas.

## Utanför uppgiften

Publik/deltagarstyrd ruttvisning, ruttjämförelse, animering, vägvalsanalys,
live-GPS, OMAP/GeoTIFF/PDF, kart- eller banimport, kontrollöverlägg, samtyckes-
och publiceringspolicy, stafett och hårdvara.
