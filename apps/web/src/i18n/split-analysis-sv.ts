/** Sträcktidsanalys och vägval (PLAN.md steg 16). */
export const splitAnalysisSv = {
  title: "Sträcktidsanalys",
  back: "Till resultaten",
  classLabel: "Klass",
  views: { SPLITS: "Sträcktider", LOSS: "Tidsförlust" },
  viewLabel: "Visa",
  help: "Sträcktid och placering på sträckan överst, förlust mot bästa sträcka under och tid totalt med placering längst ner. " +
    "Tryck på en sträcka för att sortera på den. Bästa sträcka är fetstilt och märkt ★.",
  helpForked: "Klassen har gafflade banor. Sträckorna jämförs inom samma variant, eftersom varianterna har olika sträckor.",
  helpMispunched: "Felstämplade och andra utan godkänt resultat står under de godkända, utan placeringar. Sträckor de har sprungit visas; " +
    "– betyder att tiden saknas.",
  helpRoutes: "Vägval: tryck på länken i en sträcka för att se löparens väg på kartan.",
  relayNotSupported: (classes: string) => `Sträcktidsanalys finns inte för stafett än (${classes}). Sträckresultaten finns i resultatlistan.`,
  none: "Ingen klass har sträcktider ännu.",
  noClass: "Klassen finns inte eller har inga sträcktider.",
  variantHeading: (className: string, variant: string) => `${className} · variant ${variant}`,
  runners: (count: number) => `${count} löpare`,
  place: "Plac", name: "Namn", time: "Tid", loss: "Förlust", ideal: "Idealtid",
  idealHelp: (ideal: string) => `Idealtid (summan av de bästa sträckorna): ${ideal}.`,
  lossHelp: "Tidsförlust: summan av förlusterna mot bästa sträcka på varje sträcka. Löpare som saknar en sträcka får ingen summa.",
  start: "Start", finish: "Mål",
  /** Sträckans nummer och kontroll i kolumnrubriken. */
  legNumber: (index: number) => String(index + 1),
  control: (code: number, occurrence: number) => `${code}${occurrence > 1 ? ` (${occurrence})` : ""}`,
  sortBy: (leg: string) => `Sortera på sträcka ${leg}`,
  sortReset: "Sortera på resultat",
  sortedBy: (leg: string) => `Sorterad på sträcka ${leg}.`,
  bestLeg: "bästa sträcka",
  legPlace: (place: number) => `(${place})`,
  lossValue: (value: string) => `+${value}`,
  gainValue: (value: string) => `−${value}`,
  missing: "–",
  missingLabel: "tid saknas",
  route: "Vägval",
  routeLabel: (name: string, leg: string) => `Vägval för ${name} på sträcka ${leg}`,
  status: { OK: "Godkänd", MP: "Felstämplad", DSQ: "Diskvalificerad", DNF: "Ej fullföljt", OOC: "Utom tävlan", DNS: "Ej start",
    NT: "Utan tidtagning" } as Record<string, string>,
  legName: (from: string, to: string) => `${from}–${to}`
} as const;

/** Vägvalsvyn. */
export const routeChoiceSv = {
  title: (leg: string) => `Vägval ${leg}`,
  back: "Till sträcktidsanalysen",
  intro: "Löparens väg på sträckan enligt GPS-klockan, kopplad till stämplingstiderna. Andra löpares vägval på samma sträcka visas tunnare.",
  map: "Karta med vägval",
  zoomIn: "Zooma in", zoomOut: "Zooma ut", fitLeg: "Hela sträckan", fitMap: "Hela kartan",
  panHint: "Dra för att flytta kartan. Zooma med knapparna eller mushjulet.",
  others: "Visa andras vägval",
  runnersHeading: "Löpare på sträckan",
  selected: "vald",
  legTime: "Sträcktid",
  noOthers: "Ingen annan har en uppladdad rutt på den här sträckan.",
  imageError: "Kartan kunde inte visas.",
  notFound: "Det finns inget vägval för löparen på den här sträckan.",
  gpsNotice: "GPS-spåret är inte kontrollerat mot kontrollernas lägen. Klockan i GPS:en och stämplingarna kan skilja några sekunder."
} as const;
