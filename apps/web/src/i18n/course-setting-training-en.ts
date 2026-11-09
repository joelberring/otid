import type { Texts } from "../lib/language";
import type { trainingSv } from "./course-setting-training-sv";

/** Engelska del 30: träningsläget i banläggningen (ADR-0192). */
export const trainingEn: Texts<typeof trainingSv> = {
  tab: "Training",
  heading: "Training",
  help: "Turn the course into a training: corridor, last safe point, contours only, windows and more. The forms apply to sections of the course and can follow each other on the same map.",
  chooseCourse: "Choose a course at the top to turn it into a training. Drawn areas with filters can apply to all courses.",
  show: "Show the training on the map",
  showHelp: "Off = the map as usual (before), on = with the training (after).",
  readOnly: "You can see the training but not change it.",
  removeCourse: "Remove the training for the course",
  forms: {
    heading: "Add",
    CORRIDOR: { title: "Corridor", line: "Only a strip along the legs is shown." },
    ATTACK: { title: "Last safe point", line: "A smaller circle on what to find before the control." },
    BAND: { title: "Contours", line: "Only contours (or another filter) along part of the course." },
    WINDOW: { title: "Window", line: "Only circles around the controls are shown." },
    NO_MAP: { title: "Without map", line: "Legs without a map: compass and distance judgement." },
    AREA: { title: "Area", line: "Draw an area with its own filter, e.g. contours only here." },
    STAR: { title: "Star", line: "Out and back to a central point." },
    LINE: { title: "Line", line: "Follow a drawn line and find the controls along it." },
    PAIRS: { title: "Cap", line: "Pairs with 1a and 1b: one puts out the cap, the other brings it in." },
    PIECES: { title: "Map pieces", line: "Memory and puzzle: each leg on its own small map." },
    MIRROR: { title: "Mirror", line: "The map and the course mirrored in print." }
  },
  base: {
    heading: "The map for the whole course",
    help: "The filter applies everywhere on the course, also in the sections."
  },
  outside: {
    heading: "Outside the sections",
    FULL: "The whole map", WHITE: "White", TINT: "Tinted", FILTER: "Filter",
    tint: "Tint (share removed)"
  },
  sections: {
    heading: "Sections",
    none: "No sections. Add a form above; it applies from start to finish until you change it.",
    from: "From", to: "To", start: "Start", finish: "Finish",
    form: "Form",
    forms: { CORRIDOR: "Corridor", WINDOW: "Window", BAND: "Area along the course", NO_MAP: "Without map" },
    shape: "Shape of the corridor", angular: "Angular", smooth: "Smooth",
    width: "Width (m)", smoothing: "Smoothing", legWidth: (leg: string) => `Width ${leg} (m)`, legWidths: "Width per leg",
    windowShape: "The window's shape", circle: "Circle", square: "Square", radius: "Radius (m)",
    band: "The band's width (m)",
    filter: "What shows in the section",
    marker: "Marking at the change", markers: { NONE: "None", TEXT: "Text", BAR: "Cross bar" },
    markerText: "Text", markerPlaceholder: (text: string) => text,
    remove: "Remove the section",
    up: "Move up", down: "Move down",
    title: (index: number, form: string, from: string, to: string) => `${index}. ${form}: ${from} → ${to}`
  },
  filter: {
    presets: { ALL: "The whole map", CONTOURS: "Contours only", CONTOURS_WATER_ROCK: "Contours + water + rock", NO_VEGETATION: "Without vegetation",
      NO_PATHS: "Without paths", PATHS_ROADS: "Only paths and roads", CUSTOM: "Custom" },
    groups: { LANDFORM: "Contours and landforms (1xx)", ROCK: "Rock and boulders (2xx)", WATER: "Water and marsh (3xx)",
      VEGETATION: "Vegetation (4xx)", PATHS: "Roads and paths (501–508)", MANMADE: "Man-made: buildings, walls, fences (5xx)",
      FORBIDDEN: "Out-of-bounds area and course overprint in the map (520, 7xx)", TECHNICAL: "North lines and technical (6xx)", OTHER: "Other (unknown number)" },
    symbols: "Individual symbols",
    symbolsHelp: "Tick or untick a symbol to override the group. The groups follow ISOM 2017-2 and ISSprOM 2019-2; unknown numbers by name.",
    noSymbols: "The map's symbols are shown once the map is read.",
    search: "Search symbol",
    count: (n: number) => `${n}`,
    safety: "Out-of-bounds areas and north lines show in all presets."
  },
  areas: {
    heading: "Drawn areas",
    none: "No areas.",
    draw: "Draw area",
    drawing: (n: number) => `Click on the map for the area's corners (${n} points).`,
    finish: "Done", cancel: "Cancel",
    name: (index: number) => `Area ${index}`,
    courses: "Applies to", thisCourse: "This course", allCourses: "All courses",
    remove: "Remove the area"
  },
  attack: {
    heading: "Last safe point",
    help: "Click on a leg where the last safe point is. The circle is not a control: it is not shown in the description, the length or the readout.",
    add: "Place last safe point",
    adding: "Click on the map close to the leg.",
    noLeg: "Click closer to a leg on the course.",
    size: "Size (share of the circle)",
    style: "Style", styles: { SOLID: "Solid", DASHED: "Dashed", THIN: "Thinner" },
    none: "No last safe points on the course.",
    row: (leg: string) => `Leg ${leg}`,
    remove: "Remove"
  },
  star: {
    heading: "Star",
    center: "Central control",
    controls: "Points (controls)",
    create: "Create star course",
    createEach: "One course per control",
    created: (name: string) => `${name} is created.`,
    createdMany: (n: number) => `${n} star courses are created.`,
    print: "Print", printAll: "All points on one map", printEach: "One map per point (out and back)",
    courseName: (code: string) => `Star ${code}`,
    needCenter: "Choose a central control and at least one point.",
    remove: "Not a star any more"
  },
  line: {
    heading: "Line orienteering",
    help: "The runner's map has the start, finish and the line but not the controls. The controller's map has everything.",
    draw: "Draw the line", drawing: (n: number) => `Click along the line (${n} points).`,
    fromLegs: "Line along the legs", finish: "Done", cancel: "Cancel", remove: "Remove the line",
    points: (n: number) => `The line has ${n} points.`
  },
  pairs: {
    heading: "Cap orienteering",
    help: "The runners run in pairs and take turns to put out the cap and bring it in. The map shows all a and b points.",
    mode: "Pair up", adjacent: "Next to each other (1–2, 3–4 …)", halves: "First and second half",
    make: "Pair up the controls",
    count: (n: number) => `${n} ${n === 1 ? "pair" : "pairs"}`,
    legs: "Show the legs",
    print: "Print", common: "One shared map", separate: "One map for runner A and one for B",
    separateHelp: "Solid circle: put out the cap. Dashed: bring it in.",
    unpaired: (n: number) => `${n} ${n === 1 ? "control" : "controls"} without a pair ${n === 1 ? "is" : "are"} shown with an ordinary number.`,
    forked: "Cap orienteering is done on a course without forks.",
    remove: "Not cap any more"
  },
  pieces: {
    heading: "Map pieces",
    help: "Printed from the preview (Print → Map pieces): a small map per leg.",
    size: "The piece's side (mm)", scale: "Scale 1:", margin: "Margin (m)", order: "Order", course: "The course's order", shuffled: "Shuffled (puzzle)",
    remove: "No map pieces"
  },
  mirror: {
    heading: "Mirrored map",
    help: "The print (the preview and the PDF) flips the map and the course left–right, so that known areas become new. The numbers can be read as usual; the map's own texts are mirrored. Here in the editor the map is drawn as usual.",
    on: "Mirror the map and the course in print"
  },
  print: {
    pieces: "Map pieces: a small map per leg (memory and puzzle)",
    controller: "The controller's map (line orienteering, with the controls)"
  },
  edits: {
    PUT_TRAINING: "Changed the training"
  }
};
