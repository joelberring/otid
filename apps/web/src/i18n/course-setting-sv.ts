/** Steg 62 (ADR-0180): banläggningen i webben. Enkel svenska; kontroller nämns med kod ("kontroll 31"), inga interna id. */
const meters = (value: number) => value >= 10_000 ? `${(value / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(value)} m`;

export const courseSettingSv = {
  title: "Banläggning",
  back: "Tillbaka till tävlingen",
  /** Den som bara har banläggningen (ingen roll på tävlingen) går tillbaka till Mina tävlingar. */
  backToEvents: "Tillbaka till Mina tävlingar",
  backShort: "Tävlingen",
  backShortEvents: "Mina tävlingar",
  /** Fil-menyn: utskriftens sidor (ägaren 2026-11-03). */
  printMenu: "Utskrift av banor …",
  descriptionsMenu: "Kontrollbeskrivningar …",
  link: "Banläggning",
  linkHelp: "Lägg banorna på kartfilen i webbläsaren, eller läs in en .ppen från Purple Pen.",
  loading: "Hämtar banläggningen …",
  loadFailed: "Banläggningen kunde inte hämtas.",
  retry: "Försök igen",
  noMapFile: "Banläggningen ritas på kartfilen (OCAD eller Mapper). Ladda upp kartfilen först.",
  readingMap: "Läser kartfilen …",
  mapFailed: "Kartfilen kunde inte läsas i webbläsaren. Banorna går ändå att ändra.",
  mapSaved: "Kartfilen är sparad.",
  start: {
    heading: "Ingen banläggning än",
    help: "Läs in en .ppen-fil från Purple Pen eller börja med en tom banläggning på kartfilen.",
    empty: "Börja med en tom banläggning",
    emptyTitle: "Banläggning"
  },
  map: (course: string) => `Karta med banpåtryck: ${course}`,
  zoomIn: "Zooma in",
  zoomOut: "Zooma ut",
  fit: "Visa hela kartan",
  courses: {
    heading: "Banor",
    all: "Alla kontroller",
    allSummary: (count: number) => `${count} ${count === 1 ? "kontroll" : "kontroller"}`,
    summary: (length: string, controls: number, variants: number, excluded = 0) =>
      `${length} · ${controls} ${controls === 1 ? "kontroll" : "kontroller"}${variants > 1 || excluded > 0 ? ` · ${variants} ${variants === 1 ? "variant" : "varianter"}` : ""}` +
      (excluded > 0 ? ` (${excluded} bortvald${excluded === 1 ? "" : "a"})` : ""),
    length: (min: number, max: number) => min === max ? meters(min) : `${meters(min)}–${meters(max)}`,
    add: "Ny bana",
    addName: "Namn på ny bana",
    newName: (count: number) => `Bana ${count}`,
    rename: "Döp om",
    renameLabel: (name: string) => `Nytt namn på ${name}`,
    remove: "Ta bort banan",
    save: "Spara",
    cancel: "Avbryt",
    variant: "Variant",
    allVariants: "Alla grenar",
    /** ADR-0180 beslut 14: variantväljaren med antal kontroller. */
    variantOption: (code: string, controls: number) => `${code} · ${controls} ${controls === 1 ? "kontroll" : "kontroller"}`,
    classes: "Klasser (som i Purple Pen, t.ex. H21, D21)"
  },
  tools: {
    heading: "Verktyg",
    SELECT: "Välj och flytta",
    ADD_CONTROL: "Ny kontroll",
    ADD_START: "Ny start",
    ADD_FINISH: "Nytt mål",
    ADD_CROSSING: "Ny obligatorisk passage",
    ADD_MAP_EXCHANGE: "Nytt kartbyte",
    INSERT_EXISTING: "Lägg in befintlig kontroll",
    ADD_BEND: "Brytpunkt på sträcka",
    NOTE: "Ny notis",
    SPECIAL: "Specialobjekt (förbjudet område, valfri passage, text …)",
    /** ADR-0180 beslut 14: förklaringen i verktygets tooltip där namnet inte räcker. */
    title: {
      ADD_CROSSING: "Obligatorisk passage – ingår i banan och numreras inte; löparen måste passera. Valfri passage finns under Objekt",
      SPECIAL: "Objekt – passager, spärrar, service, text och grafik"
    } as Record<string, string>,
    /** Steg 66: korta etiketter i verktygsraden och tangenterna. */
    short: { SELECT: "Välj", ADD_CONTROL: "Kontroll", ADD_START: "Start", ADD_FINISH: "Mål", ADD_CROSSING: "Obl. passage",
      INSERT_EXISTING: "Lägg in", ADD_BEND: "Brytpunkt", NOTE: "Notis", FORK: "Gaffling", SPECIAL: "Objekt" } as Record<string, string>,
    shortcut: { SELECT: "V", ADD_CONTROL: "K", ADD_START: "S", ADD_FINISH: "M", ADD_CROSSING: "P", INSERT_EXISTING: "L", ADD_BEND: "B",
      NOTE: "N", FORK: "G", SPECIAL: "O" } as Record<string, string>,
    forkTool: "Gaffla här (vid vald kontroll)",
    forkNeedsSelection: "Välj en kontroll på banan först.",
    withKey: (label: string, key: string) => `${label} (${key})`,
    help: {
      SELECT: "Klicka för att välja. Dra en kontroll, ett nummer eller en brytpunkt för att flytta. Dra kartan för att panorera.",
      ADD_CONTROL: "Klicka på kartan där kontrollen ska stå. I en bana läggs den in efter vald kontroll; ett klick i en svag ring lägger in den befintliga kontrollen (Alt: alltid ny).",
      ADD_START: "Klicka där starten ska stå.",
      ADD_FINISH: "Klicka där målet ska stå.",
      ADD_CROSSING: "Klicka där den obligatoriska passagen ska stå. I en bana vrids den efter sträckan.",
      ADD_MAP_EXCHANGE: "Klicka där kartbytet ska stå. I en bana läggs det in efter vald kontroll.",
      INSERT_EXISTING: "Klicka på en kontrollring för att lägga in kontrollen i banan efter vald kontroll.",
      ADD_BEND: "Välj en sträcka och klicka där linjen ska brytas.",
      NOTE: "Klicka på kartan, en kontroll eller en sträcka där notisen ska sitta.",
      SPECIAL: "Välj slag under Objekt. En yta eller linje: klicka i hörnen och avsluta med Enter eller ett klick på första punkten."
    } as Record<string, string>,
    undo: "Ångra",
    redo: "Gör om",
    removeFromCourse: "Ta bort från banan",
    deleteControl: "Ta bort kontrollen",
    fork: "Gaffling",
    loop: "Slinga",
    removeSplit: "Ta bort gafflingen",
    branches: "Antal grenar",
    resetNumber: "Numret tillbaka",
    straighten: "Rak sträcka",
    keys: "Tangenter: Delete tar bort, Escape avbryter, Ctrl/Cmd+Z ångrar och Ctrl/Cmd+Shift+Z gör om. Pilarna flyttar kartan."
  },
  selected: {
    heading: "Vald",
    none: "Inget valt. Klicka på en kontroll eller en sträcka.",
    control: (label: string) => `Vald: ${label}`,
    described: "Kontrollbeskrivningen i text",
    code: "Kod",
    saveCode: "Ändra koden",
    leg: (from: string, to: string) => `Sträckan ${from}–${to}`,
    deselect: "Avmarkera",
    description: "Beskrivning",
    more: "Mer …"
  },
  label: {
    START: "start", FINISH: "mål", CROSSING_POINT: "passage", MAP_EXCHANGE: "kartbyte", MAP_ISSUE: "kartutdelning",
    control: (code: string | undefined) => code ? `kontroll ${code}` : "kontroll utan kod"
  },
  /** Översynen 2026-11-02: uträkningar som inte gick (banpåtrycket, ringklippen, förslagen …). */
  problems: {
    failed: (names: readonly string[]) => `Det här kunde inte räknas fram: ${names.join(", ")}. Kartan visar det som går. Ångra senaste ändringen eller ladda om sidan.`,
    circleGaps: "Ringklippen över detaljer (ringarna ritas hela)",
    suggestions: "Förslagen på kontrollbeskrivning"
  },
  status: {
    saved: "Sparat",
    saving: "Sparar …",
    pending: "Ändrat – sparas strax",
    conflict: "Konflikt – någon annan har ändrat",
    failed: "Inte sparat – försöker igen",
    stopped: "Sparas inte – logga in igen",
    reload: "Ladda om",
    conflictHelp: (name: string | null, time: string) =>
      `${name ?? "Någon"} sparade ${time}. Ladda om för att se den versionen; dina senaste ändringar sparas inte.`
  },
  checks: {
    heading: "Kontroller att titta på",
    none: "Inget att anmärka.",
    show: "Visa på kartan",
    /** ADR-0199: nivåerna (inte bara färg) och grupperna per sort. */
    levels: { ERROR: "Fel", WARNING: "Varning", NOTICE: "Notis" } as Record<"ERROR" | "WARNING" | "NOTICE", string>,
    groups: {
      DUPLICATE_CODE: "Samma kod på flera kontroller", MISSING_CODE: "Kod saknas", COURSE_WITHOUT_START_OR_FINISH: "Start eller mål saknas",
      CONTROL_IN_FORBIDDEN: "Kontroll i förbjudet område", LEG_NO_ROUTE: "Går inte att nå lagligt",
      CONTROLS_TOO_CLOSE: "För nära varandra", INVERTIBLE_CODE: "Kod som kan läsas upp och ned",
      SAME_CONTROL_TWICE_IN_ROW: "Samma kontroll två gånger i rad", LEG_THROUGH_CONTROL: "Sträcka genom en annan ring",
      UNUSED_CONTROL: "Oanvända kontroller", LEG_THROUGH_FORBIDDEN: "Fågelvägen korsar förbjudet område",
      CONTROLS_NEAR: "Nära varandra – ange objekt", NUMBER_ON_OBSTACLE: "Nummer på hus eller mörk yta",
      LEVEL_DEVIATION: "Avviker från banans nivå"
    } as Record<string, string>,
    accept: "Godta",
    acceptLabel: (row: string) => `Godta: ${row}`,
    acceptAll: (count: number) => `Godta alla ${count}`,
    acceptHelp: "Godta när det är meningen. Varningen kommer tillbaka om kontrollerna eller området byts ut eller flyttas mer än 25 m.",
    accepted: (count: number) => `Godtagna (${count})`,
    unaccept: "Ångra",
    unacceptLabel: (row: string) => `Ångra godtagandet: ${row}`,
    notAcceptable: "Måste rättas",
    routes: (count: number) => count === 1 ? "Räknar vägvalet för en sträcka som korsar ett förbjudet område …"
      : `Räknar vägvalen för ${count} sträckor som korsar förbjudna områden …`,
    routesHelp: "Fågelvägen genom ett förbjudet område är inget fel när det finns en väg runt. Med kartfilen räknas vägvalen och bara sträckor utan laglig väg blir fel.",
    routesFailed: "Vägvalen kunde inte räknas; sträckorna genom förbjudna områden står som notiser.",
    CONTROLS_TOO_CLOSE: (a: string, b: string, distance: number, limit: number, feature?: "SAME" | "UNKNOWN") =>
      feature === "SAME" ? `${a} och ${b} ligger ${Math.round(distance)} m från varandra på samma slags objekt (riktvärde minst ${limit} m).`
      : feature === "UNKNOWN" ? `${a} och ${b} ligger ${Math.round(distance)} m från varandra. Under ${limit} m ska objekten vara tydligt olika; ange objekt (kolumn D) så avgörs det.`
      : `${a} och ${b} ligger ${Math.round(distance)} m från varandra (riktvärde minst ${limit} m).`,
    DUPLICATE_CODE: (code: string, count: number) => `Koden ${code} finns på ${count} kontroller.`,
    INVERTIBLE_CODE: (code: string) => `Koden ${code} kan läsas upp och ned.`,
    SAME_CONTROL_TWICE_IN_ROW: (course: string, control: string) => `${course}: ${control} kommer två gånger i rad.`,
    LEG_THROUGH_CONTROL: (courses: string, from: string, to: string, control: string) =>
      `${courses}: sträckan ${from}–${to} går genom ringen för ${control}.`,
    LEG_THROUGH_FORBIDDEN: (courses: string, from: string, to: string, what: string) =>
      `${courses}: fågelvägen ${from}–${to} korsar ${what}; vägvalet är inte räknat.`,
    LEG_NO_ROUTE: (courses: string, from: string, to: string, what: string) =>
      `${courses}: ${from}–${to} har ingen väg runt ${what}.`,
    CONTROL_IN_FORBIDDEN: (control: string, what: string) => `${control} ligger i ${what}.`,
    forbidden: { "out-of-bounds": "ett förbjudet område", "dangerous-area": "ett farligt område", "temporary-construction": "en tillfällig konstruktion",
      boundary: "en gräns som inte får passeras", "forbidden-route": "en förbjuden väg" } as Record<string, string>,
    COURSE_WITHOUT_START_OR_FINISH: (course: string) => `${course} saknar start eller mål.`,
    UNUSED_CONTROL: (control: string) => `${control} används inte på någon bana.`,
    MISSING_CODE: (control: string) => `En kontroll saknar kod (${control}).`,
    NUMBER_ON_OBSTACLE: (number: string, courses: string) => `Nummer ${number} ligger delvis på ett hus (${courses}). Flytta numret eller låt O-Tid placera det.`
  },
  leg: {
    heading: "Vald sträcka",
    help: "Välj en sträcka i en bana för att se vägvalen. De räknas om när du flyttar kontrollerna.",
    analysing: "Räknar vägvalen …",
    failed: "Vägvalen kunde inte räknas för sträckan.",
    waitingForMap: "Vägvalen räknas när kartfilen är läst.",
    straight: (value: number) => `Fågelväg ${meters(value)}`,
    best: (length: number, climb: number, minutes: string) => `Bästa väg ${meters(length)}, ${Math.round(climb)} m stigning, ca ${minutes}`,
    choices: (count: number) => count === 1 ? "Ett tydligt vägval" : `${count} vägval`,
    noRoute: "Ingen väg hittades mellan kontrollerna.",
    /** ADR-0199: fågelvägen korsar ett förbjudet område men vägvalet går runt (information, ingen varning). */
    aroundForbidden: (what: string, extra: number) => `Fågelvägen korsar ${what} – vägvalet går runt (+${meters(Math.max(0, extra))}).`,
    noRouteForbidden: (what: string) => `Ingen laglig väg runt ${what}.`,
    routes: "Vägvalen",
    bestRow: "Bästa",
    alternative: (index: number) => `Alternativ ${index}`,
    row: (length: number, climb: number, minutes: string) => `${meters(length)} · ${Math.round(climb)} m · ${minutes}`,
    slower: (ratio: number) => `+${Math.max(0, Math.round((ratio - 1) * 100))} %`,
    legend: "Bästa väg som blå linje, andra vägval streckade och numrerade med tidsskillnaden (högst 25 % sämre) och stråket (högst 5 % sämre) tonat."
  },
  file: {
    heading: "Fil",
    import: "Läs in .ppen",
    importLabel: "Purple Pen-fil (.ppen)",
    importHelp: "Filen läses i webbläsaren. Det som O-Tid inte tolkar sparas orört och skrivs tillbaka.",
    replaceConfirm: "Ersätta banläggningen med filen? Den nuvarande sparas som en tidigare version.",
    reading: "Läser filen …",
    invalid: "Filen kunde inte läsas som en Purple Pen-fil.",
    tooLarge: "Filen är för stor.",
    imported: (courses: number, controls: number) => `Inläst: ${courses} ${courses === 1 ? "bana" : "banor"} och ${controls} kontroller.`,
    warnings: "Att veta om filen",
    download: "Ladda ned .ppen",
    downloadOriginal: (name: string) => `Ladda ned den inlästa filen (${name})`,
    failed: "Filen kunde inte sparas. Försök igen."
  },
  revisions: {
    heading: "Tidigare versioner",
    show: "Visa tidigare versioner",
    none: "Inga tidigare versioner än.",
    kind: { SAVE: "Sparad", IMPORT: "Före inläsning", RESTORE: "Före återställning" } as Record<string, string>,
    row: (version: number, time: string, name: string | null, courses: number, controls: number) =>
      `Version ${version} · ${time}${name ? ` · ${name}` : ""} · ${courses} banor, ${controls} kontroller`,
    restore: "Återställ",
    restoreConfirm: (version: number) => `Återställa version ${version}? Den nuvarande sparas som en tidigare version.`,
    restored: (version: number) => `Version ${version} är återställd.`,
    failed: "Versionen kunde inte återställas."
  },
  transfer: {
    heading: "Överför till tävlingen",
    help: "Banorna, kontrollerna och varianterna blir tävlingens, som när en banfil läses in. Du ser ändringarna innan de sparas.",
    button: "Överför till tävlingen",
    waitForSave: "Vänta tills ändringarna är sparade.",
    problems: {
      NO_DOCUMENT: "Det finns ingen banläggning att föra över.",
      NO_COURSES: "Ingen bana har både start och mål.",
      INVALID_CODES: (controls: string) => `Kontrollerna på banorna behöver koder 1–999 999 (${controls}).`
    },
    failed: "Överföringen kunde inte förberedas. Försök igen."
  }
};
