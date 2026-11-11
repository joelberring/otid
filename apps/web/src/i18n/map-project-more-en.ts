import type { LayerId, Standard } from "../lib/map-project-layer-model";
import type { Texts } from "../lib/language";
import type { mapProjectReconSv } from "./map-project-recon-sv";
import type { mapProjectRectifySv } from "./map-project-rectify-sv";
import type { mapProjectSymbolLayersSv } from "./map-project-symbol-layers-sv";
import type { mapProjectWorkLayersSv } from "./map-project-work-layers-sv";
import type { mapStatsSv } from "./map-stats-sv";

/** Engelska del 33: rekningen, rättningen med passpunkter, lagren, arbets- och skisslagren och kartstatistiken. */
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const percent = (share: number) => `${Math.round(share * 100)} %`;
const km = (meters: number) => meters >= 1000 ? `${(meters / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} km` : `${Math.round(meters)} m`;
const meters = (value: number) => value.toLocaleString("en-GB", { maximumFractionDigits: value < 10 ? 1 : 0 });
type Kind = "similarity" | "affine" | "rubber";
const kindName: Record<Kind, string> = { similarity: "similarity", affine: "affine", rubber: "rubber sheet" };
const STANDARD_NAMES: Record<Standard, string> = { ISOM: "ISOM 2017-2", ISSPROM: "ISSprOM 2019-2" };
const number = (value: number, digits = 0) => value.toLocaleString("en-GB", { maximumFractionDigits: digits });

export const mapProjectReconEn: Texts<typeof mapProjectReconSv> = {
  heading: "Survey",
  help: "The GPS tracks tick off what you walked past. Confirm what you saw with Checked. The layers are never printed.",
  layers: { label: "Layers", STATUS: "Status", COVERAGE: "Coverage", TRACKS: "Tracks" },
  legend: { UNSEEN: "Not surveyed", PASSED: "Passed (GPS)", CHECKED: "Checked" },
  counts: (unseen: number, passed: number, checked: number) => `${unseen} not surveyed · ${passed} passed · ${checked} checked`,
  computing: "Calculating …",
  noGeoreference: "The map has no georeference, so GPS tracks cannot be put on it.",
  record: "Record track",
  recordName: "The track's name",
  recordDefault: (time: string) => `Survey ${time}`,
  stop: "Stop",
  recording: (m: number, points: number) => `Recording · ${km(m)} · ${count(points, "point", "points")}`,
  recordingHelp: "Keep the page open and the screen on; the phone does not record reliably with the screen off. For long rounds: record with the watch and load the GPX file.",
  gpx: "Load GPX file",
  tracks: "Tracks",
  noTracks: "No tracks yet.",
  track: (name: string, person: string | null, date: string, m: number) => [name, person, date, km(m)].filter(Boolean).join(" · "),
  waiting: "waiting for network",
  failed: (status: number) => `not sent (${status})`,
  rename: "Rename",
  remove: "Remove",
  removeConfirm: "Remove the track? The check marks remain.",
  privacy: "The tracks are only visible to the project's members. You can remove your own.",
  checked: "Checked ✓",
  unchecked: "Mark checked",
  checkedBy: (name: string | null, date: string) => `Checked by ${name ?? "unknown"} ${date}`,
  approveArea: (n: number) => `Approve ${n} passed`,
  areaProgress: (covered: number, seen: number, checked: number, objects: number) =>
    `Covered ${percent(covered)} · objects ${percent(seen)} seen, ${percent(checked)} checked (${objects})`,
  settings: "Sight distance",
  settingsHelp: "How close (metres) a track must have passed for the object to count as passed. Shrunk in dense vegetation.",
  groups: { LANDFORMS: "Landforms", ROCK: "Rock and cliffs", STONES: "Boulders", WATER: "Water and marsh", VEGETATION: "Vegetation", MANMADE: "Man-made features" },
  lineShare: "Share of a line (%)",
  areaShare: "Share of an area (%)",
  coverM: "The coverage's width (m)",
  save: "Save",
  reset: "Default",
  position: { off: "Show my position", on: "Follow my position", follow: "Hide my position" },
  pointHere: (code: string) => `${code} here`,
  walkLine: (code: string) => `Walk ${code}`,
  walkStop: "Done",
  walking: (points: number) => `Walking the line · ${count(points, "point", "points")}`,
  problems: {
    insecure: "The position needs https.",
    unsupported: "The browser gives no position.",
    denied: "The browser may not use the position. Allow location services for the page.",
    timeout: "No position yet.",
    unavailable: "The position is not available.",
    crs: "The map's coordinate system is not supported for GPS.",
    noStore: "The track cannot be saved in the browser (private mode?). It is sent while the page is open.",
    trackFull: "The track got too long and was stopped. Start a new one.",
    gpx: "The file could not be read as GPX.",
    gpxEmpty: "The GPX file has no points.",
    generic: (status: string) => `That did not work (${status}).`
  }
};

export const mapProjectRectifyEn: Texts<typeof mapProjectRectifySv> = {
  heading: "Correct the map with control points",
  help: "For an older map that is off against orthophoto, laser or roads. Put the base layer on top, click where something is on the map "
    + "(a road junction, a building, a shoreline) and then where it should be. Spread the points over the map. Nothing changes directly: "
    + "all objects are moved as suggestions that the owner approves.",
  start: "Set control points",
  stop: "Done with the points",
  hintFrom: "Correct the map: click where something is on the map now.",
  hintTo: "Correct the map: click where it should be.",
  none: "No control points yet.",
  point: (index: number, value: string) => `Point ${index}: ${value}`,
  residual: (m: number) => `${meters(m)} m`,
  removePoint: (index: number) => `Remove point ${index}`,
  kind: "How the map is corrected",
  kinds: {
    similarity: "Similarity: move, rotate and scale (2 points or more)",
    affine: "Affine: also different scale and skew (3 or more)",
    rubber: "Rubber sheet: exactly through the points, smooth in between (3 or more)"
  } satisfies Record<Kind, string>,
  fit: (kind: Kind, m: number) => kind === "rubber" ? `Rubber sheet: the points land exactly; bending beyond affine averages ${meters(m)} m`
    : `${kind === "affine" ? "Affine" : "Similarity"}: mean deviation ${meters(m)} m`,
  where: "Area",
  whole: "The whole map",
  preview: "Work out the move",
  computing: "Calculating …",
  summary: (n: number, meanM: number, maxM: number) => n === 0 ? "No objects are moved."
    : `${count(n, "object is", "objects are")} moved, on average ${meters(meanM)} m and at most ${meters(maxM)} m.`,
  skipped: (n: number) => n === 0 ? "" : `${count(n, "object has", "objects have")} own changes not yet sent or a conflict and ${n === 1 ? "is" : "are"} skipped.`,
  propose: (n: number) => n === 1 ? "Leave 1 move as a suggestion" : `Leave ${n} moves as suggestions`,
  undo: "Undo latest",
  clear: "Start over",
  sending: (done: number, total: number) => `Sending suggestion ${done} of ${total} …`,
  sent: (n: number) => n === 1 ? "The suggestion is sent. The owner sees it under Suggestions." : `${n} suggestions are sent. The owner sees them under Suggestions.`,
  note: (kind: Kind, points: number, part: number, total: number) =>
    `Corrected with ${points} control points (${kindName[kind]})` + (total > 1 ? ` (part ${part} of ${total})` : ""),
  failed: (status: number | string) => `The suggestion could not be sent (${status}).`
};

export const mapProjectSymbolLayersEn: Texts<typeof mapProjectSymbolLayersSv> = {
  title: "Layers",
  help: (standard: Standard) => `The layers follow ${STANDARD_NAMES[standard]} (the map's scale). Turn off a layer to see what lies below, `
    + "lock it so you do not change it by mistake (a locked layer can be shown faded). Open a layer for its symbols.",
  layers: {
    LANDFORMS: "Landforms (1xx)", ROCK: "Rock and boulders (2xx)", WATER: "Water and marsh (3xx)", VEGETATION: "Vegetation (4xx)",
    MANMADE: "Man-made features (5xx)", TECHNICAL: "Technical symbols (6xx)", COURSE: "Course overprint (7xx)", OTHER: "Other in the norm",
    OUTSIDE: "Outside the norm"
  } satisfies Record<LayerId, string>,
  outsideHelp: (standard: Standard) => `Symbols not in ${STANDARD_NAMES[standard]}: an older norm, own symbols or another map that `
    + "has been combined in. Merge them with a symbol in the norm below.",
  outsideShort: "outside the norm",
  count: (n: number) => count(n, "object", "objects"),
  groupKey: (digit: number) => `The key ${digit} shows and hides the group, Shift+${digit} shows only it, 0 shows everything.`,
  multiHelp: "Shift+click an eye or lock sets the same choice on all rows in between; Alt+click on the eye shows only that row. 1–6 show and hide the standard's groups.",
  viewsHeading: "Saved views",
  viewsHelp: "Save the layers' choices under a name (e.g. “contours only” or “survey”) and switch between them. The views are saved in this browser.",
  viewName: "Name",
  viewSave: "Save the view",
  viewUse: "Use",
  viewRemove: "Remove",
  show: (name: string) => `Turn on ${name}`,
  hide: (name: string) => `Turn off ${name}`,
  lock: (name: string) => `Lock ${name}`,
  unlock: (name: string) => `Unlock ${name}`,
  dim: (name: string) => `Show ${name} faded when it is locked`,
  mergeHeading: "Merge symbols",
  mergeHelp: "The objects with one symbol get another symbol (e.g. an older norm's symbol that becomes the norm's, or two maps' identical "
    + "symbols). Each object becomes a change that can be undone; in a project with suggestions they become suggestions.",
  suggestion: (from: string, n: number, to: string, reason: "SAME_CODE" | "SAME_NAME") =>
    `${from} (${count(n, "object", "objects")}) → ${to} · ${reason === "SAME_CODE" ? "same number" : "same name"}`,
  from: "From the symbol",
  to: "To the symbol",
  choose: "Choose …",
  preview: (n: number, from: string, to: string) => `${count(n, "object", "objects")} with ${from} get the symbol ${to}. `
    + `${from} remains in the map file but has no objects afterwards.`,
  bothStandard: (from: string, to: string) => `Note: both are in the norm (${from} and ${to}) and mean different things. Only merge if the objects are drawn wrongly.`,
  merge: (n: number) => `Merge ${count(n, "object", "objects")}`,
  merging: (done: number, total: number) => `Merging ${done} of ${total} …`,
  merged: (n: number, from: string, to: string) => `${count(n, "object", "objects")} with ${from} now ${n === 1 ? "has" : "have"} the symbol ${to}.`,
  locked: "The layer is locked. Unlock it under Layers to change it."
};

export const mapProjectWorkLayersEn: Texts<typeof mapProjectWorkLayersSv> = {
  workHeading: "Work layers",
  workHelp: "Your own groups of the norm's symbols, e.g. ”Paths to survey” or ”Buildings and walls”. The layers are shared in the project; what "
    + "is shown, locked or faded each person chooses.",
  workNone: "No work layers yet.",
  symbols: (n: number) => count(n, "symbol", "symbols"),
  newWork: "New work layer",
  name: "Name",
  pick: "Symbols",
  filter: "Search symbol",
  create: "Create the layer",
  remove: "Remove",
  removeWork: (name: string) => `Remove the work layer ${name}? The symbols and the objects remain.`,
  sketchHeading: "Sketch layers",
  sketchHelp: "Sketches that do not belong to the map, e.g. from the field: drag for a line, click for a point or (with a text) a "
    + "text. They are never written to the map file.",
  sketchNone: "No sketch layers yet.",
  sketches: (n: number) => count(n, "sketch", "sketches"),
  newSketch: "New sketch layer",
  color: "Colour",
  colors: { "#c0262d": "Red", "#1f5fbf": "Blue", "#1d8a3a": "Green", "#7a3fb0": "Purple", "#d4570b": "Orange", "#000000": "Black" },
  draw: "Draw",
  drawing: "Drawing",
  drawIn: (name: string) => `Draw in ${name}`,
  removeSketchLayer: (name: string, n: number) => `Remove the sketch layer ${name} with ${count(n, "sketch", "sketches")} for everyone in the project?`,
  hint: (name: string) => `Sketch in ${name}: drag for a line, click for a point (or a text if you have written one).`,
  textLabel: "Text on click",
  undo: "Undo sketch",
  done: "Done",
  problem: (status: number) => status === 403 ? "Only the person who created the layer or the sketch and the owners can change it." : `That did not work (${status}).`
};

export const mapStatsEn: Texts<typeof mapStatsSv> = {
  title: "Statistics",
  badgesLabel: "Badges",
  mine: "Your map statistics",
  myHelp: "Counted from what you did in the map projects. What Claude suggested does not count as yours.",
  season: "Season",
  allTime: "All time",
  optIn: "Show me in the leaderboards",
  optInHelp: "Off from the start. You only show in projects where the owners have turned on the leaderboard, and only to the project's members.",
  none: "Nothing yet.",
  numbers: {
    hectares: (value: number) => `${number(value, 1)} ha surveyed`,
    km: (value: number, hours: number) => `${number(value, 1)} km in the forest, ${number(hours, 1)} h`,
    checked: (value: number) => count(value, "checked object", "checked objects"),
    notesResolved: (value: number) => count(value, "resolved note", "resolved notes"),
    deleted: (value: number) => `${number(value)} removed (generalisation)`,
    added: (value: number) => count(value, "new object", "new objects"),
    changed: (value: number) => count(value, "changed object", "changed objects"),
    proposalsAccepted: (value: number) => count(value, "approved suggestion", "approved suggestions"),
    areasDone: (value: number) => count(value, "finished sub-area", "finished sub-areas")
  },
  badges: {
    FIRST_TRACK: "First round", TEN_KM: "Ten km in the forest", HUNDRED_KM: "A hundred km", TEN_HECTARES: "Ten hectares", NIGHT: "Night survey",
    HUNDRED_CHECKED: "A hundred checked", TEN_NOTES_RESOLVED: "Map error hunter", AREA_DONE: "Sub-area done", GENERALIZER: "Generaliser"
  },
  leaderboard: "Leaderboard",
  leaderboardOff: "The leaderboard is off in this project.",
  leaderboardEmpty: "Nobody has chosen to show yet.",
  leaderboardSetting: "Leaderboard in the project",
  settings: { off: "Off", FIRST: "On, with first name", FULL: "On, with full name", NONE: "On, without name" },
  sortBy: "Sort by",
  sorts: { hectares: "Surveyed area", checked: "Checked", notesResolved: "Resolved notes", km: "Km", deleted: "Removed", added: "New",
    changed: "Changed", proposalsAccepted: "Approved suggestions" },
  you: "You",
  anonymous: (index: number) => `Mapper ${index}`
};
