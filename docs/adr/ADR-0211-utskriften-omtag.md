# ADR-0211: Utskriften om – ringklipp, mellanrum vid ringen, normens färgordning, numren, banans skala och sidans upplägg

Status: beslutad 2026-11-03 (grenen `utskrift-omtag`, ägarens återkoppling efter provutskrifter på riktiga kartor samma dag).
Ingen migration. Ändrar ADR-0183 beslut 7 (BL:s ordning), ADR-0197 beslut 10 (förhandsvisningens redigering) och ADR-0180
beslut 11 (skalan i fliken Utskrift). Purple Pen (BSD, Peter Golde) och IOF:s bilaga till ISOM 2017 "CMYK printing and colour
definitions (includes ISSprOM)" (avsnitt 4, 5 och 7) är underlag; ingen kod är kopierad.

## Bakgrund

Ägaren skrev ut på riktiga kartor och tyckte att utskriften var rörig: ringklippen syntes i editorn men inte på papperet,
sträckorna gick ända in i ringarna, nummer och ringar försvann under hus och asfalt med "Lägg banan under brunt, svart och
100 % blå (BL)", skalan valdes först vid utskriften fast den styr ringarnas storlek och numrens plats, färgerna fanns på två
ställen och papperet redigerades i en ruta bredvid arket.

## Beslut

1. **Ringklippen följer med till papperet.** *Orsaken:* detaljgapen (ADR-0180 beslut 10, "klipp över detaljer") räknas på
   kartfilen och fanns bara i editorn, där kartans Worker räknade dem och gav dem till `layoutOverprint`. `printSheetGroups`
   hade inget sätt att få dem, så både förhandsvisningen och serverns PDF-jobb lade ut ringarna hela (`layoutCoursePage` och
   `layoutTemplateSheets` tog emot `detailGaps` men fick dem aldrig). Nu har `printSheetGroups` `detailGaps` (och
   `numberObstacles`, beslut 4); förhandsvisningen använder samma `useDetailGaps` som editorn och utskriftsarbetaren räknar
   dem på kartfilen med `printDetailGaps` (samma ren funktion som Workern). Överlappsklippen och fasta ringavbrott räknades
   redan i utläggningen och påverkades inte.
2. **Mellanrum mellan sträckan och ringen.** ISOM 2017-2, 705: "There should be gaps between the line and the control circle".
   Purple Pen har inget sådant mellanrum: `CourseFormatter.GetLegRadius` ger ringens radie till linjens mitt, så linjen slutar
   mitt i ringens linje, och `auto-leg-gap-size` gäller avbrott där sträckor korsar varandra. O-Tid avviker: sträckan slutar
   `legCircleGap` utanför figurens yttre kant (ring, målets yttre ring, starttriangelns radie, passagen), förval
   `LEG_CIRCLE_GAP_MM` = 0,35 mm på papperet (en linjebredd, egen tumregel; ISOM anger inget mått), 0–3 mm, i händelsens
   `legCircleGapMm` (`SET_EVENT`, bara O-Tid, skrivs inte till .ppen) och "Mellanrum mellan linje och ring" under Utseende.
   Måttet skalas med utskriftsskalan som allt annat. Editorn, förhandsvisningen och PDF:en ritar samma figurer, så det blir
   likadant överallt. Fasta avbrott i sträckor räknas från den nya änden (som Purple Pen räknar från sin).
3. **Färgordningen följer normen, med övre och undre lila.** Ersätter ADR-0183 beslut 7:s enkla regel. BL:s regel "banan
   under brunt, svart och 100 % blå" lade banan på *en* plats i kartans färgordning, så allt som kartfilen ritade över den
   platsen hamnade över banan: asfalt (brunt 50 %), stora byggnaders svarta fyllning och grått. Där täcktes ringar och nummer
   (ägarens bilder: 10, 11 och 20 under hus och asfalt). Dessutom trycktes färgerna över banan utan övertryck, så de slog ut
   lila helt. Nu (`press-order.ts`):
   - **Normen** per karta: sprint (ISSprOM) i 1:4 000 och 1:5 000 eller med minst två av sprintnormens egna symbolnummer
     (`detectPressNorm`), annars skog (ISOM). Profilen kan välja (`pressNorm`, "Norm: Skog (ISOM) / Sprint (ISSprOM)").
   - **Kartans färger** delas i över och under banans undre lila efter vad de är (`pressColorKind`: namn, CMYK och vad färgen
     används till). *ISOM* över: svart (utom stora byggnaders fyllning, ISOM 521 som yta, och vägkanter), blått 100 % för
     linjer och punkter, brunt 100 %. *ISSprOM* över: svart 100 % (också byggnader) och grönt 100 % för punkter; blått och
     brunt 100 % under. Allt med en andel under 90 % i namnet, ord som asfalt, hårdgjord, vägfyllning och tomt, och alla
     skärmar ligger alltid under banan. Vitt ligger över om kartfilen ritar det över någon av färgerna över banan (masker),
     annars under.
   - **Banan** delas i undre lila (701 start, 703 ring, 705 linje, 706 mål, 708 snitslad väg, 710.1 passage) och övre lila
     (nummer, markeringar, texter, beskrivningar, bilder), som ISSprOM:s lista. ISOM:s bilaga har numren i undre lila (BL:s
     "Violett transparent" likaså); "Kontrollnummer och texter överst" (`numbersOnTop`, förval på) lägger dem överst också i
     skog, som vanligt i praktiken och som ägaren vill. Det står i panelen.
   - **PDF:en** ritar kartan under banan, undre lila, kartan över banan med övertryck (/OP /op true, /OPM 1) och sist övre
     lila (`colorsOverCourse`, `inCourseLayer`). Kontorsskrivaren får inget övertryck (bilagans avsnitt 5: ordningen räcker).
     **Förhandsvisningen** och BL-jämförelsen ritar på samma sätt med kartans färger över banan multiplicerade
     (`mix-blend-mode: multiply`), så att lila syns genom dem som på tryck. Editorn ritar banan överst som förut (model space).
   - **BL:s tabell** är fortfarande källan till CMYK (`colorDecisions`). Där BL:s ordning säger något annat än normen (BL lägger
     vägfyllning och vägkant över banan) följer O-Tid normen och listan säger det på en rad. `courseLayer: "REFERENCE"` behöver
     inte längre en BL-tabell och betyder "i normens ordning".
4. **Numren undviker hus.** Den automatiska placeringen (`placeLabel`) får en kostnad för en ruta på mörka ytor (byggnader ISOM
   521, 522, 526 i alla färger och ytor mörkare än luminans 0,45) och för varje svart linje genom rutan (`number-obstacles.ts`,
   `NUMBER_OBSTACLE_COST`). Hindren räknas på kartfilen som detaljgapen (Workern i editorn och förhandsvisningen,
   `printNumberObstacles` i utskriftsarbetaren). Ett nummer som banläggaren placerat flyttas aldrig; ligger det till minst en
   femtedel på ett hinder kommer notisen "Nummer 11 ligger delvis på ett hus" i Varningar (`NUMBER_ON_OBSTACLE`).
5. **Skalan hör till banan och väljs tidigt.** "Skala för banan" under Banor → Egenskaper (`UPDATE_COURSE printScale`, som
   Purple Pens utskriftsskala i banans egenskaper), förval kartans skala. Fliken Utskrift visar den utan att kunna ändra den,
   med "Ändra i banans egenskaper" (Alla kontroller behåller sitt val där). Ringar och nummer följer den överallt eftersom
   `layoutOverprint` redan använder banans skala. .ppen som förut (`print-scale`). *Placerade nummer:* Purple Pen sparar dem
   som avstånd från kontrollen i kartans mm (`numberDeltaX/Y`) och ändrar dem inte när banans skala ändras (bara när kartan
   skalas om, ChangeEvent.ChangeMapFile). O-Tid gör likadant: numret står kvar.

## Följder

- PDF-jobben räknar detaljgapen och hindren för numren på kartan; det tar några tiotal millisekunder per karta.
- En PDF som skrevs med BL-profilen ser annorlunda ut än förut: färre färger över banan och lila under svart och brunt med
  övertryck. Tidigare godkända beslut gäller som förut (CMYK).
- Mellanrummet vid ringen ändrar alla banors utseende lite (0,35 mm); det kan sättas till 0.
