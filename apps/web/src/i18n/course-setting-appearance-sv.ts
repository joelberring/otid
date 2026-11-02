/** Banans utseende och etiketten vid kontrollen (ADR-0180 beslut 12). */
const thousands = (value: number) => Math.round(value).toLocaleString("sv-SE").replace(/\s/g, " ");
const STANDARD = { ISOM2017: "ISOM 2017-2", ISSPROM2019: "ISSprOM 2019-2" } as const;

export const appearanceSv = {
  heading: "Utseende",
  help: "Gäller alla banor, på kartan och i utskriften. Kvoterna är mot standardens mått och följer med till Purple Pen.",
  presets: "Snabbval",
  preset: {
    standard: (standard: keyof typeof STANDARD) => `Standard (${STANDARD[standard]})`,
    enlarged: "Förstorat i 1:10 000 (ungdom och äldre)",
    "sprint-rings": "Större ringar: 6,0 mm som i sprint",
    "smaller-numbers": "Mindre nummer: 3,0 mm"
  },
  presetHelp: {
    standard: "Ringar, linjer och nummer i standardens storlek.",
    enlarged: "ISOM 2017-2 (2.9.1): i 1:10 000 förstoras allt till 150 %, också banpåtrycket. Rekommenderas för de yngsta och för äldre.",
    "sprint-rings": "Ringen ur ISSprOM 2019-2 på skogskartan, t.ex. för natt. Utanför ISOM 2017-2.",
    "smaller-numbers": "Som koderna i Alla kontroller. Under ISOM:s 4,0 mm."
  },
  fields: { circleSize: "Ringstorlek", lineWidth: "Linjebredd", numberSize: "Nummerstorlek" },
  paperLabel: { circleSize: "ring", lineWidth: "linje", numberSize: "nummer" },
  ratio: "kvot",
  save: "Spara",
  /** "ring 5,35 → 6,0 mm vid 1:10 000" */
  paper: (label: string, standard: string, actual: string) => standard === actual ? `${label} ${actual} mm` : `${label} ${standard} → ${actual} mm`,
  at: (scale: number) => `På papperet i 1:${thousands(scale)}:`,
  outside: (min: number, max: number) => `Purple Pen tillåter ${String(min).replace(".", ",")}–${max} mm.`,
  notNumber: "Skriv ett tal, t.ex. 1,2.",
  scaling: "Skalning",
  scalings: { None: "Ingen", RelativeToMap: "Relativt kartan", RelativeTo15000: "Relativt 1:15 000" },
  scalingHelp: {
    None: "Samma mm på papperet i alla utskriftsskalor.",
    RelativeToMap: "Storlekarna följer kartans skala: förstoras när kartan skrivs ut i större skala.",
    RelativeTo15000: "Storlekarna gäller 1:15 000 och förstoras i större skala (150 % i 1:10 000), som ISOM 2017-2."
  },
  autoLegGap: "Automatiskt avbrott vid sträckor",
  autoLegGapHelp: "Där sträckor korsar varandra eller går nära en ring (mm, 0 = inga).",
  circleGapsScaled: "Ringavbrotten följer skalningen",
  circleGapsScaledHelp: "Så sparar Purple Pen sedan 2017. Av i äldre filer: avbrotten tas då från den största sparade skalan.",
  table: { scale: "Skala", courses: "Banor", circle: "Ring", line: "Linje", number: "Nummer" },
  warningsHeading: "Utanför standarden",
  warning: (field: "circle" | "line" | "number", scale: number, actual: string, expected: string, standard: keyof typeof STANDARD) =>
    `${{ circle: "Ringen", line: "Linjen", number: "Numret" }[field]} är ${actual} mm i 1:${thousands(scale)}; ${STANDARD[standard]} anger ${expected} mm.`,
  enlargementHint: "Kartan skrivs ut i större skala än 1:15 000 utan förstoring. Välj Relativt 1:15 000 för ISOM:s 150 %.",
  noWarnings: (standard: keyof typeof STANDARD) => `Måtten följer ${STANDARD[standard]}.`,
  scaleText: (scale: number) => `1:${thousands(scale)}`
};

export const labelSv = {
  heading: "Vid kontrollen",
  help: "Det som står vid ringen på kartan för den här banan.",
  kinds: {
    SEQUENCE: "Nummer", CODE: "Kod", SEQUENCE_AND_CODE: "Nummer och kod", SCORE: "Poäng", CODE_AND_SCORE: "Kod och poäng",
    SEQUENCE_AND_SCORE: "Nummer och poäng"
  },
  sameFor: "Gör likadant på",
  relays: (count: number) => `alla stafettbanor (${count})`,
  all: (count: number) => `alla banor (${count})`,
  done: (count: number) => count === 0 ? "Alla hade det redan." : `${count} ${count === 1 ? "bana" : "banor"} ändrades.`
};
