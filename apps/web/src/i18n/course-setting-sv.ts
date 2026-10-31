/** Steg 62 (ADR-0180): banläggningen i webben. Enkel svenska; kontroller nämns med kod ("kontroll 31"), inga interna id. */
const meters = (value: number) => value >= 10_000 ? `${(value / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(value)} m`;

export const courseSettingSv = {
  title: "Banläggning",
  back: "Tillbaka till tävlingen",
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
    summary: (length: string, controls: number, variants: number) =>
      `${length} · ${controls} ${controls === 1 ? "kontroll" : "kontroller"}${variants > 1 ? ` · ${variants} varianter` : ""}`,
    length: (min: number, max: number) => min === max ? meters(min) : `${meters(min)}–${meters(max)}`,
    add: "Ny bana",
    addName: "Namn på ny bana",
    newName: (count: number) => `Bana ${count}`,
    rename: "Döp om",
    renameLabel: (name: string) => `Nytt namn på ${name}`,
    remove: "Ta bort banan",
    removeConfirm: (name: string) => `Ta bort banan ${name}? Kontrollerna finns kvar.`,
    save: "Spara",
    cancel: "Avbryt",
    variant: "Variant",
    allVariants: "Alla grenar",
    classes: "Klasser (som i Purple Pen, t.ex. H21, D21)"
  },
  tools: {
    heading: "Verktyg",
    SELECT: "Välj och flytta",
    ADD_CONTROL: "Ny kontroll",
    ADD_START: "Ny start",
    ADD_FINISH: "Nytt mål",
    ADD_CROSSING: "Ny passage",
    INSERT_EXISTING: "Lägg in befintlig kontroll",
    ADD_BEND: "Brytpunkt på sträcka",
    help: {
      SELECT: "Klicka för att välja. Dra en kontroll, ett nummer eller en brytpunkt för att flytta. Dra kartan för att panorera.",
      ADD_CONTROL: "Klicka på kartan där kontrollen ska stå. I en bana läggs den in efter vald kontroll.",
      ADD_START: "Klicka där starten ska stå.",
      ADD_FINISH: "Klicka där målet ska stå.",
      ADD_CROSSING: "Klicka där passagen ska stå.",
      INSERT_EXISTING: "Klicka på en kontrollring för att lägga in kontrollen i banan efter vald kontroll.",
      ADD_BEND: "Välj en sträcka och klicka där linjen ska brytas."
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
    keys: "Tangenter: Delete tar bort, Escape avbryter, Ctrl/Cmd+Z ångrar och Ctrl/Cmd+Shift+Z gör om."
  },
  selected: {
    heading: "Vald",
    none: "Inget valt. Klicka på en kontroll eller en sträcka.",
    control: (label: string) => `Vald: ${label}`,
    code: "Kod",
    saveCode: "Ändra koden",
    leg: (from: string, to: string) => `Sträckan ${from}–${to}`
  },
  label: {
    START: "start", FINISH: "mål", CROSSING_POINT: "passage", MAP_EXCHANGE: "kartbyte", MAP_ISSUE: "kartutdelning",
    control: (code: string | undefined) => code ? `kontroll ${code}` : "kontroll utan kod"
  },
  status: {
    saved: "Sparat",
    saving: "Sparar …",
    pending: "Ändrat – sparas strax",
    conflict: "Konflikt – någon annan har ändrat",
    failed: "Kunde inte spara – försöker igen",
    tooLarge: "Banläggningen är för stor för att sparas.",
    reload: "Ladda om",
    conflictHelp: (name: string | null, time: string) =>
      `${name ?? "Någon"} sparade ${time}. Ladda om för att se den versionen; dina senaste ändringar sparas inte.`
  },
  checks: {
    heading: "Kontroller att titta på",
    none: "Inget att anmärka.",
    show: "Visa på kartan",
    CONTROLS_TOO_CLOSE: (a: string, b: string, distance: number, limit: number) =>
      `${a} och ${b} ligger ${Math.round(distance)} m från varandra (riktvärde minst ${limit} m).`,
    DUPLICATE_CODE: (code: string, count: number) => `Koden ${code} finns på ${count} kontroller.`,
    INVERTIBLE_CODE: (code: string) => `Koden ${code} kan läsas upp och ned.`,
    SAME_CONTROL_TWICE_IN_ROW: (course: string, control: string) => `${course}: ${control} kommer två gånger i rad.`,
    LEG_THROUGH_CONTROL: (course: string, from: string, to: string, control: string) =>
      `${course}: sträckan ${from}–${to} går genom ringen för ${control}.`,
    COURSE_WITHOUT_START_OR_FINISH: (course: string) => `${course} saknar start eller mål.`,
    UNUSED_CONTROL: (control: string) => `${control} används inte på någon bana.`,
    MISSING_CODE: (control: string) => `En kontroll saknar kod (${control}).`
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
    legend: "Bästa väg som blå linje, likvärdiga vägar streckade och stråket (högst 5 % sämre) tonat."
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
