# ADR-0180: Banläggning i webben

Status: beslutad 2026-10-31 (PLAN.md steg 62–65, ägarens önskemål samma dag). Bygger på ADR-0179 (kartfilen,
vägvalsanalysen), ADR-0175 (gafflingar) och ADR-0176 (banhemlighet).

**Bakgrund.** Ägaren vill ha hela flödet från banläggning till tävling i O-Tid, och helst bättre än Purple Pen. Det
Purple Pen gör sämst är trycket: färger och övertryck håller inte OCAD-kvalitet, så tryckeriet har velat göra om banor.
Det O-Tid kan göra bättre är det samlade flödet: gafflingsnycklar rakt till startlista, baksidor och avläsning,
vägvalsanalys medan banan läggs, kontroller under arbetet och granskning i webbläsaren. Ordningen bestämdes av ägaren:
.ppen-import och editor (62), kontrollbeskrivningar (63), banpåtryck och utskriftslayout (64), PDF med dekorfärger (65).

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

**Konsekvenser.** Purple Pen och macpurplepen kan användas parallellt: .ppen in och ut. Stockholm by Night (9 december)
läggs i Purple Pen som vanligt; .ppen-importen gör att banor och gafflingar går rakt in. Editorn blir inte lika snabb att
arbeta i som Purple Pen från början, och poängorientering, OCAD-export och utskrift utan nät kommer sist eller inte alls.

## Risker och öppna frågor

- **Variantkoderna:** måste stämma med Purple Pens IOF-export för befintliga tävlingar. Provas mot Purple Pens
  testfiler och ägarens SBN26_1.ppen.
- **Tryck:** dekorfärger och övertryck kan bara verifieras med provtryck hos tryckeriet (steg 65).
- **Editorns arbetsflöde:** behöver provas av ägaren på en riktig bana innan steg 63–64 byggs ut.
