/** ADR-0180 beslut 14: paletten med objekt, vridning, kopia av bana, fångst av befintliga kontroller och gafflingarna. */
const list = (codes: readonly string[]) => codes.length <= 12 ? codes.join(", ") : `${codes.slice(0, 12).join(", ")} och ${codes.length - 12} till`;

export const courseSettingUxSv = {
  palette: {
    button: "Objekt",
    label: "Objekt – specialobjekt som förbjudet område, passage och text",
    heading: "Lägg till objekt",
    close: "Stäng",
    groups: { passages: "Passager och kartbyte", barriers: "Spärrar", service: "Service", graphics: "Text och grafik" },
    items: {
      ADD_CROSSING: ["Obligatorisk passage", "Ingår i banan men numreras inte. Löparen måste passera här."],
      ADD_MAP_EXCHANGE: ["Kartbyte", "Ingår i banan. Löparen byter karta här."],
      "optional-crossing-point": ["Valfri passage", "Ingår inte i banan. Visar var man får passera, t.ex. en grind; alla eller valda banor."],
      "out-of-bounds": ["Förbjudet område", "Rastrerad yta som inte får beträdas. Klicka i hörnen."],
      "forbidden-route": ["Förbjuden väg", "Kryss på en väg eller stig som inte får följas."],
      boundary: ["Gräns", "Linje som inte får passeras, t.ex. ett staket som ska följas runt."],
      "dangerous-area": ["Farligt område", "Yta med fara, t.ex. en brant som ska undvikas."],
      "temporary-construction": ["Tillfällig konstruktion", "Yta som inte får passeras, t.ex. ett tält eller en scen."],
      water: ["Vatten", "Vätskekontroll utanför banans kontroller."],
      "first-aid": ["Första hjälpen", "Sjukvård eller första hjälpen."],
      text: ["Text", "Text på kartan, t.ex. banans namn eller en varning."],
      image: ["Bild", "En bild från datorn, t.ex. klubbens logotyp."],
      line: ["Linje", "Fri linje i lila, svart eller egen färg."],
      rectangle: ["Rektangel", "Ram, t.ex. runt en förstoring."],
      ellipse: ["Ellips", "Ring eller oval."],
      "white-out": ["Vit bakgrund", "Täcker kartan under text eller beskrivning."],
      descriptions: ["Beskrivningen på kartan", "Banans kontrollbeskrivning tryckt på kartan."],
      "registration-mark": ["Passmärke", "Kors för att passa in flera tryck."]
    } as Record<string, readonly [string, string]>,
    imagePick: "Välj bild",
    imageHelp: "Välj en bild (PNG eller JPEG, högst 1 MB) och klicka sedan på kartan där dess övre vänstra hörn ska stå.",
    imageTooLarge: "Bilden är större än 1 MB.",
    imageFailed: "Bilden gick inte att läsa.",
    imageReady: (name: string) => `Klicka på kartan där ${name} ska stå.`
  },
  crossing: {
    tooltip: "Obligatorisk passage – ingår i banan och numreras inte; löparen måste passera. Valfri passage finns under Objekt.",
    short: "Obl. passage"
  },
  rotate: {
    heading: "Vinkel",
    label: "Vinkel (grader moturs)",
    alongLeg: "Vrid efter sträckan",
    noLeg: "Ingen sträcka går genom passagen.",
    help: "Dra i handtaget ↻ på kartan. Vinkeln fäster i steg om 5°; håll Skift (eller ett andra finger) för fri vinkel."
  },
  snap: {
    insert: (label: string) => `Lägg in ${label}`,
    forceNew: "Alltid ny",
    forceNewHelp: "Skapa en ny kontroll även nära en befintlig (eller håll Alt).",
    ghostsHelp: "Kontroller som inte är med i banan syns svagt; klicka i en ring för att lägga in den."
  },
  view: {
    button: "Visa",
    heading: "Visa på kartan",
    otherCourses: "Visa andra banor svagt",
    unused: (count: number) => `Markera oanvända kontroller (${count})`,
    inspected: "Kollade kontroller",
    notes: "Notiser",
    warnings: "Markera varningar",
    /** ADR-0212: nivåstödets märken (syns bara efter "Bedöm nivån"). */
    levels: "Nivåmarkeringar"
  },
  courses: {
    duplicate: "Duplicera",
    copyName: (name: string) => `${name} (kopia)`,
    removeHeading: (name: string) => `Ta bort banan ${name}?`,
    removeOrphans: (count: number) => count === 1 ? "En kontroll används inte längre i någon annan bana:"
      : `${count} kontroller används inte längre i någon annan bana:`,
    removeNone: "Alla kontroller i banan används i andra banor och finns kvar.",
    removeWithControls: (count: number) => count === 1 ? "Ta bort banan och den oanvända kontrollen" : `Ta bort banan och de ${count} oanvända kontrollerna`,
    removeOnly: "Ta bort bara banan",
    cancel: "Avbryt"
  },
  controls: {
    heading: "Kontroller",
    courseHeading: (name: string) => `Kontroller i ${name}`,
    empty: "Inga kontroller än. Välj Kontroll i verktygen och klicka på kartan.",
    onlyUnused: "Bara oanvända",
    unusedCount: (count: number) => count === 1 ? "1 oanvänd" : `${count} oanvända`,
    noUnused: "Alla kontroller används i någon bana.",
    unused: "oanvänd",
    removeUnused: "Ta bort alla oanvända",
    removeUnusedConfirm: (codes: readonly string[]) => `Ta bort ${codes.length === 1 ? "den oanvända kontrollen" : `de ${codes.length} oanvända kontrollerna`}: ${list(codes)}?`,
    removed: (count: number) => count === 1 ? "En oanvänd kontroll borttagen." : `${count} oanvända kontroller borttagna.`
  },
  forks: {
    forkHere: "Gaffla här",
    forkHelp: "Välj en kontroll på banan och sedan antal grenar eller slinga.",
    branches: (count: number) => `${count} grenar`,
    loop: "Slinga",
    loops: (count: number) => count === 1 ? "Slinga" : `${count} slingor`,
    branch: (letter: string) => `Gren ${letter}`,
    branchOf: (letter: string, count: number) => `Gren ${letter} av ${count}`,
    working: "Nya kontroller läggs i grenen.",
    next: "Nästa gren",
    done: "Klar",
    join: (label: string) => `Grenarna går ihop vid ${label}`,
    loopJoin: (label: string) => `Slingorna går tillbaka till ${label}`,
    emptyBranch: "tom",
    work: (letter: string) => `Arbeta i gren ${letter}`,
    variants: "Varianter",
    allVariants: "Alla grenar",
    variant: (controls: number, length: string) => `${controls} ${controls === 1 ? "kontroll" : "kontroller"} · ${length}`
  }
};
