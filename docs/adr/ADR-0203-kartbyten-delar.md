# ADR-0203: Kartbyten – banans delar, utskrift per del, dubbelsidigt och överlapp

Status: beslutad 2026-11-03 (grenen `kartbyte-delar`, ägarens önskemål samma dag). Ingen migration. Bygger på ADR-0197
(papperet), ADR-0180 beslut 11 (utskriften) och ADR-0184 (PDF:en). Följer Purple Pen (BSD, Peter Golde): QueryEvent
(CountCourseParts, GetCoursePartBounds, GetPrintArea, GetPartOptions), CourseView.CreateCourseView och dess tester.

## Bakgrund

O-Tid hade kartbyten som kontroller (MAP_EXCHANGE) och banans kontroller med `map-exchange`/`map-flip` i editorn och
beskrivningen, men delarnas tryckytor (`<print-area part="n">`) följde bara med orörda och utskriften hade inga delar. Ägaren
vill ha delarna som i Purple Pen, utskrift per del och dubbelsidigt, och ibland ett överlapp: banan bryts mitt i och en bit
av den andra sidan syns.

## Beslut

1. **Delarna** (`course-parts.ts`): en banas kontroll med `map-exchange="true"` eller en kartbyteskontroll avslutar en del och
   börjar nästa; kartbytet står sist i del n och först i del n+1 (GetCoursePartBounds). Delarna räknas 0, 1 … som Purple Pens
   `part` och visas som "Del 1, Del 2 …". Alla kontroller och en gafflad bana utan vald variant har en del (Purple Pen:
   "All Variations" har inga delar); med vald variant räknas delarna på varianten. O-Tid skriver `map-exchange="true"` på ett
   eget kartbyte i .ppen (Purple Pen kräver det).
2. **Banpåtrycket för en del** (`layout({ part })`): delens kontroller och sträckor; numren fortsätter från delarna före;
   kartbytet först i en del ritas som delens start (triangel, med ringen om det är en kontroll); ett eget kartbyte sist i en
   del ritas inte (CourseView: `hiddenControl`); målet också på en del som inte är den sista om `<part-options show-finish>`
   säger det. Specialobjekt med `<course course part>` står bara på den delen (och på hela banan).
3. **Överlappet** ("Visa överlapp" per bana: Ingen / Sista sträckan / Hela föregående del; förval Sista sträckan; i banans
   papper `paperLayouts[bana].overlap`): en del efter den första visar föregående dels sista sträcka med kontrollen före
   (eller hela föregående del) med rollen `OVERLAP`, tonat till 35 % (`fade`) och utan nummer. Bara föregående del, så att
   löparen ser varifrån den kommer; nästa del visas inte. Skärmen och förhandsvisningen ritar med genomskinlighet, PDF:en med
   banans dekorfärg och andelen 0,35 (ingen genomskinlighet i tryck).
4. **Beskrivningen för en del**: delens kontroller, namnet "Bana-2" (Purple Pens CourseNameAndPart) och numren som på kartan.
5. **Tryckytan per del**: `Course.partPrintAreas` ("0", "1" …) läses ur och skrivs till Purple Pens `<print-area part="n">`;
   oförändrade element skrivs orörda. `SET_PRINT_AREA` har `part`; null = som banans igen. `printAreaOf(…, part)` ger delens,
   annars banans (QueryEvent.GetPrintArea).
6. **Papperet per del**: `paperLayouts["<bana>#<del>"]` (`SET_PAPER_LAYOUT` med `part`). En del ärver banans papper fält för
   fält (beskrivningen fält för fält) tills den ändras. ADR-0197:s "Alla sidor" betyder här alla delar: på del 2 och senare
   står banans element bara om de har "Alla sidor"; delens egna element står alltid. Klippningen och markeringarna följer
   ADR-0197 punkt 11 per del: banan står alltid hel.
7. **Utskriften**: `expandPartItems` delar varje bana med kartbyten i en karta per del (förhandsvisningen och PDF-jobbet,
   `SheetItem.part`), med delens tryckyta, beskrivning och papper; titeln "Bana – del 2". "Dubbelsidigt: del 2 på baksidan
   av del 1 (kartbyte)" (`PrintSheetsLayout COURSE duplex`, PDF-jobbets `duplex`) lägger en banas ark fram–bak–fram …; har banan ett
   udda antal ark följer en tom baksida så att nästa bana börjar på en framsida. Baksidorna märks `back` och PDF:en föreslår
   vändning på långsidan. Dubbelsidigt är förvalt när en vald bana vänder kartan (`map-flip`) och kan stängas av.
8. **Editorn**: fliken Utskrift har "Kartbyten" för banor med fler än en del: "Del" (Hela banan / Del 1 / Del 2 …) som visar
   delen på kartan (med överlappet) och dess ram; papper, riktning, marginal och ramen ändrar då delens tryckyta; "Som banans
   igen" tar bort den. "Visa överlapp" sparas för banan.

   *Ändrat 2026-11-07 (städrundan, grenen `a3-tryck`):* PDF-jobbet fick förut varken delen eller "Dubbelsidigt" (klienten
   tappade `part` och skickade dubbelsidigt bara för löpare), så servern skrev hela banan en gång per del; nu följer båda med.
   Vändningskanten för delarna är alltid långsidan, också för liggande delar (`duplexEdge`); ADR-0213:s kortsida när alla
   baksidor är liggande gäller bara löparnas baksidor. Liggande ark med del 2 står alltså rätt när arket vänds kring sin
   övre kant.

9. **ADR-0211 (2026-11-04):** delarna får ett kort var i utskriftssidans översikt; papperet, dubbelsidigt och överlappet är
   oförändrade. Sträckorna slutar nu ett mellanrum utanför ringarna (ADR-0211 beslut 2), också vid kartbytet.

## Följder

- .ppen: delarnas tryckytor, kartbytena och `part-options` som i Purple Pen. Överlappet och delarnas papper är O-Tid:s
  (papperet följer med vid inläsning som i ADR-0197). Beskrivningen på kartan skrivs till .ppen för hela banan (Purple Pen visar
  ett `descriptions` utan `part` på varje del).
- Ingen ny tabell eller kolumn: allt står i dokumentet.
