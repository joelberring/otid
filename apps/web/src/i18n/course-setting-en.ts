import type { Texts } from "../lib/language";
import type { courseSettingSv } from "./course-setting-sv";

/** Engelska del 28: banläggningens grund (banor, verktyg, vald, kontroller att titta på, fil, versioner, överföring). */
export type CourseSettingTexts = Texts<typeof courseSettingSv>;

const meters = (value: number) => value >= 10_000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const courseSettingEn: Texts<typeof courseSettingSv> = {
  title: "Course setting",
  back: "Back to the event",
  backToEvents: "Back to My events",
  backShort: "The event",
  backShortEvents: "My events",
  printMenu: "Print courses …",
  descriptionsMenu: "Control descriptions …",
  link: "Course setting",
  linkHelp: "Put the courses on the map file in the browser, or import a .ppen from Purple Pen.",
  loading: "Fetching the course setting …",
  loadFailed: "The course setting could not be fetched.",
  retry: "Try again",
  noMapFile: "The course setting is drawn on the map file (OCAD or Mapper). Upload the map file first.",
  readingMap: "Reading the map file …",
  readingMapProgress: (percent: number) => `Reading the map file … ${percent}\u00a0%`,
  mapFailed: "The map file could not be read in the browser. The courses can still be changed.",
  mapSaved: "The map file is saved.",
  start: {
    heading: "No course setting yet",
    help: "Import a .ppen file from Purple Pen or start with an empty course setting on the map file.",
    empty: "Start with an empty course setting",
    emptyTitle: "Course setting"
  },
  map: (course: string) => `Map with course overprint: ${course}`,
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fit: "Show the whole map",
  courses: {
    heading: "Courses",
    all: "All controls",
    allSummary: (n: number) => count(n, "control", "controls"),
    summary: (length: string, controls: number, variants: number, excluded = 0) =>
      `${length} · ${count(controls, "control", "controls")}${variants > 1 || excluded > 0 ? ` · ${count(variants, "variant", "variants")}` : ""}` +
      (excluded > 0 ? ` (${excluded} left out)` : ""),
    length: (min: number, max: number) => min === max ? meters(min) : `${meters(min)}–${meters(max)}`,
    add: "New course",
    addName: "Name of the new course",
    newName: (n: number) => `Course ${n}`,
    rename: "Rename",
    renameLabel: (name: string) => `New name for ${name}`,
    remove: "Remove the course",
    save: "Save",
    cancel: "Cancel",
    variant: "Variant",
    allVariants: "All branches",
    variantOption: (code: string, controls: number) => `${code} · ${count(controls, "control", "controls")}`,
    classes: "Classes (as in Purple Pen, e.g. M21, W21)"
  },
  tools: {
    heading: "Tools",
    SELECT: "Select and move",
    ADD_CONTROL: "New control",
    ADD_START: "New start",
    ADD_FINISH: "New finish",
    ADD_CROSSING: "New mandatory crossing point",
    ADD_MAP_EXCHANGE: "New map exchange",
    INSERT_EXISTING: "Insert existing control",
    ADD_BEND: "Bend point on a leg",
    NOTE: "New note",
    SPECIAL: "Special object (out-of-bounds area, optional crossing point, text …)",
    title: {
      ADD_CROSSING: "Mandatory crossing point – part of the course and not numbered; the runner must pass it. Optional crossing points are under Objects",
      SPECIAL: "Objects – crossing points, barriers, services, text and graphics"
    },
    short: { SELECT: "Select", ADD_CONTROL: "Control", ADD_START: "Start", ADD_FINISH: "Finish", ADD_CROSSING: "Mand. crossing",
      INSERT_EXISTING: "Insert", ADD_BEND: "Bend", NOTE: "Note", FORK: "Fork", SPECIAL: "Objects" },
    shortcut: { SELECT: "V", ADD_CONTROL: "K", ADD_START: "S", ADD_FINISH: "M", ADD_CROSSING: "P", INSERT_EXISTING: "L", ADD_BEND: "B",
      NOTE: "N", FORK: "G", SPECIAL: "O" },
    forkTool: "Fork here (at the selected control)",
    forkNeedsSelection: "Select a control on the course first.",
    withKey: (label: string, key: string) => `${label} (${key})`,
    help: {
      SELECT: "Click to select. Drag a control, a number or a bend point to move it. Drag the map to pan.",
      ADD_CONTROL: "Click on the map where the control should be. In a course it is inserted after the selected control; a click in a faint circle inserts the existing control (Alt: always new).",
      ADD_START: "Click where the start should be.",
      ADD_FINISH: "Click where the finish should be.",
      ADD_CROSSING: "Click where the mandatory crossing point should be. In a course it is turned along the leg.",
      ADD_MAP_EXCHANGE: "Click where the map exchange should be. In a course it is inserted after the selected control.",
      INSERT_EXISTING: "Click a control circle to insert the control in the course after the selected control.",
      ADD_BEND: "Select a leg and click where the line should bend.",
      NOTE: "Click on the map, a control or a leg where the note should go.",
      SPECIAL: "Choose a kind under Objects. An area or line: click the corners and finish with Enter or a click on the first point."
    },
    undo: "Undo",
    redo: "Redo",
    removeFromCourse: "Remove from the course",
    deleteControl: "Delete the control",
    fork: "Fork",
    loop: "Loop",
    removeSplit: "Remove the fork",
    branches: "Number of branches",
    resetNumber: "Number back",
    straighten: "Straight leg",
    keys: "Keys: Delete removes, Escape cancels, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes. The arrows move the map."
  },
  selected: {
    heading: "Selected",
    none: "Nothing selected. Click a control or a leg.",
    control: (label: string) => `Selected: ${label}`,
    described: "The control description in text",
    code: "Code",
    saveCode: "Change the code",
    leg: (from: string, to: string) => `Leg ${from}–${to}`,
    deselect: "Deselect",
    description: "Description",
    more: "More …"
  },
  label: {
    START: "start", FINISH: "finish", CROSSING_POINT: "crossing point", MAP_EXCHANGE: "map exchange", MAP_ISSUE: "map issue",
    control: (code: string | undefined) => code ? `control ${code}` : "control without a code"
  },
  problems: {
    failed: (names: readonly string[]) => `This could not be worked out: ${names.join(", ")}. The map shows what it can. Undo the latest change or reload the page.`,
    circleGaps: "The circle cut-outs over details (the circles are drawn whole)",
    suggestions: "The control description suggestions"
  },
  status: {
    saved: "Saved",
    saving: "Saving …",
    pending: "Changed – saving shortly",
    conflict: "Conflict – someone else has made changes",
    failed: "Not saved – trying again",
    stopped: "Not saving – sign in again",
    reload: "Reload",
    conflictHelp: (name: string | null, time: string) =>
      `${name ?? "Someone"} saved at ${time}. Reload to see that version; your latest changes are not saved.`
  },
  checks: {
    heading: "Controls to look at",
    none: "Nothing to remark on.",
    show: "Show on the map",
    levels: { ERROR: "Error", WARNING: "Warning", NOTICE: "Note" },
    groups: {
      DUPLICATE_CODE: "Same code on several controls", MISSING_CODE: "Code missing", COURSE_WITHOUT_START_OR_FINISH: "Start or finish missing",
      CONTROL_IN_FORBIDDEN: "Control in a forbidden area", LEG_NO_ROUTE: "Cannot be reached legally",
      CONTROLS_TOO_CLOSE: "Too close to each other", INVERTIBLE_CODE: "Code that can be read upside down",
      SAME_CONTROL_TWICE_IN_ROW: "Same control twice in a row", LEG_THROUGH_CONTROL: "Leg through another circle",
      UNUSED_CONTROL: "Unused controls", LEG_THROUGH_FORBIDDEN: "The straight line crosses a forbidden area",
      CONTROLS_NEAR: "Close to each other – give the feature", NUMBER_ON_OBSTACLE: "Number on a building or dark area",
      LEVEL_DEVIATION: "Differs from the course's level"
    },
    accept: "Accept",
    acceptLabel: (row: string) => `Accept: ${row}`,
    acceptAll: (n: number) => `Accept all ${n}`,
    acceptHelp: "Accept when it is intended. The warning comes back if the controls or the area are replaced or moved more than 25 m.",
    accepted: (n: number) => `Accepted (${n})`,
    unaccept: "Undo",
    unacceptLabel: (row: string) => `Undo the acceptance: ${row}`,
    notAcceptable: "Must be corrected",
    routes: (n: number) => n === 1 ? "Calculating the route choice for a leg that crosses a forbidden area …"
      : `Calculating the route choices for ${n} legs that cross forbidden areas …`,
    routesHelp: "A straight line through a forbidden area is not an error when there is a way around. With the map file the route choices are calculated and only legs without a legal route become errors.",
    routesFailed: "The route choices could not be calculated; the legs through forbidden areas are listed as notes.",
    CONTROLS_TOO_CLOSE: (a: string, b: string, distance: number, limit: number, feature?: "SAME" | "UNKNOWN") =>
      feature === "SAME" ? `${a} and ${b} are ${Math.round(distance)} m apart on the same kind of feature (guideline at least ${limit} m).`
      : feature === "UNKNOWN" ? `${a} and ${b} are ${Math.round(distance)} m apart. Under ${limit} m the features should be clearly different; give the feature (column D) to decide.`
      : `${a} and ${b} are ${Math.round(distance)} m apart (guideline at least ${limit} m).`,
    DUPLICATE_CODE: (code: string, n: number) => `The code ${code} is on ${n} controls.`,
    INVERTIBLE_CODE: (code: string) => `The code ${code} can be read upside down.`,
    SAME_CONTROL_TWICE_IN_ROW: (course: string, control: string) => `${course}: ${control} comes twice in a row.`,
    LEG_THROUGH_CONTROL: (courses: string, from: string, to: string, control: string) =>
      `${courses}: the leg ${from}–${to} passes through the circle of ${control}.`,
    LEG_THROUGH_FORBIDDEN: (courses: string, from: string, to: string, what: string) =>
      `${courses}: the straight line ${from}–${to} crosses ${what}; the route choice is not calculated.`,
    LEG_NO_ROUTE: (courses: string, from: string, to: string, what: string) =>
      `${courses}: ${from}–${to} has no route around ${what}.`,
    CONTROL_IN_FORBIDDEN: (control: string, what: string) => `${control} is in ${what}.`,
    forbidden: { "out-of-bounds": "an out-of-bounds area", "dangerous-area": "a dangerous area", "temporary-construction": "a temporary construction",
      boundary: "a boundary that must not be crossed", "forbidden-route": "a forbidden route" },
    COURSE_WITHOUT_START_OR_FINISH: (course: string) => `${course} has no start or finish.`,
    UNUSED_CONTROL: (control: string) => `${control} is not used on any course.`,
    MISSING_CODE: (control: string) => `A control has no code (${control}).`,
    NUMBER_ON_OBSTACLE: (number: string, courses: string) => `Number ${number} is partly on a building (${courses}). Move the number or let O-Tid place it.`
  },
  leg: {
    heading: "Selected leg",
    help: "Select a leg in a course to see the route choices. They are recalculated when you move the controls.",
    analysing: "Calculating the route choices …",
    failed: "The route choices could not be calculated for the leg.",
    waitingForMap: "The route choices are calculated once the map file is read.",
    straight: (value: number) => `Straight line ${meters(value)}`,
    best: (length: number, climb: number, minutes: string) => `Best route ${meters(length)}, ${Math.round(climb)} m climb, about ${minutes}`,
    choices: (n: number) => n === 1 ? "One clear route choice" : `${n} route choices`,
    noRoute: "No route was found between the controls.",
    aroundForbidden: (what: string, extra: number) => `The straight line crosses ${what} – the route choice goes around (+${meters(Math.max(0, extra))}).`,
    noRouteForbidden: (what: string) => `No legal route around ${what}.`,
    routes: "The route choices",
    bestRow: "Best",
    alternative: (index: number) => `Option ${index}`,
    row: (length: number, climb: number, minutes: string) => `${meters(length)} · ${Math.round(climb)} m · ${minutes}`,
    slower: (ratio: number) => `+${Math.max(0, Math.round((ratio - 1) * 100))} %`,
    legend: "Best route as a blue line, other route choices dashed and numbered with the time difference (at most 25 % worse) and the corridor (at most 5 % worse) shaded."
  },
  file: {
    heading: "File",
    import: "Import .ppen",
    importLabel: "Purple Pen file (.ppen)",
    importHelp: "The file is read in the browser. What O-Tid does not interpret is kept untouched and written back.",
    replaceConfirm: "Replace the course setting with the file? The current one is saved as an earlier version.",
    ppenState: "From Purple Pen",
    reading: "Reading the file …",
    invalid: "The file could not be read as a Purple Pen file.",
    tooLarge: "The file is too large.",
    imported: (courses: number, controls: number) => `Imported: ${count(courses, "course", "courses")} and ${count(controls, "control", "controls")}.`,
    warnings: "Things to know about the file",
    download: "Download .ppen",
    purplePenLetters: (rows: readonly { course: string; letters: string; purplePen: string }[]) =>
      `The letters will be different in Purple Pen than on O-Tid's maps (a branch has been removed): ${rows.map(row => `${row.course} ${row.letters} becomes ${row.purplePen}`).join("; ")}. ` +
      "Import the file here again and the branches are paired with O-Tid's letters.",
    lettersNotPaired: (notice: { course: string; lost: readonly string[]; added: readonly string[] }) =>
      `${notice.course}: ` + [notice.lost.length > 0 ? `branches ${notice.lost.join(", ")} on printed maps are no longer in the file (changed or removed)` : "",
        notice.added.length > 0 ? `new branches got ${notice.added.join(", ")}` : ""].filter(Boolean).join("; ") + ". Check the maps before the start.",
    downloadOriginal: (name: string) => `Download the imported file (${name})`,
    failed: "The file could not be saved. Try again."
  },
  revisions: {
    heading: "Earlier versions",
    show: "Show earlier versions",
    none: "No earlier versions yet.",
    kind: { SAVE: "Saved", IMPORT: "Before import", RESTORE: "Before restore" },
    row: (version: number, time: string, name: string | null, courses: number, controls: number) =>
      `Version ${version} · ${time}${name ? ` · ${name}` : ""} · ${count(courses, "course", "courses")}, ${count(controls, "control", "controls")}`,
    restore: "Restore",
    restoreConfirm: (version: number) => `Restore version ${version}? The current one is saved as an earlier version.`,
    restored: (version: number) => `Version ${version} is restored.`,
    failed: "The version could not be restored."
  },
  transfer: {
    heading: "Transfer to the event",
    help: "The courses, controls and variants become the event's, as when a course file is imported. You see the changes before they are saved.",
    button: "Transfer to the event",
    waitForSave: "Wait until the changes are saved.",
    problems: {
      NO_DOCUMENT: "There is no course setting to transfer.",
      NO_COURSES: "No course has both a start and a finish.",
      INVALID_CODES: (controls: string) => `The controls on the courses need codes 1–999 999 (${controls}).`
    },
    failed: "The transfer could not be prepared. Try again."
  }
};
