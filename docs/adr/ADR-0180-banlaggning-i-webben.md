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
12. **Utseende och etikett (ägarens önskemål 2026-11-02).** Banans utseende för hela banläggningen ändras med en ny åtgärd
    `SET_APPEARANCE` (ringstorlek, linjebredd och nummerstorlek som kvoter, skalning Ingen/Relativt kartan/Relativt 1:15 000,
    automatiskt avbrott vid sträckor i mm, om ringavbrotten följer skalningen). Inga nya fält i modellen: värdena står kvar i
    händelsens råa `<course-appearance>` och läses med `appearanceOf`. Ändras inget är `raw` orört; annars skrivs elementet som
    Purple Pen (kvoterna bara när de inte är 1, `scale-sizes` och `auto-leg-gap-size` alltid, 32-bitarstal, okända attribut
    kvar). `scale-sizes-circle-gaps` skrivs bara när banläggaren ändrar det, eftersom O-Tid inte flyttar äldre filers
    ringavbrott som Purple Pen gör när det sätts. Konfliktnycklar per fält (`event:appearance:<fält>`). Som Purple Pen följer
    numrens avstånd till ringen ringstorleken och koderna nummerstorleken. Webben visar vad kvoten ger i mm på papperet för
    varje utskriftsskala och varnar när måtten avviker mer än 2 % från ISOM 2017-2 (förstoras med 15 000/skalan, 2.9.1 och
    3.7) eller ISSprOM 2019-2. Snabbvalen är bara standardernas mått eller mått med angivet ursprung: standard, förstorat i
    1:10 000 (ISOM 2.9.1, ungdom och äldre), ISSprOM:s ring 6,0 mm och 3,0 mm nummer (Purple Pens kodstorlek); de två
    sista ger varning. Etiketten vid kontrollen är banans `labelKind` via `UPDATE_COURSE` (också för alla stafettbanor eller
    alla banor i ett steg); texterna följer Purple Pen ("3-31", "3/7-31", "31(30)", "3(30)") och poängbanans nummer kommer
    ur beskrivningens ordning (nummer flyttar poängen ur kolumn A, som Purple Pens dialog). `placeLabel` räknar texten
    något för bred, ger parenteser mer höjd och lägger flyttade nummer först.
13. **Förslag på kontrollbeskrivning ur kartfilen** (ägarens önskemål 2026-11-02, "andra banläggningsprogram har
    autoförslag"). `suggestAt`/`suggestForDocument` i paketet är rena funktioner över `ParsedMap`: en tabell ISOM 2017-2 /
    ISSprOM 2019-2 → IOF 2018 kolumn D (`suggest-symbols.ts`; numren kontrollerade mot ISOM-dokumentet och omapwiki, vilken
    detalj en kartsymbol är står inte i någon standard och är vår tolkning, med alternativ där symbolen kan betyda flera).
    OCAD:s nummer matchas på hela numret och sedan huvudnumret; kartor med egna nummer på symbolens namn (lägre säkerhet).
    Objekten i och nära ringen rangordnas: punktobjekt i centrum, korsningar och förgreningar (F 10.1/10.2, andra linjen i
    E), linjers ändar och hörn, branter (fot på taggarnas sida, annars uppe på; utan taggar antas foten), ytors kanter och
    hörn (inner/yttre), små slutna höjdkurvor (höjd; grop med lutningsstreck), mellan två punktobjekt. G får väderstreck
    från kartans norr: nordlinjerna (601) om de finns, annars papperets upp (OCAD och Mapper ritar georefererade kartor med
    magnetisk norr upp; grivationen beskriver rutnätets norr och används därför inte). C när flera likadana punktobjekt
    ligger i ringen, E bara när symbolen säger det (raserad, djup) eller omgivningen (sank, stenig). Mått i F föreslås aldrig.
    Varje förslag har säkerhet, förklaring och objekten (markeras på kartan). Webben räknar i kartans Worker; förslagen
    förhandsvisas ljusare för kontroller utan D och skrivs in först när någon godtar, som en vanlig `SET_DESCRIPTION`
    (samarbetet och ångra som förut). Inget sparas om förslagen.
14. **Editorn mer som Purple Pen (ägarens synpunkter 2026-11-02).** *Objekt:* knappen Objekt i verktygsraden (också i
    telefonens "Mer") öppnar en palett i fyra grupper (Passager och kartbyte, Spärrar, Service, Text och grafik); varje slag
    har en ikon som räknas med `layoutOverprint` och ritas med kartans `drawOverprint`, ett namn och en förklarande rad.
    Obligatorisk passage (kontrollslaget i banan, "Obl. passage" i verktygsraden) och valfri passage (specialobjekt på alla
    eller valda banor) förklaras i paletten och verktygets tooltip; kartbyte (MAP_EXCHANGE) läggs också från paletten. Bild
    väljs från datorn (högst 1 MB) och läggs med ett klick, 25 mm bred på papperet. *Vridning:* som Purple Pens CanRotate går
    bara obligatorisk och valfri passage att vrida (inte kartbyte, text eller bild: Purple Pen kan inte lagra vinkeln för
    dem). Handtaget pekar i vinkelns riktning (RotateMode), fäster i 5°-steg, Skift eller ett andra finger ger fri vinkel;
    sifferfältet och "Vrid efter sträckan" finns kvar. Ny ändring `SET_CONTROL_ORIENTATION` (bara passager, 0–360°, skrivs som
    `orientation` i .ppen). **Avvikelse:** Purple Pen ger en ny passage vinkeln 0; O-Tid ställer en ny obligatorisk passage i
    en bana rätt mot sträckan genom den (medelriktningen in och ut, löparen går mellan bågarna), i samma ångra-steg. *Kopia:*
    `DUPLICATE_COURSE` (ChangeEvent.DuplicateCourse) ger "<namn> (kopia)" direkt efter originalet med egna banans kontroller i
    samma ordning, gafflingar, nummerlägen, tryckyta, skala, etikett och råa inställningar; banans specialobjekt syns också på
    kopian (`<course part>` blir hela banan). Båda ändringarna har samarbetsstöd (touches, referenser, id-översättning; nya id
    skapas i genomgångsordning så att uppspelningen ger samma ordning). *Befintliga kontroller:* när man lägger till i en bana
    syns kontrollerna utanför banan svagt med kod (som Purple Pens SetTemporaryControlView); ett klick inom ringen plus 10 px
    (finger 22 px) lägger in den befintliga av samma slag, markerad före klicket ("Lägg in 45"); Alt eller "Alltid ny" ger en
    ny. "Lägg in befintlig" finns kvar för alla slag. "Visa andra banor svagt" i kartans Visa-meny. *Gafflingar:* kontrollistan
    i fliken Banor visar banan som Purple Pens topologi (grenarna bredvid varandra med bokstav, var de går ihop); ett klick på
    en gren arbetar i den (nya kontroller efter grenens sista); "Gaffla här" frågar 2/3/4 grenar, slinga eller 2 slingor och
    ställer editorn i gren A, "Nästa gren" byter. Grenen man arbetar i visas som den första varianten genom den (kraftig, de
    andra svaga) och bokstäverna står på kartan. Varianterna listas med kod, antal kontroller, längd och en liten bild.
    *Ta bort bana:* som Purple Pens DeleteCurrentCourse frågar editorn om kontrollerna som bara banan använde ska tas bort; banan
    och kontrollerna är ett ångra-steg (`DELETE_COURSE` + `DELETE_CONTROL` i samma steg, ingen ny ändringstyp). *Oanvända:* i
    Alla kontroller ritas kontroller utan bana grå och streckade med ett kryss (valbart), kontrollistan har "Bara oanvända",
    antalet och "Ta bort alla oanvända" med bekräftelse som listar koderna (Purple Pens RemoveUnusedControls).

**Konsekvenser.** Purple Pen och macpurplepen kan användas parallellt: .ppen in och ut. Stockholm by Night (9 december)
läggs i Purple Pen som vanligt; .ppen-importen gör att banor och gafflingar går rakt in. Editorn blir inte lika snabb att
arbeta i som Purple Pen från början, och poängorientering, OCAD-export och utskrift utan nät kommer sist eller inte alls.

## Risker och öppna frågor

- **Variantkoderna:** måste stämma med Purple Pens IOF-export för befintliga tävlingar. Provas mot Purple Pens
  testfiler och ägarens SBN26_1.ppen.
- **Tryck:** dekorfärger och övertryck kan bara verifieras med provtryck hos tryckeriet (steg 65).
- **Editorns arbetsflöde:** behöver provas av ägaren på en riktig bana innan steg 63–64 byggs ut.
