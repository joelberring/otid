import { COURSE_SETTING_SKETCH_MAX_POINTS } from "@o-tid/contracts";
import type { Texts } from "../lib/language";
import type { notesSv } from "./course-setting-notes-sv";
import type { courseSettingFieldSv } from "./course-setting-field-sv";
import type { moveSharedSv } from "./course-setting-move-sv";
import type { courseSettingSuggestSv } from "./course-setting-suggest-sv";
import type { courseSettingCuttingSv } from "./course-setting-cutting-sv";

/** Engelska del 28: notiserna med ritning och kartfel, fältläget, flytt av delade kontroller, beskrivningsförslagen och ringklippen. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const notesEn: Texts<typeof notesSv> = {
  kind: { label: "Kind", COURSE_SETTING: "Course setting", MAP_ERROR: "Map error" },
  kindFilter: { label: "Kind", ALL: "Both kinds", COURSE_SETTING: "Course setting", MAP_ERROR: "Map error" },
  sketchTarget: "Drawing on the map",
  delete: "Delete",
  deleteConfirm: "Delete the note? The replies and the photo are deleted too. This cannot be undone.",
  deleteReply: "Delete the reply",
  deleteReplyConfirm: "Delete the reply? This cannot be undone.",
  deleteQueued: "The deletion is sent when the network is back.",
  deleteFailed: "The note could not be deleted on the phone.",
  rejectedDelete: (status: number) => `The deletion (response ${status})`,
  sketch: {
    drawMapError: "Draw map error",
    draw: "Draw in a note",
    heading: { MAP_ERROR: "Draw map error", COURSE_SETTING: "Draw in the note" },
    help: "Drag to draw freely or click point by point (Enter ends the line). The wheel, the arrow keys or two fingers move the map.",
    helpTouch: "Draw with one finger. Two fingers move and zoom the map.",
    style: "Colour",
    styles: { MAP_ERROR: "Map error", MARKING: "Streamers/marking", GENERAL: "General" },
    short: { MAP_ERROR: "Map error", MARKING: "Streamers", GENERAL: "General" },
    shape: "Shape",
    shapes: { LINE: "Line", AREA: "Area" },
    intent: "Meaning",
    intents: { NONE: "Marking", WRONG: "Is wrong (dashed)", RIGHT: "Should be here (arrow)" },
    undo: "Undo",
    finishShape: "Finish the line",
    done: "Done – write text",
    cancel: "Cancel",
    cancelConfirm: "Discard the drawing?",
    count: (shapes: number, points: number) => shapes === 0 && points === 0 ? "Nothing drawn yet."
      : `${count(shapes, "part", "parts")} · ${points} of ${COURSE_SETTING_SKETCH_MAX_POINTS} points`,
    full: `The drawing is full (at most ${COURSE_SETTING_SKETCH_MAX_POINTS} points or 20 parts).`,
    empty: "Draw something first."
  },
  exportLink: "Map errors to the mapper …",
  export: {
    title: "Map errors to the mapper",
    back: "Back to course setting",
    intro: "What is downloaded and printed is exactly what shows under Preview: the map, the drawing, the text and the chosen photos. No courses, controls, course names, control codes or names of the person who wrote.",
    textReminder: "Check that the text does not reveal control sites.",
    mapMakerIntro: "The map errors from the course setters, without courses and controls. Reply, mark them done when the map is corrected, or print and download them.",
    reply: "Reply",
    sendReply: "Send the reply",
    markDone: "Done – corrected",
    reopen: "Reopen",
    actionFailed: "Saving failed. Try again.",
    photoReminder: "A photo can show a kite or a flag. Only include photos that do not reveal a control site.",
    none: "No map errors. Draw a map error in course setting (Notes → Draw map error) or choose the kind Map error for a note on a point.",
    loading: "Reading the map errors and the map …",
    failed: "The map errors could not be read.",
    noMap: "The event has no map file; the excerpts are missing.",
    mapFailed: "The map file could not be drawn; the excerpts are missing.",
    include: "Include",
    includePhoto: "Include the photo",
    statusFilter: "Show",
    statuses: { OPEN: "Open", DONE: "Done", ALL: "All" },
    near: (meters: number) => `Close to a control (about ${meters} m). The excerpt or the position can reveal the control site – not included by default.`,
    selected: (n: number, total: number) => `${n} of ${count(total, "map error", "map errors")} in the export.`,
    preview: "Preview",
    print: "Print or save as PDF",
    geojson: "Download GeoJSON",
    georef: (crs: string) => `GeoJSON in the map's coordinate system (${crs}), for QGIS and OCAD.`,
    georefUnknown: "GeoJSON in the map's projected metres (the coordinate system is unknown), for QGIS and OCAD.",
    noGeoref: "The map file has no georeference: GeoJSON in the map's mm (as in the OCAD file).",
    sheetTitle: "Map errors",
    number: (index: number) => `Map error ${index}`,
    statusDone: "Fixed",
    scale: (scale: number) => `The map's scale 1:${scale}. The excerpts are not centred on the map error.`,
    photoAlt: (index: number) => `Photo for map error ${index}`,
    renderAlt: (index: number) => `Map excerpt for map error ${index}`
  }
};

export const courseSettingFieldEn: Texts<typeof courseSettingFieldSv> = {
  position: "My position",
  positionOn: "My position: shown. Tap to follow.",
  positionFollow: "My position: following. Tap to turn off.",
  positionOff: "My position: off. Tap to show.",
  waiting: "Waiting for position …",
  accuracy: (meters: number) => `Position ±${meters} m`,
  noGeoreference: "The map file has no georeference – the position cannot be shown on the map.",
  unsupportedCrs: "The map's coordinate system is not supported – the position cannot be shown.",
  denied: "Location access denied. Allow location for the page in the browser's settings and tap again.",
  unavailable: "The position is not available right now.",
  timeout: "No position yet – trying again.",
  noGeolocation: "The browser cannot give a position.",
  insecure: "The position needs a secure connection (HTTPS).",
  moveHere: "Move here",
  moveHereCountdown: (seconds: number) => `Measuring … ${seconds}`,
  cancel: "Cancel",
  moved: (meters: number) => `Moved, accuracy ±${meters} m`,
  outside: "The position is outside the map – the control is not moved.",
  noFix: "No position to move to yet.",
  step: { N: "Move 1 m north", S: "Move 1 m south", E: "Move 1 m east", W: "Move 1 m west" },
  stepGroup: "Fine-tune the selected control (1 m per tap)",
  selected: (label: string) => `Selected: ${label}`,
  none: "Tap a control",
  course: "Course",
  variant: "Variant",
  allControls: "All controls",
  allVariants: "All branches",
  start: "start", finish: "finish", crossing: "crossing point",
  control: (code: string) => `control ${code}`,
  undo: "Undo",
  details: "Details",
  detailsTitle: (label: string) => `Details for ${label}`,
  f: "Height (column F, m)",
  fQuick: "Quick choices for height",
  g: "Position (column G)",
  gNone: "None",
  save: "Save",
  close: "Close"
};

export const moveSharedEn: Texts<typeof moveSharedSv> = {
  heading: (code: string) => `Move control ${code}?`,
  intro: (meters: number, course: string) => `The move is ${meters} m on ${course}. The control is also on:`,
  all: "Move in all courses",
  allHelp: "The same control, a new position for all courses.",
  newOnly: "New control only in",
  newHelp: (code: string, old: string) => `Control ${code} at the new position; ${old} stays for the other courses. The description is filled in anew.`,
  cancel: "Cancel",
  cancelHelp: "The control goes back.",
  occurrencesAll: (n: number) => `The control is on the course ${n} times (the same circle); all are changed.`,
  occurrencesOne: (n: number) => `The control is on the course ${n} times; only the one in the shown variant is changed.`,
  remember: "Remember for this session",
  rememberedAll: (code: string) => `${code} was moved in all courses (the choice you saved for the session).`,
  rememberedNew: (code: string, old: string, course: string) => `New control ${code} only in ${course}; ${old} stays (the choice you saved for the session).`,
  created: (code: string, old: string, course: string) => `New control ${code} in ${course}; ${old} stays in the other courses.`,
  settings: {
    heading: "Move shared controls",
    threshold: "Ask when a control that is on several courses is moved more than",
    meters: (meters: number) => `${meters} m`,
    help: (mm: string, scale: number) => `Smaller moves never ask. On the map at 1:${scale.toLocaleString("en-GB")} that is ${mm} mm. Purple Pen asks at 50 m.`,
    remembered: (choice: "ALL" | "NEW") => `Saved for the session: ${choice === "ALL" ? "move in all courses" : "new control only in the course"}.`,
    notRemembered: "No choice saved: the question is shown.",
    reset: "Ask again"
  }
};

export const courseSettingSuggestEn: Texts<typeof courseSettingSuggestSv> = {
  heading: (label: string) => `Suggestions for ${label}`,
  level: { HIGH: "certain", MEDIUM: "likely", LOW: "uncertain" },
  confidence: (level: string, percent: number) => `${level} (${percent} %)`,
  accept: "Accept",
  acceptEmpty: (n: number) => `Accept all empty (${n})`,
  acceptEmptyHelp: "The best suggestion for each control in the view that has no feature (column D).",
  alternatives: "Other interpretations",
  alternative: (text: string, reason: string) => `Accept ${text}: ${reason}`,
  computing: "Working out suggestions from the map …",
  failed: "The suggestions could not be worked out from the map file.",
  none: "The map has no clear feature in the circle. Choose the symbols yourself.",
  noMap: "Suggestions need the map file (OCAD or Mapper).",
  hover: "Point at a suggestion to see the feature on the map.",
  preview: "suggestion",
  previewHelp: (n: number) => n === 1 ? "1 control shows a suggestion (lighter) until it is accepted."
    : `${n} controls show suggestions (lighter) until they are accepted.`,
  field: (text: string) => `Suggestion: ${text}`
};

export const courseSettingCuttingEn: Texts<typeof courseSettingCuttingSv> = {
  heading: "Circle cut-outs",
  overlap: "Cut circles where they overlap",
  overlapHelp: "Where two circles on the same map run into each other, the arc inside the other is removed so that the outline shows.",
  details: "Cut circles over important details",
  detailsHelp: "The circle is cut where it covers paths, cliffs, fences, streams and small point features, at most a quarter of the circle.",
  noMap: "Cutting over details needs the map file.",
  computing: "Working out the cut-outs …",
  failed: "The cut-outs over details could not be worked out from the map file. The circles are drawn whole.",
  bake: "Make the cut-outs fixed (for Purple Pen)",
  bakeHelp: "The cut-outs over details are then saved in the controls and follow along in the .ppen file. The overlap cut-outs depend on the course and are not saved.",
  baked: (n: number) => n === 0 ? "The cut-outs were already fixed." : `${count(n, "control", "controls")} got fixed cut-outs.`
};
