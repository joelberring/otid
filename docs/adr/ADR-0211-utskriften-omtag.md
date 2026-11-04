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

6. **Färger för tryck i ett flöde.** De två avsnitten ("Förslag för BL skog" och "Färger och tryck (utskriftsprofil)") gjorde
   samma sak: korten sätter en BL-rad per kartfärg (`colorDecisions`), tabellen en egen rad per färg (`mapColors`), och en egen
   rad går före BL-raden (`mapColorAdjust`). Nu ett avsnitt "Färger för tryck": en rad överst med "Färgprofil", status
   ("Godkänd", "3 färger att bekräfta"), "Redigera färger" och "Ny profil"; hela flödet visas medan profilen inte är godkänd.
   I flödet: en rad om vad som bestäms och att kartfilen aldrig ändras, banans färg (CMYK, dekorfärg, övertryck),
   färgordningen (beslut 3: normen, "Kontrollnummer och texter överst"), förslagskorten och sist "Justera färger för hand" med
   samma värden per färg som korten sätter (förslagets CMYK visas, en ändring blir en egen rad och kortet visar "Ändrad för
   hand"; ett beslut på kortet tar bort färgens egna rad). JSON, källan och förhandskontrollen ligger under "Mer". Allt sparas
   genast i tävlingens kopia av profilen (en färdig profil kopieras först).
7. **Sidans upplägg.** Överst färgerna och "Skriv ut" (vad som skrivs ut: banor eller en karta per löpare, vilka banor; "Skriv
   ut på skrivare" och "Skapa PDF för tryckeriet" bredvid varandra med en rad var, jobben och "Ladda ned" i samma ruta), sedan
   översikten och sist redigeringen av arken. Översikten (`sheetCards`) har ett kort per ark (bana, kartbytets del, sida) med
   bild, skala, papper, mall och märken ("Följer mallen …", "Ändrad för banan", "Beskrivningen täcker kartan", "Banan går
   utanför ramen"); ett klick öppnar arket, kryssrutorna ger "Skriv ut markerade" och "Använd mallen på markerade banor", och
   "Använd på alla banor". På telefonen en lista.
8. **Papperet direkt på arket** (ändrar ADR-0197 beslut 10). Markera med klick, Skift-klick eller en ruta på tomt papper;
   dra en eller flera (gruppen); fästning mot kartramens, arkets och marginalens kanter och mittlinjer och mot andra element
   med synliga hjälplinjer (1,5 mm, Alt stänger av) och ett valbart rutnät (1 eller 5 mm, `course-setting-paper-snap.ts`);
   "Justera markerade" (vänster, mitten, höger, överkant, mitten, nederkant; ett element mot kartramen) och fördela (tre eller
   fler); dubbelklick på en text skriver i den på arket med variablerna nära markeringen; lagerlistan med ordning (banans egna
   element), "Lås" och "Dölj" (`locked`, `hide`); "Ångra" och "Gör om" (Ctrl+Z, Ctrl+Skift+Z, Ctrl+Y). Nya element: `RECT`
   (ram eller ruta: bredd, höjd, linjens bredd, färg #rrggbb, fyllning, rundade hörn) och `LINE`. PDF:en ritar färgerna som
   CMYK (svart blir rent K). "Vitt på utskriften" (`whiteAreas`: rektanglar och polygoner i ramens mm, flera, hörnen dras på
   arket) skrivs vitt över kartan och under banan; kartans färger över banan (beslut 3) och markeringarna klipps bort i ytorna
   (jämn–udda), punktmarkeringar i en yta står inte alls, banan står hel. Finns bredvid "Behåll bara innanför" (klippningen).
   På 390 px finns markering och ark nere på skärmen som förut; dragning fungerar med finger (`touch-action: none`).
9. **Mallen bär papperet.** En mall för papperet (`PaperTemplate`) har nu också papperets storlek, riktning och marginal
   (`page`, som banans tryckyta) och de vita ytorna; "Använd mallen" sätter banans tryckyta till mallens papper
   (`templateEdits`). Mallen kan användas på markerade banor eller alla banor i översikten.

10. **Tillägg 2026-11-04 (grenen `utskrift-omtag-2`, ägarens återkoppling).** Ingen migration.
    - *"1 Issue" i dev-överlägget:* en bana med kartbyte fick samma React-nyckel för sina två delar (`1||{}|1`) i översikten och
      bland arken, eftersom delen saknades i arkets nyckel. Nyckeln har nu delen. Ett avvisat sparande som strax försöks igen
      loggas som varning, inte fel. En bild som just laddats upp visas ur webbläsarens egen kopia tills dokumentet som pekar på
      den är sparat (förut 404 i konsolen när ett annat konto redan laddat upp samma bild, beslut 5 i ADR-0197 står kvar).
      E2E (`browserErrors`) fäller utskriftssidan på sidfel, `console.error` och svar ≥ 400.
    - *Namnen:* "Layoutmall" (ADR-0183: flera kartor per ark, remsa för rullad karta) heter nu **"Kartor per ark"** med
      förvalet "En bana per ark (tryckytan som i Purple Pen)" och står bredvid "Papper och kartram". Papperets mall (ADR-0197)
      heter **"Mall för papperet"** både i panelen och i översikten (förut "Mallar för papperet", "Banans mall" och "Mall för
      papperet"). Det är två olika saker och hjälpen säger det.
    - *Sidan i 390 px:* ordningen är Färger för tryck, Skriv ut, Översikt, **Redigera arket**: arken först och panelerna efter
      (på datorn från 1 100 px bredvid arken och kvar i bild när man rullar). Panelerna: "Papper och kartram", "Kartor per ark",
      "Papperet: texter, bilder och klippning" och "Kontrollbeskrivning på kartan", var och en med högst en mening och "?".
      Klippning, Vitt på utskriften, Uppgifter för texterna, Mitt bibliotek och fälten i Kartor per ark är hopfällda och öppna
      från början bara när de har något. Förklaringarna som togs bort står i hjälpen (nya artiklar "Papper och kartram" och
      "Kartor per ark").
    - *Papper och kartram på arket* (ersätter "Inte gjort" nedan för ramen och papperet): papper, riktning, marginal och
      tryckytan (automatisk eller fast ram) för arket som är öppet, för banan, Alla kontroller eller kartbytets del
      (`SET_PRINT_AREA` med `part`), och kartbytets "Visa överlapp". "Flytta ramen på arket" visar ramens handtag: dra inne i
      ramen för att flytta den över kartan (tryckytan blir fast och behåller papperet) och handtaget nere till höger för att
      göra ramen mindre (`restrictToPageSize` av; ramen står mitt på papperet som i Purple Pen). Ändringarna går genom papperets
      Ångra. Editorns flik Utskrift har bara länken till utskriften, kartbytets delväljare (kartan visar delen) och skalan; en
      fast ram kan fortfarande dras på kartan där. .ppen som förut (`print-area`).

## Inte gjort (för senare)

- Vridning av texter och bilder. Ramen kan inte flyttas bort från papperets mitt (Purple Pens tryckyta har ingen plats för det).
- Editorn (model space) ritar banan överst och lägger inte kartans färger över banan som förhandsvisningen och PDF:en.

## Följder

- PDF-jobben räknar detaljgapen och hindren för numren på kartan; det tar några tiotal millisekunder per karta.
- En PDF som skrevs med BL-profilen ser annorlunda ut än förut: färre färger över banan och lila under svart och brunt med
  övertryck. Tidigare godkända beslut gäller som förut (CMYK).
- Mellanrummet vid ringen ändrar alla banors utseende lite (0,35 mm); det kan sättas till 0.
