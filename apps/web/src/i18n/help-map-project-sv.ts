import type { HelpArticle } from "./help-sv";

/** Ägaren 2026-11-10: hjälpen i kartprojektets ritläge – hur man ska tänka, lagren, och punkter, tangenter och hjulet. */
export const mapProjectHelpArticles: readonly HelpArticle[] = [
  {
    id: "ritlaget-sa-tanker-du",
    title: "Så tänker du i ritläget",
    views: ["MAP_EDITOR"],
    body: [
      "Skärmen har tre delar. Till vänster ligger verktygen som små ikoner, i mitten kartan och till höger en panel med flikar. Raden under kartan säger alltid vad det valda verktyget väntar på.",
      [
        "Välj först en symbol under ”Symboler”, sedan ritar du. Verktyget ”Rita” väljs av sig självt.",
        "Håll musen över en ruta för att se symbolens nummer och namn. Sök på nummer eller namn i fältet överst.",
        "De senaste symbolerna ligger överst i fliken och i verktygshjulet. Tangenterna 1–6 tänder och släcker normens grupper under Lager.",
        "”Redigera” markerar, flyttar och böjer. Esc tar dig alltid tillbaka dit.",
        "Knapparna för det markerade objektet ligger i raden under kartan: ”Ta bort”, ”Förenkla”, ”Gör mjuk” och ”Flytta hela”.",
        "”Bara kartan” gömmer verktygen och panelen. Tangenten § gör samma sak.",
        "Pricken överst visar sparandet: fylld när allt är sparat, en tom ring när ändringar väntar. En varning i text visas bara när något är fel."
      ],
      "Flikarna delar upp det som förut var en lång lista. ”Lager” är allt som går att släcka och låsa: läs [Släcka, tona och låsa lager](#ritlaget-lager). ”Granska” är förslag, delområden, notiser, rekning och normkontroll, och ”Bearbeta” är generalisering och rättning av hela kartan.",
      "Tangenterna och hjulet står i [Punkter, tangenter och hjulet](#ritlaget-punkter-tangenter)."
    ]
  },
  {
    id: "ritlaget-lager",
    title: "Släcka, tona och låsa lager",
    views: ["MAP_EDITOR"],
    body: [
      "Symbolen är lagret, som i OCAD och Mapper. Det finns inga fria lager att lägga objekt i. Varje grupp i normen och varje symbol kan släckas, låsas och tonas under fliken ”Lager”.",
      [
        "Släcka: tryck på ögat vid gruppen. Ögat blir överstruket, och objekten döljs tills du trycker igen.",
        "Frysa: tryck på hänglåset. Objekten syns men går inte att markera eller ändra.",
        "Tona: knappen bredvid låset visar ett låst lager blekt, så att det du arbetar med syns tydligare.",
        "En enda symbol: öppna gruppen. Varje symbol har samma tre knappar.",
        "Egna grupper: ”Nytt arbetslager” samlar symboler du väljer, till exempel alla stigar. De släcks och låses som en grupp.",
        "Skisser som inte hör till kartan: ”Nytt skisslager”. De skrivs aldrig till kartfilen.",
        "Nya symboler går inte att skapa här än. Objekt med en symbol utanför normen flyttas med ”Slå ihop symboler”."
      ],
      "Flygbilder, laserbilder och äldre kartor som du lagt under kartan ligger längre ned i samma flik."
    ]
  },
  {
    id: "ritlaget-punkter-tangenter",
    title: "Punkter, tangenter och hjulet",
    views: ["MAP_EDITOR"],
    body: [
      "Det mesta går att göra på tre sätt: med ikonen till vänster, med en tangent eller i hjulet. Tangenten står i ikonens hörn.",
      [
        "Tangenterna ligger under vänster hand: Q väljer ”Redigera”, W ”Rita”, A ”Lägg till punkt” och S ”Ta bort punkt”.",
        "X väljer ”Klipp isär”: klicka på en linje så delas den i två där.",
        "V vänder den markerade linjens riktning, så att en brants taggar byter sida. D tar symbolen från det markerade objektet.",
        "Skift ger varianten: Skift+E ”Cirkel”, Skift+A ”Gör mjuk” och Skift+S ”Förenkla”. C byter symbol och R markerar kollad.",
        "Ny punkt: välj ”Lägg till punkt” och klicka på sträckan. Ta bort: välj ”Ta bort punkt” och klicka på punkten.",
        "I ”Redigera” gör Cmd- eller Ctrl-klick samma sak: på en punkt tas den bort, på en sträcka blir det en ny.",
        "Rita: klicka för hörn, tryck och dra för kurva. Backsteg tar bort sista punkten, Enter avslutar och Esc avbryter.",
        "Hjulet: högerklicka på kartan, håll fingret på den eller tryck mellanslag. Där finns verktygen och de senaste symbolerna.",
        "Byt tangenter med ”Tangenter” längst ned i verktygsspalten. Valet sparas i webbläsaren.",
        "Z ångrar och Skift+Z gör om. Cmd eller Ctrl + Z fungerar också."
      ],
      "Läs också [Så tänker du i ritläget](#ritlaget-sa-tanker-du)."
    ]
  },
  {
    id: "ritlaget-markera-flera",
    title: "Markera, flytta och vrida flera objekt",
    views: ["MAP_EDITOR"],
    body: [
      "I ”Redigera” kan du markera flera objekt på en gång och ändra dem tillsammans, som i ett ritprogram.",
      [
        "Dra en ruta på tom karta. Allt som rutan rör vid markeras. En yta som bara omsluter rutan följer inte med.",
        "Skift+klick lägger till ett objekt i markeringen, eller tar bort det ur den.",
        "Flytta: dra inne i markeringens ruta. Alla objekt följer med.",
        "Vrid: dra strax utanför ett hörn, där markören blir en böjd pil. Allt vrids runt rutans mitt.",
        "Slå ihop linjer: markera linjerna och tryck F, eller knappen ”Slå ihop linjer”. Linjer med samma symbol vars ändar möts blir en.",
        "Byt symbol på flera: markera dem, välj symbolen i panelen och tryck C. Alla med samma form får symbolen.",
        "Delete tar bort allt markerat. Ångra tar tillbaka hela flytten, vridningen eller borttagningen i ett steg.",
        "Flytta kartan: håll mellanslag nere och dra, eller dra med två fingrar på styrplattan. Ett kort tryck på mellanslag öppnar hjulet.",
        "Ett klick på ett enda objekt markerar bara det. Då ändrar du dess punkter som vanligt."
      ],
      "Låsta och släckta lager följer inte med i en ruta. Läs [Släcka, tona och låsa lager](#ritlaget-lager)."
    ]
  }
];
