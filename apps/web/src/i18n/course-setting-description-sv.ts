/** Steg 63 (ADR-0180): kontrollbeskrivningarna i banläggningen och på utskriftssidan. Kontroller nämns med kod. */
export const courseSettingDescriptionSv = {
  heading: "Kontrollbeskrivning",
  label: (course: string) => `Kontrollbeskrivning: ${course}`,
  help: "Klicka på en ruta (C–H) för att välja symbol. Klicka på en rad för att välja kontrollen på kartan.",
  failed: "Beskrivningen kunde inte ritas.",
  empty: "Banan har inga kontroller än.",
  row: (label: string) => `${label}: välj kontrollen`,
  box: (label: string, box: string, value: string | undefined) => `${label}, ruta ${box}${value ? `: ${value}` : ""}`,
  directive: (label: string, value: string | undefined) => `${label}, riktning${value ? `: ${value}` : ""}`,
  textLine: (label: string, before: boolean) => `${label}: textrad ${before ? "före" : "efter"}`,
  boxNames: {
    C: "vilket av objekten", D: "objekt", E: "objekt eller utseende", F: "mått eller kombination", G: "kontrollens läge", H: "övrigt",
    all: "riktning"
  } as Record<string, string>,
  picker: {
    heading: (label: string, box: string, name: string) => box === "all" ? `${label}, ${name}` : `${label}, ruta ${box} (${name})`,
    search: "Sök symbol",
    searchText: "Sök symbol eller skriv mått (t.ex. 2m eller 4x4)",
    options: "Symboler",
    recent: "Senast använd",
    none: "Ingen (töm rutan)",
    text: (value: string) => `Använd texten "${value}"`,
    nothing: "Ingen symbol heter så.",
    close: "Stäng",
    keys: "Pilarna flyttar, Enter väljer, Escape stänger."
  },
  textLines: {
    heading: "Textrader",
    before: "Text före kontrollen",
    after: "Text efter kontrollen",
    save: "Spara texten",
    help: "Tomt fält tar bort raden.",
    courseOnly: (before: boolean, value: string) => `Bara på den här banan, ${before ? "före" : "efter"}: "${value}".`
  },
  settings: {
    heading: "Inställningar för beskrivningen",
    standard: "Standard",
    standards: { "2004": "IOF 2004", "2018": "IOF 2018" } as Record<string, string>,
    language: "Språk",
    languages: { sv: "Svenska", en: "English" } as Record<string, string>,
    kind: "Visa",
    kinds: { SYMBOLS: "Symboler", TEXT: "Text", SYMBOLS_AND_TEXT: "Symboler och text" } as Record<string, string>,
    stored: "Språk och visningssätt sparas i den här webbläsaren för tävlingen."
  },
  print: "Skriv ut beskrivningar",
  textDescription: "Beskrivning i text",
  page: {
    title: "Kontrollbeskrivningar",
    back: "Tillbaka till banläggningen",
    help: "Välj banor och hur många av varje. Beskrivningarna läggs tätt på A4 att klippa ut. Skriv ut i 100 % skala.",
    loading: "Hämtar banläggningen …",
    failed: "Banläggningen kunde inte hämtas.",
    retry: "Försök igen",
    noSetting: "Det finns ingen banläggning än.",
    courses: "Banor",
    all: "Alla banor",
    allControls: "Alla kontroller",
    variants: "Varianter",
    allBranches: "Alla grenar",
    kind: "Visa",
    box: "Rutstorlek",
    boxSize: (value: number) => `${String(value).replace(".", ",")} mm`,
    copies: "Kopior per bana",
    language: "Språk",
    printButton: "Skriv ut",
    download: (name: string) => `Ladda ned SVG: ${name}`,
    pages: (count: number, items: number) => `${count} ${count === 1 ? "sida" : "sidor"}, ${items} ${items === 1 ? "beskrivning" : "beskrivningar"}.`,
    none: "Välj minst en bana.",
    scaled: "En beskrivning är större än sidan och har krympts.",
    sheet: (page: number, count: number) => `Sida ${page} av ${count}`,
    failedCourse: (name: string) => `Beskrivningen för ${name} kunde inte ritas.`
  }
};
