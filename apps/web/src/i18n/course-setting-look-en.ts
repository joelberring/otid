import type { Texts } from "../lib/language";
import type { appearanceSv, labelSv } from "./course-setting-appearance-sv";
import type { blProposalSv } from "./course-setting-bl-proposal-sv";

/** Engelska del 29: banans utseende, etiketten vid kontrollen och godkännandet av BL-förslaget. */
const thousands = (value: number) => Math.round(value).toLocaleString("en-GB").replace(/,/g, " ");
const STANDARD = { ISOM2017: "ISOM 2017-2", ISSPROM2019: "ISSprOM 2019-2" } as const;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const appearanceEn: Texts<typeof appearanceSv> = {
  heading: "Appearance",
  help: "Applies to all courses, on the map and in print. The ratios are against the standard's dimensions and follow along to Purple Pen.",
  presets: "Quick choices",
  preset: {
    standard: (standard: keyof typeof STANDARD) => `Standard (${STANDARD[standard]})`,
    enlarged: "Enlarged at 1:10 000 (youth and veterans)",
    "sprint-rings": "Larger circles: 6.0 mm as in sprint",
    "smaller-numbers": "Smaller numbers: 3.0 mm"
  },
  presetHelp: {
    standard: "Circles, lines and numbers at the standard's size.",
    enlarged: "ISOM 2017-2 (2.9.1): at 1:10 000 everything is enlarged to 150 %, the course overprint too. Recommended for the youngest and for veterans.",
    "sprint-rings": "The circle from ISSprOM 2019-2 on the forest map, e.g. for night. Outside ISOM 2017-2.",
    "smaller-numbers": "Like the codes in All controls. Below ISOM's 4.0 mm."
  },
  fields: { circleSize: "Circle size", lineWidth: "Line width", numberSize: "Number size" },
  paperLabel: { circleSize: "circle", lineWidth: "line", numberSize: "number" },
  ratio: "ratio",
  save: "Save",
  paper: (label: string, standard: string, actual: string) => standard === actual ? `${label} ${actual} mm` : `${label} ${standard} → ${actual} mm`,
  at: (scale: number) => `On paper at 1:${thousands(scale)}:`,
  outside: (min: number, max: number) => `Purple Pen allows ${min}–${max} mm.`,
  notNumber: "Write a number, e.g. 1.2.",
  scaling: "Scaling",
  scalings: { None: "None", RelativeToMap: "Relative to the map", RelativeTo15000: "Relative to 1:15 000" },
  scalingHelp: {
    None: "The same mm on paper at all print scales.",
    RelativeToMap: "The sizes follow the map's scale: enlarged when the map is printed at a larger scale.",
    RelativeTo15000: "The sizes apply at 1:15 000 and are enlarged at larger scales (150 % at 1:10 000), as in ISOM 2017-2."
  },
  autoLegGap: "Automatic gap at legs",
  autoLegGapHelp: "Where legs cross each other or pass close to a circle (mm, 0 = none).",
  legCircleGap: "Space between line and circle",
  legCircleGapHelp: "The legs end this far (mm on paper) outside circles, start and finish, so that the details at the control show (ISOM 2017-2, 705). Purple Pen has no space; it does not come along in .ppen.",
  circleGapsScaled: "The circle gaps follow the scaling",
  circleGapsScaledHelp: "That is how Purple Pen saves since 2017. Off in older files: the gaps are then taken from the largest saved scale.",
  numbersPerVariant: "Place the numbers for each variant separately",
  numbersPerVariantHelp: "Off: the numbers stand where the whole course has them, the same in course setting and in each variant's print. On: each variant "
    + "and map part gets the numbers placed by its own legs (moved numbers stay).",
  table: { scale: "Scale", courses: "Courses", circle: "Circle", line: "Line", number: "Number" },
  warningsHeading: "Outside the standard",
  warning: (field: "circle" | "line" | "number", scale: number, actual: string, expected: string, standard: keyof typeof STANDARD) =>
    `${{ circle: "The circle", line: "The line", number: "The number" }[field]} is ${actual} mm at 1:${thousands(scale)}; ${STANDARD[standard]} gives ${expected} mm.`,
  enlargementHint: "The map is printed at a larger scale than 1:15 000 without enlargement. Choose Relative to 1:15 000 for ISOM's 150 %.",
  noWarnings: (standard: keyof typeof STANDARD) => `The dimensions follow ${STANDARD[standard]}.`,
  scaleText: (scale: number) => `1:${thousands(scale)}`
};

export const labelEn: Texts<typeof labelSv> = {
  heading: "At the control",
  help: "What is shown by the circle on the map for this course.",
  kinds: {
    SEQUENCE: "Number", CODE: "Code", SEQUENCE_AND_CODE: "Number and code", SCORE: "Points", CODE_AND_SCORE: "Code and points",
    SEQUENCE_AND_SCORE: "Number and points"
  },
  sameFor: "Do the same on",
  relays: (n: number) => `all relay courses (${n})`,
  all: (n: number) => `all courses (${n})`,
  done: (n: number) => n === 0 ? "All already had it." : `${count(n, "course was", "courses were")} changed.`
};

export const blProposalEn: Texts<typeof blProposalSv> = {
  heading: (name: string) => `Proposal for ${name}`,
  intro: "O-Tid has matched the map's colours against the printer's table. Check that each colour comes out right and approve. The map file does not change: what is approved is saved in the event's print profile and only applies to printing.",
  source: (date: string, effective: string | undefined) => `Table checked ${date}${effective ? `, valid from ${effective}` : ""}`,
  sourceLink: "BL's page",
  counts: (safe: number, confirm: number, ambiguous: number) => `${safe} certain · ${confirm} to confirm · ${ambiguous} ambiguous`,
  progress: (decided: number, total: number) => `${decided} of ${total} colours approved`,
  acceptSafe: "Accept all certain",
  acceptSafeNone: "All certain ones are accepted",
  saving: "Saving …",
  saved: "Saved in the event's print profile.",
  saveFailed: "The approval could not be saved. Try again.",
  readOnly: "You can see the proposal but not approve it (read only).",
  noColors: "Reading the map file …",
  confidence: { SAFE: "Certain", CONFIRM: "Confirm", AMBIGUOUS: "Ambiguous" },
  confidenceHelp: {
    SAFE: "Name, use and CMYK point to the same row.",
    CONFIRM: "Probably the right row, but something differs (name, share or order).",
    AMBIGUOUS: "Several BL rows fit and give different prints or orders. Choose a row."
  },
  status: { ACCEPTED: "Approved", KEPT: "The file's colour is kept", PENDING: "Not approved" },
  before: "Before (the file)",
  after: "After (BL)",
  keepFile: "The file's colour",
  accept: "Accept",
  accepted: "Accepted",
  keep: "Keep the file's",
  kept: "The file's is kept",
  choose: "Choose BL row …",
  chosen: "Own BL row (change …)",
  undo: "Undo",
  actionsLabel: (name: string) => `Decision for ${name}`,
  already: "That choice already applies and is saved.",
  done: { ACCEPT: "Approved and saved.", KEEP: "The file's colour is kept, saved.", CHOOSE: "The BL row is chosen and saved.", UNDO: "Undone: not approved." },
  chooseLabel: (name: string) => `BL row for ${name}`,
  chooseCancel: "Close",
  chooseBest: "Fits best",
  chooseRest: "Other rows in BL's table",
  chooseProposed: "the proposal",
  numbers: (file: string, target: string | undefined, ocad: number) => `File ${file}${target ? ` → BL ${target}` : ""} · OCAD ${ocad}`,
  used: (codes: string) => `used for ${codes}`,
  emptyCells: (cells: string) => `empty ${cells} in BL's table (read as 0)`,
  sideOver: "above the course in BL's table",
  sideUnder: "below the course in BL's table",
  sideCourse: "the course's colour",
  thumbAlt: (name: string) => `Map excerpt with only ${name} lit`,
  unused: (n: number) => `${n} colours are not used in the map (they are not drawn and need no decision)`,
  compare: "The whole map before and after",
  compareHelp: "Drag the slider: on the left the map file's colours with the course on top, on the right BL's colours with the course in BL's order. After also shows the proposal for colours not yet approved.",
  compareSlider: "Before and after",
  compareDivider: "The border between before and after",
  compareWaiting: "Drawing the map excerpt …",
  showBefore: "Before",
  showAfter: "After",
  layers: "The order in print",
  layersHelp: (course: string, norm: "ISOM" | "ISSPROM") => norm === "ISSPROM"
    ? `Sprint (ISSprOM 2019-2): circles, lines, start and finish (${course}) lie below black 100 % and green for points, above everything else; numbers and markings lie on top. The map's colours above the course are printed with overprint. The list starts with what lies on top.`
    : `Forest (ISOM 2017-2): circles, lines, start and finish (${course}) lie below black, brown 100 % and blue 100 % for lines and points, above asphalt, the fill of large buildings and all screened colours; numbers and markings lie on top. The map's colours above the course are printed with overprint. The list starts with what lies on top.`,
  layersOnTop: "The course is drawn on top (chosen in the profile or nothing approved to go by).",
  layerOver: "Above the course",
  layerCourse: "The course",
  layerUnder: "Below the course",
  byHand: "Changed by hand",
  layerConflicts: (names: string) => `BL's table puts these on the other side of the course; O-Tid follows the norm and the map file's order (the colours never swap places with each other on the same side): ${names}`,
  layerWrongSide: "wrong side",
  notes: "BL's rules and notes",
  interpretation: "O-Tid's interpretation",
  more: (n: number) => `and ${n} more`,
  doubtfulHeading: (n: number) => n === 0 ? "No doubtful colours" : count(n, "doubtful colour", "doubtful colours"),
  doubtfulIntro: (safe: number) => `${count(safe, "colour fits", "colours fit")} BL's table with certainty; ”Accept all certain” approves them. Only the colours that need your decision are shown here: no certain row in the table, or uncertain whether the colour should lie above or below the course. The full list is under ”Advanced”.`,
  doubtfulNone: "All the map's colours have a certain row in BL's table.",
  doubtSide: "BL's table puts the colour on the other side of the course than the norm; O-Tid follows the norm."
};
