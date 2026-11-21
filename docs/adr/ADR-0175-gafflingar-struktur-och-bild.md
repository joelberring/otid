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

## Tillägg 2026-11-17 (ägaren: «hanteringen av gafflingar vid banläggning behöver ses över»)

1. **Ändra en gaffling i banläggningen** (`fork-edit.ts`): `ADD_BRANCH` ger en tom gren till (eller ett varv till i en
   slinga), en gren tas bort med knappen i grenträdet (`REMOVE_COURSE_CONTROL` på grenens gaffelkontroll; med två grenar blir
   den andra kvar utan gaffling) och `MOVE_SPLIT` flyttar början eller ihopgången en kontroll framåt eller bakåt. Senare början
   kräver att alla grenar börjar med samma kontroll, tidigare ihopgång att alla slutar med samma. Grenarnas banans kontroller
   behåller sina id, så bokstäverna står kvar. Gaffling-verktyget gafflar också en vald sträcka, och «Lägg in» på en vald
   sträcka lägger in i den gren där sträckan finns.
2. **Kombinationerna i tävlingen**: vid «Överför till tävlingen» (och en ny banfil) får en individuell löpare vars kod inte
   längre finns, som inte läst ut och inte har något resultat, den minst använda av klassens varianter
   (`reassignVanishedVariants`). Giltiga koder behålls (de står på kartan), stafetten fördelas som förut och beskedet säger
   vilka som får en ny variant. Ägaren svarade inte på frågan om hur; antagandet «behåll giltiga, fördela resten» kan ändras.

## Tillägg 2026-11-21: utkast och lås för nycklarna (ägaren inför Stockholm by Night)

Översyn: projektets dokument `claude/gafflingar-oversyn-2026-11-21.md`. Tillägg (b) och (c) låste bokstäverna från första
klicket, så en gaffling som gjordes om fick nya bokstäver (G, H) och en omnumrering i banläggningen slog inte igenom rätt i
tävlingen (koden «försvann» och löparen fick en annan variant). Ägarens beslut:

1. **Utkast och lås per bana i banläggningen.** I utkast har grenarna bokstäver i banans ordning (som Purple Pen), utan
   luckor och utan använda bokstäver; tas en gren bort ur en gaffling med fler än två grenar försvinner sista bokstaven, med två
   grenar försvinner gafflingen. Låst gäller tillägg (c). Banan låses av tryck med variantkod, av tilldelade varianter i
   tävlingen och av en publicerad startlista, eller för hand; låset kan hävas för hand med en lista över vad som berörs.
2. **«Ordna nycklarna»** ger grenarna bokstäver i banans ordning, med förhandsvisning gammal → ny kod. Tillåtet också i en
   låst bana, efter bekräftelse med tryckta kartor, löpare med tilldelad variant och bortval som berörs. Bortvalen flyttas med.
3. **Översättningen följer med vid Överför**: en löpare vars kod bytts (AG → AC) får den nya koden och behåller sina
   kontroller; bara de vars kontroller ändras står i beskedet.
4. **Ta bort gafflingen** behåller gren A.

## Tillägg 2026-11-21 (b): hur utkast, lås och översättning är byggda

Allt som påverkar bokstäverna står i banläggningens dokument (jsonb i `course_setting.document`, ingen migration), så att
samma ändring ger samma bokstäver i webbläsaren och på servern (autospar, samarbete, förslag och versioner spelar upp samma
`applyEdit`). Koden: `packages/course-setting/src/fork-lock.ts`, `fork-codes.ts`, `fork-letters.ts` och
`packages/application/src/course-setting-fork-letters.ts`.

1. **Fält på banan** (`Course`):
   - `forkLetterLock?: { reason: "MANUAL" | "PRINT" | "ASSIGNED" | "START_LIST"; at: string }` – låst. Saknas = utkast.
   - `forkLetterUnlockedAt?: string` – låset hävdes för hand (då låser tävlingens *läge* inte igen, bara en ny händelse).
   - `transferredLetters?: Record<grenId, bokstav>` – grenarnas bokstäver vid senaste godkända «Överför till tävlingen». En gren
     är banans kontroll som börjar grenen; dess id är stabilt genom ändringarna (inte genom en .ppen sparad i Purple Pen som
     byter id).
   - Alla tre skrivs i .ppen i `<otid:letters>` (`lock`, `unlockedAt`, `transferred`) och följer med när en fil utan elementet
     läses in över banläggningen (`carryForkLetters`).
2. **Utkast** (`keepForkLetters`): ändras en banas grenar tas sparade bokstäver (`CourseControl.letter`) och `retiredLetters`
   bort, så att grenarna får Purple Pens bokstäver i banans ordning (A, B, C → B bort → A, B; en gaffling som görs om får C, D
   igen). Bortvalen (ADR-0198) flyttas till de nya koderna när den översatta koden har samma kontroller. En bana utan lås som
   har sparade bokstäver (med lucka, alla befintliga dokument) behåller dem tills nästa gafflingsändring eller «Ordna
   nycklarna»: flyttade kontroller, koder och utseende rör dem inte. **Låst**: tillägg (c) som förut.
3. **Ändringssteg**: `RENUMBER_FORK_LETTERS { course }` («Ordna nycklarna»: Purple Pens bokstäver skrivs ut på grenarna,
   bortvalen flyttas, `retiredLetters` töms, låset står kvar) och `SET_FORK_LETTER_LOCK { course, locked, reason?: MANUAL |
   PRINT, at }` (för hand, eller av en utskrift i webbläsaren med variantkod). Tiden står i ändringen, inte i `applyEdit`.
4. **Servern låser** (`lockForkLettersFromRace`, ny version som ett sparande, ändringen i konfliktloggen med `diffTouches`):
   banläggningens bana paras med tävlingens på namnet. PRINT = ett tryckjobb med en variant av banan eller en utskriven
   kartbuntslista för en bana med tilldelade varianter; START_LIST = publicerad startlista och banan har klasser; ASSIGNED =
   en löpare eller stafettsträcka i banans klasser har en variant. Anropas när ett tryckjobb skapas, kartbuntslistan skrivs ut,
   «Fördela gafflingar» eller «Byt variant» görs och startlistan publiceras, efter varje godkänd överföring och när editorn
   läser dokumentet (`readCourseSettingAsAdmin`). Varianter som ges vid anmälan eller import låser alltså senast när editorn
   öppnas eller vid nästa överföring. Efter ett lås som hävts för hand låser bara en händelse efter `forkLetterUnlockedAt`
   (tryck eller publicering senare, en ny fördelning); tilldelade varianter i sig låser inte igen.
5. **Översättningen vid Överför**: projektionen får `forkLetters` per gafflad bana (`letters` nu och `renames`: bokstaven i
   `transferredLetters` → grenens bokstav nu, `null` när grenen inte finns). Jämförelsen (`course-file-diff`) gör om dem till
   tävlingens koder (`CHANGE_COURSE.codeRenames`, bokstav för bokstav: AG → AC; en kod med en bokstav vars gren försvunnit blir
   `null`). Beskedet (`courseFileVariantChanges`) jämför löparens gamla kontroller med den nya kodens; samma kontroller = inte i
   beskedet, annars med `codeAfter`. Vid godkännandet (`renameTransferredVariants`, före fördelningen) får löpare – också de
   som läst ut, grenen är densamma – och stafettsträckornas fasta variant den nya koden; en `null`-kod får en ny variant av
   `reassignVanishedVariants` (inte avlästa), också när den gamla koden råkar finnas bland de nya. Sedan sparas `letters` som
   `transferredLetters` för banorna som fördes över (vald rad, ny bana eller ingen omnumrering).
6. **UI**: raden «Nycklarna» i panelen Varianter visar läget («Utkast: nycklarna ordnas medan du arbetar» eller «Låst: … och
   varför»), «Lås nycklarna»/«Häv låset» och «Ordna nycklarna» med förhandsvisning gammal → ny kod. I en låst bana (och för
   att häva låset) visas först det som berörs ur `GET …/course-setting/fork-letters` (EDIT): kartor med variant i tryckjobben,
   publicerad startlista, löpare med tilldelad variant (namn, klass, kod) och bortval som får ny kod. Kartor som skrivits ut i
   webbläsaren går inte att räkna (de låser banan med `SET_FORK_LETTER_LOCK` reason PRINT).
7. **Kvar**: tävlingens egen baneditor (C4 i översynen) har inte utkast och lås; en återanvänd grens id (borttagen sist och
   en ny gren med samma id) översätts som samma gren, och om kontrollerna skiljer står löparen i beskedet.
