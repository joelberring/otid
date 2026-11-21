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
        "De senaste symbolerna ligger överst i fliken och i hjulet, på tangenterna 1–8. Alt+1–6 tänder och släcker normens grupper under Lager.",
        "”Markera” markerar, flyttar och böjer. Esc tar dig alltid tillbaka dit.",
        "Knapparna för det markerade objektet ligger i raden under kartan: ”Ta bort”, ”Förenkla”, ”Gör mjuk” och ”Flytta hela”.",
        "”Bara kartan” gömmer verktygen och panelen. Tangenten § gör samma sak.",
        "Pricken överst visar sparandet: fylld när allt är sparat, en tom ring när ändringar väntar. En varning i text visas bara när något är fel."
      ],
      "Flikarna delar upp det som förut var en lång lista. ”Grundkarta” är stegen för en ny karta: läs [Från laserdata till färdig karta](#ritlaget-arbetsgang); ”Lager” är allt som går att släcka, låsa och tona. ”Granska” är förslag, normkontroll, notiser, rekning och delområden, och ”Bearbeta” är generalisering och rättning av hela kartan.",
      "Tangenterna och hjulet står i [Punkter, tangenter och hjulet](#ritlaget-punkter-tangenter)."
    ]
  },
  {
    id: "ritlaget-arbetsgang",
    title: "Från laserdata till färdig karta",
    views: ["MAP_EDITOR"],
    body: [
      "En ny karta görs i samma ordning varje gång, under fliken ”Grundkarta”. Steg 2 och 3 behövs, steg 1 är valfritt.",
      [
        "Före steg 2: koppla Lantmäteriet en gång. Läs [Så kopplar du Lantmäteriet](#lantmateriet-koppla).",
        "Steg 1, valfritt: hämta ortofoto, markfuktighet och Skogsstyrelsens kartor att rita efter. De syns bara som bakgrund.",
        "Steg 2, ”Ta fram grundkartan”: guiden kör laserdatan och lägger till OpenStreetMap och hyggen. Resultatet är ett utkast.",
        "Steg 3, ”Gå igenom utkastet”: reglagen ändrar utkastet direkt. Lägg in det med raden under kartan.",
        "”Rita färdigt”: välj en symbol under ”Symboler” och rita; ändra ett objekt med ”Markera”.",
        "Kontrollera under ”Granska” › ”Normkontroll”.",
        "Exportera med ”Till Exportera” sist i ”Granska”: en ny kartversion eller bara ändringarna."
      ],
      "Ett utkast sparas inte i kartan förrän du lägger in det. Förslag är något annat: ändringar som en ägare godkänner under ”Granska”.",
      "En karta som redan har innehåll: läs [Redigera en karta som redan finns](#ritlaget-redigera)."
    ]
  },
  {
    id: "ritlaget-redigera",
    title: "Redigera en karta som redan finns",
    views: ["MAP_EDITOR"],
    body: [
      "En karta från en kartfil, eller en ny karta med grundkartan inlagd, redigeras med symbolerna. Stegen under ”Grundkarta” behövs inte då.",
      [
        "Öppna kartan från kartprojektets sida med ”Öppna kartan”.",
        "”Rita färdigt”: välj en symbol under ”Symboler” och rita; ändra ett objekt med ”Markera”.",
        "Ändra: klicka på objektet i ”Markera” och dra i punkterna. Knapparna för objektet står i raden vid objektet (i telefonen längst ned).",
        "Andras ändringar och AI:ns kommer som förslag under ”Granska”. En ägare godkänner eller avvisar dem.",
        "Kontrollera under ”Granska” › ”Normkontroll”.",
        "Exportera med ”Till Exportera” sist i ”Granska”. En ny kartversion sparas i projektet, och originalet ändras aldrig."
      ],
      "Tangenterna och hjulet står i [Punkter, tangenter och hjulet](#ritlaget-punkter-tangenter)."
    ]
  },
  {
    id: "lantmateriet-koppla",
    title: "Så kopplar du Lantmäteriet",
    views: ["MAP_EDITOR"],
    body: [
      "Laserdatan till grundkartan hämtas från Lantmäteriet med ditt eget konto där. O-Tid har inget eget konto hos Lantmäteriet. Utan kopplingen går guiden i steg 2 inte, men annat går.",
      "Det här behövs:",
      [
        "Ett konto på Lantmäteriets Geotorget. Som privatperson loggar du in med Geotorgets användarnamn och lösenord.",
        "En organisation kan i stället använda ett systemkonto i Lantmäteriets API-portal, med nyckel och hemlighet.",
        "Produkterna nedan, beställda på Geotorget. Varje produkt beställs för sig; utan beställning säger Lantmäteriet nej.",
        "Laserdata Nedladdning, skog: grundkartan i guiden, med kurvor, branter, kärr och grönt. Behövs för första kartan.",
        "Ortofoto Nedladdning: flygbilder att rita efter, under ”Ortofoto från Lantmäteriet”. Valfri.",
        "Ortofoto historiska Nedladdning: äldre flygbilder, en egen produkt. Valfri.",
        "Marktäcke, Byggnad och Fastighetsindelning: läses med laserdatan när kontot har dem. Valfria; grundkartan blir klar utan dem."
      ],
      "Så kopplar du:",
      [
        "Mitt konto › Lantmäteriet: välj ”Sätt att logga in”, fyll i uppgifterna och tryck ”Spara uppgifterna”.",
        "Ladda om kartans sida. Första delsteget i guiden säger om Lantmäteriet är kopplat.",
        "Prova: öppna ”Laserkörningar (avancerat)” och tryck ”Sök laserrutor”. Kommer en lista med rutor fungerar laserdatan.",
        "Säger O-Tid att Lantmäteriet sa nej: kontrollera uppgifterna under Mitt konto och beställningen på Geotorget."
      ],
      "Utan Lantmäteriet går OpenStreetMap under ”Läs in vektorfil eller OpenStreetMap”, ”Markfuktighet (SLU)”, Skogsstyrelsens kartor och egna bilder och vektorfiler."
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
        "Symboler som är dolda i kartfilen, till exempel en grundkarta från CAD, ligger i ”Skisslager ur kartfilen”. Tänd lagret för att se dem.",
        "Nya symboler går inte att skapa här än. Objekt utanför normen och skisslagren flyttas med ”Slå ihop och för över symboler”.",
        "Förslagen där går efter nummer, namn, utseende och lagret i DWG-filen. Det som redan är ritat kan hoppas över."
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
        "Tangenterna ligger under vänster hand: Q väljer ”Markera”, W ”Rita”, A ”Lägg till punkt” och S ”Ta bort punkt”.",
        "X väljer ”Klipp isär”: klicka på en linje så klipps den i två där. Båda delarna blir markerade och de nya ändarna får rosa ringar.",
        "V vänder den markerade linjens riktning, så att en brants taggar byter sida. D tar symbolen från det markerade objektet.",
        "Skift ger varianten: Skift+E ”Cirkel”, Skift+A ”Gör mjuk” och Skift+S ”Förenkla”. C byter symbol och R markerar kollad.",
        "Ny punkt: välj ”Lägg till punkt” och klicka på sträckan. Ta bort: välj ”Ta bort punkt” och klicka på punkten.",
        "I ”Markera” gör Cmd- eller Ctrl-klick samma sak: på en punkt tas den bort, på en sträcka blir det en ny.",
        "Rita: klicka för hörn, tryck och dra för kurva. Backsteg tar bort sista punkten, Enter avslutar och Esc avbryter.",
        "Hjulet: högerklicka på kartan, håll fingret på den eller tryck mellanslag. Verktygen har fasta platser: Markera uppåt, Rita snett höger, Rektangel åt höger.",
        "Håll högerknappen och dra åt ett håll för att välja verktyget där direkt. De senaste symbolerna och åtgärderna står i listan bredvid ringen.",
        "Raden under kartan säger vad pekaren står på i hjulet, och annars vilket verktyg som är valt.",
        "Byt tangenter med ”Tangenter” längst ned i verktygsspalten. Valet sparas i webbläsaren.",
        "Z ångrar och Skift+Z gör om. Cmd eller Ctrl + Z fungerar också.",
        "Siffrorna 1–8 väljer de senaste symbolerna i raden överst. Skift+mellanslag gör den senaste åtgärden igen.",
        "Håll Q för att markera en stund: när du släpper är du tillbaka i verktyget du hade."
      ],
      "Läs också [Så tänker du i ritläget](#ritlaget-sa-tanker-du)."
    ]
  },
  {
    id: "ritlaget-markera-flera",
    title: "Markera, flytta och vrida flera objekt",
    views: ["MAP_EDITOR"],
    body: [
      "I ”Markera” kan du markera flera objekt på en gång och ändra dem tillsammans, som i ett ritprogram.",
      [
        "Dra en ruta på tom karta. Allt som rutan rör vid markeras. En yta som bara omsluter rutan följer inte med.",
        "Skift+klick lägger till ett objekt i markeringen, eller tar bort det ur den.",
        "Flytta: dra inne i markeringens ruta. Alla objekt följer med.",
        "Vrid: dra strax utanför ett hörn, där markören blir en böjd pil. Allt vrids runt rutans mitt.",
        "Slå ihop: markera och tryck G, eller ”Slå ihop linjer eller ytor”. Linjer vars ändar möts blir en, ytor som överlappar blir en yta.",
        "Byt symbol på flera: markera dem, välj symbolen i panelen och tryck C. Alla med samma form får symbolen.",
        "Delete tar bort allt markerat. Ångra tar tillbaka hela flytten, vridningen eller borttagningen i ett steg.",
        "Flytta kartan: håll mellanslag nere och dra, eller dra med två fingrar på styrplattan. Ett kort tryck på mellanslag öppnar hjulet.",
        "Ett klick på ett enda objekt markerar bara det. Då ändrar du dess punkter som vanligt."
      ],
      "Låsta och släckta lager följer inte med i en ruta. Läs [Släcka, tona och låsa lager](#ritlaget-lager)."
    ]
  }
];
