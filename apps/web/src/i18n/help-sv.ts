import type { SectionId } from "../lib/race-sections";
import { archiveHelpArticles, routeChoiceHelpArticles } from "./help-archive-route-sv";
import { courseSettingHelpArticles, gettingStartedHelpArticles, levelHelpArticles } from "./help-course-setting-sv";
import { fieldPrintHelpArticles } from "./help-print-sv";
import { clubHelpArticles } from "./help-club-sv";
import { accountHelpArticles } from "./help-account-sv";
import { plural } from "./plural";

/**
 * Hjälpen i programmet (PLAN.md steg 37). Enkel svenska och korta meningar. Knappar och vägar står inom ”…” och heter
 * exakt som i UI-texterna; `help-sv.test.ts` slår upp varje citat i i18n-filerna. Skriv inget annat inom ”…”.
 * En länk till en annan artikel skrivs `[text](#artikel-id)`; testet kontrollerar att artikeln finns.
 *
 * Artiklarna om banläggningen, utskriften, vägvalen och klubbarkivet ligger i `help-*-sv.ts` bredvid. En gren som ändrar
 * en funktion lägger till eller ändrar ett stycke i artikeln om funktionen (en punkt eller ett stycke per sak).
 */

/** Banläggningens flikar, fältläget och sidorna runt editorn. */
export type CourseSettingHelpView = "COURSE_SETTING" | "CS_START" | "CS_COURSES" | "CS_DESCRIPTION" | "CS_SELECTED" | "CS_OBJECTS"
  | "CS_TRAINING" | "CS_PRINT" | "CS_CHECKS" | "CS_NOTES" | "CS_INSPECTIONS" | "CS_SUGGESTIONS" | "CS_SETTINGS" | "CS_FIELD"
  | "CS_PRINT_PAGE" | "CS_DESCRIPTIONS_PAGE";

/** Klubbarkivets flikar och en träning i arkivet. */
export type ArchiveHelpView = "ARCHIVE_TRAININGS" | "ARCHIVE_MAPS" | "ARCHIVE_MEMBERS" | "ARCHIVE_CLUB" | "ARCHIVE_IMPORT" | "ARCHIVE_ENTRY";

/**
 * Vyn man står i: arbetsytans steg (även Fest), Mina tävlingar, avläsningssidan, banläggningens flikar, klubbarkivet,
 * kontrollkartan och dess läge Vägval.
 */
export type HelpView = SectionId | "EVENTS" | "READOUT_PAGE" | CourseSettingHelpView | ArchiveHelpView | "CONTROL_MAP" | "ROUTE_CHOICE";

/** Ett stycke, en punktlista eller en numrerad lista (Kom igång). */
export type HelpBlock = string | readonly string[] | { readonly steps: readonly string[] };

/** En hjälpartikel. `body`: ett stycke per sträng, en punktlista per lista, en numrerad lista per `steps`. */
export type HelpArticle = {
  id: string;
  title: string;
  views: readonly HelpView[];
  body: readonly HelpBlock[];
};

export const helpSv = {
  button: "Hjälp",
  title: "Hjälp",
  close: "Stäng",
  search: "Sök i hjälpen",
  searchPlaceholder: "Till exempel lottning, kartdef eller utskrift",
  here: "Hjälp för den här sidan",
  all: "Alla hjälpartiklar",
  more: "Fler hjälpartiklar",
  hits: (count: number) => count === 0 ? "Inga träffar." : plural(count, "träff", "träffar"),
  noHits: "Pröva ett annat ord. Hittar du inte svaret: skicka ett mejl.",
  about: "Om O-Tid",
  film: "Se filmen (1 min)",
  contact: "Frågor om O-Tid:",
  newTab: "öppnas i ny flik",
  /** Den lilla "?" vid en knapp eller ruta. */
  link: (title: string) => `Hjälp: ${title}`
} as const;

/**
 * Ord som betyder samma sak i sökningen (vikta som texten, se `help-search.ts`). Ett sökord som börjar med en stam i en
 * grupp träffar också texter med gruppens andra stammar.
 */
export const helpSynonyms: readonly (readonly string[])[] = [
  ["kartdef", "kontrollbeskrivning", "beskrivningen på kartan"],
  ["ppen", "purple pen", "purplepen"],
  ["gaffl", "variant", "grenar", "slinga"],
  ["bortvald", "bortval", "färre varianter", "begränsa varianter", "längst"],
  ["hänga", "hänger", "utsättning", "sätta ut", "fältläge", "fältet"],
  ["tryck", "utskrift", "skriv ut", "pdf"],
  ["offline", "utan nät"],
  ["vägval", "rutt", "kalibrer"],
  ["arkiv", "klubbarkiv"],
  ["klubbyta", "klubbarkiv", "klubbtillhörighet", "mina klubbar"]
];

const raceDayHelpArticles: readonly HelpArticle[] = [
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
        "”Tävling”: lottning, import, speaker och fastställda resultat. Gafflade banor ger banvarianter.",
        "”Stafett”: lag och sträckor.",
        "”Rogaining”: kontroller med poäng och tidsgräns."
      ],
      "Tryck på ”Skapa tävling”, så öppnas arbetsytan. Typen kan bytas under ”Inställningar” utan att något tas bort.",
      "Har klubben ett klubbarkiv kan du ta kartan med ”Välj karta från klubbarkivet” innan du trycker på ”Skapa tävling”; då öppnas banläggningen med kartan."
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
      "Lägg till en bana med ”Ny bana”. Skriv ”Bannamn” och kontrollerna i ordning och tryck på ”Spara bana”. Fyll i ”Klassnamn (valfritt)” om en klass ska springa banan direkt; knappen heter då ”Spara bana och klass”. Annars lägger du till klassen under Klasser.",
      [
        "Banfil från Purple Pen, OCAD eller Condes: exportera banorna som IOF XML 3.0 och välj ”Läs in banfil”. Du ser skillnaderna innan något sparas.",
        "”Redigera”: rätta en bana, även när löpare har läst ut. Tryck på ”Visa vad som händer” och ”Spara ändringen”. Resultaten räknas om.",
        "”Ta bort bana”: går när ingen klass springer banan och inga resultat finns.",
        "Banläggningen, Fil: ”Ladda ned IOF XML (banor)” ger en banfil som från Purple Pen. MeOS och OLA läser den.",
        "OCAD: inget eget format från O-Tid. OCAD:s banläggning kan läsa samma IOF XML-fil. Till Purple Pen: ”Ladda ned .ppen”."
      ],
      "Vill du lägga banorna på kartan i O-Tid: se [Banläggningen: öppna den och läs in kartan](#banlaggning-start)."
    ]
  },
  {
    id: "traning",
    title: "Träningsformer i banläggningen",
    views: ["CS_TRAINING", "COURSES"],
    body: [
      "Fliken ”Träning” (eller knappen ”Träning” bland verktygen) gör vald bana till en träning. Välj banan överst först.",
      "Formerna gäller avsnitt av banan och kan läggas efter varandra, till exempel korridor till 4, bara kurvbild till 8 och fönster till mål.",
      [
        "”Korridor”: bara en remsa längs sträckorna syns, kantig eller mjuk. Bredden kan ändras per sträcka.",
        "”Kurvbild”, ”Fönster” och ”Utan karta”: ett filter längs en del av banan, cirklar runt kontrollerna eller sträckor utan karta.",
        "”Utanför avsnitten”: vad som syns runt avsnitten – hela kartan, vitt, tonat eller ett filter.",
        "”Kartan för hela banan”: ett filter som gäller överallt, t.ex. ”Bara kurvbild” eller ”Utan stigar”.",
        "”Sista säkra”: en mindre ring på sträckan. Den är inte en kontroll och syns inte i beskrivningen, längden eller avläsningen.",
        "”Område”: rita ett område med eget filter. Det kan gälla ”Den här banan” eller ”Alla banor”.",
        "”Stjärna”, ”Linje”, ”Keps” och ”Kartbitar”: stjärnbana, linjeorientering, kepsorientering i par och en liten karta per sträcka.",
        "”Spegel”: kartan och banan spegelvända i utskriften. Siffrorna går att läsa som vanligt; i banläggningen ritas kartan som vanligt."
      ],
      "”Visa träningen på kartan” visar före och efter. Utskriften och PDF:en har samma maskning i kartans färger; se [Utskrift och förhandsvisning](#utskrift).",
      "Träningen följer med i .ppen-filen men försvinner om filen sparas i Purple Pen. ”Ta bort träningen för banan” gör banan vanlig igen."
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
      "Eventor finns för Tävling och Stafett, under ”Inställningar” → ”Eventor”:",
      [
        "Spara klubbens API-nyckel och välj tävlingen med ”Visa klubbens tävlingar”.",
        "”Hämta från Eventor” hämtar klasser och anmälda. Du ser skillnaderna innan något sparas.",
        "”Byt tävling” om det blev fel tävling. ”Uppdatera från Eventor” när anmälningarna ändras.",
        "”Uppdatera löpardatabasen från Eventor” ger ”Förslag ur löpardatabasen” när du skriver ett namn."
      ],
      "Klicka på en löpare i listan för att öppna deltagarkortet. Där ändrar du namn, klubb och starttid, och under ”Rätta” allt som ändrar resultatet: status, tid, kontroller, klass, variant och bricka."
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
      "Under ”Avläsning” → ”Mer: verktyg för hela tävlingen” → ”Rättningar för hela tävlingen”:",
      [
        "”Justera tid för en station”: när en enhet haft fel klocka. Tiden ändras för alla som stämplat där.",
        "”Kontroll ur funktion”: kontrollen krävs inte på någon bana."
      ],
      "Tryck på ”Visa vad som händer” och sedan ”Spara och räkna om”. Allt kan tas bort igen.",
      "För en löpare finns allt under ”Rätta” i deltagarkortet, även via ”Rätta en löpare” och ”Öppna”:",
      [
        "”Ange tid manuellt”: när mål eller start saknas, eller brickan är borttappad.",
        "”Godkänn saknade kontroller”: när löparen bevisligen varit vid kontrollen.",
        "”Byt bricka” och ”Byt klass”: avläsningen följer med till rätt löpare och räknas om.",
        "”Mer”: rätta en enstaka stämplad mål- eller starttid och ta bort en sådan rättning."
      ],
      "Fel efter en uppdatering av O-Tid: ”Läs om avläsningar från rådata” under samma ”Mer”."
    ]
  },
  {
    id: "status",
    title: "Ej start, brutit, disk och andra statusval",
    views: ["ENTRIES", "READOUT", "RESULTS"],
    body: [
      "Öppna löparens deltagarkort och gå till ”Rätta”. Välj under ”Ändra status” och tryck på ”Bekräfta ändringen”.",
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
        "”Ladda ner säkerhetskopia” under ”Inställningar”: hela tävlingen i en fil. Ta den efter lottningen, före start och efter sista målgång.",
        "”Återställ tävling från säkerhetskopia” på Mina tävlingar: filen blir en ny tävling, också på en annan server."
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
      "Gå till ”Inställningar” → ”Personer med behörighet”.",
      "Skriv en eller flera e-postadresser under ”Lägg till person”, välj ”Funktionär” och tryck på ”Lägg till”.",
      "Personen får ett mejl med en länk och hamnar på tävlingen efter inloggningen (se [Inbjudningar med e-post](#inbjudningar)).",
      "”Ta bort” tar bort behörigheten direkt."
    ]
  },
  {
    id: "inbjudningar",
    title: "Inbjudningar med e-post",
    views: ["SETTINGS", "EVENTS", "ARCHIVE_MEMBERS"],
    body: [
      "När du bjuder in någon till en tävling, ett klubbarkiv eller en träningsgrupp sparas behörigheten för e-postadressen, och med e-post på servern får personen ett mejl med vem som bjöd in, till vad, rollen och en länk.",
      "Länken öppnar en sida med ”Skapa konto” (adressen ifylld och låst) och ”Logga in”.",
      "Behörigheten gäller när personen är inloggad med just den adressen och har bekräftat den, och sedan hamnar personen på tävlingen, i klubbarkivet eller i gruppen.",
      "Länken gäller i 14 dagar och ger ingenting själv, och sidan ser likadan ut oavsett om adressen redan har ett konto.",
      [
        "Listan visar när inbjudan skickades, eller ”inte skickad”.",
        "”Skicka igen” skickar ett nytt mejl med en ny länk; den förra slutar gälla. Det går högst några gånger i timmen till samma adress.",
        "Utan e-post på servern står ”Kopiera länken” i stället. Klistra in länken i ett eget mejl eller sms.",
        "”Ta bort” tar bort inbjudan, och länken visar då ”Inbjudan gäller inte längre”."
      ],
      "Flera adresser går på en gång, åtskilda med komma, mellanslag eller ny rad, och alla får samma roll och var sitt mejl.",
      "Inbjudningar ”Från klubben” mejlas på samma sätt, men du ser bara personens namn."
    ]
  },
  {
    id: "live",
    title: "Live, speaker och kvar i skogen",
    views: ["READOUT", "RESULTS", "PUBLISH"],
    body: [
      "Live finns på tävlingssidan när tävlingen är publicerad. Där syns senast i mål, ledare per klass och radiokontroller. Publiken kan följa löpare och klubbar.",
      "Speakersidan öppnas med ”Öppna speaker” i arbetsytans toppbalk. Den finns för Tävling och Stafett och uppdateras av sig själv.",
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
        "Målenheten checkar ut gästen när det är dags att gå hem. Samma målstämpling checkar inte ut igen.",
        "”Personal” har lägena ”Checka in”, ”Köp/verifiera” och ”Checka ut” för rättningar. Läget gäller nästa utläsning, sedan är bardisken automatisk igen.",
        "Samma vara igen är ett nytt köp om stämplingen kommer minst så många sekunder efter förra köpet som ”Dubbelstämpling inom (sekunder)” anger."
      ],
      "Köpen sparas på brickan och i plattan även utan nät, och glömda köp kommer med nästa gång.",
      "Övningsstationens köp räknas inte i summeringen.",
      "I arbetsytan ser du summa per person, ångrar ett köp med orsak, väljer ”Ta bort incheckning” eller ”Ta bort utcheckning” och laddar ner CSV för Excel."
    ]
  },
  {
    id: "rogaining",
    title: "Rogaining: kontroller med poäng",
    views: ["COURSES", "CS_COURSES"],
    body: [
      "I rogaining stämplar löparen valfria kontroller inom tidsgränsen. Resultatet är summan av kontrollernas poäng minus straffet för tid över gränsen.",
      [
        "Poängen följer kontrollkodens första siffra: 31 ger 3 poäng, 52 ger 5 och 102 ger 10. Så föredrar IRF:s regel C9 det.",
        "Lägg banorna i ”Banläggning”: nya banor blir poängbanor. Ett tomt poängfält betyder kodens första siffra.",
        "Skriv en annan poäng i fältet för kontroller som ska ge mer eller mindre.",
        "”Överför till tävlingen …” tar med poängen. Ändrade poäng står som egna rader innan du godkänner.",
        "Under ”Kontroller & poäng” går poängen att ändra efteråt, och där sätts klassernas tidsgräns och straff."
      ],
      "Har någon redan läst ut visar O-Tid vilka resultat som ändras innan poängen sparas."
    ]
  },
  {
    id: "sjalvregistrering",
    title: "Självregistrering på tävlingsdagen",
    views: ["PARTY", "SETTINGS", "PUBLISH"],
    body: [
      "Med ”Tillåt självregistrering på tävlingsdagen” kan vem som helst koppla sitt namn till sin bricka på den publika sidan, utan att logga in.",
      "För en fest finns valet i delen Fest, för andra typer under Inställningar. Det är av som standard.",
      "Formuläret ”Registrera din bricka” syns bara när valet är på, tävlingen är publicerad och det är tävlingsdagen (en fest även natten efter, till kl 06).",
      [
        "Fest: gästen får sitt namn på brickan, och bardisken känner igen den inom några sekunder.",
        "Andra typer: löparen väljer klass och blir anmäld med brickan; en okänd avläsning av brickan bedöms direkt.",
        "En bricka som redan hör till någon avvisas, och inget skrivs över."
      ],
      "Självregistrerade märks ”Självregistrerad” i deltagarlistan och gästlistan. Där kan du ändra namnet eller, på en fest, välja ”Koppla bort brickan”."
    ]
  }
];

export const helpArticles: readonly HelpArticle[] = [...raceDayHelpArticles, ...gettingStartedHelpArticles, ...courseSettingHelpArticles, ...levelHelpArticles,
  ...fieldPrintHelpArticles, ...routeChoiceHelpArticles, ...archiveHelpArticles, ...clubHelpArticles, ...accountHelpArticles];
