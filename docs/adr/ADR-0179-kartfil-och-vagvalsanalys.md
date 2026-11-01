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
9. Stråket med vägar högst 5 % sämre än bästa och upp till fyra skilda alternativ, högst 25 % sämre, visas
   (ändrat 2026-11-01 från tre och 15 %; ±15 % gäller fortfarande för "ungefär lika").
10. Analysen använder bara kartans information, samma som de tävlande har. Stigningen räknas med höjdkurvor gånger ekvidistans. Ingen höjdmodell.
    Stigningsmodellen (ändrad 2026-11-01, se nedan) skiljer på höjdarbete, lutning och passager.
11. Analysen räknas i webbläsaren och sparas inte. Bara inställningarna sparas.
12. Banhemligheten gäller: bara admin innan banorna är publika.
13. Farterna är riktvärden. Analysen visar när bästa vägvalet byter plats om farterna ändras ±15 %, och farterna kan
    kalibreras mot löparnas GPS-rutter per tävling.

**Konsekvenser.** Skärmbilden är inte tryckkvalitet. Tryck med dekorfärger och övertryck (steg 4) görs senare på
servern med låg prioritet eller i macpurplepen. Kartan visar inte åt vilket håll en kurva går upp, så stigningen räknas
som ett väntevärde (nedan). Filer från äldre OCAD än version 12 stöds inte i första versionen.

## Stigningsmodellen (2026-11-01)

Ägaren såg på Stockholm by Night (Högdalen, bana A 8–9) att analysen valde en lång väg runt kullens fot i vit skog i
stället för över kullen. Orsaken: varje passerad kurva räknades som stigning åt båda hållen (8 m plan väg per höjdmeter
även nedför, alltså 40 m per kurva), medan skrå, tät kurvbild och passerbara branter inte kostade något. Tre delar som
inte överlappar ersätter regeln (`packages/route-choice/src/defaults.ts`):

1. **Kurvpassagerna** står för höjdarbetet, även på stig och väg. Riktningen syns inte, så en passage kostar
   ekvidistans × (`climbFactor` + `descentFactor`) / 2. Mellan två kontroller är höjdskillnaden densamma för alla vägar,
   så rangordningen blir exakt; bara den uppskattade tiden kan fela med (upp − ned) / 2 × |Δh|. Standard
   `climbFactor` 8 (Naismith: 8,3 m per höjdmeter) och `descentFactor` 3 (Langmuir: +2,8 m per höjdmeter brant nedför;
   Tobler 2,1–3,4 vid −20 till −30 %), alltså 27,5 m per kurva med 5 m ekvidistans. Bästa vägens stigning visas som
   hälften av de passerade höjdmetrarna. `descentFactor` är minst 0,5 (brant nedför kostar alltid något).
2. **Lutningsfaktorn** står för framkomligheten i brant mark utan stig (upp, ned och skrå). Lutningen skattas ur
   kurvlängden per ytenhet (lådfilter med radien 20 m, en gång per rutnät): ekvidistans × längd per m². Tiden per meter i
   marken gånger 1 + `slopeFactor` × (e^(3,5·(g − 0,1)) − 1) över 10 % lutning (Toblers nedförsgren); stigar och vägar
   påverkas inte. Standard 0,2, vald så att upp och ned över en sluttning i skog hamnar mellan Langmuir och Tobler.
3. **Passerbara linjer** (202 brant, 104 jordbrant, 105/106 vallar, 107/108 rännor, 215 dike, 513/514 murar, 516/517
   staket) kostar 2–15 m per passage (ISOM 2017-2/ISSprOM 2019-2: "crossing a cliff will normally slow progress"),
   inget där en stig korsar. Inställbart med `crossingMetersBySymbol`.

Kalibreringen skattar `climbFactor` (med `descentFactor` fast; upp och ned går inte att skilja utan höjder) och
`slopeFactor` med minsta kvadrat när rutterna räcker. Alla nya inställningar är valfria fält i `RouteChoiceSettings`.

På kartan (banläggningens kanvas och kontrollkartans vägvalsvy) är bästa vägen en tjock blå linje och alternativen
streckade i var sin färg (röd, turkos, orange, vinröd; aldrig banlila eller kartans färger), alla med vit kant, och
numrerade med tidsskillnaden ("1 · +8 %") där de ligger längst från bästa vägen. Ägarens fall (Högdalen, bana A 8–9)
provas i `real-map.test.ts` med `OTID_SBN_DIR` mot hans .ppen; filerna committas inte.

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
