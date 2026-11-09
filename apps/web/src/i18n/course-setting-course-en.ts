import type { Texts } from "../lib/language";
import type { coursePropertiesSv } from "./course-setting-properties-sv";
import type { courseSettingDescriptionSv } from "./course-setting-description-sv";
import type { courseVariantsSv } from "./course-setting-variants-sv";

/** Engelska del 29: banans egenskaper, kontrollbeskrivningen och varianterna i banläggningen. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const km1 = (meters: number) => `${(meters / 1000).toFixed(1)} km`;
const km2 = (meters: number) => `${(meters / 1000).toFixed(2)} km`;

export const coursePropertiesEn: Texts<typeof coursePropertiesSv> = {
  heading: (name: string) => `Properties of ${name}`,
  kind: "Kind of course",
  kinds: { NORMAL: "Normal course", SCORE: "Score course" },
  kindHelp: "A score course is taken in any order and cannot have forks.",
  climb: "Climb (m)",
  climbHelp: "Empty = no climb in the description and on the map.",
  length: "Fixed length (m)",
  lengthHelp: (measured: string) => `Empty = calculated length (${measured}). A fixed length is shown in the description, on the map and in the event.`,
  lengthHelpScore: "A score course has no calculated length. Write a fixed length if a length should be shown in the description and on the map.",
  measured: (min: number, max: number) => min === max ? km1(min) : `${km1(min)}–${km1(max)}`,
  scale: "Scale for the course",
  scaleMap: (scale: string) => `1:${scale} (the map's)`,
  scaleHelp: "The scale the course is printed at. The circle size and where the numbers go follow it, in the editor, the preview and the PDF. Choose it early. Numbers you placed yourself stay where they are (as in Purple Pen).",
  save: "Save the properties",
  saved: "Saved",
  invalid: "Write a whole number in metres (or leave empty).",
  scoreTotal: (points: number, controls: number) => `${points} points on ${count(controls, "control", "controls")}`,
  points: (code: string) => `Points for ${code}`,
  pointsDefault: (code: string, points: number) => `Points for ${code}. Empty = ${points} (the code's first digit).`,
  pointsShort: "Points",
  order: {
    up: "Move up",
    down: "Move down",
    upLabel: (name: string) => `Move ${name} up the list`,
    downLabel: (name: string) => `Move ${name} down the list`,
    drag: "Drag the courses to change the order. The order applies to the list, printing, .ppen and the transfer to the event."
  },
  iof: {
    download: "Download IOF XML (courses)",
    help: "The courses as IOF XML 3.0 CourseData, like Purple Pen's export: a forked course becomes one course per variant with the course's name as " +
      "family (\"Long AC\", \"Long AD\"), so that MeOS, OLA and other timing programs read the variants. The classes are taken from " +
      "the course's classes. The relay teams' allocation of variants does not come along.",
    ocad: "OCAD: O-Tid writes no OCAD format of its own. OCAD's course setting can read courses in IOF XML 3.0 (import courses from " +
      "IOF XML), with the controls at the same map positions in mm. Control descriptions, special objects and print settings do " +
      "not come along; use .ppen when the courses are to continue in Purple Pen."
  },
  routeLength: {
    heading: "Length along route choices",
    help: "The sum of the best route choices on the map for each leg, next to the straight line. Information only; the course's length is the straight line.",
    variant: (code: string) => `Variant ${code}.`,
    count: "Calculate along route choices",
    again: "Finish calculating",
    running: (done: number, total: number) => `Calculating … ${done} of ${total} legs`,
    partial: (done: number, total: number) => `${done} of ${total} legs calculated.`,
    done: (best: number, straight: number, percent: number) => `Along the best route choices ${km1(best)}, the straight line ${km1(straight)}` +
      (percent > 0 ? ` (${percent} % longer).` : "."),
    noRoute: (legs: number) => `${count(legs, "leg has", "legs have")} no route on the map; the length cannot be calculated.`,
    noMap: "Length along route choices is calculated on the map file. Upload the map file first.",
    failed: "The route choices could not be calculated.",
    noLegs: "The course has no legs yet."
  },
  history: {
    restored: (steps: number) => `Undo works for ${count(steps, "change", "changes")} from last time.`,
    dropped: (steps: number) => `${count(steps, "change", "changes")} from last time cannot be undone: someone else has changed the same thing since then.`
  }
};

export const courseSettingDescriptionEn: Texts<typeof courseSettingDescriptionSv> = {
  heading: "Control description",
  label: (course: string) => `Control description: ${course}`,
  help: "Click a box (C–H) to choose a symbol. Click a row to select the control on the map.",
  failed: "The description could not be drawn.",
  empty: "The course has no controls yet.",
  row: (label: string) => `${label}: select the control`,
  box: (label: string, box: string, value: string | undefined) => `${label}, box ${box}${value ? `: ${value}` : ""}`,
  directive: (label: string, value: string | undefined) => `${label}, directive${value ? `: ${value}` : ""}`,
  textLine: (label: string, before: boolean) => `${label}: text line ${before ? "before" : "after"}`,
  boxNames: {
    C: "which of the features", D: "feature", E: "feature or appearance", F: "dimension or combination", G: "location of the control",
    H: "other", all: "directive"
  },
  picker: {
    heading: (label: string, box: string, name: string) => box === "all" ? `${label}, ${name}` : `${label}, box ${box} (${name})`,
    search: "Search symbol",
    searchText: "Search symbol or write a dimension (e.g. 2m or 4x4)",
    options: "Symbols",
    recent: "Recently used",
    none: "None (clear the box)",
    text: (value: string) => `Use the text "${value}"`,
    nothing: "No symbol has that name.",
    close: "Close",
    keys: "The arrows move, Enter chooses, Escape closes."
  },
  textLines: {
    heading: "Text lines",
    before: "Text before the control",
    after: "Text after the control",
    save: "Save the text",
    help: "An empty field removes the line.",
    courseOnly: (before: boolean, value: string) => `Only on this course, ${before ? "before" : "after"}: "${value}".`
  },
  settings: {
    heading: "Settings for the description",
    standard: "Standard",
    standards: { "2004": "IOF 2004", "2018": "IOF 2018" },
    language: "Language",
    languages: { sv: "Svenska", en: "English" },
    kind: "Show",
    kinds: { SYMBOLS: "Symbols", TEXT: "Text", SYMBOLS_AND_TEXT: "Symbols and text" },
    stored: "Language and display are saved in this browser for the event."
  },
  print: "Print descriptions",
  page: {
    title: "Control descriptions",
    back: "Back to course setting",
    help: "Choose courses and how many of each. The descriptions are packed tightly on A4 to cut out. Print at 100 % scale.",
    loading: "Fetching the course setting …",
    failed: "The course setting could not be fetched.",
    retry: "Try again",
    noSetting: "There is no course setting yet.",
    courses: "Courses",
    all: "All courses",
    allControls: "All controls",
    variants: "Variants",
    allBranches: "All branches",
    kind: "Show",
    box: "Box size",
    boxSize: (value: number) => `${value} mm`,
    copies: "Copies per course",
    language: "Language",
    printButton: "Print",
    download: (name: string) => `Download SVG: ${name}`,
    pages: (pages: number, items: number) => `${count(pages, "page", "pages")}, ${count(items, "description", "descriptions")}.`,
    none: "Choose at least one course.",
    scaled: "A description is larger than the page and has been shrunk.",
    sheet: (page: number, pages: number) => `Page ${page} of ${pages}`,
    missing: (names: readonly string[]) => `Not included in the print (the description could not be worked out): ${names.join(", ")}.`,
    failedCourse: (name: string) => `The description for ${name} could not be drawn.`
  }
};

export const courseVariantsCsEn: Texts<typeof courseVariantsSv> = {
  heading: "Variants",
  summary: (total: number, kept: number) => kept === total ? `${count(total, "variant", "variants")}, all used`
    : `${count(total, "variant", "variants")}, ${kept} used (${total - kept} left out)`,
  help: "Variants left out are not transferred to the event, not allocated in the draw, not written to IOF XML and not printed. " +
    "The readout still recognises a runner who ran a variant that was left out.",
  table: {
    caption: (name: string) => `The variants of ${name}`,
    used: "Used",
    code: "Variant",
    straight: "Straight line",
    route: "Route choice",
    controls: "Contr.",
    difference: "Against shortest",
    shortest: "shortest",
    notCounted: "–",
    noRoute: "no route",
    use: (code: string) => `Use variant ${code}`,
    goes: "removed",
    stays: "kept"
  },
  km: km2,
  difference: (meters: number, percent: number) => `+${meters} m (${percent} %)`,
  route: {
    count: "Calculate along route choices",
    again: "Finish calculating",
    running: (done: number, total: number) => `Calculating along route choices … ${done} of ${total} legs`,
    partial: (done: number, total: number) => `${done} of ${total} legs calculated along route choices.`,
    done: "The length along route choices is calculated for all variants and is compared too.",
    noMap: "Length along route choices is calculated on the map file. Upload the map file first.",
    failed: "The route choices could not be calculated."
  },
  prune: {
    heading: "Limit variants",
    mode: "Method",
    modes: { LONGEST: "Remove the longest", DOMINATED: "Longest in every respect (all)", CAP: "Cap: percent or number" },
    longest: (max: number) => `Number to remove (1–${max})`,
    longestHelp: (route: boolean) => `The longest ${route ? "along route choices" : "by straight line"} are removed first, but only those that are longer in every ` +
      "respect than a variant that remains.",
    longestInvalid: (max: number) => `Write a whole number from 1 to ${max}.`,
    dominatedHelp: (route: boolean) => route
      ? "All variants that another is not longer than by straight line or along route choices, and shorter in one of them, are removed."
      : "Only the straight line is compared (calculate along route choices to compare that too): then only the shortest remain.",
    capHelp: "The shortest are kept. Fill in one or both.",
    percent: "At most % longer than the shortest",
    count: "At most number of variants",
    preview: "Preview",
    apply: (n: number) => `Remove ${count(n, "variant", "variants")}`,
    cancel: "Cancel",
    nothing: "Nothing to remove with those choices.",
    goes: (n: number) => `Removed (${n}):`,
    stays: (n: number) => `Kept (${n}):`,
    reasons: {
      LONGEST: (by: string | undefined) => by ? `longer than ${by}` : "longer",
      DOMINATED: (by: string | undefined) => by ? `longer than ${by}` : "longer",
      OVER_PERCENT: () => "over the percentage limit",
      OVER_COUNT: () => "over the number"
    },
    needed: (what: string) => `needed for ${what}`,
    last: "the last variant",
    control: (code: string) => `control ${code}`,
    leg: (from: string, to: string) => `the leg ${from}–${to}`,
    invalid: "Write a whole number (or leave empty)."
  },
  useAll: "Use all variants",
  unused: (what: readonly string[]) => `Not used by any variant: ${what.join(", ")}.`,
  tooMany: (n: number) => `${n} variants are used. The event takes at most 100 per course; leave out more before the courses are transferred.`,
  relay: "The course has relay teams. A balanced relay needs all variants for the teams to run the same legs; " +
    "only leave out variants for an unequally forked relay.",
  failed: "The variants could not be changed."
};
