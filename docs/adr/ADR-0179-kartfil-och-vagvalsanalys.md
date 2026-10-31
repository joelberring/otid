# ADR-0179: Kartfilen och vägvalsanalys

Status: beslutad 2026-10-31 (PLAN.md steg 59 och 60, ägarens önskemål samma dag). Kompletterar ADR-0171 och ADR-0176.

**Bakgrund.** Ägaren vill på sikt ha hela flödet från banläggning till tävling i O-Tid. Första delen är att läsa
banläggarens kartfil (OCAD eller Mapper) och räkna vägval. Banläggning i webben och tryck väntar. Banor kommer från både
OCAD och Mapper, och formaten ritar linjer olika. Därför ska filerna inte konverteras.

**Beslut.**
1. Kartfilen sparas orörd (`race_map_source`) och läses med egna läsare för OCAD och Mapper i `packages/map-file`.
2. Läsning, ritning och georeferens görs i arrangörens webbläsare. Servern sparar bara.
3. Den ritade bilden och den automatiska georeferensen går in i `race_map`, så att dagens kartvägar återanvänds.
4. Georeferens ur filen för SWEREF 99 (TM och lokala zoner) och RT 90 2,5 gon V. Annars tre punkter för hand.
5. Kontroller med `MapPosition` placeras på kartfilens mm när banfilen hör till kartan, med kontroll mot `Position`.
6. Ingen kod kopieras eller översätts från AGPL/GPL-projekt (ocad2geojson, OpenOrienteering Mapper).
7. Vägvalsanalysen bygger på symbolnummer (ISOM 2017-2, ISSprOM 2019-2) med en standardtabell som kan ändras per tävling.
8. Sökningen görs i ett rutnät per sträcka (2 m skog, 0,5 m sprint) med 16 grannar, från båda ändar.
9. Stråket med vägar högst 5 % sämre än bästa och upp till tre skilda alternativ visas.
10. Analysen använder bara kartans information, samma som de tävlande har. Stigningen räknas med höjdkurvor gånger ekvidistans. Ingen höjdmodell.
11. Analysen räknas i webbläsaren och sparas inte. Bara inställningarna sparas.
12. Banhemligheten gäller: bara admin innan banorna är publika.
13. Farterna är riktvärden. Analysen visar när bästa vägvalet byter plats om farterna ändras ±15 %, och farterna kan
    kalibreras mot löparnas GPS-rutter per tävling.

**Konsekvenser.** Skärmbilden är inte tryckkvalitet. Tryck med dekorfärger och övertryck (steg 4) görs senare på
servern med låg prioritet eller i macpurplepen. Uppför och nedför skiljs inte åt i stigningen. Filer från äldre OCAD än
version 12 stöds inte i första versionen.

## Risker och öppna frågor

- **OCAD-formatets varianter** mellan 12, 2018 och nyare. Verifieras med ägarens filer innan läsaren byggs ut.
- **`MapPosition` verifierat 2026-10-31** på Djurgården 2025 (OCAD 2018, och samma karta i Mapper) med Purple Pens
  banfil för Natt-KM 2026: kartlägena plus OCAD-filens georeferens (SWEREF 99 TM, vridning 4,9°) ger samma läge som
  `Position` på högst 7 cm för alla 25 kontroller. Mapper-filen har samma koordinatsystem, så banan hamnar rätt på båda.
  Banfiler från OCAD:s banläggning återstår att pröva.
- **Ritningens trohet:** mönster och text i skärmbilden är förenklade. Det räcker för analys och publik visning men inte
  för tryck.
- **Kalibreringen av farterna:** startvärdena kan jämföras mot klubbens GPS-rutter. Det är ett bra sätt att justera
  tabellen när steg 60 är klart.
