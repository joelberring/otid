# ADR-0192: Träningsläge i banläggningen

Status: beslutad 2026-11-02 (grenen `traningslage`, ägarens önskemål samma dag). Bygger på ADR-0180 (dokumentet, .ppen,
banpåtrycket), ADR-0181 (samarbete och ångra) och ADR-0183/0184 (arken, utskriftsprofilen och PDF:en).

**Bakgrund.** Ägaren vill att O-Tid ska vara bättre än Purple Pen för klubbens träningar. Purple Pen har inget stöd för
träningsformer; korridorer och fönster görs i dag för hand med vita ytor (`white-out`) eller i OCAD med en kopia av kartan.
Ägarens exempel: kantiga och mjuka korridorer, delar av kartan med bara kurvbild, stjärnorientering, kepsorientering ("hatt")
och sista säkra (attackpunkt). Man gör ofta flera övningar efter varandra på samma karta: korridor från start till 4, bara
kurvbild till 8, fönster till mål, sista säkra på några sträckor.

## Beslut

1. **Träningen är en egen del av dokumentet** (`CourseSettingDocument.training`, valfri, `schemaVersion` 1), bredvid banorna.
   Banor, kontroller, sträckor, varianter, beskrivningar, längd och överföringen till tävlingen läser den aldrig: en
   träningsbana är en vanlig bana för avläsningen. Delarna har egna id (som klienten slumpar, `t…`) så att två som arbetar
   samtidigt inte får samma id:
   - `courses[banans id]` (`CourseTraining`): avsnitten, utanför-valet, grundfiltret, linjen, stjärnan, kepsparen och kartbitarna.
   - `areas[id]` (`TrainingArea`): ritade områden (polygon i kartans mm) med ett symbolfilter, för alla banor eller valda.
   - `attackPoints[id]` (`AttackPoint`): sista säkra, en punkt på en sträcka (kontrollernas id, som Purple Pens `<leg>`).
   - `attackStyle`: ringens storlek (0,4–0,9 av kontrollringen, förval 0,6) och stil (heldragen, streckad, tunn).
2. **Avsnitt** (`TrainingSection`) är träningsformen för en del av banan: från banans kontroll `from` till `to` (banans
   kontroll-id; `null` = start respektive mål). Ett avsnitt har en form och ett filter för det som syns inne i formen:
   - `CORRIDOR`: buffert längs avsnittets sträckor (brytpunkterna följs). Kantig (`ANGULAR`: raka kanter, spetsiga hörn med
     gräns 3 × halva bredden, rak ände förlängd en halv bredd förbi kontrollen) eller mjuk (`SMOOTH`: rundade hörn och ändar,
     `smoothing` 0–1 rundar själva linjen med Chaikins hörnklippning före bufferten). Bredd i meter i terrängen, per sträcka
     med `legWidths[legKey]`.
   - `WINDOW`: cirkel eller kvadrat kring avsnittets kontroller (radie i meter).
   - `BAND`: ett bälte kring sträckorna (bredd i meter, förval 300 m) där filtret gäller, t.ex. bara kurvbild 4–8.
   - `NO_MAP`: sträckorna utan karta (relä/kompass): bältet är vitt.
   - `marker`: markering vid bytet (vid avsnittets första kontroll): ingen, kort text (förval formens namn och "→", t.ex.
     "Kurvbild →") eller ett tvärstreck över sträckan strax efter kontrollen. Ritas i banans färg (roll `TRAINING`); pilen
     ritas som två linjer i sträckans riktning, eftersom tecknet → saknas i PDF:ens typsnitt.
   Avsnitten följer varianten som skrivs ut: positionerna slås upp i variantens kontrollföljd (id, annars samma kontroll),
   och "alla grenar" ger unionen av varianternas ytor. Gafflingsvarianter får därmed sin egen korridor.
3. **Hur kartan sätts ihop** (en ren funktion, `trainingMapPasses`): banans grundfilter gäller överallt. Har banan avsnitt
   visar varje avsnitts yta kartan med avsnittets filter; där ytor går in i varandra gäller det tidigare avsnittet i banan
   (ytorna görs disjunkta), så maskningen byter vid kontrollen. Utanför alla avsnitt gäller `outside`: hela kartan, vitt,
   tonat (alla kartans färger med lägre andel, förval 25 % kvar; `drawMap` `tint`) eller ett filter (t.ex. bara kurvbild).
   Banans ritade områden snävar in filtret inom sin polygon (det första området gäller där två överlappar). Resultatet är
   en lista med pass: klippning (inom unionen av ytor, utanför andra), filter och ljusning. Antalet pass är
   (avsnitt + 1) × (områden + 1); områden och avsnitt utanför utsnittet hoppas över.
4. **Symbolfilter** (`SymbolFilter`): förval, synliga grupper och undantag per symbol (`hide`, `show`, symbolens nummer som i
   filen, t.ex. "101.0" i OCAD och "101" i Mapper). Grupperna efter ISOM 2017-2 och ISSprOM 2019-2 (huvudnumret, kontrollerat
   mot omapwiki 2026-11-01 som i ADR-0180 beslut 10): höjdkurvor och terrängformer 101–115, berg och sten 2xx, vatten och
   sankmark 3xx, vegetation 4xx, vägar och stigar 501–508 (ISSprOM 501 belagd yta räknas dit), byggt 509–5xx utom 520,
   förbjudet område 520 och kartans banpåtryckssymboler 7xx, tekniskt 6xx (nordlinjer, passmärken, höjdsiffror). ISOM 2000
   har samma hundratal, så äldre kartor grupperas rätt. **Okända nummer** (0, 8xx–9xx, egna) grupperas efter namnet (svenska
   och engelska ord: "kurva/contour", "sten/boulder", "vatten/water", "väg/stig/path" …), annars som "Övrigt". Text-symboler
   hör till "Övrigt". Förvalen: Hela kartan, Bara kurvbild (höjdkurvor och terrängformer), Kurvbild + vatten + sten, Utan
   vegetation, Utan stigar, Bara stigar och vägar. Alla förval behåller tekniskt och förbjudet område (säkerheten);
   banläggaren kan dölja dem uttryckligen. Filtret gäller objekten efter sin egen symbol (en kombinerad Mapper-symbol
   följer sitt nummer).
5. **Sista säkra** (`AttackPoint`) ritas som en mindre ring i banans färg och dekorfärg (roll `TRAINING`) på alla banor och
   varianter där sträckan finns. Den är inte en kontroll: ingen kod, inte i beskrivningen, längden, kontrollerna eller
   avläsningen. Streckad = ringen med 12 avbrott; tunn = halva linjebredden.
6. **Fönster, stjärna, linje, keps och kartbitar.**
   - *Stjärna* (`star`): central kontroll och utskrift `ALL` (alla uddar på en karta) eller `PER_CONTROL` (en karta per udd,
     ut och tillbaka). "Skapa stjärnbana" gör en ny bana start – C – 31 – C – 32 … – mål i ett ångra-steg (vanliga åtgärder
     `ADD_COURSE` och `INSERT_COURSE_CONTROL`), eller en bana per kontroll. En udd skrivs ut med `section` (nedan).
   - *Linjeorientering* (`line`): en inritad linje (punkter i kartans mm; förslag: sträckornas linjer i ordning). Löparens
     karta har start, mål och linjen men inte kontrollerna; kontrollantens karta har allt (`view: "CONTROLLER"`).
   - *Kepsorientering* (`pairs`): par av banans kontroller i ordning ger etiketterna "1a" och "1b", "2a" och "2b" … (det första
     i paret är a). Paren görs ur en vanlig bana (intill varandra eller första och andra halvan) och ändrar inte banans
     struktur, så varianter, gafflingar och avläsning är orörda. **Förval: en gemensam karta** med alla a- och b-punkter (löparna
     turas om att hänga ut och ta in kepsen); sträckorna visas bara om man väljer det. Extra val: en karta för löpare A och en
     för B, där punkterna man sätter ut är heldragna och de man tar in streckade, med förklaringen i kartans text.
   - *Kartbitar* (minnes- och pusselorientering, `pieces`): utskriften gör en liten ram per sträcka (bitens sida i mm, skala och
     marginal i meter valbara, ordning i banans ordning eller blandad), flera på ett ark.
7. **Banpåtrycket** (`layout`) får träningen för den bana och variant som ritas: sista säkra, markeringarna, kepsetiketterna och
   linjen. `OverprintOptions.training` väljer vy (`RUNNER`/`CONTROLLER`), kepsens karta (`COMMON`/`A`/`B`) och ett avsnitt
   (`section`: positioner i kontrollföljden) som begränsar kontroller, sträckor och nummer till avsnittet (stjärnans udd, en
   kartbit). Etiketterna placeras som vanliga nummer.
8. **Editorn.** Fliken "Träning" (också en knapp i verktygsraden) med formerna som kort med en liten bild och en rad text.
   Formerna kombineras på banan: avsnitten listas i banans ordning och läggs till med "Lägg till avsnitt" (från, till, form);
   "utanför" och grundfiltret gäller hela banan. Kartan ritas direkt med passen i kartans Worker, så före och efter syns med
   ett klick ("Visa träningen" av/på). Symbolfiltret har förvalen som knappar och grupperna och kartans symboler (med antal
   objekt) som kryssrutor. Områden ritas punkt för punkt på kartan. Sista säkra läggs med ett klick på sträckan.
9. **Utskrift och PDF.** `printSheetGroups` lägger passen på varje ram (`SheetFrame.mapPasses`), så förhandsvisningen och
   serverns PDF ritar samma sak. Maskningen görs i kartlagret: varje pass ritas med `drawMap` med klippning (`clip`: inom
   unionen av ytor, utanför andra) och dolda symboler (`hiddenSymbols`); inga vita fält läggs över banpåtrycket. Kartans
   dekorfärger, BL-profilen och lagerordningen (ADR-0183 beslut 7, kartan under och över banan) gäller oförändrat: passen
   ritas i båda delarna. Tonat är en lägre andel av samma dekorfärg (skärmen ritar färgen genomskinlig, PDF:en skriver
   dekorfärgen med andelen), så plåtarna är desamma som utan träning.
10. **.ppen.** Träningen skrivs sist i filen som ett eget element i O-Tid:s namnrymd:
    `<otid:training xmlns:otid="https://o-tid.se/ns/ppen-training/1" schema-version="1">…JSON…</otid:training>`. Purple Pen
    (EventDB.Load via XmlInput.FindSubElement) hoppar över element det inte känner till, så filen går att öppna och ändra där;
    sparar Purple Pen filen försvinner elementet. Läser O-Tid in en .ppen utan elementet behålls den nuvarande träningen (som
    utskriftsprofilerna), och delar för banor som inte finns tas bort när filen skrivs. Ett element med fel version eller
    trasig JSON sparas orört i `raw` med en varning. Inga befintliga element ändras, och utseende (`<course-appearance>`) och
    mallar lagras som förut.
11. **Ändringar, samarbete och ångra.** En åtgärd `PUT_TRAINING` sätter (eller tar bort, `null`) hela delar per id: banor,
    områden, sista säkra och stilen. Touches per del (`training:course:<id>`, `training:area:<id>` …), så att två som ändrar
    olika banors träning inte krockar. Ångra och gör om går genom `objectPatch`/`PUT_OBJECTS.training` (samma form), uppspelningen
    behöver ingen id-översättning eftersom id:n är slumpade. Paketet kontrollerar formen (ändliga tal, gränser, högst 64
    avsnitt, 50 områden, 2 000 punkter per polygon och 500 sista säkra).

12. **Spegelvänd karta** (`CourseTraining.mirror`, spegelorientering): kartan och banan vänds höger–vänster i utskriften.
    `printSheetGroups` speglar ramens banpåtryck kring ramens lodräta mittlinje (`mirrorFigures`: ringar, sträckor, ytor och
    texternas plats; ringarnas avbrott [s, e] blir [180 − e, 180 − s]) och märker ramen (`SheetFrame.mirror`). Kartbilden
    ritas som vanligt med passen och vänds när den placeras: förhandsvisningen med en SVG-transform på bilden, PDF:en med
    matrisen `-1 0 0 1` när kartans Form XObject placeras i ramen. Plåtarna är desamma. Texterna (nummer, kepsens etiketter,
    markeringar) vänds inte; kartans egna texter blir spegelvända; beskrivningar och bilder på kartan står kvar. Editorn
    ritar kartan som vanligt (att klicka i en spegelvänd karta vore förvirrande); kortet "Spegel" slår på speglingen.
    *Relä* (sträckor utan karta, kompass och avståndsbedömning) är avsnittsformen `NO_MAP` i beslut 2.
13. **Formernas namn som taggar** (`TRAINING_TAGS`, `trainingTags`): Korridor, Kurvbild, Fönster, Utan karta, Sista säkra,
    Stjärna, Linje, Keps, Minnes, Spegel. Svenska och stabila, samma ord som klubbarkivet (ADR-0194) föreslår ur mapp- och
    filnamn, så att en träning gjord här och en gammal fil med samma övning får samma tagg. De interna koderna (`CORRIDOR`,
    `PAIRS` …) är dokumentets format och byts inte heller.

**Konsekvenser.** Inga nya tabeller eller migrationer: träningen ligger i banläggningens jsonb. Purple Pen ser träningsbanorna
som vanliga banor. Kartan ritas en gång per pass, så en karta med många avsnitt och områden tar längre tid att rita (mätt i
testerna); PDF:en blir större i samma mån.

## Risker och öppna frågor

- **Purple Pen sparar bort träningen.** Att O-Tid behåller den vid ny inläsning gäller bara banor med samma id.
- **Okända symbolnummer** grupperas efter namnet; en karta med egna nummer och namn på andra språk hamnar i "Övrigt", där
  banläggaren väljer per symbol.
- **Roterad karta** är inte byggd: banpåtryckets texter måste då vridas för sig, och PDF:ens transform har ingen rotation.
  Spegelvänd karta finns (beslut 12) men bara i utskriften, och kartans egna texter blir spegelvända.
