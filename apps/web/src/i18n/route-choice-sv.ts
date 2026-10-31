/** Steg 60 (ADR-0179 beslut 7–13): vägvalsanalysen i kontrollkartan. Enkel svenska, inga interna id. */
const place = (key: string) => key === "S" ? "start" : key === "F" ? "mål" : key.split(".")[0]!;
const meters = (value: number) => value >= 10_000 ? `${(value / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(value)} m`;

export const routeChoiceSv = {
  mode: "Vägval",
  needsMapFile: "Vägvalen räknas ur kartfilen. Ladda upp kartfilen (OCAD eller Mapper) under Resultat → Karta och vägval.",
  goToMapFile: "Gå till Karta och vägval",
  mismatch: "Banfilen verkar inte vara gjord på den här kartan. Kontrollerna placeras med koordinaterna i banfilen i stället.",
  noPlaces: "Kontrollerna har inga lägen på kartfilen, så vägvalen kan inte räknas. Läs in en banfil med lägen (OCAD eller Purple Pen).",
  course: "Bana eller variant",
  courseOption: (course: string, variant: string | null) => variant ? `${course}, variant ${variant}` : course,
  reading: "Läser kartfilen …",
  analysing: (done: number, total: number) => `Räknar vägvalen … ${done} av ${total} sträckor`,
  done: (total: number) => `Klart: ${total} ${total === 1 ? "sträcka" : "sträckor"}.`,
  failed: "Vägvalen kunde inte räknas. Försök igen.",
  readFailed: "Kartfilen kunde inte läsas för vägvalen.",
  retry: "Försök igen",
  table: {
    caption: "Vägval per sträcka",
    leg: "Sträcka",
    straight: "Fågelväg",
    best: "Bästa väg",
    climb: "Stigning",
    time: "Uppskattad tid",
    choices: "Vägval",
    verdict: "Bedömning"
  },
  legName: (from: string, to: string) => `${place(from)}–${place(to)}`,
  meters,
  climb: (value: number) => `${Math.round(value)} m`,
  pending: "Räknas …",
  noRoute: "Ingen väg",
  choices: (count: number) => String(count),
  verdicts: {
    ROUTE_CHOICE: "Vägvalssträcka",
    NO_CHOICE: "Inget vägval",
    ABOUT_EQUAL: "Vägvalen är ungefär lika bra"
  },
  verdictHelp: "Vägvalen är ungefär lika bra = det bästa vägvalet byter plats om farterna ändras 15 % upp eller ner.",
  total: (best: number, straight: number) => `Hela banan: bästa vägen ${meters(best)} mot fågelvägen ${meters(straight)}` +
    (straight > 0 ? ` (${Math.round((best / straight - 1) * 100)} % längre).` : "."),
  totalIncomplete: "Hela banan räknas när alla sträckor är klara.",
  warnings: {
    heading: "Att se över",
    THROUGH_OTHER_CONTROL: (code: string) => `Bästa vägen går genom kontroll ${code}:s ring.`,
    CONTROL_IN_IMPASSABLE: (code: string) => code === "S" ? "Starten ligger i ej passerbar mark." : code === "F" ? "Målet ligger i ej passerbar mark."
      : `Kontroll ${code} ligger i ej passerbar mark.`,
    NO_ROUTE: (from: string, to: string) => `Ingen väg hittades mellan ${place(from)} och ${place(to)}.`
  },
  legWarning: (leg: string) => `Sträcka ${leg}:`,
  map: (leg: string) => `Vägval på sträckan ${leg}`,
  control: (code: number) => `Kontroll ${code}`,
  legend: "Svart linje = bästa vägen. Tonad yta = vägar som är högst 5 % sämre. Streckade linjer = andra vägval.",
  alternative: (index: number, percent: number) => `Vägval ${index + 1}: ${percent} % längre tid`,
  selectLeg: "Välj en sträcka i tabellen för att se den på kartan.",
  showLeg: (leg: string) => `Visa ${leg} på kartan`,
  // Inställningar.
  settings: {
    heading: "Inställningar för vägvalen",
    help: "Ändringar räknas om direkt och sparas för tävlingen.",
    contour: "Ekvidistans (m)",
    climbFactor: "1 m stigning räknas som (m plan väg)",
    pace: "Fart i vanlig skog (min/km)",
    save: "Spara inställningarna",
    saved: "Inställningarna är sparade.",
    failed: "Inställningarna kunde inte sparas.",
    invalid: "Kontrollera talen: ekvidistans 0,5–50 m, stigning 0–50 m och fart 2:00–30:00 min/km.",
    unknownHeading: "Symboler som inte finns i tabellen",
    unknownHelp: "De räknas som vanlig skog. Välj hur de ska räknas.",
    unknownNone: "Alla symboler på kartan finns i tabellen.",
    unknownRow: (code: string, name: string, objects: number) => `${code} ${name} (${objects} ${objects === 1 ? "objekt" : "objekt"})`,
    classLabel: (code: string) => `Hur symbol ${code} ska räknas`
  },
  classes: {
    FAST: "Snabb (väg, stig, öppen mark)",
    NORMAL: "Vanlig skog",
    SLOW: "Långsam",
    VERY_SLOW: "Mycket långsam",
    FIGHT: "Nästan stopp",
    IMPASSABLE: "Ej passerbar",
    IGNORE: "Påverkar inte farten"
  },
  shortClasses: { FAST: "Snabb", NORMAL: "Vanlig skog", SLOW: "Långsam", VERY_SLOW: "Mycket långsam", FIGHT: "Nästan stopp" },
  // Kalibrering.
  calibration: {
    heading: "Farterna mot löparnas rutter",
    button: "Justera farterna efter de här rutterna",
    help: (runners: number) => `${runners} ${runners === 1 ? "löpare" : "löpare"} med resultat på banan har en uppladdad GPS-rutt. ` +
      "Rutterna räknas i webbläsaren och skickas inte någonstans.",
    none: "Inga uppladdade GPS-rutter för löpare med resultat på banan än.",
    running: "Jämför farterna med rutterna …",
    caption: "Fart mot vanlig skog",
    kind: "Mark",
    before: "Före",
    after: "Efter",
    samples: (count: number) => `Räknat på ${count} ${count === 1 ? "sträcka" : "sträckor"}.`,
    reliability: { NONE: "För lite data: farterna ändras inte.", LOW: "Lite data: se förslaget som en fingervisning.",
      MEDIUM: "Ganska mycket data.", HIGH: "Mycket data." },
    save: "Spara",
    saved: "Farterna är sparade.",
    failed: "Farterna kunde inte räknas."
  },
  // Publicering.
  publish: {
    button: "Visa bästa vägval publikt",
    withdraw: "Dölj bästa vägval publikt",
    help: "Bästa vägen per sträcka visas i den publika sträcktidsanalysen bredvid löparnas rutter, men först när banorna är publika.",
    published: "Bästa vägvalen visas publikt när banorna är publika.",
    publishedAt: (time: string) => `Visas publikt sedan ${time}.`,
    withdrawn: "Bästa vägvalen visas inte längre publikt.",
    oldMap: "Bästa vägvalen publicerades för en tidigare kartfil och visas inte publikt. Publicera igen.",
    waitForAll: "Vänta tills alla sträckor är räknade.",
    failed: "Bästa vägvalen kunde inte publiceras.",
    mapChanged: "Kartfilen har bytts sedan analysen räknades. Öppna Vägval igen."
  }
} as const;
