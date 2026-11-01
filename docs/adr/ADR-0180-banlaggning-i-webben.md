# ADR-0180: Banläggning i webben

Status: beslutad 2026-10-31 (PLAN.md steg 62–65, ägarens önskemål samma dag). Bygger på ADR-0179 (kartfilen,
vägvalsanalysen), ADR-0175 (gafflingar) och ADR-0176 (banhemlighet).

**Bakgrund.** Ägaren vill ha hela flödet från banläggning till tävling i O-Tid, och helst bättre än Purple Pen. Det
Purple Pen gör sämst är trycket: färger och övertryck håller inte OCAD-kvalitet, så tryckeriet har velat göra om banor.
Det O-Tid kan göra bättre är det samlade flödet: gafflingsnycklar rakt till startlista, baksidor och avläsning,
vägvalsanalys medan banan läggs, kontroller under arbetet och granskning i webbläsaren. Ordningen bestämdes av ägaren:
.ppen-import och editor (62), kontrollbeskrivningar (63), banpåtryck och utskriftslayout (64), PDF med dekorfärger (65).
Samarbete och fältläge i mobilen (66–67, ADR-0181) lades till 2026-11-01 och görs före 64–65.

**Beslut.**
1. Banläggningen är ett eget dokument per tävling (`course_setting`, jsonb, migration 0031) med versionsnummer och
   historik. Tävlingens banor ändras bara när banläggaren för över dokumentet ("Överför till tävlingen"). Överföringen
   går genom samma jämförelse som en importerad banfil (`course-file-diff`), så ändringarna visas före och klasser,
   varianter och avlästa löpare hanteras som i dag.
2. Dokumentets modell följer Purple Pens händelsefil (.ppen) nära: kontroller, banornas kontroller som länkad lista med
   gafflingar och slingor, sträckor med brytpunkter och avbrott, specialobjekt. Det som O-Tid inte tolkar ännu sparas
   orört och skrivs tillbaka, så att en .ppen kan gå fram och tillbaka mellan O-Tid och Purple Pen/macpurplepen.
3. Koordinater är kartfilens mm med y uppåt (samma som Purple Pen, IOF `MapPosition` och `@o-tid/map-file`).
4. Logiken ligger i ett rent paket `packages/course-setting` (läsa/skriva .ppen, ändringar, varianter, kontroller,
   banpåtrycket som figurer). Webbläsaren gör allt arbete; servern lagrar och för över (ADR-0177).
5. Banpåtrycket räknas fram som enkla figurer i kartans mm (ring, linje, yta, text med färgen "banans"). Samma figurer
   ritas på skärmen och skrivs senare till PDF med dekorfärg och övertryck (steg 65), så skärm och tryck inte glider isär.
6. Variantkoderna räknas som Purple Pen gör, så att en .ppen ger samma varianter i O-Tid som i Purple Pens IOF-export.
7. Purple Pen är BSD-licensierad. Format, regler och data ur `PurplePenCore` (t.ex. symbolerna i `symbols.xml`) får
   användas med upphovsnotisen i `packages/course-setting/NOTICE.md`. Inget tas ur Purple Pens tredjepartsbibliotek
   (PdfSharp, SharpZipLib m.fl.) och namnet Purple Pen används inte för att marknadsföra O-Tid.
8. Banhemligheten gäller dokumentet: bara admin, aldrig publikt, och inte med i publika exporter.
9. Kontrollerna under arbetet: för nära kontroller (IOF:s riktvärden 30/60 m, sprint 15/30 m, inställbart), samma kod
   två gånger, omvändbara koder, samma kontroll två gånger i rad, sträcka genom en annan kontrolls ring, bana utan start
   eller mål, oanvända kontroller. Vägvalsanalysen (steg 60) visas för vald sträcka medan man flyttar kontroller.
10. Automatiska ringklipp (ägarens önskemål 2026-11-01) är valbara i dokumentets `event.circleCutting` (bara O-Tid, skrivs
    inte till .ppen; saknas = som Purple Pen). **Överlapp:** där ringar på samma kartbild går in i varandra tas bågen inne
    i den andra bort för båda (också målets dubbelring; passager och starttrianglar klipper ringen men klipps inte), vid
    kraftig överlappning (under 0,35 av radiesumman, Purple Pens gräns) behålls en hel ring, ingen ring tappar mer än
    hälften. **Detaljer:** ringen klipps över viktiga linje- och punktobjekt enligt en ändringsbar symboltabell (ISOM
    2017-2 och ISSprOM 2019-2, numren kontrollerade mot omapwiki), gapet täcker objektets bredd plus 0,15 mm, högst en
    fjärdedel av ringen (viktigast och mest vinkelrätt först), inte där en sträcka går ut. Detaljgapen räknas i kartans
    Worker och kan göras fasta som vanliga ringavbrott (`SET_CIRCLE_GAPS`) så att de följer med till Purple Pen; ingen ny
    ändringstyp, så samarbetets uppspelning (ADR-0181) behöver inget nytt. Överlappsklippen beror på banan och görs aldrig fasta.
    Gapen räknas per ringstorlek (`detailGapKey`: kontroll och radie), eftersom vinklarna beror på radien: en kontroll i
    flera utskriftsskalor (utan skalning relativt kartan) och målets två ringar får var sina; fasta klipp sparas per skala.
11. **Specialobjekt och utskriftslayout (steg 64).** Purple Pens specialobjekt tolkas i fält bredvid `raw` (`orientation`,
    `stretch`, `text`, `font`, `color`, `line`, `columns`, `imageFormat`; bildens data stannar i `raw`); oförändrade fält ger
    `raw` orört, ändrade skrivs som Purple Pen. Tryckytan är `Course.printArea` och `event.printArea`/`allControlsPrintScale`
    bredvid de råa `<print-area>`/`<all-controls>`. `layoutOverprint` ger specialobjekten tillsammans med banan, i Purple Pens
    målningsordning efter färgroll (WHITE, bild, CUSTOM, BLACK, COURSE_LOWER, COURSE). `layoutCoursePage` är en ren funktion
    som ger sidor: papper i mm (y nedåt), `mapArea` (kartans mm), `clip` och `transform` (x' = s·x + tx, y' = −s·y + ty,
    s = kartans skala / utskriftsskalan), figurerna i kartans mm och texter på sidan. Webbläsarens förhandsvisning ritar
    kartan med `drawMap` i `clip` och figurerna som SVG; steg 65 ska skriva samma sidor som PDF (kartan som vektorer, varje
    färgroll som egen dekorfärg med övertryck) utan att räkna något på nytt. Beskrivningen på kartan är en egen figur med
    `layoutDescription` i kartans mm (som Purple Pen skalas den med kartan, rutans sida = avståndet mellan punkterna).
    Avvikelser från Purple Pen: förbjudet område ritas utan kantlinje (som Purple Pen), text mäts med uppskattade
    teckenbredder, flera sidor räknas uppifrån, en sida per bana-del (`part`) finns inte än.
    Specialobjekten är också spärrar för vägvalsanalysen (ADR-0179): `routeBarriers` ger ytor och linjer som inte går att
    passera och passager som öppningar, som motorn tar emot per sträcka (`LegInput.barriers`) och rastrerar som kartans
    ej passerbara symboler respektive genomgångar; kontrollerna varnar när en sträckas linje går genom en spärr.
    Utskriftsprofilen (kartans färger och banans dekorfärg), layoutmallarna och en karta per löpare beskrivs i ADR-0183.

**Konsekvenser.** Purple Pen och macpurplepen kan användas parallellt: .ppen in och ut. Stockholm by Night (9 december)
läggs i Purple Pen som vanligt; .ppen-importen gör att banor och gafflingar går rakt in. Editorn blir inte lika snabb att
arbeta i som Purple Pen från början, och poängorientering, OCAD-export och utskrift utan nät kommer sist eller inte alls.

## Risker och öppna frågor

- **Variantkoderna:** måste stämma med Purple Pens IOF-export för befintliga tävlingar. Provas mot Purple Pens
  testfiler och ägarens SBN26_1.ppen.
- **Tryck:** dekorfärger och övertryck kan bara verifieras med provtryck hos tryckeriet (steg 65).
- **Editorns arbetsflöde:** behöver provas av ägaren på en riktig bana innan steg 63–64 byggs ut.
