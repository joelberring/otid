import type { Texts } from "../lib/language";
import type { courseSettingTabsSv, layoutSv, printWhatSv } from "./course-setting-layout-sv";

/** Engelska del 30: banläggningens flikar, Layout-fliken och Utskrift-flikens urval (ADR-0217). */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const courseSettingTabsEn: Texts<typeof courseSettingTabsSv> = {
  label: "The parts of course setting",
  setting: "Course setting",
  layout: "Layout",
  print: "Print"
};

export const layoutEn: Texts<typeof layoutSv> = {
  title: "Layout",
  intro: "The paper: layouts (paper and scale), the sheets for each course and which layout each class gets. The courses are set in Course setting.",
  loading: "Reading the course setting …",
  failed: "The course setting could not be read.",
  retry: "Try again",
  noSetting: "There is no course setting for the event yet.",
  readOnly: "You can see the layouts but not change them.",
  saveFailed: "The change was not saved.",
  readingMap: "Reading the map …",
  mainName: "Main layout",
  overview: {
    heading: "Overview",
    help: "Rows are courses and columns layouts. A cell is a sheet: a click opens it.",
    course: "Course",
    allControls: "All controls",
    add: "+ Add sheet",
    addLabel: (course: string, layout: string) => `Add a sheet for ${course} in ${layout}`,
    open: (course: string, layout: string) => `Open the sheet ${course} in ${layout}`,
    maps: (entered: number, reserves: number) => `${entered} + ${count(reserves, "spare", "spares")}`,
    noClasses: "No classes",
    status: { FITS: "Fits", OUTSIDE: "Goes outside – choose an extent", OWN_AREA: "Own extent", PARTS: "Map exchange" },
    parts: (n: number) => `Map exchange: ${n} parts`,
    adjustments: (n: number) => count(n, "adjustment", "adjustments")
  },
  layouts: {
    heading: "Layouts",
    help: "A layout is paper, scale, Paper template and Maps per sheet. The main layout is the courses' own scale and paper and is written to .ppen.",
    add: "+ New layout",
    newName: "New layout",
    name: "Name",
    scale: "Scale 1:",
    courseScale: "The course's scale",
    paper: "Paper",
    orientation: "Orientation",
    portrait: "Portrait",
    landscape: "Landscape",
    margin: "Margin (mm)",
    paperTemplate: "Paper template",
    noTemplate: "None",
    perSheet: "Maps per sheet",
    onePerSheet: "One course per sheet",
    remove: "Remove the layout",
    removeConfirm: (name: string) => `Remove the layout ”${name}”? The classes that have it get the main layout.`,
    main: "the courses' scale and paper, written to .ppen",
    sheets: (n: number) => count(n, "sheet", "sheets")
  },
  sheet: {
    heading: (layout: string) => `The sheets in ${layout}`,
    none: "Choose a sheet in the overview.",
    close: "Close the sheet",
    adjust: (scale: string) => `Adjust for ${scale}`,
    adjustHelp: "Drag a number on the sheet to move it only in this layout. The circle and leg gaps apply to all the layout's sheets.",
    adjustMain: "The main layout is the course setting: numbers and circle gaps are changed in Course setting.",
    adjustments: (n: number) => n === 0 ? "No adjustments: everything follows the course setting." : `${count(n, "adjustment", "adjustments")} in the layout`,
    clear: "Remove adjustments",
    numberLabel: (code: string) => `Number ${code}`,
    numberReset: "As in the course setting",
    gaps: "Circle gaps (degrees, e.g. 80-100, 200-220)",
    legGaps: "Leg gaps (mm from the start of the leg and length, e.g. 9-2)",
    gapsFollow: "as the course setting",
    gapsSave: "Save",
    gapsReset: "As in the course setting",
    paperSource: (own: boolean, template: boolean) => own ? "The paper (cropping, texts, images) is the sheet's own."
      : template ? "The paper follows the layout's template until you change it here." : "The paper (cropping, texts, images) follows the main layout until you change it here.",
    resetPaper: (template: boolean) => template ? "Reset to the template" : "As the main layout",
  },
  classes: {
    heading: "Classes",
    help: "Each class has a layout; the spares follow the class. The course comes from the event.",
    none: "The classes are read from the event (Maps for the start).",
    name: "Class",
    course: "Course",
    layout: "Layout",
    markAll: "Mark all",
    mark: (name: string) => `Mark ${name}`,
    setMarked: "Give the marked the layout",
    apply: "Apply",
    marked: (n: number) => `${n} marked`
  },
  states: {
    heading: "Saved states",
    help: "A saved state keeps the layouts, the sheets, the adjustments, the classes' choices and the colour profile (not the courses).",
    name: "Name of the state",
    save: "Save state",
    restore: "Restore",
    restoreConfirm: (name: string) => `Restore the state ”${name}”? It can be undone with Undo.`,
    compare: "Compare",
    remove: "Remove",
    none: "No saved states.",
    same: "No differences from now.",
    ppen: "automatically on import",
    undo: "Undo",
    differences: {
      LAYOUT: (name: string, change: string) => `The layout ${name}: ${change === "ADDED" ? "new since the state" : change === "REMOVED" ? "removed since the state" : "changed"}`,
      SHEET: (course: string, layout: string) => `The sheet ${course} in ${layout}`,
      CLASS: (name: string, from: string, to: string) => `${name}: ${from} → ${to}`,
      TEMPLATES: "Paper template and Maps per sheet",
      PROFILE: "The colour profile"
    }
  }
};

export const printWhatEn: Texts<typeof printWhatSv> = {
  modeClasses: "Classes",
  modeProof: "Proof sheets (one of each)",
  layout: "All sheets in the layout",
  count: "Number",
  entered: "Entered + spares",
  own: "Own number",
  copies: "Maps per sheet",
  classes: "Classes",
  allClasses: "All classes",
  noClasses: "The classes are read from the event.",
  layoutLink: "Change the paper in Layout"
};
