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
      "Fliken ”Utskrift” ställer in vald bana: ”Papper”, ”Riktning”, ”Utskriftsskala” och ”Tryckyta”. Ramen på kartan visar vad som kommer med.",
      [
        "”Automatisk (som Purple Pen)”: ramen följer banan. ”Fast ram (dra på kartan)”: du drar ramen dit du vill.",
        "”Förhandsvisning och utskrift”, eller ”Fil” → ”Utskrift av banor …”, öppnar sidan med alla ark.",
        "Där väljer du ”Banor” och ”En sida per variant” för gafflade banor. ”Skriv ut” skriver ut från webbläsaren.",
        "”En karta per löpare (i samma ordning som Kartor till starten)”: en karta per anmäld med rätt variant.",
        "”Papperet: texter, bilder och klippning”: text, logotyp, skalstock och nordpil per bana. Se [Papperet](#papperet).",
        "”Layoutmall”: flera kartor per ark och remsa för rullad karta."
      ],
      "Utskriften ur webbläsaren är ett utkast. Mer:",
      [
        "Till tryckeriet: [PDF för tryck](#pdf-tryck).",
        "Beskrivningen på arket: [Kontrollbeskrivningen på kartan](#beskrivning-pa-kartan).",
        "Kartans färger: [Färger för tryckeriet](#bl-farger)."
      ]
    ]
  },
  {
    id: "kartbyten",
    title: "Kartbyten: delar, dubbelsidigt och överlapp",
    views: ["CS_PRINT", "CS_PRINT_PAGE"],
    body: [
      "En bana med kartbyte delas i delar som i Purple Pen. Del 2 börjar vid kartbytet, som ritas som en start, och numren fortsätter.",
      [
        "”Del” under ”Kartbyten” i fliken ”Utskrift”: ”Hela banan” eller en av delarna (Del 1, Del 2 …). Kartan visar den delen.",
        "Varje del får en egen tryckyta när du ändrar ramen för delen. ”Som banans igen” tar bort delens egen.",
        "”Visa överlapp”: ”Ingen”, ”Sista sträckan” eller ”Hela föregående del”, tonat och utan nummer.",
        "I förhandsvisningen står varje del på ett eget ark med delens kontrollbeskrivning.",
        "”Dubbelsidigt: del 2 på baksidan av del 1 (kartbyte)”: ordningen som skrivaren behöver, med en tom baksida vid udda antal.",
        "På papperet står ett element med ”Alla sidor” på varje del. Annars står det bara på del 1."
      ],
      "Vänds kartan vid kartbytet (map-flip i Purple Pen) är dubbelsidigt förvalt. Delarnas tryckytor skrivs till .ppen som i Purple Pen."
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
      "På utskriftssidan finns ”Papperet: texter, bilder och klippning” för vald bana. Det står på papperet, inte på kartan, och syns inte i banläggningen.",
      [
        "”+ Text”: skriv texten. ”Infoga variabel” lägger in t.ex. {bana}, {längd} eller {datum}, som fylls i per bana.",
        "”+ Bild …”: t.ex. klubbens logotyp. PNG, JPG eller SVG, högst 2 MB. ”Täckning (%)” gör den svagare.",
        "”+ Skalstock” och ”+ Nordpil”: skalstocken räknas ur banans utskriftsskala.",
        "Dra elementet på arket och dra i hörnet nere till höger för storleken. Pilarna flyttar 1 mm (Skift 5 mm), Delete tar bort.",
        "”Hörn” och ”I förhållande till”: ”Kartramen” eller ”Arket”. Elementet står kvar i hörnet när papperet ändras.",
        "”Sidor”: en bana på flera sidor får elementet på ”Första sidan” (förval) eller på ”Alla sidor”. Beskrivningen står bara på första sidan.",
        "”Uppgifter för texterna”: datum och ekvidistans som ska stå i {datum} och {ekvidistans}."
      ],
      "I .ppen blir texterna Purple Pens textobjekt och bilderna bildobjekt. Skalstock, nordpil, täckning och klippning stannar i O-Tid. Mallar och klippning: [Mallar och klippning av kartan](#papperets-mallar)."
    ]
  },
  {
    id: "papperets-mallar",
    title: "Mallar för papperet och klippning av kartan",
    views: ["CS_PRINT_PAGE"],
    body: [
      "En mall är papperets element, klippning och beskrivningens plats under ett namn. Banorna ärver mallen.",
      [
        "”Spara banans papper som mall” och välj den under ”Banans mall” på de andra banorna.",
        "”Använd mallen på alla valda banor” och ”Uppdatera mallen med banans papper”.",
        "Ändrar du ett element på en bana gäller det bara den banan (”Ändrad för banan”). ”Som i mallen igen” ångrar.",
        "”Spara mallen i mitt bibliotek”: mallen finns sedan under ”Mitt bibliotek (alla mina tävlingar)”. ”Hämta” tar in den i en annan tävling."
      ],
      "”Klippning av kartan” begränsar hur mycket av kartan som skrivs ut, utan att ändra kartan. Välj ”Rektangel” eller ”Polygon” och dra hörnen på arket.",
      "”Utanför” visar ”Vitt” eller ”Tonad karta” runt klippningen. PDF:en klipps likadant.",
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
    title: "Färger för tryckeriet (BL-förslaget)",
    views: ["CS_PRINT_PAGE", "CS_PRINT"],
    body: [
      "Under ”Färger och tryck (utskriftsprofil)” på utskriftssidan väljer du ”Profil”. Med BL skog eller BL sprint matchar O-Tid kartans färger mot tryckeriets tabell.",
      "Varje färg får ett märke: ”Säker”, ”Bekräfta” eller ”Tvetydig”. Välj för varje färg:",
      [
        "”Godta”: använd BL-raden i förslaget.",
        "”Behåll filens”: kartfilens färg behålls.",
        "”Välj BL-rad …”: välj en annan rad i BL:s tabell, t.ex. när färgen är tvetydig.",
        "”Godta alla säkra” godtar alla säkra på en gång. ”Ångra” tar tillbaka ett val.",
        "”Hela kartan före och efter”: dra reglaget och jämför."
      ],
      "Kartfilen ändras aldrig. Valen sparas i tävlingens utskriftsprofil och gäller bara utskriften och PDF:en."
    ]
  },
  {
    id: "pdf-tryck",
    title: "PDF för tryck och spegelvänd karta",
    views: ["CS_PRINT_PAGE", "CS_PRINT"],
    body: [
      "Under ”PDF för tryck” på utskriftssidan skapas PDF:en på servern. Den har kartan som vektorer och banan i egen dekorfärg med övertryck.",
      [
        "”Skapa PDF för tryck”: till tryckeriet. ”Kartans färger i PDF:en för tryck”: dekorfärger som i kartfilen eller CMYK.",
        "”Skapa PDF för kontorsskrivare”: CMYK utan dekorfärger.",
        "”Förhandskontroll för PDF:en” visar det som stoppar eller bör ses över. Läs varningarna först.",
        "Jobbet läggs i en kö. PDF:en står i listan när den är klar: ”Ladda ned”.",
        "Klara PDF:er sparas några dagar och syns bara för tävlingens administratörer."
      ],
      "Gör alltid ett provtryck hos tryckeriet innan PDF:en används skarpt.",
      "Spegelvänd karta: fliken ”Träning” → ”Spegel” → ”Spegelvänd kartan och banan i utskriften”. Utskriften och PDF:en vänds, men inte kartan i banläggningen."
    ]
  }
];
