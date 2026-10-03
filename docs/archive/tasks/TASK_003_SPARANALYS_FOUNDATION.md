# TASK 003 – arkitekturgrund för fri spåranalys

## Syfte

Förbered V2:s egen spår- och analysmodul utan att bygga en Liveloxberoende lösning och utan att störa V1:s tävlingskärna.

Detta är först en datamodells- och prototyppuppgift.

## Oberoendekrav

- Ingen användning av Livelox API för kartor eller rutter.
- Ingen scraping.
- Ingen kopiering av deras UI, texter eller varumärke.
- Egna kartor, banor, resultat och användaruppladdade GPS-rutter.
- Core viewer ska vara möjlig att erbjuda utan individuell premiumspärr.

## Leverans A – ADR och modell

Skapa ADR för:

- karta och kartversion,
- georeferering,
- tileåtkomst,
- ruttlagring,
- tidslinjering,
- integritet och publicering.

Implementera eller färdigställ modeller:

- `map`
- `map_version`
- `map_asset`
- `map_georeference`
- `map_tie_point`
- `course_print`
- `route`
- `route_point`
- `route_assignment`
- `route_alignment`
- `route_control_passage`
- `route_leg_metric`

## Leverans B – enkel kartprototyp

Stöd:

- uppladdning av GeoTIFF eller PNG + world file,
- privat objektlagring,
- läsning av CRS,
- workerjobb som skapar webbanvändbar representation,
- MapLibrevisning,
- klassens kontroller från IOF CourseData,
- kartan ska vara låst fram till publicering.

Det räcker med en kartversion och en bana i första prototypen.

## Leverans C – GPX

- importera GPX,
- spara originalfil,
- validera och parsar punkter,
- visa rutt ovanpå kartan,
- manuell beskärning och tidsförskjutning,
- koppla rutten till en deltagare/resultatrevision,
- behåll originaldata oförändrad.

## Leverans D – fler-ruttviewer

- välj flera deltagare,
- spela upp efter faktisk tid,
- spela upp som masstart,
- tidslinje och hastighet,
- följ vald deltagare eller alla,
- sträckval,
- tabell för tid, distans och tempo.

Ingen avancerad duellalgoritm krävs.

## Leverans E – åtkomst

- karta och rutt är privata före publicering,
- kortlivade signerade URL:er eller auktoriserad tile-endpoint,
- publik länk efter publicering,
- route visibility: private, event-participants, public,
- auditlogg för publicering.

## Tester

- hemlig tile går inte att hämta,
- publicering aktiverar åtkomst,
- world-file-transformen träffar kontrollpunkter inom tolerans,
- GPX-originalhash ändras inte av offset,
- samma ruttimport är idempotent,
- två rutter kan spelas upp som masstart,
- en privat rutt läcker inte i publik bundle,
- ändrad kartversion ändrar inte äldre analys utan explicit ombearbetning.

## Avgränsning

Bygg inte ännu:

- FIT/TCX,
- automatisk klocksynk,
- Garmin/Strava/Suunto/Polar/Coros,
- live GPS,
- vägvalsklustring,
- duell,
- automatisk bomanalys,
- OCAD-parser.
