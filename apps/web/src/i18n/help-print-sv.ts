import type { HelpArticle } from "./help-sv";

/**
 * Hjälpen för fältläget i telefonen, utskriften och papperet (grenen hjalp-banlaggning; papperet efter grenen
 * pappersrum). Samma regler som i `help-sv.ts`.
 */
export const fieldPrintHelpArticles: readonly HelpArticle[] = [
  {
    id: "faltlaget",
    title: "Fältläget i telefonen (hänga kontroller)",
    views: ["CS_FIELD", "CS_INSPECTIONS"],
    body: [
      "På telefonen visar banläggningen kartan med en rad nertill. På datorn står ”Min position” ovanpå kartan, och fältknapparna kommer fram när den är på.",
      [
        "”Min position”: ett tryck visar positionen, ett till följer den, ett tredje stänger av. Kartan behöver georeferens.",
        "”Flytta hit”: mäter några sekunder och flyttar vald kontroll dit du står. Noggrannheten står i raden.",
        "Pilarna flyttar vald kontroll 1 m åt gången.",
        "”Uppgifter”: höjd (kolumn F) och läge (kolumn G) för vald kontroll.",
        "”Kollad” och ”Notis här”: se länkarna nedan.",
        "”Mer” (⋯): ”Rita kartfel”, ”Lista” (fliken Kollat) och ”Offline”."
      ],
      "Positionen är osäker om den är sämre än 15 m. Vänta en stund eller gå ut i det öppna, och jämför alltid med kartbilden.",
      "Mer: [Kollat](#kollat), [Notiser och kartfel](#notiser) och [Utan nät i skogen](#utan-nat)."
    ]
  },
  {
    id: "kollat",
    title: "Kollat: kontroller som är kontrollerade på plats",
    views: ["CS_INSPECTIONS", "CS_FIELD"],
    body: [
      "Står du vid kontrollen i skogen: välj den och tryck på ”Kollad”. Bocken sparas med ditt namn och tiden.",
      "Fliken ”Kollat” visar ”Ej kollade” eller ”Alla” och hur många som är kollade. Tryck på en kontroll för att visa den på kartan.",
      "Flyttas kontrollen efter kollen står det att den är flyttad. Utan nät sparas bocken i telefonen och skickas sedan."
    ]
  },
  {
    id: "utan-nat",
    title: "Utan nät i skogen (offline)",
    views: ["CS_FIELD", "CS_SETTINGS"],
    body: [
      "Spara kartan i telefonen innan du går ut: ”Offline” i telefonens rad (under ”Mer”) eller ”Inställningar” → ”Utan nät”. Tryck på Spara kartan för offline.",
      [
        "Ändringar, notiser och bockar sparas alltid i telefonen tills servern har tagit emot dem.",
        "Statusen överst säger ”Utan nät” och hur många ändringar som väntar.",
        "När nätet är tillbaka skickas allt av sig självt. ”Skicka nu” försöker direkt.",
        "”Spara igen” när kartfilen på servern är ny. ”Ta bort från telefonen” frigör platsen.",
        "Säger telefonen att den inte kan spara: ladda inte om sidan, anslut till nätet först."
      ],
      "Har inloggningen gått ut ligger ändringarna kvar i telefonen och skickas när du loggat in igen."
    ]
  },
  {
    id: "utskrift",
    title: "Utskrift och förhandsvisning",
    views: ["CS_PRINT", "CS_PRINT_PAGE"],
    body: [
      "Skalan hör till banan: ”Skala för banan” under fliken ”Banor” i banans egenskaper. Välj den tidigt, för ringarnas storlek och numren följer den. Fliken ”Utskrift” visar den och har ”Ändra i banans egenskaper”.",
      "Fliken ”Utskrift” i banläggningen har ”Förhandsvisning och utskrift”, som öppnar utskriftssidan. Där står, uppifrån:",
      [
        "”Färger för tryck”: färgprofilen på en rad med ”Redigera färger”. Se [Färger för tryck](#bl-farger).",
        "”Skriv ut”: välj ”Banor” eller ”En karta per löpare (i samma ordning som Kartor till starten)”, och vilka banor.",
        "”Skriv ut på skrivare”: ett snabbt utkast på din egen skrivare; färgerna är inte tryckkvalitet.",
        "”Skapa PDF för tryckeriet”, bredvid: PDF:en med dekorfärger och övertryck.",
        "Översikten: ett kort per ark med skala, papper, mall och varningar. Klicka på ett kort för att redigera arket.",
        "Markera kort för ”Skriv ut markerade” eller för att ge dem en ”Mall för papperet”.",
        "”Redigera arket”: arken först och fälten bredvid, i telefonen under arken.",
        "Fälten: ”Papper och kartram”, ”Kartor per ark”, papperets texter och bilder och ”Kontrollbeskrivning på kartan”."
      ],
      "Mer:",
      [
        "Papper, riktning, marginal och kartramen: [Papper och kartram](#arket).",
        "Flera kartor på ett ark eller remsa för rullad karta: [Kartor per ark](#kartor-per-ark).",
        "Till tryckeriet: [PDF för tryck](#pdf-tryck).",
        "Text, logotyp, skalstock och nordpil: [Papperet](#papperet).",
        "Beskrivningen på arket: [Kontrollbeskrivningen på kartan](#beskrivning-pa-kartan)."
      ]
    ]
  },
  {
    id: "arket",
    title: "Papper och kartram",
    views: ["CS_PRINT_PAGE"],
    body: [
      "”Papper och kartram” under ”Redigera arket” gäller arket som är öppet (klicka på ett kort i översikten). Allt sparas i banans tryckyta och skrivs till .ppen som Purple Pens print-area.",
      [
        "”Papper” (A3, A4, A5), ”Riktning” och ”Marginal (mm)”.",
        "”Tryckyta”: ”Automatisk (som Purple Pen)” lägger banan mitt på papperet. ”Fast ram” låser ramen där den står.",
        "”Flytta ramen på arket”: dra inne i ramen för att flytta den över kartan, och handtaget nere till höger för att göra ramen mindre. Ramen står mitt på papperet.",
        "”Automatisk igen” tar bort banans egen tryckyta. För en del av en bana med kartbyte: ”Som banans igen”.",
        "Kartbyten: varje del har ett eget kort. ”Visa överlapp” väljer hur mycket av föregående del som syns.",
        "En fast ram kan också dras på kartan i banläggningen, med fliken ”Utskrift” öppen."
      ],
      "Använder utskriften ”Kartor per ark” bestämmer den mallen papperet i stället."
    ]
  },
  {
    id: "kartor-per-ark",
    title: "Kartor per ark",
    views: ["CS_PRINT_PAGE"],
    body: [
      "”Kartor per ark” lägger flera banor på samma ark, eller en karta med remsa för rullad karta. Förvalt är ”En bana per ark (tryckytan som i Purple Pen)”.",
      [
        "Välj en färdig, t.ex. A4 med fyra kartor eller A4 med en karta och remsa.",
        "”Kopiera till egen” och sedan ”Ändra arket (ramar, texter, logotyp, remsa)”: papper, rader och kolumner av ramar, texter, logotyp och skärmarker.",
        "Texterna kan ha {tävling} {bana} {variant} {längd} {stigning} {skala} {datum} {klasser} {löpare} {klubb} {klass} {starttid} {startnummer}.",
        "”Banorna i ramarna”: fyll arket i ordning, eller samma bana i alla ramar.",
        "Kontrollbeskrivningen ställs in per bana under ”Kontrollbeskrivning på kartan”."
      ],
      "Det här är inte samma sak som ”Mall för papperet”, som bär en banas texter, bilder, klippning och papper. Se [Mall för papperet](#papperets-mallar)."
    ]
  },
  {
    id: "beskrivning-pa-kartan",
    title: "Kontrollbeskrivningen på kartan",
    views: ["CS_PRINT_PAGE", "CS_PRINT", "CS_DESCRIPTION"],
    body: [
      "Beskrivningen hör till papperet, inte kartan. Den syns i förhandsvisningen och utskriften, inte i banläggningen.",
      [
        "Den är på för varje bana och läggs automatiskt i ett hörn där den inte täcker banan.",
        "Dra rutan på arket för att flytta den. Dra i hörnet nere till höger för att ändra storleken.",
        "Markera rutan och flytta med piltangenterna, 1 mm per tryck.",
        "”Spalter” och ”Rutans storlek” finns under ”Kontrollbeskrivning på kartan”. ”Automatiskt igen” väljer ett fritt hörn.",
        "Täcker den kontroller eller sträckor står en varning: dra den till en fri plats."
      ],
      "Platsen gäller banan i alla utskrifter. Den skrivs till .ppen som Purple Pens beskrivning, också när den står automatiskt, och följer med tillbaka när filen läses in."
    ]
  },
  {
    id: "papperet",
    title: "Papperet: texter, bilder, skalstock och nordpil",
    views: ["CS_PRINT_PAGE", "CS_PRINT"],
    body: [
      "Klicka på ett kort i översikten för att redigera arket. Det som står på papperet syns inte i banläggningen.",
      [
        "”+ Text”, ”+ Bild …”, ”+ Skalstock”, ”+ Nordpil”, ”+ Ram” och ”+ Linje” lägger till element.",
        "Dubbelklicka på en text för att skriva i den på arket. ”Infoga variabel” lägger in t.ex. {bana} eller {datum}.",
        "Dra elementet, dra i hörnet nere till höger för storleken. Pilarna flyttar 1 mm (Skift 5 mm), Delete tar bort.",
        "”Fäst mot kanter och mittlinjer”: elementen fäster mot ramen, marginalen och varandra. Håll Alt för att dra fritt.",
        "Skift-klick eller en ruta på tomt papper markerar flera. ”Justera markerade” ställer dem i linje.",
        "Lagren: ”Upp” och ”Ned” ändrar ordningen, ”Lås” och ”Dölj” skyddar eller gömmer ett element.",
        "Bilder: PNG, JPG eller SVG, högst 2 MB (SVG görs om till PNG).",
        "Variablerna {bana} {klass} {längd} {stigning} {tävling} {datum} {skala} {ekvidistans} {variant} fylls i per bana.",
        "”Ångra” och ”Gör om”, eller Ctrl+Z och Ctrl+Y.",
        "”Uppgifter för texterna” (hopfällt): datum och ekvidistans som ska stå i {datum} och {ekvidistans}."
      ],
      "”Klippning av kartan”, ”Vitt på utskriften”, ”Uppgifter för texterna” och ”Mitt bibliotek (alla mina tävlingar)” är hopfällda: klicka på rubriken.",
      "I .ppen blir texterna Purple Pens textobjekt och bilderna bildobjekt. Ramar, linjer, skalstock, nordpil och vita ytor stannar i O-Tid. Mallar: [Mall för papperet och klippning av kartan](#papperets-mallar)."
    ]
  },
  {
    id: "papperets-mallar",
    title: "Mall för papperet och klippning av kartan",
    views: ["CS_PRINT_PAGE"],
    body: [
      "En mall är papperet, riktningen och marginalen, elementen, klippningen, de vita ytorna och beskrivningens plats under ett namn. Banorna ärver mallen.",
      [
        "”Spara banans papper som mall” och välj den under ”Mall för papperet” på de andra banorna.",
        "Översikten har samma ”Mall för papperet”: markera korten och använd mallen på dem, eller ”Använd på alla banor”.",
        "”Uppdatera mallen med banans papper” när du ändrat banan som mallen bygger på.",
        "Ändrar du ett element på en bana gäller det bara den banan (”Ändrad för banan”). ”Som i mallen igen” ångrar.",
        "”Spara mallen i mitt bibliotek”: mallen finns sedan under ”Mitt bibliotek (alla mina tävlingar)”. ”Hämta” tar in den i en annan tävling."
      ],
      "”Klippning av kartan” begränsar hur mycket av kartan som skrivs ut, utan att ändra kartan. Välj ”Rektangel” eller ”Polygon” och dra hörnen på arket.",
      "”Utanför” visar ”Vitt” eller ”Tonad karta” runt klippningen. ”Vitt på utskriften” gör egna ytor vita, t.ex. det som ska skäras bort; dra hörnen på arket. Kartfilen ändras inte.",
      [
        "Banan står alltid hel, också utanför klippningen: kontroller, start, mål, sträckor och nummer.",
        "Markeringar (förbjudna områden, gränser, vätska och andra små symboler) står bara innanför.",
        "Ett förbjudet område som ligger delvis innanför ritas fram till kanten.",
        "”Visa markeringar utanför utsnittet” visar alla markeringar som vanligt."
      ]
    ]
  },
  {
    id: "bl-farger",
    title: "Färger för tryck",
    views: ["CS_PRINT_PAGE", "CS_PRINT"],
    body: [
      "Under ”Färger för tryck” på utskriftssidan bestäms hur kartans och banans färger trycks. Kartfilen ändras aldrig.",
      "Raden överst visar ”Färgprofil” och om den är ”Godkänd”. ”Redigera färger” öppnar hela flödet; det är öppet tills profilen är godkänd. ”Ny profil” gör en egen kopia.",
      [
        "”Banans färg”: CMYK, ”Dekorfärg” och ”Övertryck”.",
        "”Lägg banan i normens färgordning”: ringar och linjer under svart och 100 %-färger, över asfalt, byggnadsytor och raster.",
        "Normen bestämmer bara om en kartfärg hamnar över eller under banan. På varje sida ligger färgerna i kartfilens ordning.",
        "Ett vitt under ett träd eller under järnvägens svarta streck stannar alltså under dem.",
        "Vitt ligger över banan bara när kartfilen ritar det över all svart, t.ex. vitt för förbjudet område. Svart för odlad mark ligger med rastren under banan.",
        "”Norm”: skog (ISOM) eller sprint (ISSprOM), förvalt ur kartan.",
        "I skog ligger numren under kurvor, svart och blått som i normen, så att de ser lite genomsiktliga ut.",
        "”Kontrollnummer och texter överst” lägger dem över kartans färger. I sprint ligger de alltid överst.",
        "Med BL skog eller BL sprint får varje färg ett kort: ”Säker”, ”Bekräfta” eller ”Tvetydig”.",
        "”Godta”, ”Behåll filens” eller ”Välj BL-rad …”. ”Godta alla säkra” tar alla säkra på en gång.",
        "”Justera färger för hand”: samma värden per färg i en tabell. En ändring där syns på kortet som ”Ändrad för hand”.",
        "”Mer”: ladda ned eller läs in profilen som JSON och tabellens källa."
      ],
      "Valen sparas i tävlingens färgprofil och gäller utskriften och PDF:en."
    ]
  },
  {
    id: "pdf-tryck",
    title: "PDF för tryck och spegelvänd karta",
    views: ["CS_PRINT_PAGE", "CS_PRINT"],
    body: [
      "”Skapa PDF för tryckeriet” under ”Skriv ut” på utskriftssidan skapar PDF:en på servern. Den har kartan som vektorer och banan i egen dekorfärg med övertryck.",
      [
        "”Skapa PDF för tryck”: till tryckeriet. ”Kartans färger i PDF:en för tryck”: dekorfärger som i kartfilen eller CMYK.",
        "”Skapa PDF för kontorsskrivare”: CMYK utan dekorfärger, med samma färgordning som trycket.",
        "I den är kartans färger över banan multiplicerade, så den ser ut som trycket i alla program.",
        "PDF:en för tryck har äkta övertryck. Det syns i Acrobat med Simulera övertryck; Förhandsvisning på Mac visar lila heltäckande.",
        "”Förhandskontroll för PDF:en” visar det som stoppar eller bör ses över. Läs varningarna först.",
        "Jobbet läggs i en kö. PDF:en står i listan när den är klar: ”Ladda ned”.",
        "Klara PDF:er sparas några dagar och syns bara för tävlingens administratörer."
      ],
      "Gör alltid ett provtryck hos tryckeriet innan PDF:en används skarpt.",
      "Spegelvänd karta: fliken ”Träning” → ”Spegel” → ”Spegelvänd kartan och banan i utskriften”. Utskriften och PDF:en vänds, men inte kartan i banläggningen."
    ]
  },
  {
    id: "lopar-kartor",
    title: "En karta per löpare: variabler, baksida och kontroll",
    views: ["CS_PRINT_PAGE"],
    body: [
      "”En karta per löpare (i samma ordning som Kartor till starten)” under ”Skriv ut” ger en karta för varje löpare, ledig tid och reserv.",
      [
        "Texter på papperet kan ha löparens variabler: {namn} {startnummer} {klubb} {klass} {starttid} {variant}, och för stafett {lag} {lagnummer} {sträcka}.",
        "Exempel på framsidan: Lag {lagnummer} · Sträcka {sträcka} · {variant}. I utskriften av banor syns variablerna som platshållare.",
        "”Baksida med löparens uppgifter”: dubbelsidigt i samma PDF, eller separat körning under Kartor till starten → Baksidor.",
        "Baksidan redigeras på arket: välj ”Baksidan (per löpare)” under ”Bana” i papperets fält. Förvalet är samma som Kartor till startens baksida.",
        "”Vilka som skrivs ut”: alla, valda klasser, valda löpare (sök på namn eller nummer) eller valda lag med alla sträckor eller en sträcka.",
        "”Kontrollera kopplingen” visar sidan i PDF:en, löparen, klassen, laget, banan, varianten och starttiden. Klicka på en rad för att se arket.",
        "Varningarna: ingen variant, bortvald variant, antalet stämmer inte med Kartor till starten, samma startnummer två gånger. ”Spara som CSV” sparar tabellen."
      ],
      "Mallarna, ”Mitt bibliotek (alla mina tävlingar)” och klubbarkivet sparar bara variablerna, aldrig löparna."
    ]
  },
  {
    id: "kartbyten",
    title: "Kartbyten: delar, dubbelsidigt och överlapp",
    views: ["CS_PRINT_PAGE", "CS_PRINT"],
    body: [
      "En bana med kartbyte delas i delar som i Purple Pen. Del 2 börjar vid kartbytet, som ritas som en start, och numren fortsätter.",
      [
        "”Del” under ”Kartbyten” i fliken ”Utskrift”: ”Hela banan” eller en av delarna (Del 1, Del 2 …). Kartan i banläggningen visar den delen.",
        "Varje del får en egen tryckyta när du ändrar papperet eller ramen för delens ark i utskriften (”Papper och kartram”). ”Som banans igen” tar bort delens egen.",
        "”Visa överlapp” under ”Papper och kartram”: ”Ingen”, ”Sista sträckan” eller ”Hela föregående del”, tonat och utan nummer.",
        "I förhandsvisningen står varje del på ett eget ark med delens kontrollbeskrivning.",
        "”Dubbelsidigt: del 2 på baksidan av del 1 (kartbyte)”: ordningen som skrivaren behöver, med en tom baksida vid udda antal.",
        "På papperet står ett element med ”Alla sidor” på varje del. Annars står det bara på del 1."
      ],
      "Vänds kartan vid kartbytet (map-flip i Purple Pen) är dubbelsidigt förvalt. Delarnas tryckytor skrivs till .ppen som i Purple Pen."
    ]
  }
];
