# @o-tid/map-file

Steg 59 (ADR-0179). Läser orienteringskartor ur OCAD (.ocd, version 12, 2018 och senare) och OpenOrienteering Mapper
(.omap/.xmap) till en gemensam modell i minnet (`src/model.ts`), räknar kartans mm till SWEREF 99/RT 90 och WGS 84
och tar fram ritkommandon för skärmbilden. Ren TypeScript utan I/O, körs i webbläsaren.

Egen kod. ocad2geojson (AGPL) och OpenOrienteering Mapper (GPL) får läsas för förståelse men ingen kod kopieras eller
översätts (ADR-0168 beslut 3, ADR-0179 beslut 6).

- `readMapFile(bytes, fileName?)` känner igen formatet på innehållet och kastar `MapFileError` för oanvändbara filer.
- `mapPointToWgs84(georef, point)` och `wgs84ToMapPoint` räknar kartans mm via SWEREF 99 TM, de tolv lokala zonerna
  eller RT 90 2,5 gon V. Övriga koordinatsystem ger `crs.kind = "UNKNOWN"`.

Kontroll mot riktiga kartor (filerna committas inte): `OTID_REAL_MAP_DIR=/sökväg/till/mappen pnpm --filter
@o-tid/map-file test`. Mappen ska innehålla en `.ocd`, en `.omap` av samma karta och banfilen (`.xml`) från Purple Pen.
