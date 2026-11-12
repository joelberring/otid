# ADR-0175: Gafflingar som struktur och bild

Status: beslutad 2026-10-25 (PLAN.md steg 49, ägarens önskemål samma dag). Kompletterar ADR-0169 beslut 2 (gafflingar kan nu
byggas i appen, inte bara komma från IOF XML) och ADR-0171.

## Bakgrund

Gafflingar fanns bara som varianter med hel kontrollföljd från en banfil (ADR-0169 beslut 2). Det gick inte att skapa
en gafflad bana i appen, inte att se hur varianterna hänger ihop och inte att ändra mer än en variant i taget. Ägaren
vill se och redigera gafflingarna visuellt, se dem i resultatlistorna och kunna köra både utjämnade gafflingar och
fulgaffling ("alla sträckor var inte likvärdiga men nästan").

## Beslut

1. **Struktur med Purple Pens begrepp.** En gafflad bana är en grundföljd med gafflingspunkter i följd: enkel gaffling
   (Purple Pen "Fork": 2–4 alternativ mellan två kontroller) och fjäril/slinga (Purple Pen "Loop": 2–4 slingor från en
   central kontroll, tillbaka till den efter varje slinga, i alla ordningar). Ingen gaffling inuti en annan. Domänen
   (`packages/domain/src/course-forking.ts`) genererar varianterna; högst 100 varianter och 26 bokstäver.
2. **Koder i OCAD/Purple Pen-stil.** Bokstäverna delas ut i följd över gafflingspunkterna (A, B; C, D …). En enkel
   gaffling bidrar med det valda alternativets bokstav, en fjäril med slingornas bokstäver i springordning utom den sista.
   Det ger samma koder som banfilerna från OCAD/Purple Pen ("AC", "BD").
3. **Strukturen sparas med banversionen** (`course_version.forking`, migration 0023) och redigeras genom "Redigera bana":
   besked i klartext när resultat ändras och omräkning i samma transaktion. En löpare vars kontrollföljd finns kvar får
   den under den nya koden; en löpare vars kontrollföljd försvinner får en ny variant genom fördelningen (en avläst den
   som stämplingarna passar), med antalet i beskedet. En ändrad enskild variant tar bort strukturen (varianterna
   redigeras då var för sig). En struktur utan gafflingspunkter blir en vanlig bana.
4. **Banor från banfil utan struktur** får en struktur härledd ur varianterna (lika början blir kontroller; en
   återkommande föregående kontroll med samma slingor i alla varianter blir en fjäril; annars en enkel gaffling till
   första gemensamma kontroll). Varje variant är alltid en väg i den härledda strukturen, så bilden fungerar.
   "Gör om till struktur" erbjuds när strukturen klarar reglerna; beskedet säger hur många varianter som tillkommer.
5. **Gafflingssätt per bana** (`course.forking_mode`): Utjämnad (standard; varning när varianterna inte ger samma
   sträckor) eller Fulgaffling (sträckor i enkla gafflingars alternativ är bara en upplysning; fjärilar varnar fortfarande).
   Rättvisekontrollen stoppar aldrig att banan sparas eller används. Längd per variant (`course_variant.length_meters`,
   från banfilens Length) visas med skillnaden mot den kortaste.
6. **Bilden** är egen SVG utan bibliotek (`apps/web/src/lib/forking-diagram.ts` + `components/forking`), från start
   till mål: grenar för enkla gafflingar, kronblad för fjärilar, anmälda och avlästa per gren. Bara färgtoken, så den
   följer sidans tema. Publikt: "Visa gafflingar" i resultatlistan och på deltagarsidan för en gafflad klass, med
   löparens väg markerad och slingornas ordning. Inga interna id i bilden eller svaren.
7. **Sträcktidsanalys per sträcka** (ändrar ADR-0171 beslut 6): en gafflad klass jämförs som standard per kontrollpar
   mellan alla som sprungit det, oavsett variant; per variant är ett val. Vägvalslänkarna finns i vyn per variant.
8. **Kontrollernas lägen** ur IOF XML (`Control/Position`, WGS 84) sparas på kontrollen och startens och målets lägen
   på banan (migration 0023). En variant utan Length i filen får längden ur lägena (storcirkel genom start, kontroller
   och mål; annars `MapPosition` med kartans skala). På vägvalskartan (ADR-0171) ritas den valda löparens bana
   (variant) med sträckans ändpunkter markerade när kartan är georefererad och lägena finns.
9. **Generellt för stafetten.** Struktur, generering, härledning, graf, rättvisa och bild tar varianter och val, inte
   klasser eller löpare, så att stafetten (ADR-0174) kan använda dem.

## Tillägg 2026-11-12: koden följer löparen vid en rättad kontrollkod

Användartestet 2026-11-12: när en kontrollkod i ett alternativ rättades (E 64 → 65 i 31 40 [A:41 | B:42] 50 60
[C:61 62 | D:63 | E:64] 70 100) fick alla med AE och BE nya varianter genom fördelningen, trots att koderna fanns kvar och
kartorna var tryckta med dem. Beslut 3 ändras så (`forkingVariantCodeMap` i `packages/domain/src/course-forking.ts`):

1. Finns löparens kontrollföljd kvar exakt följer löparen den under den kod den nu har (bara bokstäverna flyttades, t.ex.
   ett alternativ lades till eller togs bort i mitten eller två alternativ bytte innehåll). Oförändrat.
2. Annars behåller löparen sin kod när koden finns kvar, ingen gammal kontrollföljd har flyttat till koden (punkt 1) och
   gafflingspunkterna är av samma slag i samma ordning (enkel gaffling och fjäril; annars betyder bokstaven något
   annat). Det är en rättad kontrollkod i ett alternativ eller i grundföljden. Avlästa räknas om mot kodens nya följd.
3. Annars försvinner koden och löparen får en ny variant som förut (avläst: den som stämplingarna passar, övriga genom
   fördelningen).

Beskedet säger vilka varianter som får ändrade kontroller (`changedCodes`) och räknar bara koder som verkligen försvinner.
Stafettsträckor följer som förut bara sin kontrollföljd (en sträcka vars följd försvinner blir utan variant). (Punkt 1 och
stafettmeningen ersätts av tillägget nedan.)

## Tillägg 2026-11-12 (b): bokstaven är alternativets identitet

Ägaren inför nattävlingen 9 december: "löparen måste såklart ha en gaffel på kartan som är samma som i programmet även om
gafflingar tas bort/inte används". Med punkt 1 ovan flyttade bokstäverna när ett alternativ i mitten togs bort (A, B, C →
B bort → C blev B), så en löpare med karta "C" stod som "B". Beslut 2 och 3 ändras så:

1. **Sparad bokstav per alternativ.** En enkel gaffling och en fjäril kan ha `letters` (en bokstav A–Z per alternativ eller
   slinga, unika på banan) och strukturen `retiredLetters` (bokstäver som använts men tagits bort). Det ryms i
   `course_version.forking` (jsonb); ingen migration. Saknas `letters` (alla strukturer sparade före tillägget) delas
   bokstäverna ut i följd precis som förut, så befintliga tävlingar får samma bokstäver och varianter. Ett sparande
   skriver alltid ut bokstäverna (`withAssignedForkingLetters`).
2. **Bokstäverna står kvar.** Tas ett alternativ bort behåller de andra sina bokstäver, med lucka (C, D, E → D bort → C, E;
   koderna AC, AE, BC, BE). Ett nytt alternativ får den första bokstaven som varken används eller har använts på banan
   (`retiredLetters`; först när alla 26 är förbrukade en tidigare använd). Editorn bär bokstaven med alternativet; en
   begäran utan bokstäver (äldre klient, API) paras med den gamla strukturen efter innehåll: samma kontroller ger samma
   bokstav, lika många oparade alternativ på båda sidor paras i ordning (rättade koder), annars blir de oparade nya
   alternativ.
3. **En hel gafflingspunkt tas bort:** de andra punkterna behåller sina bokstäver och den borttagnas bokstav faller bort ur
   koden ("AC" blir "C"). Regeln valdes för att varje bokstav i den tryckta koden fortfarande betyder samma alternativ; den
   borttagna punktens bokstav betyder inget längre. Löpare vars kontroller ändras (t.ex. B-löparna när gafflingen ersätts
   av 41) står i beskedet med "ny karta behövs".
4. **Löparens nya kod** (`forkingVariantCodeMap`) är löparens bokstäver i de punkter som finns kvar; punkterna paras efter
   gemensamma bokstäver och samma slag (enkel gaffling/fjäril). En fjäril där en slinga tas bort behåller ordningen på
   resten. Null (ny variant genom fördelningen, avläst: den som stämplingarna passar) bara när löparens bokstav i en
   kvarvarande punkt försvinner, när en ny gafflingspunkt eller slinga tillkommer, när punktens slag ändras eller när
   koden är bortvald (ADR-0198). En rättad kontrollkod ger samma kod med nya kontroller (tillägget ovan, punkt 2), också
   när alternativen byter innehåll i editorn: bokstaven följer fältet, inte kontrollerna.
5. **Banfil utan struktur:** den härledda strukturen läser bokstäverna ur varianternas koder (en lucka A, C blir A, C).
   Går koderna inte att läsa som en bokstav per alternativ gäller bokstäver i följd och löparna följer då bara sin
   kontrollföljd, som förut.
6. **Stafett:** samma regel för stafettsträckor. En sträcka vars bokstav försvinner blir utan variant (fördelas inte här,
   för lagens rättvisa) och väljs i lagvyn; den står med namn och sträcka i beskedet.
7. **Besked och historik:** förhandsvisningen (`entryChanges`) och kvittot (`variantChanges`) har varje löpare vars kod
   byts med namn, klass, sträcka, kod före och efter och om kontrollerna ändras. Historiken får en post per löpare
   (`ENTRY_COURSE_VARIANT_CHANGED_BY_COURSE_EDIT`, kod före och efter). Bara admin på tävlingen når redigeringen.

IOF XML-export och -import tar koderna som text, så en lucka ("AE" utan "AD") går igenom oförändrad. Banläggningen
följer samma regel från tillägg (c).

## Tillägg 2026-11-12 (c): bokstäverna står kvar också i banläggningen

Kartorna trycks ur banläggningen. Med Purple Pens ordning döptes grenarna om när en gren togs bort (E blev D), och
"Överför till tävlingen" förde över de nya koderna: en löpare med tryckt karta E fick fel följd i tidtagningen.

1. **Banläggningens dokument** (O-Tids eget, `packages/course-setting`) sparar bokstaven på grenen (`CourseControl.letter`
   på grenens första banans kontroll) och använda bokstäver på banan (`Course.retiredLetters`), i dokumentets jsonb; ingen
   migration. `variantLetters` använder sparade bokstäver och ger övriga grenar den första bokstaven som varken används
   eller har använts; utan sparade bokstäver blir det exakt Purple Pens ordning (A–Z, a–z). Alla som visar bokstäver går
   genom den: editorn, gafflingsbilden, påtrycket och PDF:en, kartbuntar, kontrollbeskrivningen, IOF XML och "Överför".
2. **När en banas grenar ändras** (andra grenar eller annan ordning; `keepForkLetters` efter varje ändring) skrivs
   bokstäverna ut: kvarvarande grenar behåller sin, en borttagen grens bokstav blir använd och nya grenar får nästa
   lediga. Ett dokument utan sparade bokstäver (alla befintliga på servern) behåller Purple Pens ordning tills någon ändrar
   en gaffling eller slinga; flyttade kontroller, nya kontroller i grundföljden, koder och utseende skriver inga bokstäver
   (test mot fixturernas .ppen). En gaffling som tas bort och görs om får nya bokstäver, och en ny gaffling före en
   befintlig får nästa lediga (den befintliga behåller sina), så ordningen kan skilja från Purple Pens.
3. **.ppen:** bokstäverna skrivs i O-Tids namnrymd (`<otid:letters>`, som bortvalen) och läses tillbaka. Purple Pen
   skriver inte tillbaka elementet; läses en sådan fil in över en banläggning med sparade bokstäver paras grenarna efter
   innehåll (gaffelkontrollens kod och grenens kontroller, `carryForkLetters`). En gren som inte går att para får en ny
   bokstav och en bokstav utan gren blir använd; inläsningens besked säger det per bana. Utan sparade bokstäver gäller
   filens ordning som förut. Vid nedladdning varnar O-Tid när bokstäverna i Purple Pen blir andra (en lucka).
4. **Överför till tävlingen** ger tävlingen banläggningens (nu stabila) koder. Får en tilldelad löpare eller stafettsträcka
   andra kontroller för sin kod, eller försvinner koden, står den med namn, klass, sträcka, kod och kontroller före och
   efter i beskedet (`variantChanges`) och överföringen kräver bekräftelse. Löparen behåller koden; en kod som försvunnit
   ges en ny variant (Fördela gafflingar, Byt variant, lagvyn). Samma besked för en IOF-banfil.
5. **Minnet över använda bokstäver:** i banläggningen ligger det på banan och finns kvar också när alla gafflingar tas
   bort. I tävlingen sparas strukturen inte för en vanlig bana; gafflas den igen räknas bokstäverna i banans senaste
   struktur som använda så länge banans klasser har anmälda (`usedLettersFromHistory`). En helt ombyggd struktur får
   alltid nya bokstäver (de gamla kan stå på kartor).

## Konsekvenser

- Kartlägen (`MapPosition`) sparas inte; de används bara för längden vid inläsningen. Banan ritas bara på vägvalskartan,
  inte på en egen karta i arbetsytan.
- En gaffling inuti en fjäril (eller tvärtom) kan inte byggas i appen; en sådan banfil visas med härledd struktur och
  redigeras per variant.
