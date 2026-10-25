import type { SectionId } from "../lib/race-sections";

/**
 * Hjälpen i programmet (PLAN.md steg 37). Enkel svenska och korta meningar. Knappar och vägar står inom ”…” och heter
 * exakt som i UI-texterna; `help-sv.test.ts` slår upp varje citat i i18n-filerna. Skriv inget annat inom ”…”.
 */

/** Vyn man står i: arbetsytans steg (även Fest), Mina tävlingar eller avläsningssidan. */
export type HelpView = SectionId | "EVENTS" | "READOUT_PAGE";

/** En hjälpartikel. `body`: ett stycke per sträng, en punktlista per lista. */
export type HelpArticle = {
  id: string;
  title: string;
  views: readonly HelpView[];
  body: readonly (string | readonly string[])[];
};

export const helpSv = {
  button: "Hjälp",
  title: "Hjälp",
  close: "Stäng",
  search: "Sök i hjälpen",
  searchPlaceholder: "Till exempel lottning eller okänd bricka",
  here: "Hjälp för den här sidan",
  all: "Alla hjälpartiklar",
  more: "Fler hjälpartiklar",
  hits: (count: number) => count === 0 ? "Inga träffar." : count === 1 ? "1 träff" : `${count} träffar`,
  noHits: "Pröva ett annat ord. Hittar du inte svaret: skicka ett mejl.",
  about: "Om O-Tid",
  contact: "Frågor om O-Tid:",
  newTab: "öppnas i ny flik"
} as const;

export const helpArticles: readonly HelpArticle[] = [
  {
    id: "skapa-tavling",
    title: "Skapa en tävling och välj typ",
    views: ["EVENTS", "SETTINGS"],
    body: [
      "Gå till ”Mina tävlingar”. Skriv ”Tävlingens namn” och ”Datum” under ”Skapa tävling”. ”Etapp/lopp (valfritt)” kan stå tomt.",
      "Välj ”Typ av tävling”. Typen styr vilka steg som syns i arbetsytan:",
      [
        "”Träning”: fri start, banor och klasser på samma ställe.",
        "”Liten tävling”: klasser, anmälda och starttider utan lottning.",
        "”Tävling”: lottning, import, speaker och fastställda resultat.",
        "”Tävling med gafflade banor”: som Tävling, med banvarianter.",
        "”Stafett”: lag och sträckor.",
        "”Rogaining”: kontroller med poäng och tidsgräns."
      ],
      "Tryck på ”Skapa tävling”, så öppnas arbetsytan. Typen kan bytas under ”Inställningar” utan att något tas bort."
    ]
  },
  {
    id: "publicera",
    title: "Publicera tävlingen",
    views: ["PUBLISH", "SETTINGS"],
    body: [
      "En ny tävling syns bara för dig och andra med behörighet. Gå till steget ”Publicera” och tryck på ”Publicera tävlingen”.",
      "Då syns tävlingssidan för alla, och tävlingen finns på startsidan. Resultaten syns när löparna läser av.",
      "Med ”Förhandsvisa tävlingssidan” ser du sidan innan den är publicerad. ”Skriv ut QR-kod” ger en lapp att sätta upp vid start och mål.",
      "Startlistan publiceras för sig under ”Start”. ”Sluta publicera” döljer tävlingen igen."
    ]
  },
  {
    id: "banor",
    title: "Banor",
    views: ["COURSES"],
    body: [
      "Lägg till en bana med ”Ny bana”. Skriv ”Bannamn”, ”Klassnamn” och kontrollerna i ordning och tryck på ”Spara bana och klass”.",
      [
        "Banfil från Purple Pen, OCAD eller Condes: exportera banorna som IOF XML 3.0 och välj ”Läs in banfil”. Du ser skillnaderna innan något sparas.",
        "”Redigera”: rätta en bana, även när löpare har läst ut. Tryck på ”Visa vad som händer” och ”Spara ändringen”. Resultaten räknas om.",
        "”Ta bort bana”: går när ingen klass springer banan och inga resultat finns."
      ]
    ]
  },
  {
    id: "klasser",
    title: "Klasser",
    views: ["CLASSES", "COURSES"],
    body: [
      "En klass springer en bana. Skapa en klass med ”Ny klass”, välj ”Bana” och ”Startsätt” och tryck på ”Spara klass”.",
      "”Fri start” betyder att löparen stämplar start. ”Minutstart” betyder en fast starttid, lottad eller satt för hand.",
      "Ändra namn, bana, startsätt eller maxtid med ”Redigera” i raden. Resultaten räknas om när du sparar.",
      "En klass kan bara tas bort när den är tom."
    ]
  },
  {
    id: "anmalda",
    title: "Anmälda",
    views: ["ENTRIES", "SETTINGS"],
    body: [
      "Lägg till en löpare i taget med ”Ny deltagare”. Välj klass, skriv namn och gärna bricka, och tryck på ”Lägg till”. Formuläret står kvar för nästa.",
      "Eventor finns för Tävling, Tävling med gafflade banor och Stafett, under ”Inställningar” → ”Eventor”:",
      [
        "Spara klubbens API-nyckel och välj tävlingen med ”Visa klubbens tävlingar”.",
        "”Hämta från Eventor” hämtar klasser och anmälda. Du ser skillnaderna innan något sparas.",
        "”Byt tävling” om det blev fel tävling. ”Uppdatera från Eventor” när anmälningarna ändras.",
        "”Uppdatera löpardatabasen från Eventor” ger ”Förslag ur löpardatabasen” när du skriver ett namn."
      ],
      "Klicka på en löpare i listan för att öppna deltagarkortet. Där ändrar du namn, klass, bricka och status."
    ]
  },
  {
    id: "start",
    title: "Start och lottning",
    views: ["START"],
    body: [
      "Under ”Lottning” väljer du startsätt per klass och kryssar i klasserna. Skriv ”Första start (klockslag)” och tryck på ”Visa lottning”. Är det rätt: ”Spara lottningen”.",
      [
        "”Avancerat”: startordning, senare start för en klass, max starter per minut och seedning.",
        "”Fri start”: klassen får inga starttider. Löparna stämplar start.",
        "”Flytta starttider” under ”Startlistan”: flytta alla tider i en klass, till exempel när starten kom igång sent.",
        "”Publicera startlistan”: listan syns för alla. Publicera igen efter ändringar.",
        "”Uppdatera startlistan löpande”: ändringar syns direkt utan ny publicering.",
        "”Visa bricknummer i den publika startlistan” och ”Kort info om tävlingen” finns under ”Inställningar” → ”Information till löparna”."
      ]
    ]
  },
  {
    id: "avlasning",
    title: "Avläsning med station",
    views: ["READOUT_PAGE", "READOUT"],
    body: [
      "Öppna avläsningen med ”Öppna avläsningen”. Ha den i en egen flik och byt sida i en annan flik, så kopplas stationen inte från.",
      [
        "Dator: sätt i stationen och tryck på ”Anslut SPORTident-station”. Använd Chrome eller Edge.",
        "Mac: installera drivrutinen CP210x VCP från Silicon Labs och tillåt den under Systeminställningar. Annars syns ingen station.",
        "Android-platta: använd Chrome och tryck på ”Anslut via USB (läsplatta)”. iPhone och iPad går inte.",
        "Nästa gång ansluter sidan själv till samma station. ”Sluta ansluta automatiskt” stänger av det.",
        "”Ljud vid avläsning”: tre stigande toner vid godkänt och tre fallande vid fel.",
        "Använd inte ett privat fönster. Då kan avläsningar försvinna när fönstret stängs."
      ],
      "Avläsningen fungerar utan nät. Avläsningarna sparas i webbläsaren och skickas när nätet kommer tillbaka.",
      "Vill du prova utan station: ”Starta övningsstation”. Den skriver riktiga avläsningar, så använd den inte under tävlingen."
    ]
  },
  {
    id: "okand-bricka",
    title: "Okänd bricka, direktanmälan och lånad bricka",
    views: ["READOUT_PAGE", "READOUT"],
    body: [
      "Är brickan inte anmäld visar avläsningen ”OKÄND BRICKA”. Fyll i klass och namn under beskedet och tryck på ”Lägg till”. Det fungerar utan nät.",
      [
        "Finns brickan i löpardatabasen fylls namn och klubb i.",
        "Redan anmäld utan bricka: välj löparen under ”Är det någon som redan är anmäld?”.",
        "Lånad bricka (brickan har lästs ut för någon annan): anmäl den som sprang. Samma löpare igen: ”Det är samma löpare – använd den nya avläsningen”.",
        "I arbetsytan: ”Avläsning” → ”Okända brickor”. Koppla till en anmäld eller välj ”Ny direktanmälan”."
      ]
    ]
  },
  {
    id: "nodlagen",
    title: "Nödlägen under tävlingen",
    views: ["READOUT", "RESULTS", "ENTRIES"],
    body: [
      "Under ”Avläsning” → ”Rättningar för hela tävlingen”:",
      [
        "”Justera tid för en station”: när en enhet haft fel klocka. Tiden ändras för alla som stämplat där.",
        "”Kontroll ur funktion”: kontrollen krävs inte på någon bana."
      ],
      "Tryck på ”Visa vad som händer” och sedan ”Spara och räkna om”. Allt kan tas bort igen.",
      "För en löpare, i deltagarkortet:",
      [
        "”Ange tid manuellt”: när mål eller start saknas, eller brickan är borttappad.",
        "”Godkänn saknade kontroller”: när löparen bevisligen varit vid kontrollen."
      ],
      "Stämmer avläsningarna inte efter en uppdatering av O-Tid: ”Läs om avläsningar från rådata”. Den gamla avläsningen sparas alltid."
    ]
  },
  {
    id: "status",
    title: "Ej start, brutit, disk och andra statusval",
    views: ["ENTRIES", "READOUT", "RESULTS"],
    body: [
      "Öppna löparens deltagarkort. Välj under ”Ändra status” och tryck på ”Bekräfta ändringen”.",
      [
        "”Ej start”: löparen startade inte.",
        "”Brutit”: löparen bröt loppet.",
        "”Diskvalificera”: med en orsak om du vill.",
        "”Utom tävlan”: tiden visas men löparen placeras inte.",
        "”Deltog utan tid”: för den som sprang utan bricka. Visas sist i klassen."
      ],
      "Ett beslut tas bort under ”Ändra status” igen. Efter tävlingen kan du välja ”Markera alla kvar i skogen som ej start” under ”Resultat” → ”Efterarbete”."
    ]
  },
  {
    id: "resultat",
    title: "Resultat och export",
    views: ["RESULTS"],
    body: [
      "Resultaten räknas automatiskt när löparna läser av. Listorna kan skrivas ut med ”Skriv ut” och laddas ner med ”Exportera” (”IOF XML” eller ”CSV (Excel)”).",
      [
        "”Resultaten är klara”: när alla är i mål och allt stämmer. Listorna visar då Officiella resultat. Finns inte för Träning, Liten tävling och Rogaining.",
        "”Ladda ner IOF-fil för Eventor”: filen att ladda upp i Eventor.",
        "”Gör resultaten preliminära igen”: ångrar.",
        "”Exportera tävlingen” under ”Inställningar”: allt om tävlingen i en fil. Spara den efter tävlingen."
      ]
    ]
  },
  {
    id: "funktionarer",
    title: "Funktionärer",
    views: ["SETTINGS", "EVENTS"],
    body: [
      "En funktionär läser av, direktanmäler, följer kvar i skogen, sköter starten och ser speakersidan. Inget annat.",
      "Funktionären ser deltagarnas och gästernas fulla namn, klubb och bricka och kan ladda ner festens köp (”Ladda ner summering (CSV)”), så ge behörigheten bara till personer du litar på.",
      "Personen skapar först ett eget konto. Gå sedan till ”Inställningar” → ”Personer med behörighet”.",
      "Skriv personens e-postadress under ”Lägg till person”, välj ”Funktionär” och tryck på ”Lägg till”. Personen ser tävlingen under ”Mina tävlingar”.",
      "”Ta bort” tar bort behörigheten direkt."
    ]
  },
  {
    id: "live",
    title: "Live, speaker och kvar i skogen",
    views: ["READOUT", "RESULTS", "PUBLISH"],
    body: [
      "Live finns på tävlingssidan när tävlingen är publicerad. Där syns senast i mål, ledare per klass och radiokontroller. Publiken kan följa löpare och klubbar.",
      "Speakersidan öppnas med ”Öppna speaker” i arbetsytans toppbalk. Den finns för Tävling, Tävling med gafflade banor och Stafett och uppdateras av sig själv.",
      "”Kvar i skogen” under ”Avläsning” visar anmälda som inte har läst ut. Hela listan med utskrift finns under ”Kvar i skogen – hela listan, manuell återkomst och utskrift”.",
      "Stäm alltid av med målet innan ni slutar leta efter löpare."
    ]
  },
  {
    id: "radio",
    title: "Radiokontroller",
    views: ["SETTINGS", "RESULTS"],
    body: [
      "Mellantider från radiokontroller i skogen kommer via ROC eller OResults. Det finns inte för Träning och Rogaining.",
      "Gå till ”Inställningar” → ”Radiokontroller”. Slå på ”Hämta radiostämplingar”, välj ”Källa” och skriv ”ROC-id”.",
      "Bocka för kontrollerna som skickar stämplingar och tryck på ”Spara”. ”Hämta nu” provar anslutningen.",
      "På tävlingsdagen hämtas stämplingarna av sig själv. Avläsningen i mål avgör fortfarande resultatet."
    ]
  },
  {
    id: "si-enheter",
    title: "SPORTident-enheter före tävlingen",
    views: ["READOUT_PAGE", "READOUT", "START"],
    body: [
      "Gör det här dagen före eller i god tid före start:",
      [
        "Ställ rätt tid och datum i alla enheter, med SPORTident Config+.",
        "Ställ avläsningsstationen i läget avläsning (Readout).",
        "Ha enheter för töm (clear) och kontroll (check) vid start, så att gamla stämplingar inte följer med.",
        "Spring en testbricka genom start, alla kontroller och mål. Läs av den och se att tiderna stämmer."
      ],
      "Går stationens klocka fel visar avläsningen en varning. Märker du det under tävlingen: använd ”Justera tid för en station”."
    ]
  },
  {
    id: "fest-bardisk",
    title: "Fest och bardisk",
    views: ["PARTY", "READOUT_PAGE", "EVENTS"],
    body: [
      "Välj typen ”Fest”. Sätt festens start och lägg in varorna: en kontrollenhet per pris, med kod, namn och pris i kronor.",
      "Gästerna stämplar själva på enheten med rätt pris och sätter sedan brickan i bardisken.",
      [
        "Första utläsningen checkar in gästen. Okänd bricka: gästen väljer sitt namn eller skriver det.",
        "Senare utläsningar visar de nya köpen sedan förra gången och kvällens summa.",
        "Målenheten checkar ut gästen när det är dags att gå hem.",
        "”Personal” har lägena ”Checka in”, ”Köp/verifiera” och ”Checka ut” för rättningar."
      ],
      "Köpen sparas på brickan och i plattan även utan nät, och glömda köp kommer med nästa gång.",
      "I arbetsytan ser du summa per person, ångrar ett köp med orsak och laddar ner CSV för Excel."
    ]
  },
  {
    id: "sjalvregistrering",
    title: "Självregistrering på tävlingsdagen",
    views: ["PARTY", "SETTINGS", "PUBLISH"],
    body: [
      "Med ”Tillåt självregistrering på tävlingsdagen” kan vem som helst koppla sitt namn till sin bricka på den publika sidan, utan att logga in.",
      "För en fest finns valet i delen Fest, för andra typer under Inställningar. Det är av som standard.",
      "Formuläret ”Registrera din pinne” syns bara när valet är på, tävlingen är publicerad och det är tävlingsdagen (en fest även natten efter, till kl 06).",
      [
        "Fest: gästen får sitt namn på brickan, och bardisken känner igen den inom några sekunder.",
        "Andra typer: löparen väljer klass och blir anmäld med brickan; en okänd avläsning av brickan bedöms direkt.",
        "En bricka som redan hör till någon avvisas, och inget skrivs över."
      ],
      "Självregistrerade märks ”Självregistrerad” i deltagarlistan och gästlistan. Där kan du ändra namnet eller, på en fest, välja ”Koppla bort pinnen”."
    ]
  }
];
