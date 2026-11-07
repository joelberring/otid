# ADR-0183: Utskriftsprofil, layoutmallar och en karta per löpare

Status: beslutad 2026-11-01 (PLAN.md steg 64, ägarens önskemål samma dag). Bygger på ADR-0180 beslut 11 (sidor ur
`layoutCoursePage`) och steg 61 (kartbuntar och baksidor). Underlag till steg 65 (PDF för tryckeriet).

**Bakgrund.** Kartfilens färger passar inte alltid skrivaren eller tryckeriet: på kontorsskrivaren blir grönt för mörkt,
tryckeriet vill ha kartans färger som i filen och banan i egen dekorfärg med övertryck. I dag rättar man det i OCAD och
sparar om kartan, vilket ändrar den gemensamma filen. macpurplepen (BSD) har en utskriftsprofil med färginställningar per
kartfärg och en förhandskontroll (ColorPreflight) som säger vad som stämmer. Ägaren vill också kunna lägga flera kartor
på ett A4/A3, ha egna texter och logotyp på papperet och skriva ut en karta per löpare med namn, klass och starttid. Ingen
kod är tagen ur PDFsharp eller andra tredjepartsbibliotek; idéerna kommer ur macpurplepens modell.

**Beslut.**
1. **Utskriftsprofil** (`PrintProfile`, `schemaVersion` 1; okänd version avvisas) sparas per tävling i banläggningens
   dokument (`event.printProfiles`, vald `event.printProfileId`), aldrig i .ppen-filen och aldrig i kartfilen. Den följer
   med när en ny .ppen läses in och kan laddas ned och läsas in som JSON till en annan tävling.
   - Per kartfärg (matchas på OCAD-id, namn eller namnmönster): dölj, ljusare/mörkare i procent (−100–100), ny CMYK,
     dekorfärg med övertryck. `mapColorAdjust` ger justeringen per färg; `drawMap` tar den som `colorAdjust` och ritar
     om utan att kartan ändras.
   - Banans färg: CMYK, dekorfärgens namn och övertryck på/av (Purple Pens standard 20/100/0/0 "Purple").
   - Färdiga profiler som inte kan ändras, bara kopieras: "Tryckeri (som i filen)" och "Kontorsskrivare (ljusare grönt)"
     (grönt 30 % ljusare, gult 15 %), plus macpurplepens förhandsregler från BL Idrottsservice (skog och sprint) som exempel.
2. **Förhandskontrollen** (`colorPreflight`) jämför profilens regler med kartans färger och säger INFO, WARNING eller
   BLOCKING per regel: träff, avvikande CMYK, "behöver bekräftas" (namnet stämmer inte exakt, arrangören bekräftar),
   "tvetydig" (flera kandidater) och fel ordning. Den ändrar ingenting. Webbläsarens utskrift kan inte dekorfärger,
   övertryck, PDF/X eller ICC; kontrollen säger det när profilen kräver det.
3. **Layoutmall** (`SheetLayout`, `schemaVersion` 1) är papperet som "paperspace": papper och riktning, marginal, en
   eller flera kartramar, texter med platshållare ({tävling} {bana} {variant} {längd} {stigning} {skala} {datum} {klasser}
   {löpare} {klubb} {klass} {starttid} {startnummer}), logotyp som bild (högst 300 kB), beskrivningens plats och rutstorlek,
   remsa för rullad karta (kant och bredd valbara) och skärmarker. Samma mall gäller alla valda banor. Mallarna sparas per
   tävling (`event.layoutTemplates`) och kan kopieras; färdiga mallar: A4 en karta, A4 två och fyra kartor, A3 två kartor,
   A4 med remsa.
4. **Flera kartor per ark:** varje ram får sin bana, variant, tryckyta och skala (`SheetItem`); FILL lägger de valda
   banorna i ramarna i ordning ("fyll sidan"), REPEAT samma bana i alla ramar. Utsnittet är lika stort som ramen i
   utskriftsskalan kring banans tryckyta.
5. **En karta per löpare** ur steg 61:s plan (`planMapBundles` via kartbuntarna): buntordning (per variant, löpare och
   lediga tider, sedan reserver) eller startordning; varje löpare får sin variant. Dubbelsidigt följer en baksida med namn,
   klass, startnummer, starttid och variant i stor stil (som steg 61:s baksidor); enkelsidigt står uppgifterna på remsan.
   Lediga och reserver får variant men inget namn. Kontrollen före utskrift: varje löpare har en variant, varianten finns i
   banläggningen och antalet per variant stämmer med kartbuntslistan.
6. **Modellen till steg 65** är `Sheet`: papper i mm (y nedåt), ramar (`SheetFrame` som `CoursePage`: `mapArea`, `clip`,
   `transform`, figurerna med färgroll i målningsordning), texter, bilder, beskrivningar, vita ytor (remsan), skärmarker
   och `back` för baksidan. Steg 65 skriver samma ark som PDF med profilens dekorfärger, övertryck och eventuellt PDF/X och
   ICC, utan att räkna om något. `layoutCoursePage` står kvar för Purple Pens en bana per sida (`sheetOfPage`).
7. **BL-profilerna och förslaget** (tillägg 2026-11-02, grenen bl-profil; ägarens önskemål: "BL som en profil att välja,
   ett förslag man accepterar, visuellt tydligt"). Porterat ur macpurplepens PrintProfiles.cs/ColorPreflight.cs (BSD).
   - **Tabellerna som data** (`print-reference.ts`): "BL skog" (`bl-forest-2026-11-02`, 27 rader) och "BL sprint"
     (`bl-sprint-2026-11-02`, 30 rader, gäller från 2025-05-01), rad för rad som på BL:s sidor med URL, datum, kommentar,
     tabellens ordning och banläggarstödets färgnummer (50, 52, 55). Inga påhittade tal; kontrollerade mot sidorna 2026-11-02.
     Tomma celler: bara K tom läses som 0 och märks (`emptyCells`); helt tomma rader (Brun 30 %, Svart 50 %) har inga värden
     och föreslås aldrig. Regler och upplysningar ur sidorna (ordningen, passmärket, oanvända färger, PDF från banläggarstödet,
     5 mm marginal, faktarutan, filerna) står i `notes` med källa; O-Tid:s tolkningar är märkta.
   - **Versioner:** en tabell ändras aldrig. En ny BL-tabell = en ny tabell och en ny inbyggd profil med nytt id; den gamla
     står kvar oförändrad (testet låser innehållet med en hash) och `SUPERSEDED_PRINT_PROFILES` pekar på den nya (de första
     BL-utkasten `bl-forest-2026-08-27`/`bl-sprint-2025-05-01` visas bara om de redan är valda). Tävlingens godkända kopia
     bär sin tabell (`PrintProfile.reference`) och påverkas inte av en ny version.
   - **Förslaget** (`proposeColorMatches`) per kartfärg: namn (färgord och andel, "Grön 100% + 50% Svart"), OCAD-id,
     CMYK, användning (`colorUsage` i map-file: symbolnummer, yta/linje/punkt) och ordning. Fel färgord, extra färgord eller
     andel som skiljer mer än 15 procentenheter utesluter en rad (utom vid samma CMYK). Säker = tydligt bäst med minst två
     oberoende stöd; Bekräfta = en rad men något skiljer (andel, sida av banan, ingen rad passar); Tvetydig = rader som ger
     olika tryck ligger nära (rader med samma CMYK på samma sida av banan räknas som en). Oanvända färger behöver inget beslut.
   - **Godkännandet** (förhandsvisningen): stora färgrutor före/efter (SWOP som kartan), kartfilens och BL:s namn, säkerheten
     i text, skälen, en kartbit med bara färgen tänd och talen i en liten rad; hela kartan före/efter med reglage kring banan;
     ordningen som lager och en liten figur. "Godta alla säkra", per rad "Godta", "Behåll filens" och "Välj BL-rad …" (lista
     med färgrutor). Varje beslut sparas genast i tävlingens kopia (`<id>-godkand`, `basedOn`, `colorDecisions`); kartfilen
     ändras aldrig. Förhandskontrollen före PDF säger hur många färger som är obekräftade (varning) och stoppar om passmärket
     används; beslut vars färg bytt namn eller försvunnit gäller inte och sägs.
   - **PDF:** BL:s sidor anger bara CMYK och säger inget om dekorfärger eller övertryck; BL-profilerna vill därför ha CMYK
     (`processColors`, banan `course.process` 35/95/0/0 skog, 35/100/0/0 sprint, utan övertryck). Banan läggs i kartans
     färgordning (`courseLayer: "REFERENCE"`, valbart): platsen med minst färger på fel sida enligt tabellen (källans
     uttryckliga regler väger tre gånger) och kartan skrivs i två utsnitt per ram, under och över banan; beskrivningar, bilder
     och texter ligger överst. Ghostscript (bitcmyk) i testet: där höjdkurvan korsar ringen är cyanplåten tom.
   - **Avvikelser från macpurplepen:** "Blå yta" ligger under banan (BL:s tabell; macpurplepen hade den över) och "100 % blå"
     i regeln är "Blå linje och punkt"; regeln för svart och blått kommer från sidan om baninritning, inte skogssidan; banans
     violett har inget övertryck (sidorna säger inget om övertryck).

8. **Ändrat av ADR-0211 (2026-11-04).** Banans plats i färgordningen (beslut 7, "under brunt, svart och 100 % blå") går nu
   efter normen (ISOM eller ISSprOM) med övre och undre lila och övertryck på färgerna över banan; BL:s tabell är kvar som
   källa till CMYK. Profilpanelen och förslaget är ett flöde, "Färger för tryck" (ADR-0211 beslut 3 och 6).

**Konsekvenser.** Arrangören kan rätta färgerna för sin skrivare och tryckeriet utan OCAD. Webbläsarens utskrift är fortsatt
ett utkast med skärmens färger; profilens dekorfärger och övertryck syns som data och i förhandskontrollen men görs först i
steg 65. Profilerna och mallarna gör dokumentet större (logotyp högst 300 kB per mall, högst 50 profiler och 50 mallar).

## Risker och öppna frågor

- **Färgerna på papper:** ljusare/mörkare och ny CMYK i webbläsaren är skärmens tolkning; bara provtryck visar resultatet.
- **Dubbelsidigt:** webbläsaren vet inte om skrivaren vänder på lång eller kort kant; baksidan ligger rakt och mitt på arket.
- **Per löpare med flera ramar** ger en löpare per ark (övriga ramar tomma); flera löpare per ark med var sin remsa finns inte.
- **BL:** PDF:en är inte provad hos BL (BL avråder från Purple Pen); kartfilens egen färgordning ändras inte, så en färg på
  fel sida av banan (t.ex. grön punktsymbol över bruna kurvor) syns bara som varning. BL kan ändra tabellerna med kort varsel.
  Webbläsarens utkast lägger inte banan i färgordningen (bara jämförelsebilden och PDF:en gör det).
