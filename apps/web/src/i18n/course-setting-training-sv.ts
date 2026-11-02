/** Träningsläget i banläggningen (ADR-0192). Enkel svenska. */
export const trainingSv = {
  tab: "Träning",
  heading: "Träning",
  help: "Gör banan till en träning: korridor, sista säkra, bara kurvbild, fönster med mera. Formerna gäller avsnitt av banan och kan läggas efter varandra på samma karta.",
  chooseCourse: "Välj en bana överst för att göra den till en träning. Ritade områden med filter kan gälla alla banor.",
  show: "Visa träningen på kartan",
  showHelp: "Av = kartan som vanligt (före), på = med träningen (efter).",
  readOnly: "Du kan se träningen men inte ändra den.",
  removeCourse: "Ta bort träningen för banan",
  forms: {
    heading: "Lägg till",
    CORRIDOR: { title: "Korridor", line: "Bara en remsa längs sträckorna syns." },
    ATTACK: { title: "Sista säkra", line: "En mindre ring på det man ska hitta före kontrollen." },
    BAND: { title: "Kurvbild", line: "Bara höjdkurvor (eller annat filter) längs en del av banan." },
    WINDOW: { title: "Fönster", line: "Bara cirklar runt kontrollerna syns." },
    NO_MAP: { title: "Utan karta", line: "Sträckor utan karta: kompass och avståndsbedömning." },
    AREA: { title: "Område", line: "Rita ett område med eget filter, t.ex. bara kurvbild här." },
    STAR: { title: "Stjärna", line: "Ut och tillbaka till en central punkt." },
    LINE: { title: "Linje", line: "Följ en inritad linje och hitta kontrollerna längs den." },
    PAIRS: { title: "Keps", line: "Par med 1a och 1b: en hänger ut kepsen, den andra tar in den." },
    PIECES: { title: "Kartbitar", line: "Minne och pussel: varje sträcka på en egen liten karta." }
  },
  base: {
    heading: "Kartan för hela banan",
    help: "Filtret gäller överallt på banan, också i avsnitten."
  },
  outside: {
    heading: "Utanför avsnitten",
    FULL: "Hela kartan", WHITE: "Vitt", TINT: "Tonat", FILTER: "Filter",
    tint: "Ton (andel bort)"
  },
  sections: {
    heading: "Avsnitt",
    none: "Inga avsnitt. Lägg till en form ovan; den gäller från start till mål tills du ändrar.",
    from: "Från", to: "Till", start: "Start", finish: "Mål",
    form: "Form",
    forms: { CORRIDOR: "Korridor", WINDOW: "Fönster", BAND: "Område längs banan", NO_MAP: "Utan karta" } as Record<string, string>,
    shape: "Form på korridoren", angular: "Kantig", smooth: "Mjuk",
    width: "Bredd (m)", smoothing: "Utjämning", legWidth: (leg: string) => `Bredd ${leg} (m)`, legWidths: "Bredd per sträcka",
    windowShape: "Fönstrets form", circle: "Cirkel", square: "Kvadrat", radius: "Radie (m)",
    band: "Bältets bredd (m)",
    filter: "Det som syns i avsnittet",
    marker: "Markering vid bytet", markers: { NONE: "Ingen", TEXT: "Text", BAR: "Tvärstreck" } as Record<string, string>,
    markerText: "Text", markerPlaceholder: (text: string) => text,
    remove: "Ta bort avsnittet",
    up: "Flytta upp", down: "Flytta ned",
    title: (index: number, form: string, from: string, to: string) => `${index}. ${form}: ${from} → ${to}`
  },
  filter: {
    presets: { ALL: "Hela kartan", CONTOURS: "Bara kurvbild", CONTOURS_WATER_ROCK: "Kurvbild + vatten + sten", NO_VEGETATION: "Utan vegetation",
      NO_PATHS: "Utan stigar", PATHS_ROADS: "Bara stigar och vägar", CUSTOM: "Eget" } as Record<string, string>,
    groups: { LANDFORM: "Höjdkurvor och terrängformer (1xx)", ROCK: "Berg och sten (2xx)", WATER: "Vatten och sankmark (3xx)",
      VEGETATION: "Vegetation (4xx)", PATHS: "Vägar och stigar (501–508)", MANMADE: "Byggt: hus, murar, staket (5xx)",
      FORBIDDEN: "Förbjudet område och banpåtryck i kartan (520, 7xx)", TECHNICAL: "Nordlinjer och tekniskt (6xx)", OTHER: "Övrigt (okänt nummer)" } as Record<string, string>,
    symbols: "Enskilda symboler",
    symbolsHelp: "Kryssa i eller ur en symbol för att gå förbi gruppen. Grupperna följer ISOM 2017-2 och ISSprOM 2019-2; okända nummer efter namnet.",
    noSymbols: "Kartans symboler visas när kartan är inläst.",
    search: "Sök symbol",
    count: (count: number) => `${count} st`,
    safety: "Förbjudet område och nordlinjer syns i alla förval."
  },
  areas: {
    heading: "Ritade områden",
    none: "Inga områden.",
    draw: "Rita område",
    drawing: (count: number) => `Klicka på kartan för områdets hörn (${count} punkter).`,
    finish: "Klar", cancel: "Avbryt",
    name: (index: number) => `Område ${index}`,
    courses: "Gäller", thisCourse: "Den här banan", allCourses: "Alla banor",
    remove: "Ta bort området"
  },
  attack: {
    heading: "Sista säkra",
    help: "Klicka på en sträcka där det sista säkra ligger. Ringen är inte en kontroll: den syns inte i beskrivningen, längden eller avläsningen.",
    add: "Lägg sista säkra",
    adding: "Klicka på kartan nära sträckan.",
    noLeg: "Klicka närmare en sträcka på banan.",
    size: "Storlek (andel av ringen)",
    style: "Stil", styles: { SOLID: "Heldragen", DASHED: "Streckad", THIN: "Tunnare" } as Record<string, string>,
    none: "Inga sista säkra på banan.",
    row: (leg: string) => `Sträcka ${leg}`,
    remove: "Ta bort"
  },
  star: {
    heading: "Stjärna",
    center: "Central kontroll",
    controls: "Uddar (kontroller)",
    create: "Skapa stjärnbana",
    createEach: "En bana per kontroll",
    created: (name: string) => `${name} är skapad.`,
    createdMany: (count: number) => `${count} stjärnbanor är skapade.`,
    print: "Utskrift", printAll: "Alla uddar på en karta", printEach: "En karta per udd (ut och tillbaka)",
    courseName: (code: string) => `Stjärna ${code}`,
    needCenter: "Välj en central kontroll och minst en udd.",
    remove: "Inte stjärna längre"
  },
  line: {
    heading: "Linjeorientering",
    help: "Löparens karta har start, mål och linjen men inte kontrollerna. Kontrollantens karta har allt.",
    draw: "Rita linjen", drawing: (count: number) => `Klicka längs linjen (${count} punkter).`,
    fromLegs: "Linje längs sträckorna", finish: "Klar", cancel: "Avbryt", remove: "Ta bort linjen",
    points: (count: number) => `Linjen har ${count} punkter.`
  },
  pairs: {
    heading: "Kepsorientering",
    help: "Löparna springer i par och turas om att hänga ut kepsen och ta in den. Kartan visar alla a- och b-punkter.",
    mode: "Para ihop", adjacent: "Intill varandra (1–2, 3–4 …)", halves: "Första och andra halvan",
    make: "Para ihop kontrollerna",
    count: (count: number) => `${count} par`,
    legs: "Visa sträckorna",
    print: "Utskrift", common: "En gemensam karta", separate: "En karta för löpare A och en för B",
    separateHelp: "Heldragen ring: sätt ut kepsen. Streckad: ta in den.",
    unpaired: (count: number) => `${count} kontroller utan par visas med vanligt nummer.`,
    forked: "Kepsorientering görs på en bana utan gafflingar.",
    remove: "Inte keps längre"
  },
  pieces: {
    heading: "Kartbitar",
    help: "Skrivs ut från förhandsvisningen (Utskrift → Kartbitar): en liten karta per sträcka.",
    size: "Bitens sida (mm)", scale: "Skala 1:", margin: "Marginal (m)", order: "Ordning", course: "Banans ordning", shuffled: "Blandad (pussel)",
    remove: "Inga kartbitar"
  },
  print: {
    pieces: "Kartbitar: en liten karta per sträcka (minne och pussel)",
    controller: "Kontrollantens karta (linjeorientering, med kontrollerna)"
  },
  edits: {
    PUT_TRAINING: "Ändrade träningen"
  }
};
