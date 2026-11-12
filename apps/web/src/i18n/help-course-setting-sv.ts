import type { CourseLevel } from "@o-tid/course-setting";
import type { HelpArticle } from "./help-sv";

/**
 * Hjälpen för banläggningen (grenen hjalp-banlaggning): Kom igång, editorn, kontroller och banor, beskrivningar, varningar,
 * notiser och samarbetet. Samma regler som i `help-sv.ts`: knappar inom ”…” exakt som i UI-texterna, länkar `[text](#id)`.
 */

/** Två korta vägar med numrerade steg som länkar till de utförliga artiklarna. */
export const gettingStartedHelpArticles: readonly HelpArticle[] = [
  {
    id: "kom-igang-traning",
    title: "Kom igång: lägga en träning på 10 minuter",
    views: ["CS_START", "EVENTS", "COURSE_SETTING", "COURSES"],
    body: [
      "Från tom tävling till utskrivna kartor och avläsning. Klubbytorna och träningsgrupperna finns överst på ”Mina tävlingar” (”Mina klubbar”, ”Mina grupper”) och i menyn med ditt namn.",
      { steps: [
        "Skriv namn och datum på ”Mina tävlingar”, välj ”Träning” och tryck på ”Skapa tävling”. Se [Skapa en tävling](#skapa-tavling).",
        "Öppna ”Banläggning” och ladda upp kartfilen, eller ta den med ”Välj karta från klubbarkivet”. Se [Banläggningen och kartfilen](#banlaggning-start).",
        "Tryck på ”Börja med en tom banläggning” (eller ”Läs in .ppen” om banan finns i Purple Pen).",
        "Tryck på ”Ny bana” och välj ”Skala för banan” i banans egenskaper. Klicka ut kontrollerna, start och mål. Se [Kontroller och banor](#kontroller-banor).",
        "Korridor, kurvbild eller annan form: fliken ”Träning”. Se [Träningsformer](#traning).",
        "”Fil” → ”Utskrift av banor …” → ”Skriv ut på skrivare”. Se [Utskrift och förhandsvisning](#utskrift).",
        "Skriv klassen i banans fält ”Klasser (som i Purple Pen, t.ex. H21, D21)”.",
        "”Fil” → ”Överför till tävlingen …”. Sedan kan ni läsa av. Se [Överför banorna](#overfor) och [Avläsning](#avlasning)."
      ] }
    ]
  },
  {
    id: "kom-igang-purple-pen",
    title: "Kom igång: från Purple Pen till tävling",
    views: ["CS_START", "EVENTS", "COURSE_SETTING"],
    body: [
      "Banorna är lagda i Purple Pen och ska bli en tävling med kartor från tryckeriet:",
      { steps: [
        "Skapa en tävling av typen ”Tävling” på ”Mina tävlingar”.",
        "Öppna ”Banläggning” och ladda upp samma kartfil som i Purple Pen. Se [Banläggningen och kartfilen](#banlaggning-start).",
        "Tryck på ”Läs in .ppen”. Bara IOF XML: ”Banor” → ”Läs in banfil”. Se [Purple Pen, OCAD och IOF XML](#purple-pen).",
        "Gå igenom fliken ”Varningar” och fliken ”Beskrivning”. Se [Varningar](#varningar).",
        "”Fil” → ”Utskrift av banor …”: ”Färger för tryck”, en mall för alla banor och ”Skapa PDF för tryckeriet”. Se [PDF för tryck](#pdf-tryck).",
        "”Fil” → ”Överför till tävlingen …”: banorna och varianterna blir tävlingens. Se [Överför banorna](#overfor).",
        "Fortsätt med klasser, anmälda och lottning i arbetsytan. Se [Start och lottning](#start).",
        "Ska banorna tillbaka till Purple Pen: ”Fil och versioner …” → ”Ladda ned .ppen”."
      ] }
    ]
  }
];

export const courseSettingHelpArticles: readonly HelpArticle[] = [
  {
    id: "banlaggning-start",
    title: "Banläggningen: öppna den och läs in kartan",
    views: ["CS_START", "COURSE_SETTING", "COURSES"],
    body: [
      "Banläggningen öppnas med ”Banläggning” i arbetsytans sidopanel, under ”Meny” på telefonen eller med knappen ”Banläggning” på ”Mina tävlingar”.",
      "Den som bara ska lägga banor läggs till under ”Inställningar” → ”Personer med behörighet” med en av rollerna:",
      [
        "”Banläggning: ändra”: ändrar banorna direkt.",
        "”Banläggning: föreslå”: ändringarna blir ett förslag som någon godkänner.",
        "”Banläggning: läsa och kommentera”: ser banorna och skriver notiser."
      ],
      "Banorna ritas på kartfilen. Ladda upp den med ”Ladda upp kartfil (OCAD eller Mapper)”:",
      [
        "OCAD 8 till OCAD 2018 (.ocd) och Mapper (.omap, .xmap), högst 75 MB.",
        "OCAD 7 och äldre går inte: öppna kartan och spara den i nyare OCAD eller i Mapper.",
        "Kartfilen är densamma som under ”Karta och vägval” i arbetsytan.",
        "Saknar kartan georeferens sätter du tre punkter under ”Karta och vägval”. Positionen i fältläget behöver den.",
        "Finns kartan i klubbens arkiv: ”Välj karta från klubbarkivet” → ”Använd kartan”. Se [Dubbletter och versioner av kartor](#arkiv-dubbletter)."
      ],
      "Sedan: ”Läs in .ppen” från Purple Pen eller ”Börja med en tom banläggning”."
    ]
  },
  {
    id: "purple-pen",
    title: "Purple Pen, OCAD och IOF XML",
    views: ["CS_START", "COURSE_SETTING"],
    body: [
      "O-Tid läser och skriver Purple Pens fil (.ppen). Allt finns under ”Fil” → ”Fil och versioner …”:",
      [
        "”Läs in .ppen”: ersätter banläggningen. Den nuvarande sparas som en tidigare version.",
        "Det som O-Tid inte tolkar sparas orört och skrivs tillbaka, så filen kan gå fram och tillbaka.",
        "”Ladda ned .ppen”: banor, kontroller, beskrivningar, specialobjekt och tryckyta, att öppna i Purple Pen.",
        "Den inlästa filen finns kvar orörd och kan laddas ned igen.",
        "”Ladda ned IOF XML (banor)”: banfilen för MeOS, OLA och OCAD. En gafflad bana blir en bana per variant."
      ],
      "Att veta om fram och tillbaka:",
      [
        "Läses en ny fil in behålls tävlingens utskriftsprofiler, layoutmallar, ringklipp och papper, och träningen om filen saknar den.",
        "Papperets texter och bilder blir Purple Pens text- och bildobjekt, och beskrivningens plats följer med. Se [Papperet](#papperet).",
        "Träningsformerna följer med i .ppen men försvinner om filen sparas i Purple Pen."
      ],
      "OCAD: O-Tid skriver inget OCAD-format. Importera banorna i OCAD från IOF XML; kontrollerna hamnar rätt, men beskrivningar och specialobjekt följer inte med.",
      "En banfil i IOF XML (3.0 eller äldre 2.0.3 från OCAD och Condes) utan .ppen kan också bli banläggning:",
      [
        "”Banor” → ”Läs in banfil”: har tävlingen en kartfil erbjuds ”Lägg banorna i banläggningen”.",
        "Finns redan banor: ”Ersätt banläggningens banor …” och ”Ja, ersätt”. Den gamla banläggningen sparas som en tidigare version.",
        "”Använd igen” i klubbarkivet på en träning med bara banfil öppnar banläggningen med banorna direkt.",
        "Kontrollerna hamnar på samma ställe på kartfilen som i programmet som skrev filen. Start, mål, passager, poängbanor och klasser följer med.",
        "Varianter blir gafflingar eller slingor när det går exakt; annars blir varje variant en egen bana och beskedet säger det.",
        "Banfilen har inga kontrollbeskrivningar. Fyll i dem under fliken ”Beskrivning”."
      ]
    ]
  },
  {
    id: "kontroller-banor",
    title: "Kontroller och banor: verktygen",
    views: ["CS_COURSES", "CS_SELECTED", "COURSE_SETTING"],
    body: [
      "Verktygen står ovanpå kartan. Varje verktyg har en tangent:",
      [
        "”Välj” (V): klicka för att välja; dra en kontroll, ett nummer eller en brytpunkt för att flytta. På telefonen: tryck först, dra sedan.",
        "”Kontroll” (K), ”Start” (S) och ”Mål” (M): klicka på kartan. I en bana läggs kontrollen in efter vald kontroll.",
        "”Lägg in” (L): klicka på en befintlig kontroll för att ta med den i banan. Ett klick i en svag ring gör samma sak.",
        "”Brytpunkt” (B): välj en sträcka och klicka där linjen ska brytas. ”Rak sträcka” tar bort brytpunkterna.",
        "Delete tar bort, Escape avbryter, Ctrl/Cmd+Z ångrar och Ctrl/Cmd+Shift+Z gör om. Pilarna flyttar kartan."
      ],
      "Banorna och kontrollerna:",
      [
        "Fliken ”Banor”: ”Ny bana”, ”Döp om”, ”Duplicera” och ”Ta bort banan”. Dra banorna för att ändra ordningen.",
        "Fliken ”Vald”: vald kontroll med ”Kod”, ”Ta bort från banan” och ”Ta bort kontrollen”.",
        "En kontroll som flyttas flyttas i alla banor som har den.",
        "Drar du en sådan kontroll mer än 50 m i en bana frågar O-Tid: ”Flytta i alla banor”, ”Ny kontroll bara i” banan eller ”Avbryt”.",
        "En ny kontroll får nästa lediga kod; de andra banorna behåller den gamla. ”Flytta hit” i fältläget frågar likadant.",
        "”Kom ihåg för den här sessionen” hoppar över frågan. Gränsen och ”Fråga igen” finns under ”Flytta delade kontroller” i ”Inställningar”."
      ],
      "Mer: [Gaffling och slinga](#gaffling), [Passager och specialobjekt](#objekt), [Notiser](#notiser) och [Alla kontroller](#alla-kontroller)."
    ]
  },
  {
    id: "alla-kontroller",
    title: "Alla kontroller och oanvända kontroller",
    views: ["CS_COURSES"],
    body: [
      "Välj ”Alla kontroller” överst för att se varje kontroll med sin kod, oavsett bana.",
      "I en bana syns kontroller som inte är med svagt. Klicka i ringen med ”Kontroll” eller ”Lägg in” för att ta med den.",
      [
        "”Visa” på kartan: ”Visa andra banor svagt” och markera oanvända kontroller.",
        "Under ”Visa” släcks också ”Kollade kontroller” (gröna rutan), ”Notiser” och ”Markera varningar”, per webbläsare.",
        "”Bara oanvända” i listan visar kontroller som inte finns på någon bana.",
        "”Ta bort alla oanvända” städar bort dem efter en fråga."
      ]
    ]
  },
  {
    id: "gaffling",
    title: "Gaffling och slinga",
    views: ["CS_COURSES", "CS_SELECTED"],
    body: [
      "En gaffling delar banan i grenar som går ihop igen. En slinga går ut och tillbaka till samma kontroll. Varje löpare får en variant.",
      [
        "Välj kontrollen där banan delar sig och tryck på ”Gaffling” (G). Välj antal grenar eller ”Slinga”.",
        "Nya kontroller läggs i grenen som är vald. ”Nästa gren” byter gren och ”Klar” avslutar.",
        "Fliken ”Vald” har också ”Antal grenar”, ”Gaffling”, ”Slinga” och ”Ta bort gafflingen”.",
        "Listan i fliken ”Banor” visar grenarna. Tryck på en grens bokstav för att arbeta i den.",
        "”Varianter” i listan och väljaren överst visar varje variant med antal kontroller och längd."
      ],
      "Varianterna följer med när banorna förs över till tävlingen. En poängbana kan inte gafflas.",
      "Bokstäverna står kvar på sina grenar när en gren tas bort (A, C), så att tryckta kartor stämmer i tävlingen, och en ny gren får en bokstav som inte använts; i Purple Pen blir de i följd igen, men en fil som läses in här paras med O-Tids bokstäver.",
      "Blir det för många varianter, eller vissa för långa? Se [Färre varianter](#varianter)."
    ]
  },
  {
    id: "varianter",
    title: "Färre varianter",
    views: ["CS_COURSES"],
    body: [
      "Många gafflingar i följd ger många varianter, och vissa blir längre. Panelen ”Varianter” i fliken ”Banor” visar varianterna av en gafflad bana.",
      [
        "Tabellen har fågelväg, längd längs vägval, antal kontroller och skillnaden mot den kortaste i meter och procent.",
        "”Räkna längs vägval” räknar alla varianters sträckor på kartan. Sedan jämförs också längden längs vägval.",
        "Bocka ur ”Används” för att välja bort en variant för hand. Raden överst säger hur många som används."
      ],
      "”Begränsa varianter” föreslår vilka som ska bort. Välj sätt:",
      [
        "”Ta bort de längsta” (förval): de 3 längsta av dem som används tas bort. Redan bortvalda förblir bortvalda.",
        "Bara varianter som är längre i alla avseenden än en som blir kvar kan tas bort. Ordningen är längs vägval när den är räknad.",
        "”Längst i alla avseenden (alla)” tar bort alla sådana; med bara fågelvägen blir få kvar.",
        "”Tak: procent eller antal” med ”Högst % längre än kortaste” och ”Högst antal varianter” behåller de kortaste.",
        "”Förhandsgranska” visar vad som tas bort och varför. ”Avbryt” låter allt vara.",
        "Den enda varianten med en viss kontroll eller sträcka blir kvar. ”Använd alla varianter” tar tillbaka alla."
      ],
      "Bortvalda varianter förs inte över till tävlingen, lottas inte ut, skrivs inte i IOF XML och skrivs inte ut, inte heller som reserv. " +
        "Ändras banan i tävlingens baneditor kommer de inte tillbaka, och ett bortval som slutar stämma sägs där. " +
        "Avläsningen säger till om en löpare ändå sprungit en bortvald variant. Använd det för fulgaffling; en utjämnad gaffling eller stafett behöver alla varianter."
    ]
  },
  {
    id: "objekt",
    title: "Obligatorisk passage och specialobjekt",
    views: ["CS_OBJECTS", "CS_SELECTED"],
    body: [
      "”Obl. passage” (P) sätter en obligatorisk passage. Den ingår i banan, numreras inte och vrids efter sträckan.",
      "”Objekt” (O) öppnar paletten med allt annat:",
      [
        "Passager: ”Valfri passage” (t.ex. en grind) och ”Kartbyte”.",
        "Spärrar: ”Förbjudet område”, ”Förbjuden väg”, ”Gräns”, ”Farligt område” och ”Tillfällig konstruktion”.",
        "Service: ”Vatten” och ”Första hjälpen”.",
        "Text och grafik: ”Text”, ”Bild”, ”Linje”, ”Rektangel”, ”Ellips”, ”Vit bakgrund” och ”Passmärke”."
      ],
      "Att veta:",
      [
        "En yta eller linje: klicka i hörnen och avsluta med Enter, ”Klar” eller ett klick på första punkten.",
        "Fliken ”Objekt” listar objekten. Under ”Syns på” väljer du alla banor eller bara vissa.",
        "Spärrarna räknas med i vägvalen och i varningarna: en kontroll som går att nå runt ett förbjudet område varnas inte; se [Varningar](#varningar)."
      ]
    ]
  },
  {
    id: "banans-egenskaper",
    title: "Banans egenskaper: stigning, längd och poängbana",
    views: ["CS_COURSES"],
    body: [
      "Välj en bana. Dess egenskaper står under listan i fliken ”Banor”:",
      [
        "”Stigning (m)”: står i beskrivningen och på kartan. Tomt = ingen stigning.",
        "”Fast längd (m)”: ersätter den uträknade längden i beskrivningen, på kartan och i tävlingen.",
        "”Slag av bana”: ”Vanlig bana” eller ”Poängbana”. En poängbana tas i valfri ordning och kan inte gafflas.",
        "”Poäng” per kontroll på en poängbana. En poängbana har ingen uträknad längd.",
        "Tryck på ”Spara egenskaperna”."
      ],
      "”Vid kontrollen” väljer vad som står vid ringen: nummer, kod eller poäng.",
      "Banans längd är fågelvägen. ”Räkna längs vägval” ger också längden längs bästa vägvalen; se [Vägval i banläggningen](#vagval-strackan)."
    ]
  },
  {
    id: "kontrollbeskrivning",
    title: "Kontrollbeskrivning (kartdef)",
    views: ["CS_DESCRIPTION", "CS_SELECTED", "CS_DESCRIPTIONS_PAGE"],
    body: [
      "Fliken ”Beskrivning” visar vald banas kontrollbeskrivning. Klicka på en ruta (C–H) för att välja symbol, eller på en rad för att välja kontrollen.",
      [
        "Sök symbolen med namn, eller skriv mått direkt, t.ex. 2m eller 4x4. Pilarna och Enter väljer.",
        "”Senast använd” står överst. ”Ingen (töm rutan)” tömmer rutan.",
        "”Textrader”: ”Text före kontrollen” och ”Text efter kontrollen”, t.ex. följ snitseln.",
        "”Inställningar för beskrivningen”: ”Standard” (IOF 2004 eller 2018), ”Språk” och ”Visa”: symboler, text eller båda.",
        "Symbolerna hör till kontrollen och syns i alla banor som har den."
      ],
      "Utskrift och mer:",
      [
        "”Skriv ut beskrivningar”, eller ”Fil” → ”Kontrollbeskrivningar …”: beskrivningarna tätt på A4 att klippa ut. Skriv ut i 100 % skala.",
        "Beskrivningen på kartan placeras i förhandsvisningen: [Kontrollbeskrivningen på kartan](#beskrivning-pa-kartan).",
        "Förslag ur kartfilen: [Förslag på kontrollbeskrivning](#beskrivningsforslag)."
      ]
    ]
  },
  {
    id: "beskrivningsforslag",
    title: "Förslag på kontrollbeskrivning ur kartan",
    views: ["CS_DESCRIPTION", "CS_FIELD"],
    body: [
      "O-Tid läser kartfilen i ringen och föreslår objektet (kolumn D) och mer. Förslaget står under beskrivningen när en kontroll är vald.",
      [
        "Säkerheten står som säkert, troligt eller osäkert med en procentsats.",
        "”Godta” skriver in förslaget. ”Andra tolkningar” visar fler förslag.",
        "Godta alla tomma tar bästa förslaget för varje kontroll i vyn som saknar objekt.",
        "Peka på ett förslag så markeras objektet på kartan.",
        "Kontroller med förslag som inte är godtagna ritas ljusare i beskrivningen."
      ],
      "Förslagen kräver kartfilen. Står inget tydligt objekt i ringen: välj symbolerna själv. I fältläget står förslaget i raden nertill."
    ]
  },
  {
    id: "varningar",
    title: "Varningar",
    views: ["CS_CHECKS"],
    body: [
      "Fliken ”Varningar” räknas om efter varje ändring. Det här kontrolleras:",
      [
        "Kontroller för nära varandra. Är objektet (kolumn D) ifyllt avgörs det om objekten är lika eller olika.",
        "Samma kod på flera kontroller, och koder som kan läsas upp och ned.",
        "Samma kontroll två gånger i rad, och en sträcka genom en annan kontrolls ring.",
        "En kontroll i ett förbjudet eller farligt område eller en tillfällig konstruktion är fel.",
        "Korsar fågelvägen en spärr räknas vägvalet runt. Finns en väg runt är det ingen varning; ”Vald” visar omvägen.",
        "Finns ingen laglig väg runt spärren är det fel.",
        "Bana utan start eller mål, kontroll utan kod och kontroller som inte används på någon bana."
      ],
      "Så läser du listan:",
      [
        "Fel först, sedan varningar och notiser, i grupper per sort med antal.",
        "Siffran på fliken räknar fel och varningar som inte är godtagna.",
        "Samma sträcka på flera banor eller varianter står på en rad med banornas namn först.",
        "Ett klick på en rad visar den på kartan; en sträcka väljs på banan."
      ],
      "Är det meningen? Tryck på ”Godta”.",
      [
        "Raden flyttas till de godtagna längst ned. ”Ångra” tar tillbaka den.",
        "Gruppens knapp godtar alla av samma sort.",
        "Det sparas i banläggningen med ångra och versioner, och följer med när en ny .ppen läses in.",
        "Det gäller tills kontrollen eller området byts ut eller flyttas mer än 25 m.",
        "Samma kod, kod som saknas och bana utan start eller mål går inte att godta."
      ],
      "Varningarna stoppar ingenting.",
      "Ringarnas och linjernas mått mot standarden står under ”Inställningar” → ”Utseende”; se [Banans utseende](#utseende)."
    ]
  },
  {
    id: "notiser",
    title: "Notiser och kartfel",
    views: ["CS_NOTES", "CS_FIELD"],
    body: [
      "En notis är en kommentar på kartan, en kontroll, en sträcka eller en bana. Välj verktyget ”Notis” (N) och klicka där den ska sitta.",
      [
        "Skriv text och lägg gärna till ett foto. Tryck på ”Spara notisen”.",
        "I fliken ”Notiser”: ”Svara”, ”Klar” och ”Öppna igen”. Filtret visar ”Öppna”, ”Klara” eller ”Alla”.",
        "”Rita i en notis”: rita linjer eller ytor på kartan, t.ex. var snitseln ska gå.",
        "”Rita kartfel”: ett kartfel sitter på en punkt eller ritning, aldrig på en kontroll, så att det kan ges till kartritaren.",
        "”Kartfel till kartritaren …”: kartfelen utan banor och kontroller, att skriva ut eller ladda ned som GeoJSON.",
        "Där finns också ”Dela med kartritaren”: en länk som öppnas utan konto. Se [Dela kartfelen med kartritaren](#kartritarens-lank).",
        "”Redigera” på din egen notis eller ditt eget svar ändrar texten. Den visas sedan som ändrad, med tiden.",
        "”Ta bort” tar bort notisen med svar och foto. Det går inte att ångra."
      ],
      "I telefonen sätter ”Notis här” notisen på vald kontroll eller där du står. Se [Fältläget i telefonen](#faltlaget)."
    ]
  },
  {
    id: "kartritarens-lank",
    title: "Dela kartfelen med kartritaren",
    views: ["CS_NOTES", "CS_FIELD"],
    body: [
      "Kartritaren kan se kartfelen med en länk, utan konto och utan tillgång till tävlingen. Den som får ändra banläggningen skapar länken.",
      { steps: [
        "Öppna ”Kartfel till kartritaren …” i fliken ”Notiser”.",
        "Tryck på ”Dela med kartritaren”. Välj ”Begränsa tiden” om länken ska sluta gälla ett visst datum.",
        "Välj ”Visa tävlingens namn” om kartritaren ska se det. Annars står bara ”Kartfel” på sidan.",
        "Tryck på ”Skapa länken” och sedan ”Kopiera länken”. Länken visas bara den gången."
      ] },
      "Kartritaren ser kartan, kartfelen och trådarna, men inga banor, kontroller, foton eller deltagare.",
      "Kartritaren kan svara och trycka på ”Åtgärdat i kartan” eller ”Inte åtgärdat”. Svaren syns direkt i Kartfel och i banläggningen.",
      [
        "”Senast öppnad” visar när länken användes senast.",
        "”Stäng av länken” gäller direkt. ”Skapa ny länk” ger en ny länk och stänger den gamla.",
        "Ett kartfel nära en kontroll kan avslöja kontrollen. Skriv texten så att den inte gör det."
      ]
    ]
  },
  {
    id: "samarbete",
    title: "Flera banläggare samtidigt",
    views: ["CS_SETTINGS", "CS_SUGGESTIONS", "COURSE_SETTING"],
    body: [
      "Flera kan ha banläggningen öppen samtidigt. Överst står vilka som är inne nu, och andras ändringar syns direkt.",
      "”Inställningar” → ”Arbetssätt” → ”Hur ni arbetar” (bara administratörer ändrar):",
      [
        "”Huvudbanläggare”: de med ”Banläggning: ändra” ändrar direkt; de med ”Banläggning: föreslå” skickar förslag.",
        "”Gemensamt”: alla som får ändra gör det direkt, och notiserna används för diskussionen."
      ],
      "Ändrar två personer samma sak gäller den som sparade först. Det som inte gick att spara räknas upp i ett besked ovanpå kartan.",
      "Se också [Förslag från andra banläggare](#forslag) och [Sparande, versioner och ångra](#sparande)."
    ]
  },
  {
    id: "sparande",
    title: "Sparande, versioner och ångra",
    views: ["COURSE_SETTING", "CS_SETTINGS"],
    body: [
      "Allt sparas av sig självt. Statusen överst visar ”Sparat”, ”Ändrat – sparas strax” eller ”Inte sparat – försöker igen”.",
      [
        "”Ångra” och ”Gör om” gäller dina egna ändringar, också efter att sidan laddats om om ingen annan ändrat samma sak.",
        "”Fil” → ”Fil och versioner …” → ”Visa tidigare versioner”: varje sparad version med tid, namn och antal banor.",
        "”Återställ” tar tillbaka en version. Den nuvarande sparas först som en tidigare version, så inget försvinner.",
        "Versionen före en inläsning av .ppen sparas alltid.",
        "”Sparas inte – logga in igen”: logga in i en ny flik. Ändringarna väntar under tiden."
      ],
      "Sparande utanför kartan, till exempel när banfilens banor läggs i banläggningen:",
      [
        "Hann någon annan spara försöker O-Tid en gång till på den nya versionen, utan besked.",
        "Går det ändå inte står ”Ändringen sparades inte – försök igen.” vid det som inte sparades, med ”Försök igen”."
      ],
      "Fest och rogaining har också ”Banläggning”:",
      [
        "Rogaining: nya banor blir poängbanor. Tomt poängfält = kontrollkodens första siffra, och poängen följer med till tävlingen. Se [Rogaining](#rogaining).",
        "Fest: banläggningen ger kartor att skriva ut. ”Överför till tävlingen …” finns inte, festen har inga banor."
      ],
      "Se också [Flera banläggare samtidigt](#samarbete)."
    ]
  },
  {
    id: "forslag",
    title: "Förslag från andra banläggare",
    views: ["CS_SUGGESTIONS"],
    body: [
      "Med rollen ”Banläggning: föreslå” blir dina ändringar ett förslag. De syns bara hos dig tills du skickar förslaget.",
      [
        "Skicka: fliken ”Förslag”, skriv en kommentar och tryck på ”Skicka förslaget”. ”Kasta förslaget” tar bort det.",
        "Granska: tryck på ”Granska”. Förslaget ritas streckat ovanpå banan, med pilar för flyttade kontroller.",
        "Godkänn: ”Godkänn alla”, eller kryssa ur ändringar och godkänn bara de valda. ”Avböj” går att kommentera.",
        "Ändringar som inte går längre, för att någon annan ändrat samma sak, står under ”Går inte längre:”."
      ],
      "Den som får ändra banorna godkänner. ”Tidigare förslag” visar besluten."
    ]
  },
  {
    id: "utseende",
    title: "Banans utseende och ringklipp",
    views: ["CS_SETTINGS"],
    body: [
      "”Inställningar” → ”Utseende” gäller alla banor, på kartan och i utskriften. Måtten följer med till Purple Pen.",
      [
        "”Snabbval”: standardmått, förstorat i 1:10 000 (ungdom och äldre), större ringar eller mindre nummer.",
        "”Ringstorlek”, ”Linjebredd” och ”Nummerstorlek” som kvot mot standarden. ”Skalning” styr om måtten följer skalan.",
        "”Utanför standarden” varnar när ett mått avviker från ISOM eller ISSprOM.",
        "”Ringklipp”: klipp ringar där de överlappar och över viktiga detaljer som stigar och branter.",
        "”Gör klippen fasta (för Purple Pen)” sparar klippen över detaljer i kontrollerna, så att de följer med i .ppen."
      ]
    ]
  },
  {
    id: "overfor",
    title: "Överför banorna till tävlingen",
    views: ["COURSE_SETTING", "COURSES"],
    body: [
      "Banläggningen och tävlingens banor är två saker. Avläsningen och resultaten använder tävlingens banor.",
      "”Fil” → ”Överför till tävlingen …” → ”Överför till tävlingen”: banorna, kontrollerna och varianterna blir tävlingens. Du ser skillnaderna innan något sparas.",
      [
        "Varje bana behöver start och mål, och kontrollerna koder 1–999 999.",
        "Klasserna i banans fält ”Klasser (som i Purple Pen, t.ex. H21, D21)” skapas med fri start om de inte finns.",
        "En träning som inte har några klasser än får en klass per bana med banans namn, när ingen bana säger klasser.",
        "Ändrar du banorna efteråt: för över igen och titta på skillnaderna.",
        "Bara administratörer för över."
      ]
    ]
  }
];

/**
 * Nivåstödet (ADR-0212): artikeln om nivåerna och verktyget, och en kort guide per nivå för den som lägger sin första
 * bana ("Så lägger du en gul bana"). Källor: SOFT, "Klasser, svårighetsnivåer, beräknade segrartider samt banlängder"
 * (2022-03-25), och SOFT:s banläggarträff "Banläggningens grunder – svårighetsgrader" (2025). Banlängderna är SOFT:s för
 * medel- och långdistans; sprint har ingen färgskala.
 */
const SOURCE = "Källa: Svensk Orientering (SOFT): Klasser, svårighetsnivåer, beräknade segrartider samt banlängder (2022), och SOFT:s banläggarträff 2025.";

export const levelHelpArticles: readonly HelpArticle[] = [
  {
    id: "nivastod",
    title: "Nivåstöd – grön, vit, gul …",
    views: ["CS_COURSES", "COURSE_SETTING"],
    body: [
      "Svensk Orientering delar banorna i sju färgnivåer, från lättast till svårast: Grön, Vit, Gul, Orange, Violett, Blå och Svart.",
      [
        "Grön och Vit följer stigar och andra tydliga ledstänger. Gul får gena och kontrollen ligger en bit från stigen.",
        "Orange och Violett kräver mer kartläsning, men det ska finnas något tydligt att läsa in sig på.",
        "Blå och Svart är för de skickligaste. Höjdkurvor och detaljer avgör; Svart får vara tyngre fysiskt.",
        "Klasserna: H/D10 Vit, 12 Gul, 14 Orange, 16 Violett, 18–65 Svart, 70 och äldre Blå. Inskolning Grön, Mycket lätt Vit, Lätt Gul, Medelsvår Orange."
      ],
      "Så använder du nivåstödet:",
      [
        "Välj banans nivå i fältet ”Nivå” i banans egenskaper. Har banan klasser föreslås nivån ur dem.",
        "Tryck på ”Bedöm nivån” (eller ”Bedöm alla banor”). Inget räknas förrän du ber om det.",
        "Varje kontroll och sträcka får en nivå med skäl och ett tips. ”Visa på kartan” väljer den; ”Visa förslag på kartan” visar t.ex. närmaste stigkorsning.",
        "Ändrar du banan står det ”Inaktuell – bedöm igen”.",
        "Med ”Visa avvikelser mot nivån i Varningar” kommer avvikelserna som notiser, som kan godtas. ”Nivåmarkeringar” under ”Visa” släcker märkena på kartan."
      ],
      "Så mäter verktyget, bara ur kartans symboler och vägvalen:",
      [
        "Kontrollen: hur långt det är till närmaste stig eller ledstång, hur stort föremålet är och om det finns en angreppspunkt nära.",
        "Sträckan: hur mycket av vägvalet som följer ledstänger, hur långt det går utan, om det lönar sig att gena och om det krävs kurvläsning."
      ],
      "Det är ett stöd, inte en dom: du som banläggare avgör.",
      [
        "Verktyget ser inte sikt, löpbarhet eller hur tydlig en detalj är i verkligheten.",
        "Gränserna är stämda mot riktiga banor med kända nivåer. I skog med många stigar och diken blir svåra banor ofta bedömda något lägre.",
        "Sprint har ingen färgskala, så nivåstödet gäller inte sprintkartor.",
        SOURCE
      ],
      "Guider per nivå: [grön](#niva-gron), [vit](#niva-vit), [gul](#niva-gul), [orange](#niva-orange), [violett](#niva-violett) och [blå eller svart](#niva-bla-svart)."
    ]
  },
  {
    id: "niva-gron",
    title: "Så lägger du en grön bana",
    views: ["CS_COURSES"],
    body: [
      "Grön är för de allra yngsta och nya (Inskolning, ca 2 km). Löparen ska kunna följa stigen hela vägen.",
      [
        "Kontrollerna sitter på eller alldeles intill stigen, vägen, staketet eller den öppna marken, väl synliga.",
        "Sträckan följer en tydlig ledstång hela vägen. Ett byte vid kontrollen går bra; inte för många byten ute på sträckan.",
        "Inga vägval: det ska inte löna sig att gena genom skogen.",
        "Lägg en kontroll vid stigkorsningar där det annars är lätt att springa fel.",
        "Vanlig fallgrop: en kontroll bara 30 m in i skogen. Det är Vit eller svårare."
      ],
      "Se [Nivåstöd – grön, vit, gul …](#nivastod). Källa: SOFT 2022 och SOFT:s banläggarträff 2025."
    ]
  },
  {
    id: "niva-vit",
    title: "Så lägger du en vit bana",
    views: ["CS_COURSES"],
    body: [
      "Vit är för H/D10 och Mycket lätt (ca 2 km för H/D10 på medeldistans, 2,5 km på lång; Mycket lätt 2 eller 4 km).",
      [
        "Kontrollen får ligga vid sidan av stigen, högst ca 50 m, vid ett lätt och tydligt föremål: en sten eller en tydlig höjd.",
        "Det ska finnas ett tydligt stopp på stigen strax före kontrollen, och skärmen ska synas därifrån.",
        "Sträckorna följer ledstänger; de får vara mindre tydliga än på Grön, t.ex. diken, bäckar, stenmurar och beståndsgränser.",
        "Att gena över öppen mark mot en säker uppfångare går bra, högst ca 200 m.",
        "Vanlig fallgrop: en liten grop eller en liten höjd som föremål. Välj något större."
      ],
      "Se [Nivåstöd – grön, vit, gul …](#nivastod). Källa: SOFT 2022 och SOFT:s banläggarträff 2025."
    ]
  },
  {
    id: "niva-gul",
    title: "Så lägger du en gul bana",
    views: ["CS_COURSES"],
    body: [
      "Gul är för H/D12 och Lätt (ca 2,5 km för H/D12 på medeldistans, 3 km på lång; Lätt 2,5 eller 5 km).",
      [
        "Kontrollen kan sitta en bit från stigen. Föremålen får vara större sänkor, tydliga åsar, höjder och branter.",
        "Det ska löna sig att gena mellan två stigar, högst ca 150 m genom skogen, mot en säker uppfångare. Runtvägen längs stigen ska också finnas.",
        "En säker inläsningspunkt högst ca 200 m före kontrollen, och en tydlig uppfångare bakom.",
        "Lättframkomlig terräng: undvik tät skog, brant och stenig mark och svårlöpta hyggen.",
        "Vanlig fallgrop: sträckor där stigen går rakt mot kontrollen, så att genandet aldrig lönar sig. Då blir det en vit bana."
      ],
      "Se [Nivåstöd – grön, vit, gul …](#nivastod). Källa: SOFT 2022 och SOFT:s banläggarträff 2025."
    ]
  },
  {
    id: "niva-orange",
    title: "Så lägger du en orange bana",
    views: ["CS_COURSES"],
    body: [
      "Orange är för H/D14 och Medelsvår (ca 3 km för H/D14 på medeldistans, 4 km på lång; Medelsvår 3 eller 5 km).",
      [
        "Terrängen ska fortfarande vara lättframkomlig. Sankmarker, höjdkanter, åsar och sänkor ska kunna följas.",
        "Kontrollen är svårare än på Gul, men det ska alltid finnas tydliga föremål i närheten att läsa in sig på.",
        "Sträckorna får gå där ledstänger inte räcker: grovorientering över tydliga hållpunkter och i enkel kurvbild.",
        "Det behövs ingen uppfångare bakom kontrollen, men löparen ska kunna läsa in sig på rimligt avstånd.",
        "Vanlig fallgrop: en liten detalj långt från allt annat. Lägg den nära något tydligt."
      ],
      "Se [Nivåstöd – grön, vit, gul …](#nivastod). Källa: SOFT 2022 och SOFT:s banläggarträff 2025."
    ]
  },
  {
    id: "niva-violett",
    title: "Så lägger du en violett bana",
    views: ["CS_COURSES"],
    body: [
      "Violett är för H/D16 (ca 3,5 km på medeldistans, 5–5,5 km på lång).",
      [
        "All slags terräng går bra, men undvik mycket fysiskt krävande terräng och svårläst kartbild.",
        "Sträckorna är lika svåra som på Orange; det är kontrollerna som får vara svårare.",
        "Det ska gå att förenkla: ta kontrollen från ett håll där det finns något stort och tydligt (en angreppspunkt).",
        "Kontroller utan tydlig uppfångare och i detaljfattig terräng hör hit.",
        "Vanlig fallgrop: långa sträckor med kurvläsning i detaljrik terräng. Det är Blå eller Svart."
      ],
      "Se [Nivåstöd – grön, vit, gul …](#nivastod). Källa: SOFT 2022 och SOFT:s banläggarträff 2025."
    ]
  },
  {
    id: "niva-bla-svart",
    title: "Så lägger du en blå eller svart bana",
    views: ["CS_COURSES"],
    body: [
      "Blå och Svart är för de skickligaste: Blå för 70 och äldre och Svår 3 km, Svart för 18–65 och Svår 5 eller 7 km.",
      [
        "Att läsa höjdkurvor och detaljer är en stor fördel: grovorientering i svår kurvbild och finorientering i detaljrik terräng.",
        "Vägvalen får vara svåra att bedöma, med flera beslut per vägval och varierande löpbarhet.",
        "Svart får gå i all slags terräng; på Blå undviks den mest fysiskt krävande.",
        "Variera: blanda långa vägvalssträckor med korta sträckor med finorientering.",
        "Vanlig fallgrop: alla kontroller vid stora föremål nära stigar. Då blir banan för lätt."
      ],
      "Se [Nivåstöd – grön, vit, gul …](#nivastod). Källa: SOFT 2022 och SOFT:s banläggarträff 2025."
    ]
  }
];

const GUIDES: Readonly<Record<CourseLevel, string>> = {
  GRON: "niva-gron", VIT: "niva-vit", GUL: "niva-gul", ORANGE: "niva-orange", VIOLETT: "niva-violett", BLA: "niva-bla-svart", SVART: "niva-bla-svart"
};

/** Guiden för nivån, eller artikeln om nivåstödet när ingen nivå är vald. */
export function levelGuideArticle(level: CourseLevel | undefined): string {
  return level ? GUIDES[level] : "nivastod";
}
