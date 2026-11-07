import { plural } from "./plural";

/** ADR-0217: Layout som egen flik i banläggningen. */
export const courseSettingTabsSv = {
  label: "Banläggningens delar",
  setting: "Banläggning",
  layout: "Layout",
  print: "Utskrift"
} as const;

export const layoutSv = {
  title: "Layout",
  intro: "Papperet: layouter (papper och skala), arken för varje bana och vilken layout varje klass får. Banorna läggs i Banläggning.",
  loading: "Läser banläggningen …",
  failed: "Banläggningen kunde inte läsas.",
  retry: "Försök igen",
  noSetting: "Det finns ingen banläggning för tävlingen ännu.",
  readOnly: "Du kan se layouterna men inte ändra dem.",
  saveFailed: "Ändringen sparades inte.",
  readingMap: "Läser kartan …",
  mainName: "Huvudlayout",
  overview: {
    heading: "Överblick",
    help: "Rader är banor och kolumner layouter. En ruta är ett ark: klick öppnar det.",
    course: "Bana",
    allControls: "Alla kontroller",
    add: "+ Lägg till ark",
    addLabel: (course: string, layout: string) => `Lägg till ark för ${course} i ${layout}`,
    open: (course: string, layout: string) => `Öppna arket ${course} i ${layout}`,
    maps: (entered: number, reserves: number) => `${entered} + ${reserves} reserv${reserves === 1 ? "" : "er"}`,
    noClasses: "Inga klasser",
    status: { FITS: "Får plats", OUTSIDE: "Går utanför – välj utsnitt", OWN_AREA: "Eget utsnitt", PARTS: "Kartbyte" } as Record<string, string>,
    parts: (count: number) => `Kartbyte: ${count} delar`,
    adjustments: (count: number) => plural(count, "justering", "justeringar")
  },
  layouts: {
    heading: "Layouter",
    help: "En layout är papper, skala, Mall för papperet och Kartor per ark. Huvudlayouten är banornas egen skala och papper och skrivs till .ppen.",
    add: "+ Ny layout",
    newName: "Ny layout",
    name: "Namn",
    scale: "Skala 1:",
    courseScale: "Banans skala",
    paper: "Papper",
    orientation: "Riktning",
    portrait: "Stående",
    landscape: "Liggande",
    margin: "Marginal (mm)",
    paperTemplate: "Mall för papperet",
    noTemplate: "Ingen",
    perSheet: "Kartor per ark",
    onePerSheet: "En bana per ark",
    remove: "Ta bort layouten",
    removeConfirm: (name: string) => `Ta bort layouten ”${name}”? Klasserna som har den får huvudlayouten.`,
    main: "banornas skala och papper, skrivs till .ppen",
    sheets: (count: number) => `${count} ark`
  },
  sheet: {
    heading: (layout: string) => `Arken i ${layout}`,
    none: "Välj ett ark i överblicken.",
    close: "Stäng arket",
    adjust: (scale: string) => `Justera för ${scale}`,
    adjustHelp: "Dra ett nummer på arket för att flytta det bara i den här layouten. Ring- och sträckavbrotten gäller layoutens alla ark.",
    adjustMain: "Huvudlayouten är banläggningen: nummer och ringavbrott ändras i Banläggning.",
    adjustments: (count: number) => count === 0 ? "Inga justeringar: allt följer banläggningen." : `${plural(count, "justering", "justeringar")} i layouten`,
    clear: "Ta bort justeringar",
    numberLabel: (code: string) => `Nummer ${code}`,
    numberReset: "Som i banläggningen",
    gaps: "Ringavbrott (grader, t.ex. 80-100, 200-220)",
    legGaps: "Sträckavbrott (mm från sträckans början och längd, t.ex. 9-2)",
    gapsFollow: "som banläggningen",
    gapsSave: "Spara",
    gapsReset: "Som i banläggningen",
    resetPaper: "Återställ till mallen",
    removeSheet: "Ta bort arket"
  },
  classes: {
    heading: "Klasser",
    help: "Varje klass har en layout; reserverna följer klassen. Banan kommer från tävlingen.",
    none: "Klasserna läses från tävlingen (Kartor till starten).",
    name: "Klass",
    course: "Bana",
    layout: "Layout",
    markAll: "Markera alla",
    mark: (name: string) => `Markera ${name}`,
    setMarked: "Ge markerade layouten",
    apply: "Använd",
    marked: (count: number) => `${count} markerade`
  },
  states: {
    heading: "Lägen",
    help: "Ett läge sparar layouterna, arken, justeringarna, klassernas val och färgprofilen (inte banorna).",
    name: "Namn på läget",
    save: "Spara läge",
    restore: "Återställ",
    restoreConfirm: (name: string) => `Återställa läget ”${name}”? Det kan ångras med Ångra.`,
    compare: "Jämför",
    remove: "Ta bort",
    none: "Inga sparade lägen.",
    same: "Inga skillnader mot nu.",
    ppen: "automatiskt vid inläsning",
    undo: "Ångra",
    differences: {
      LAYOUT: (name: string, change: string) => `Layouten ${name}: ${change === "ADDED" ? "ny sedan läget" : change === "REMOVED" ? "borttagen sedan läget" : "ändrad"}`,
      SHEET: (course: string, layout: string) => `Arket ${course} i ${layout}`,
      CLASS: (name: string, from: string, to: string) => `${name}: ${from} → ${to}`,
      TEMPLATES: "Mall för papperet och Kartor per ark",
      PROFILE: "Färgprofilen"
    }
  }
} as const;

/** ADR-0217 beslut 8: Utskrift-flikens urval (vad och hur många). */
export const printWhatSv = {
  modeClasses: "Klasser",
  modeProof: "Provark (ett av varje)",
  layout: "Alla ark i layouten",
  count: "Antal",
  entered: "Anmälda + reserver",
  own: "Eget antal",
  copies: "Kartor per ark",
  classes: "Klasser",
  allClasses: "Alla klasser",
  noClasses: "Klasserna läses från tävlingen.",
  layoutLink: "Ändra papperet i Layout"
} as const;
