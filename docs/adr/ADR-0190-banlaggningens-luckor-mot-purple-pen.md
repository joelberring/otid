# ADR-0190: Banläggningens kvarstående luckor mot Purple Pen

Status: beslutad 2026-11-02 (grenen `banlaggning-egenskaper`). Bygger på ADR-0180 (banläggning i webben) och ADR-0181
(samarbete och fältläge).

## Bakgrund

Efter steg 62–68 gick det fortfarande inte att ändra stigning, fast längd, poäng per kontroll, poängbana och banornas
ordning i editorn (modellen och .ppen hade dem redan). Ångra försvann vid omladdning, och banorna kunde bara lämna O-Tid
som .ppen eller genom "Överför till tävlingen".

## Beslut

1. **Banans egenskaper.** `UPDATE_COURSE` tar `kind` (vanlig eller poängbana) och `null` för att ta bort stigning, fast
   längd, undertitel och utskriftsskala. En poängbana kan inte ha gafflingar (som Purple Pen); etiketten "Nummer" blir
   "Kod" när banan blir poängbana och etiketter med poäng tappar poängen när den blir vanlig. Ny åtgärd `SET_POINTS`
   (poängen för en vanlig kontroll på en poängbana, 0–9999, 0/null = inga; touch `courseControl:<id>:points`).
   Ordningen är `UPDATE_COURSE.order` = plats i listan (1 = först), de andra numreras om 1, 2, 3 …; flytta upp och ned
   för vald bana, dra i listan på datorn.
2. **Ångra en flytt rör bara ordningen.** `PUT_OBJECTS` får `courseOrder` (bana → plats). `objectPatch` lägger en bana som
   bara bytt plats där i stället för hela banan, och en bana som finns behåller sin plats när hela banan sätts. Därmed
   flyttar ångra av ett namnbyte inte tillbaka en bana som någon annan flyttat, och ångra av en flytt tar inte bort
   någon annans namnbyte. Touches för `courseOrder` är `course:<id>:order`.
3. **Utskrift och tävlingen.** Beskrivningens huvud och `$(CourseLength)`/`$(CourseClimb)` hade redan fast längd och
   stigning; utskriftens rubrik visar nu "4,3 km, 85 m" (poängbana: bara stigningen). Banfilsjämförelsen ger en egen rad
   när bara längden eller stigningen ändrats (`SET_COURSE_MEASURES`, fält `LENGTH`/`CLIMB`, räknar inte om resultat), och
   längd och stigning sparas för en befintlig bana bara när dess rad är vald. Ny ordning i dokumentet ger inga rader
   (banorna matchas på id och namn); ordningen avgör bara vilken bana en klass som står på två banor får, som i Purple Pen.
   En borttagen stigning tas inte bort i tävlingen (en banfil utan `Climb` ska inte nollställa).
4. **Ångra efter omladdning.** Editorns ångra-historik (stegen med `PUT_OBJECTS` som sätter tillbaka objekten) sparas i
   telefonen i IndexedDB-databasen för offline-posten (`otid-course-setting`, ny tabell `history`, version 3), per tävling,
   med kontot och dokumentet som stegen gäller för; högst 200 steg bakåt och 200 framåt. När editorn öppnas läggs stegen
   tillbaka bara för samma konto och bara de steg vars objekt ingen annan har ändrat sedan dess (`documentChanges` mellan
   det sparade dokumentet och det editorn öppnas med, samma regel som för andras ändringar medan sidan är öppen); egna
   sparade ändringar krockar inte. Gör om finns kvar bara om inget ändrats sedan sidan öppnades. Ångra skickas som vanligt
   som en åtgärd och prövas mot servern. Historiken tas bort vid utloggning, när tillgången försvinner (403), med
   tävlingens kopia och när dokumentet byts (inläst .ppen, återställd version). Förslagsläget sparar ingen historik.
5. **Export av banor.** "Ladda ned IOF XML (banor)" under Fil skriver IOF XML 3.0 CourseData som Purple Pens
   ExportXmlVersion3 (`writeIofCourseData` i paketet): en gafflad bana blir en `Course` per variant ("Lång AC" med
   `CourseFamily` "Lång"), som MeOS och OLA läser; klasserna ur undertiteln; kartfilens yta och, med georefererad kartfil,
   `Position` i WGS 84. Purple Pens förväntade filer (marymoor, mapexchange1, relay) blir likadana rad för rad utom tid och
   program; stafettlagens varianter (`TeamCourseAssignment`, Purple Pens RelayVariations med .NET:s slumptal) skrivs inte.
   IOF:s XSD finns inte i repot, så testet jämför mot Purple Pens filer; alla 151 testfilers export validerades mot
   `IOF.xsd` (datastandard 3.0) med xmllint utanför repot 2026-11-02. Inget eget OCAD-format: OCAD läser banor i IOF XML
   3.0, vilket står i hjälpen (inte provat med en riktig OCAD).
   Ändrat 2026-11-07: en kontroll på en poängbana utan satta poäng skrivs med förvalet ur koden (`scorePoints`, koden
   delat med tio) som `Score`, som O-Tid visar och räknar; Purple Pen skriver då ingen `Score` (skillnaden mot marymoor).
6. **Längd längs vägval.** Under banans egenskaper räknar "Räkna längs vägval" varje sträcka med vägvalens Worker (samma
   indata som en vald sträcka, steg 60) och visar summan av bästa vägvalen bredvid fågelvägen ("Längs bästa vägval 5,2 km,
   fågelvägen 4,3 km (21 % längre)"). Bara en uppgift i editorn: banans längd, beskrivningen och tävlingen använder
   fågelvägen som förut. En gafflad bana räknas för vald variant (annars den första), poängbanor inte alls. Sträckorna
   sparas per indata så att bara flyttade sträckor räknas om; väljs en sträcka under tiden avbryts räkningen och
   "Räkna klart" tar resten.
7. **Mål är mål** (ägarens beslut 2026-11-02). En stämpling efter målstämplingen ger aldrig poäng, inte heller i rogaining
   och på poängbanor: `scoreRogaining` hoppar över stämplingar med tid efter målet (en stämpling exakt vid målet räknas,
   en utan läsbar tid räknas eftersom den inte kan visas vara efter). De står i resultatets `ignoredAfterFinish`
   (valfritt fält; äldre resultat saknar det) och på avläsningskvittot som "Efter målet, inga poäng: …", aldrig som extra
   stämplingar. Resultatmotorn blir 0.7.0. En rättad måltid räknar bara om straffet som förut (poängen bygger på den
   avlästa målstämplingen); en ny avläsning bedöms med regeln.

## Konsekvenser

Banläggaren kan göra det i O-Tid som tidigare krävde Purple Pen (stigning, fast längd, poängbanor, ordning) och skicka
banorna till MeOS, OLA och OCAD utan .ppen. Stafettlagens varianter följer fortfarande bara med i .ppen.
