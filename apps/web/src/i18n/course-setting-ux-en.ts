import type { Texts } from "../lib/language";
import type { courseSettingUxSv } from "./course-setting-ux-sv";

/** Engelska del 28: objektpaletten, vridningen, fångsten, visningen, banorna, kontrollistan och gafflingarna i banläggningen. */
const list = (codes: readonly string[]) => codes.length <= 12 ? codes.join(", ") : `${codes.slice(0, 12).join(", ")} and ${codes.length - 12} more`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const courseSettingUxEn: Texts<typeof courseSettingUxSv> = {
  palette: {
    button: "Objects",
    label: "Objects – special objects such as out-of-bounds areas, crossing points and text",
    heading: "Add an object",
    close: "Close",
    groups: { passages: "Crossing points and map exchange", barriers: "Barriers", service: "Services", graphics: "Text and graphics" },
    items: {
      ADD_CROSSING: ["Mandatory crossing point", "Part of the course but not numbered. The runner must pass here."],
      ADD_MAP_EXCHANGE: ["Map exchange", "Part of the course. The runner changes map here."],
      "optional-crossing-point": ["Optional crossing point", "Not part of the course. Shows where crossing is allowed, e.g. a gate; all or chosen courses."],
      "out-of-bounds": ["Out-of-bounds area", "Hatched area that must not be entered. Click the corners."],
      "forbidden-route": ["Forbidden route", "Crosses on a road or path that must not be followed."],
      boundary: ["Boundary", "A line that must not be crossed, e.g. a fence to be followed around."],
      "dangerous-area": ["Dangerous area", "An area with danger, e.g. a steep slope to be avoided."],
      "temporary-construction": ["Temporary construction", "An area that must not be crossed, e.g. a tent or a stage."],
      water: ["Water", "Drinks station outside the course's controls."],
      "first-aid": ["First aid", "Medical care or first aid."],
      text: ["Text", "Text on the map, e.g. the course's name or a warning."],
      image: ["Image", "An image from the computer, e.g. the club's logo."],
      line: ["Line", "Free line in purple, black or a colour of your own."],
      rectangle: ["Rectangle", "A frame, e.g. around an enlargement."],
      ellipse: ["Ellipse", "A ring or oval."],
      "white-out": ["White background", "Covers the map under text or a description."],
      descriptions: ["Descriptions on the map", "The course's control descriptions printed on the map."],
      "registration-mark": ["Registration mark", "A cross for aligning several prints."]
    },
    imagePick: "Choose image",
    imageHelp: "Choose an image (PNG or JPEG, at most 1 MB) and then click on the map where its top left corner should be.",
    imageTooLarge: "The image is larger than 1 MB.",
    imageFailed: "The image could not be read.",
    imageReady: (name: string) => `Click on the map where ${name} should be.`
  },
  crossing: {
    tooltip: "Mandatory crossing point – part of the course and not numbered; the runner must pass it. Optional crossing points are under Objects.",
    short: "Mand. crossing"
  },
  rotate: {
    heading: "Angle",
    label: "Angle (degrees anticlockwise)",
    alongLeg: "Turn along the leg",
    noLeg: "No leg passes through the crossing point.",
    help: "Drag the handle ↻ on the map. The angle snaps in steps of 5°; hold Shift (or a second finger) for a free angle."
  },
  snap: {
    insert: (label: string) => `Insert ${label}`,
    forceNew: "Always new",
    forceNewHelp: "Create a new control even close to an existing one (or hold Alt).",
  },
  view: {
    button: "Show",
    heading: "Show on the map",
    otherCourses: "Show other courses faintly",
    unused: (n: number) => `Mark unused controls (${n})`,
    inspected: "Checked controls",
    notes: "Notes",
    warnings: "Mark warnings",
    levels: "Level marks"
  },
  courses: {
    duplicate: "Duplicate",
    copyName: (name: string) => `${name} (copy)`,
    removeHeading: (name: string) => `Remove the course ${name}?`,
    removeOrphans: (n: number) => n === 1 ? "One control is no longer used in any other course:"
      : `${n} controls are no longer used in any other course:`,
    removeNone: "All controls in the course are used in other courses and remain.",
    removeWithControls: (n: number) => n === 1 ? "Remove the course and the unused control" : `Remove the course and the ${n} unused controls`,
    removeOnly: "Remove only the course",
    cancel: "Cancel"
  },
  controls: {
    heading: "Controls",
    courseHeading: (name: string) => `Controls in ${name}`,
    empty: "No controls yet. Choose Control in the tools and click on the map.",
    onlyUnused: "Only unused",
    unusedCount: (n: number) => `${n} unused`,
    noUnused: "All controls are used in some course.",
    unused: "unused",
    removeUnused: "Remove all unused",
    removeUnusedConfirm: (codes: readonly string[]) => `Remove ${codes.length === 1 ? "the unused control" : `the ${codes.length} unused controls`}: ${list(codes)}?`,
    removed: (n: number) => n === 1 ? "One unused control removed." : `${n} unused controls removed.`
  },
  forks: {
    forkHere: "Fork here",
    branches: (n: number) => `${n} branches`,
    loop: "Loop",
    loops: (n: number) => n === 1 ? "Loop" : `${n} loops`,
    branch: (letter: string) => `Branch ${letter}`,
    branchOf: (letter: string, n: number) => `Branch ${letter} of ${n}`,
    working: "New controls are put in the branch.",
    next: "Next branch",
    done: "Done",
    join: (label: string) => `The branches join at ${label}`,
    loopJoin: (label: string) => `The loops return to ${label}`,
    emptyBranch: "empty",
    work: (letter: string) => `Work in branch ${letter}`,
    variants: "Variants",
    allVariants: "All branches",
    variant: (controls: number, length: string) => `${count(controls, "control", "controls")} · ${length}`
  }
};
