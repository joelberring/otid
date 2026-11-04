import type { HelpArticle } from "./help-sv";

/**
 * Hjälpen för vägvalen (i banläggningen och kontrollkartan) och klubbarkivet (grenen hjalp-banlaggning). Samma regler som
 * i `help-sv.ts`.
 */
export const routeChoiceHelpArticles: readonly HelpArticle[] = [
  {
    id: "vagval-strackan",
    title: "Vägval i banläggningen",
    views: ["CS_SELECTED", "CS_COURSES"],
    body: [
      "Välj en bana överst och klicka på en sträcka. Fliken ”Vald” visar ”Vald sträcka” med vägvalen, räknade ur kartfilen.",
      [
        "Fågelväg: rak linje mellan kontrollerna.",
        "Bästa väg: snabbaste vägen med längd, stigning och ungefärlig tid. Den ritas som en blå linje.",
        "Alternativ: andra vägval, streckade och numrerade. +12 % betyder 12 % längre tid än bästa vägen.",
        "Bara vägval som är högst 25 % sämre visas. Det tonade stråket är vägar som är högst 5 % sämre.",
        "Välj en rad i listan så markeras den vägen på kartan."
      ],
      "Vägvalen räknas om när du flyttar en kontroll. ”Räkna längs vägval” i fliken ”Banor” ger hela banans längd längs bästa vägvalen.",
      "Hur tiden räknas: [Vägvalsanalysen](#vagval)."
    ]
  },
  {
    id: "kontrollkarta",
    title: "Kontrollkartan",
    views: ["CONTROL_MAP", "COURSES"],
    body: [
      "”Kontrollkarta” under ”Banor” i arbetsytan visar tävlingens kontroller på kartan. Välj läge överst:",
      [
        "”Belastning”: större och mörkare ring = fler löpare, efter ”Planerade löpare” eller ”Stämplingar”.",
        "”Bana”: en bana eller variant med linjer, och gafflingsbilden för gafflade banor.",
        "”Vägval”: vägvalsanalysen per sträcka. Se [Vägvalsanalysen](#vagval)."
      ],
      "Kartan under kontrollerna är kartfilen eller kartbilden från ”Karta och vägval”. Saknar banfilen lägen visas bara tabellen."
    ]
  },
  {
    id: "vagval",
    title: "Vägvalsanalysen: så räknas den",
    views: ["ROUTE_CHOICE", "CONTROL_MAP"],
    body: [
      "Välj bana eller variant. Alla sträckor räknas i webbläsaren ur kartfilen och banläggningens spärrar.",
      "Kartans symboler blir markslag: snabb (väg, stig, öppen mark), vanlig skog, långsam, mycket långsam, nästan stopp och ej passerbar. Tiden räknas med farten i vanlig skog och stigningen.",
      [
        "”Fågelväg” och ”Bästa väg”: längden rakt och längs snabbaste vägen.",
        "”Stigning”: meter uppför längs bästa vägen. 1 m stigning räknas som 8 m plan väg om inget annat är inställt.",
        "”Uppskattad tid”: tiden för bästa vägen med farten i vanlig skog (6:00 min/km om inget annat är inställt).",
        "”Vägval”: hur många vägval som är högst 25 % långsammare än det bästa.",
        "”Bedömning”: ”Vägvalssträcka”, ”Inget vägval” eller ”Vägvalen är ungefär lika bra”.",
        "Ungefär lika bra betyder att bästa vägvalet byter plats om farterna ändras 15 % upp eller ner.",
        "”Att se över”: bästa vägen går genom en annan kontrolls ring, en kontroll ligger i ej passerbar mark eller ingen väg finns."
      ],
      "Tiderna är till för att jämföra vägval, inte för att förutsäga löparnas tider. Se också [Inställningar och spärrar](#vagval-installningar)."
    ]
  },
  {
    id: "vagval-installningar",
    title: "Vägvalens inställningar och spärrar",
    views: ["ROUTE_CHOICE"],
    body: [
      "”Inställningar för vägvalen” står under tabellen. Ändringar räknas om direkt och sparas för tävlingen:",
      [
        "”Ekvidistans (m)”: avståndet mellan höjdkurvorna på kartan (förval 5 m).",
        "”1 m stigning räknas som (m plan väg)”: hur dyr stigningen är (förval 8).",
        "”Fart i vanlig skog (min/km)”: grundfarten som de andra markslagen räknas från.",
        "”Symboler som inte finns i tabellen” räknas som vanlig skog tills du väljer något annat."
      ],
      "Spärrarna från banläggningen räknas med. Förbjudet och farligt område, tillfällig konstruktion, gräns och förbjuden väg går inte att passera.",
      "En valfri passage öppnar en spärr där den står, som en grind."
    ]
  },
  {
    id: "vagval-kalibrering",
    title: "Justera farterna efter löparnas GPS-rutter",
    views: ["ROUTE_CHOICE"],
    body: [
      "Har löparna sprungit banan kan farterna jämföras med deras rutter. Ladda först upp GPS-rutterna (GPX) under ”Karta och vägval”.",
      [
        "Öppna ”Farterna mot löparnas rutter” under tabellen och tryck på ”Justera farterna efter de här rutterna”.",
        "Rutterna räknas i webbläsaren och skickas inte någonstans.",
        "Tabellen visar varje markslags fart mot vanlig skog, ”Före” och ”Efter”.",
        "Under tabellen står hur mycket data det bygger på. Med lite data: se förslaget som en fingervisning.",
        "”Spara” gör de nya farterna till tävlingens, och vägvalen räknas om."
      ],
      "Bara löpare med resultat på banan räknas."
    ]
  },
  {
    id: "vagval-publicera",
    title: "Visa bästa vägval publikt",
    views: ["ROUTE_CHOICE"],
    body: [
      "”Visa bästa vägval publikt” visar bästa vägen per sträcka i den publika sträcktidsanalysen, bredvid löparnas rutter.",
      "Det syns först när banorna är publika, och alla sträckor måste vara räknade. ”Dölj bästa vägval publikt” tar bort det.",
      "Byts kartfilen visas vägvalen inte längre; öppna ”Vägval” och publicera igen. Kartans rättigheter kan stoppa publik visning."
    ]
  }
];

export const archiveHelpArticles: readonly HelpArticle[] = [
  {
    id: "klubbarkiv",
    title: "Klubbarkivet",
    views: ["ARCHIVE_TRAININGS", "ARCHIVE_ENTRY", "EVENTS"],
    body: [
      "Klubbarkivet sparar klubbens kartor och banor från tidigare träningar, så att de kan användas igen. Det är aldrig publikt; bara inbjudna ser det.",
      "Skapa det på ”Mina tävlingar” → ”Mina klubbar” → ”Ny klubb”. Den som skapar klubben blir ägare.",
      [
        "”Träningar”: sök på plats, övning eller bana och filtrera på år, karta, tagg och ledare.",
        "”Kartor”: kartorna med alla versioner. Se [Kartor, versioner och rättigheter](#arkiv-kartor).",
        "”Medlemmar”: vem som ser och ändrar arkivet. Se [Medlemmar](#arkiv-medlemmar).",
        "”Import”: läs in klubbens gamla träningar från din dator. Se [Importera till arkivet](#arkiv-import)."
      ],
      "Arkivet visar träningen som den gjordes. Vill du ändra banorna: [Använd en träning igen](#anvand-igen)."
    ]
  },
  {
    id: "anvand-igen",
    title: "Använd en träning igen",
    views: ["ARCHIVE_ENTRY", "ARCHIVE_TRAININGS"],
    body: [
      "Öppna en träning i arkivet och tryck på ”Använd igen”. Arkivet ändras aldrig; du får en ny träning med kartan och banorna.",
      [
        "”Namn” och ”Datum” för den nya träningen.",
        "”Var”: ”Ny träning (Mina tävlingar)” eller i en träningsgrupp.",
        "”Banfil” om träningen har flera, och ”Kartversion” (senaste versionen är förvald).",
        "Tryck på ”Skapa träningen”. Banläggningen öppnas med en kopia att ändra."
      ],
      "Är kartan nyare än den banorna gjordes på flyttar O-Tid banorna efter kartornas georeferens. Saknas den: flytta banan med pilarna och tryck på ”Banorna ligger rätt”.",
      "En kartfil över 75 MB kan inte bli träningens karta än, men banorna kommer med."
    ]
  },
  {
    id: "arkiv-kartor",
    title: "Kartor, versioner och rättigheter",
    views: ["ARCHIVE_MAPS", "ARCHIVE_ENTRY"],
    body: [
      "En karta är ett område med versioner. Gamla träningar visar versionen de gjordes på; ”Använd igen” väljer den senaste.",
      [
        "”Ny karta” och ”Ladda upp ny version”: OCAD (.ocd) eller Mapper (.omap, .xmap), högst 75 MB.",
        "”Slå ihop markerade” eller ”Möjliga dubbletter” gör flera kartor till en. ”Flytta versionen till …” flyttar en version.",
        "”Ändra rättigheter”: klubbens eller extern karta, ägare, avtal, bara träning, avgift per utskrift och publik visning.",
        "Rättigheterna gäller alla versioner och följer med när kartan används i en grupp eller tävling.",
        "”Lägg i gruppens kartbibliotek” lägger senaste versionen i en träningsgrupp."
      ],
      "Bilderna och kontrollen av kartorna: [Bilder och kontroll av kartorna](#arkiv-bilder). Dubbletter: [Dubbletter och versioner av kartor](#arkiv-dubbletter)."
    ]
  },
  {
    id: "arkiv-dubbletter",
    title: "Dubbletter och versioner av kartor",
    views: ["ARCHIVE_MAPS", "CS_START", "EVENTS"],
    body: [
      "Samma karta finns ofta under flera filnamn. ”Möjliga dubbletter” överst i fliken ”Kartor” visar kartor som troligen är samma, med bild, år och skälen:",
      [
        "”Troligen samma karta” eller ”Kanske samma”. Skälen är till exempel samma område med överlappet, ”Liknande namn” och ”Samma symboler”.",
        "Välj under ”Behåll namn och uppgifter från” vilken karta som behåller namnet och rättigheterna. Förvalet är den som används mest.",
        "”Slå ihop till en karta” flyttar de andras versioner dit. ”Inte samma karta” tar bort förslaget för gott.",
        "Egna val: kryssa i kartorna och tryck på ”Slå ihop markerade”."
      ],
      "Kartfilerna och träningarna ändras aldrig: varje träning visar fortfarande versionen den gjordes på.",
      [
        "Varje version har ett år, gissat ur filnamnet, mappen eller uppladdningen. ”Ändra år och uppgifter” rättar det.",
        "Versionerna står nyaste först, och kortet säger till exempel 5 versioner, 2014–2023.",
        "”Kopiera till alla versioner” sätter en versions kartritare eller anteckning på de andra; du ser först vad som ändras. ”Från kartan” tar kartans kartritare.",
        "”Historik” → ”Ångra sammanslagning” delar kartorna igen, så länge inget annat har ändrats i kartan."
      ],
      "När du skapar en träning eller öppnar banläggningen utan karta väljer ”Välj karta från klubbarkivet” en karta ur dina klubbar; senaste versionen är förvald."
    ]
  },
  {
    id: "arkiv-bilder",
    title: "Bilder och kontroll av kartorna",
    views: ["ARCHIVE_MAPS", "ARCHIVE_TRAININGS"],
    body: [
      "Varje kartversion och träning får en liten bild. Bilderna ritas i webbläsaren när en ägare eller administratör har arkivet öppet, några kartor per besök.",
      "Vid varje version står ”Fungerar” med OCAD-versionen, eller skälet till att den inte gick att rita. OCAD 7 och äldre går inte: spara kartan i nyare OCAD eller i Mapper.",
      "”Kontrollera alla kartor igen” läser varje kartversion på nytt, ritar alla bilder och räknar om banfilernas sammanfattningar. Det tar en stund; låt sidan vara öppen."
    ]
  },
  {
    id: "arkiv-medlemmar",
    title: "Medlemmar i klubbarkivet",
    views: ["ARCHIVE_MEMBERS"],
    body: [
      "Bjud in med e-postadressen under ”Medlemmar” → ”Bjud in”; flera adresser går på en gång. Personen får ett mejl med en länk och blir medlem när hen loggar in med adressen och har bekräftat den. ”Skicka igen” (eller ”Kopiera länken” utan e-post på servern) finns vid varje inbjudan; se [Inbjudningar med e-post](#inbjudningar).",
      [
        "”Ägare”: allt, också att ändra ägarna. Klubben har alltid minst en ägare.",
        "”Administratör”: ändrar arkivet, bjuder in, bekräftar och importerar. Ägare och administratörer ser alltid allt.",
        "”Ledare”: ser träningsarkivet och använder kartbanken (kartfiler, Använd igen).",
        "”Medlem”: ser det som klubben väljer under [Vem ser vad](#bekrafta-medlemmar).",
        "”Ändra roll” och ”Ta bort” finns vid varje person."
      ]
    ]
  },
  {
    id: "arkiv-import",
    title: "Importera till klubbarkivet från datorn",
    views: ["ARCHIVE_IMPORT"],
    body: [
      "Har klubben gamla träningar i mappar eller zip-filer på en dator läser du in dem här; bara ägare och administratörer importerar.",
      { steps: [
        "Öppna fliken ”Import” och tryck på ”Välj mapp”. Välj mappen med årsmapparna (2018, 2019 …) eller en enda årsmapp.",
        "Zip-filer från Google Drive väljer du med ”Välj filer”. Du kan också dra mappar och zip-filer till rutan.",
        "Ska ledarnas namn inte med: kryssa i ”Ta inte med ledarens namn ur [hakparenteser]”.",
        "Tryck på ”Förhandsgranska”. Du ser träningarna, kartorna, vad som är nytt och vilka filer som inte skickas. Inget är skickat än.",
        "Tryck på ”Importera”. Kartorna skickas först, sedan träningarna. ”Avbryt” stoppar när som helst.",
        "Avbröts importen eller stängdes fliken: välj samma filer och importera igen. Det som redan finns hoppas över."
      ] },
      "Filerna läses på din dator. Bara kartfiler och banfiler (.ocd, .omap, .xmap, .ppen, CourseData) skickas; PDF, Word, Excel, bilder, startlistor och resultat lämnar aldrig datorn.",
      "En kartfil över 75 MB skickas inte, och förhandsgranskningen säger vilken. ”Ladda ner rapporten” sparar förhandsgranskningen som textfil.",
      [
        "Kan du Git: öppna ”För den som kan Git: kommandoraden”, tryck på ”Skapa importnyckel” och kör kommandot som står där.",
        "Nyckeln gäller i 12 timmar och ”Återkalla” stoppar den. Flaggan --utan-ledare gör samma sak som kryssrutan."
      ]
    ]
  }
];
