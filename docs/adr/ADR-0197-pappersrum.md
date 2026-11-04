# ADR-0197: Papperet ("paper space") – texter, bilder, skalstock, nordpil, klippning och mallar

Status: beslutad 2026-11-03 (grenen `pappersrum`, migration 0063, ägarens önskemål samma dag). Bygger på hittbarhet
(kontrollbeskrivningen på papperet, `paper-layout.ts`), ADR-0183 (layoutmallar och arket `Sheet`), ADR-0184 (PDF för tryck),
ADR-0192 (träningens kartpass) och ADR-0180 beslut 11 (utskriften).

## Bakgrund

Ägaren: "kontrollbeskrivningar istället ska läggas till i utskriftsläget och att detta ska utvecklas till ett riktigt
'paperspace' där man skapar färdiga utskriftslayouter med texter, kartdef, loggor, samt klippningar av kartan. På så sätt kan
'model space' hållas rent som en arbetsyta." Och: "bygg allt på det sättet som är enklast, jag kan vänta".
Kartan med banan i editorn är model space (kartans mm). Förhandsvisningen är paper space (papperets mm, det färdiga arket).
Steg 1 (hittbarhet) flyttade kontrollbeskrivningen dit; det här är steg 2.

## Beslut

1. **Papperet är data per bana i dokumentet**, i samma fält som steg 1: `event.paperLayouts[bana]` (`CoursePaperLayout`) med
   `descriptions` (steg 1), `items` (element), `clip` (klippning), `template` (mall som banan ärver) och `hidden` (mallens
   element som inte står på banan). Allt sparas med samma åtgärd `SET_PAPER_LAYOUT` (hela banans papper), så versioner,
   autosparande, konflikter per bana (`event:paperLayouts:<bana>`) och förslag fungerar som förut. Ingenting ritas i editorn.
2. **Elementen** (`paper-items.ts`): `TEXT` (text med radbrytningar, storlek i mm, bredd, fet, vänster/mitten/höger, vit
   bakgrund), `IMAGE` (bild ur bildlagret med sha256, bredd, låsta proportioner, täckning 5–100 %), `SCALE_BAR` (längsta
   längd; stocken blir 1, 2 eller 5 gånger en tiopotens i meter i banans utskriftsskala) och `NORTH_ARROW` (höjd; uppåt på
   arket). Varje element har ett id och förankras som beskrivningen (`PaperAnchor`: hörn och avstånd inåt i mm) i kartramen
   eller, med `relativeTo: "PAGE"`, i arket. Gränser i `PAPER_LIMITS` (40 element, text 400 tecken …).
3. **Variablerna** fylls i per ram: `{bana} {klass} {längd} {stigning} {tävling} {datum} {skala} {ekvidistans} {variant}`
   (och layoutmallarnas `{klasser} {löpare} {klubb} {starttid} {startnummer}`). `{klass}` är löparens klass i en karta per
   löpare, annars banans klasser. `{datum}` är utskriftens datum (tävlingsdagen i kartbuntarna) eller `event.paperValues.date`;
   `{ekvidistans}` står inte i någon fil och sätts i `event.paperValues.contourInterval` (`SET_EVENT`). Okända lämnas kvar.
   Layoutmallarnas platshållare använder samma funktion (`expandPaperText`).
4. **Arket får `paperItems`** (`SheetPaperItem`: plats, källa och delar) av `layoutCoursePage` (första sidan) och
   `layoutTemplateSheets` (per ram; arkets element bara i första ramen). Delarna (`PaperPart`: rektangel, polygon, text,
   bild) är svartvita vektorer i papperets mm och ritas likadant av förhandsvisningen (SVG) och PDF:en (`write-pdf.ts`;
   täckningen som ExtGState `ca/CA`). Målningsordning: kartor och banor, vita ytor, layoutmallens bilder, papperets element,
   beskrivningar, texter.
5. **Bilderna lagras en gång per innehåll** i `course_setting_paper_image` (migration 0063, sha256, PNG eller JPEG, högst
   2 MB; typen prövas mot innehållet och bildens storlek läses ur huvudet). Inte i kartinnehållet (ADR-0189): bilderna är små
   och delas genom sha256. En SVG görs om till PNG i webbläsaren (längsta sidan 2 400 px) innan den laddas upp, så att
   PDF:en kan bädda in den. Den som får ändra banläggningen laddar upp; en bild visas för den som laddade upp den eller när
   tävlingens dokument (eller kontots bibliotek) pekar på den. Utskriftsarbetaren (`otid_print`) får läsa tabellen.
6. **Klippningen** är en rektangel eller polygon i ramens mm (origo i ramens övre vänstra hörn) med "utanför": vitt eller
   tonad karta. Den byggs på träningens kartpass (ADR-0192 beslut 9): `printSheetGroups` lägger klippningen på ramens pass
   (`clipMapPasses`: innanför som förut, utanför inget eller tonat 75 %), så förhandsvisningens Worker och PDF:en ritar den
   utan ny ritkod. Banan klipps inte. Tryckytan (Purple Pens `print-area`) bestämmer fortfarande vilken del av kartan som
   ligger i ramen; träningens "utanför avsnittet" och områden fungerar som förut och kombineras med klippningen.
7. **Mallar för papperet** (`event.paperTemplates`, `PaperTemplate`: namn, element, klippning, beskrivningens inställning)
   med `PUT_PAPER_TEMPLATE` och `DELETE_PAPER_TEMPLATE` (konflikt per mall `event:paperTemplates:<id>`). En bana som pekar på
   en mall ärver dess element; ändras ett mallelement på banan sparas en kopia med samma id i banans `items` (källa
   `OVERRIDE`), ett borttaget mallelement hamnar i `hidden`, banans egna element läggs till efter mallens och `clip: "NONE"`
   stänger av mallens klippning. Beskrivningens inställning ärvs fält för fält. Tas mallen bort står banorna kvar utan mall
   med sina egna element. "Spara banans papper som mall" gör en mall av det som gäller för banan och låter banan ärva den.
   Layoutmallarna (ADR-0183: papper, ramar, remsa) är något annat och finns kvar; papperets element står i deras ramar.
8. **Kontots bibliotek** (`course_setting_paper_template`, per konto och namn, högst 200) gör en mall användbar i andra
   tävlingar: "Spara mallen i mitt bibliotek" och "Hämta" (kopieras in i tävlingens dokument). Klubbarnas mallar väntar:
   klubbarkivet (ADR-0194) har ingen plats för delade inställningar och klubbens behörighet gäller arkivet, inte banläggningen.
9. **.ppen** (`ppenWithPaperLayout`, `keepPaperOnImport`):

   | O-Tid | Purple Pen |
   |---|---|
   | Beskrivningen, utplacerad eller automatisk | `descriptions`-specialobjekt för banan där O-Tid lägger den |
   | Text | `text`-specialobjekt för banan (rutan i kartans mm, Arial, svart); variablerna som `$(CourseName)`, `$(EventTitle)`, `$(CourseLength) km`, `$(CourseClimb) m`, `$(PrintScale)`, `$(ClassList)`, `$(Variation)`; datum och ekvidistans som text |
   | Bild | `image`-specialobjekt med bildens data (täckningen följer inte med) |
   | Tryckytan | `print-area` (som förut) |
   | Skalstock, nordpil, klippning, mallar, `hidden`, datum och ekvidistans | finns inte i Purple Pen; stannar i O-Tid |

   När en .ppen läses in i en banläggning följer papperet, mallarna och värdena med; text- och bildobjekt som O-Tid själv
   skrev (samma text respektive samma sha256, för samma enda bana) tas bort ur filen så att de inte står två gånger, och ett
   `descriptions`-objekt som står exakt där O-Tid lägger beskrivningen automatiskt (0,05 mm) tas bort så att banan förblir
   automatisk (samordnaren 2026-11-03: en bana utan beskrivning i filen skrivs ändå med beskrivningen, så Purple Pen skriver ut
   samma sak). Har någon flyttat objekten i Purple Pen gäller filens beskrivning och O-Tid:s text står kvar på sin plats.
10. **Förhandsvisningen redigerar**: panelen "Papperet: texter, bilder och klippning" per bana (lägg till, listan med källa,
    det markerade elementets fält, klippningen, datum och ekvidistans, mallar och bibliotek, Ångra), och på arket: klick
    markerar, dra flyttar, handtaget nere till höger ändrar storleken (bilden med låsta proportioner), piltangenterna 1 mm
    (Skift 5 mm), Delete tar bort, Escape eller klick på tomt papper släpper. Klippningens hörn dras på arket (rektangeln
    också med siffror). På 390 px ligger det markerade elementets fält i ett ark nere på skärmen; siffrorna räcker där.
    Ändringarna visas direkt och sparas en i taget på senaste versionen; Ångra (och Ctrl+Z) sparar det som gällde före.

11. **Tillägg 2026-11-03 (ägarens svar, grenen `pappersrum-2`).**
    - *Flera sidor:* varje element har "Sidor": "Första sidan" (förval) eller "Alla sidor" (`pages: "ALL"`). En bana som
      delas på flera sidor (`layoutCoursePage`) får elementen med "Alla sidor" också på de följande sidorna. Beskrivningen står
      kvar bara på första sidan.
    - *Klippningen och banan:* banans figurer (kontroller, start, mål, sträckor, nummer) står alltid hela, också utanför
      klippningen. Banläggningens markeringar (specialobjekten) står bara innanför: en punktsymbol (vätska, sjukvård, passage,
      förbjuden väg, passmärke) står hel om dess punkt ligger innanför och annars inte alls; övriga (förbjudet område, gräns,
      linje, text, bild …) ritas klippta till klippningens polygon, så att ett område som ligger delvis innanför syns fram
      till kanten. `printSheetGroups` tar bort punktsymbolerna och sätter `SheetFrame.markingClip` (polygonen i papperets mm
      och specialobjektens id); förhandsvisningen klipper med en SVG-`clipPath` och PDF:en med `W n` i målningsordning.
      "Visa markeringar utanför utsnittet" (`clip.showMarkings`, förval av) visar alla som förut.
    - *Förvald plats* i ett hörn av kartramen behålls.

12. **Ändrat av ADR-0211 (2026-11-04).** Beslut 10 ersätts av redigeringen direkt på arket (ADR-0211 beslut 8: markera
    flera, fästning med hjälplinjer, justera, lager, skriv i texten på arket, ram, linje och "Vitt på utskriften"), och
    mallarna (beslut 7) bär papperets storlek, riktning, marginal och de vita ytorna (ADR-0211 beslut 9).

## Följder

- Steg 1:s `PaperDescriptions` och förankringen flyttade till `paper-items.ts` och `paper-anchor.ts`; `paper-layout.ts`
  exporterar dem som förut. Steg 1:s beskrivning är en del av mallen.
- Säkerhetskopian och kopian av en tävling tar inte med bilderna (de ligger kvar i servern med sin sha256); en kopia på en
  annan server saknar bilderna tills de laddas upp igen. PDF:en säger då att bilden utelämnas.
- Utan nät kan papperet inte ändras (förhandsvisningen sparar direkt som förut); bilderna kräver nät.
