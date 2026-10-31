# @o-tid/map-file

Steg 59 (ADR-0179). Läser orienteringskartor ur OCAD (.ocd, version 12, 2018 och senare) och OpenOrienteering Mapper
(.omap/.xmap) till en gemensam modell i minnet (`src/model.ts`), räknar kartans mm till SWEREF 99/RT 90 och WGS 84
och tar fram ritkommandon för skärmbilden. Ren TypeScript utan I/O, körs i webbläsaren.

Egen kod. ocad2geojson (AGPL) och OpenOrienteering Mapper (GPL) får läsas för förståelse men ingen kod kopieras eller
översätts (ADR-0168 beslut 3, ADR-0179 beslut 6).
