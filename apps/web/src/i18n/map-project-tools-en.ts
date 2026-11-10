import type { Texts } from "../lib/language";
import type { mapProjectColorsSv } from "./map-project-colors-sv";
import type { mapProjectKeysSv } from "./map-project-keys-sv";
import type { mapProjectGeneralizeSv } from "./map-project-generalize-sv";
import type { mapProjectImportSv } from "./map-project-import-sv";
import type { mapProjectNormSv } from "./map-project-norm-sv";
import type { mapProjectNotesSv } from "./map-project-notes-sv";
import type { mapProjectQuickSv } from "./map-project-quick-sv";

/** Engelska del 33: kartredigerarens generalisering, vektorimport, normkontroll, notiser och snabbval. */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const num = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 2 });

export const mapProjectGeneralizeEn: Texts<typeof mapProjectGeneralizeSv> = {
  heading: "Generalisation",
  help: "Simplifies lines and areas with dense points (e.g. contours from Karttapullautin), joins split lines and removes what is smaller than the norm allows. "
    + "Nothing changes directly: the changes are left as suggestions that the owner approves or rejects. Curves (arcs) are left untouched.",
  where: "Area",
  whole: "The whole map",
  simplify: "Simplify with the tolerance",
  tolerance: (mm: number) => mm === 0 ? "Do not simplify" : `${mm} mm`,
  removeSmall: "Remove small areas, short lines and small knolls",
  joinLines: "Join lines with the same symbol whose ends meet (e.g. contours split at the laser tiles' edges)",
  removeInside: "Remove areas lying entirely inside an identical area",
  joined: (lines: number, absorbed: number) => lines === 0 ? "No lines to join."
    : `${count(lines, "line is", "lines are")} joined from ${lines + absorbed} parts.`,
  inside: (n: number) => n === 0 ? "No areas inside an identical area." : `${count(n, "area", "areas")} inside an identical area ${n === 1 ? "is" : "are"} removed.`,
  preview: "Work out the changes",
  computing: "Calculating …",
  summary: (simplified: number, before: number, after: number) => simplified === 0 ? "No lines or areas to simplify."
    : `${count(simplified, "object is", "objects are")} simplified: ${before} points become ${after}.`,
  removed: (area: number, line: number, closed: number) => area + line + closed === 0 ? "Nothing is smaller than the norm."
    : `Removed: ${area} small areas, ${line} short lines, ${closed} small knolls.`,
  skipped: (n: number) => n === 0 ? "" : `${count(n, "object has", "objects have")} own changes not yet sent or a conflict and ${n === 1 ? "is" : "are"} skipped.`,
  propose: (n: number) => n === 1 ? "Leave 1 change as a suggestion" : `Leave ${n} changes as suggestions`,
  sending: (done: number, total: number) => `Sending suggestion ${done} of ${total} …`,
  sent: (n: number) => n === 1 ? "The suggestion is sent. The owner sees it under Suggestions." : `${n} suggestions are sent. The owner sees them under Suggestions.`,
  note: (mm: number, removeSmall: boolean, part: number, total: number) =>
    `Generalisation${mm > 0 ? `: simplify ${mm} mm` : ""}${removeSmall ? `${mm > 0 ? "," : ":"} remove what is smaller than the norm` : ""}`
    + (total > 1 ? ` (part ${part} of ${total})` : ""),
  failed: (status: number | string) => `The suggestion could not be sent (${status}).`
};

export const mapProjectImportEn: Texts<typeof mapProjectImportSv> = {
  heading: "Import vectors",
  help: "A base map or other vector file (GeoJSON, DXF or Shapefile, preferably as .zip) becomes candidates: choose a symbol per layer, see them on the map and leave them as suggestions "
    + "approved like other suggestions. Save DWG as DXF for now. Everything is read here in the browser. Some base maps are recognised "
    + "by their layer names, but not all. The choices can be saved as a profile for the next file.",
  choose: "Choose file",
  osmHeading: "Fetch from OpenStreetMap",
  osmHelp: "Buildings, roads, paths, fences, walls, water and land use for the whole map or a stage. The server fetches them; they become candidates like a file. Data © OpenStreetMap contributors (ODbL).",
  osmWhere: "Area",
  osmWhole: "The whole map",
  osmFetch: "Fetch",
  osmFetching: "Fetching …",
  osmName: (area?: string) => `OpenStreetMap${area ? `, ${area}` : ""} (© OpenStreetMap contributors, ODbL)`,
  file: (name: string, n: number, skipped: number) => `${name}: ${count(n, "object", "objects")}${skipped ? `, ${skipped} skipped` : ""}`,
  crs: "Coordinate system (EPSG)",
  fit: "Fit to the map",
  fitting: "Fitting … (a few seconds)",
  fitClear: "Remove the fit",
  fitHelp: "Does the source land almost right but slightly shifted or rotated? Give the layers with buildings, roads or water their symbols and then fit them to the map's.",
  fitFailed: "The fit failed: too few buildings, roads or water match the map's. Check the coordinate system and the layers' symbols, or use control points.",
  fitted: (meters: string, degrees: string, scale: string, median: string, share: number) =>
    `Fitted: moved ${meters} m, rotated ${degrees}°, scale ${scale}. Afterwards the median difference is ${median} m, and ${share} % of the points lie within 1 mm on the map.`,
  crsHelp: "From the file or the coordinates when possible; otherwise the map's. E.g. 3006, 3011 (SWEREF 99 18 00), 3021 or 4326.",
  layers: "Layers and symbols",
  layerShape: (points: number, lines: number, closed: number, areas: number) =>
    [points && count(points, "point", "points"), lines && count(lines, "line", "lines"), closed && count(closed, "closed line", "closed lines"),
      areas && count(areas, "area", "areas")].filter(Boolean).join(", "),
  skip: "Skip",
  symbolFor: (layer: string) => `Symbol for ${layer}`,
  result: (objects: number, joined: number, duplicates: number, short: number, outside: number, mismatched: number, clipped: number,
    closedAreas: number, stairs: number, steps: number) =>
    `${count(objects, "candidate", "candidates")}`
    + [joined && `${joined} merged`, closedAreas && `${count(closedAreas, "area", "areas")} from closed lines`,
      stairs && `${count(stairs, "staircase", "staircases")} from ${steps} steps`, clipped && `${clipped} clipped at the edge`, duplicates && `${duplicates} duplicates removed`,
      short && `${short} short stubs removed`, outside && `${outside} outside the map`, mismatched && `${mismatched} with the wrong shape`].filter(Boolean).map(part => ` · ${part}`).join(""),
  propose: (n: number) => `Leave ${count(n, "candidate", "candidates")} as suggestions`,
  accept: (n: number) => `Put ${count(n, "object", "objects")} in the map`,
  accepted: (n: number) => `${count(n, "object", "objects")} are now in the map. Undo removes them all again in one step.`,
  acceptHelp: "The candidates are shown on the map with their symbols. Put them in directly, or leave them as suggestions to review.",
  shownHelp: "The candidates are shown on the map with their symbols.",
  hideOnMap: "Hide on the map",
  showOnMap: "Show on the map",
  sending: (done: number, total: number) => `Sending ${done} of ${total} …`,
  dwgSent: (file: string) => `${file} is being read on the geo server. Load the drawing under Laser data and Karttapullautin → The jobs when it is ready.`,
  sent: (n: number) => `${count(n, "suggestion", "suggestions")} left. Approve or reject them under Suggestions.`,
  note: (file: string, part: number, parts: number) => `Import ${file}${parts > 1 ? `, part ${part} of ${parts}` : ""}`.slice(0, 500),
  cancel: "Cancel",
  profileUsed: (name: string, matched: number, layers: number) => `The symbols from the profile ”${name}” (${matched} of ${layers} layers).`,
  profileHeading: "Save the choices as a profile",
  profileName: "The profile's name (e.g. Stockholm's base map)",
  profileShare: "Share with the project's club",
  profileSave: "Save the profile",
  profileSaved: "The profile is saved. The next file with the same layers gets the same symbols.",
  problems: {
    unsupported: "Choose a GeoJSON, DXF, DWG or Shapefile (.shp with .dbf and .prj, or a .zip).",
    UNSUPPORTED_DWG_FILE: "The file is not a DWG drawing (AutoCAD 2000 or later).",
    GEO_JOB_BUSY: "You already have two jobs on the geo server waiting or running. Wait until one is done.",
    MAP_FILE_TOO_LARGE: "The drawing is too large (at most 75 MB).",
    STORAGE_QUOTA_EXCEEDED: "The storage is not enough for the drawing.",
    crs: "The coordinate system is not supported (SWEREF 99, RT 90, UTM or WGS 84).",
    generic: (status: number) => `That did not work (${status}).`,
    SOURCE_AREA_TOO_LARGE: "The area is too large for one fetch (at most about 40 km²). Choose a stage.",
    SOURCE_THROTTLED: "Too many fetches in the last hour. Try again later.",
    SOURCE_UNAVAILABLE: "OpenStreetMap did not answer right now. Try again in a while."
  }
};

export const mapProjectNormEn: Texts<typeof mapProjectNormSv> = {
  heading: "Norm check",
  toggle: "Show norm errors on the map",
  help: "The map's objects against the norm's graphic minimum dimensions: ISOM 2017-2 for forest maps, ISSprOM 2019-2 for sprint maps (1:5 000 and larger). The check shows where something should be looked at and changes nothing.",
  standard: (standard: "ISOM" | "ISSPROM", factor: number) => standard === "ISSPROM"
    ? "Sprint map, ISSprOM 2019-2: the symbols' dimensions, passages between impassable objects (0.40 mm) and openings in walls and fences (1.00 mm)."
    : factor === 1 ? "ISOM 2017-2, the base scale 1:15 000." : `ISOM 2017-2, enlarged map: the dimensions × ${num(factor)}.`,
  computing: "Checking …",
  none: "No norm errors were found.",
  count: (n: number, truncated: boolean) => `${count(n, "place", "places")}${truncated ? " (there are more)" : ""} to look at.`,
  rules: {
    CONTOUR_GAP: "Contours too close to each other",
    SHORT_LINE: "Free-standing line too short",
    SMALL_AREA: "Area too small",
    THIN_AREA: "Very thin area",
    SMALL_CLOSED: "Knoll or depression too small",
    PASSAGE: "Passage between impassable objects too narrow",
    OPENING: "Opening in a wall or fence too narrow"
  },
  detail: (rule: string, code: string, value: number, limit: number) =>
    rule === "SMALL_AREA" ? `${code}: ${num(value)} mm², at least ${num(limit)} mm²` : rule === "PASSAGE" || rule === "OPENING"
      ? `${code}: ${num(value)} mm between the edges, at least ${num(limit)} mm` : rule === "CONTOUR_GAP"
      ? `${code}: ${num(value)} mm centre to centre, at least ${num(limit)} mm` : `${code}: ${num(value)} mm, at least ${num(limit)} mm`,
  show: "Show",
  more: (n: number) => `and ${n} more`
};

export const mapProjectNotesEn: Texts<typeof mapProjectNotesSv> = {
  heading: "Notes",
  tool: "Note",
  toolHint: "Tap the map where the note should go.",
  here: "Note here",
  new: "New note",
  text: "What did you see?",
  placeholder: "E.g. the path is missing, the boulder is smaller, new clear-cut",
  photo: "Photo",
  photoAdded: "Photo attached",
  removePhoto: "Remove the photo",
  save: "Save the note",
  cancel: "Cancel",
  close: "Close",
  done: "Done",
  reopen: "Reopen",
  remove: "Remove",
  removeConfirm: "Remove the note?",
  show: "Show",
  waiting: "waiting for network",
  failed: (status: number) => `not sent (${status})`,
  by: (name: string | null, date: string) => `${name ?? "Unknown"}, ${date}`,
  open: (n: number) => n === 0 ? "No open notes." : `${count(n, "open note", "open notes")}.`,
  showDone: "Show done",
  empty: "Write something or take a photo.",
  problem: (status: number) => status === 413 ? "The photo is too large." : `That did not work (${status}).`
};

export const mapProjectQuickEn: Texts<typeof mapProjectQuickSv> = {
  wheel: "Tool wheel",
  tools: { select: "Edit", draw: "Draw", circle: "Circle", note: "Note" },
  recent: "Latest symbols",
  actions: "The object",
  simplify: "Simplify",
  simplifyMore: "Simplify more",
  smooth: "Make smooth",
  straighten: "Make straight",
  switchTo: (code: string) => `Change to ${code}`,
  remove: "Remove",
  simplified: (before: number, after: number) => `Simplified: ${before} → ${after} points.`,
  nothingToSimplify: "Nothing to simplify with that tolerance.",
  smoothed: "The line now runs in smooth curves through the same points.",
  straightened: "The curves are now straight segments.",
  circleHint: (code: string) => `Circle with ${code}: drag from the centre out to the edge, or click the centre and then the edge.`,
  circleNeedsShape: "Choose a line or area symbol for the circle.",
  grid: "Grid",
  list: "List",
  view: "Show the symbols as",
  tabsLabel: "The panel's tabs",
  tabs: { symbols: "Symbols", layers: "Layers", review: "Review", process: "Process" },
  hidePanels: "Map only",
  showPanels: "Show the panels",
  bareHelp: "Hide or show the tool column and the panel"
};

export const mapProjectKeysEn: Texts<typeof mapProjectKeysSv> = {
  open: "Keys",
  title: "Keys in the drawing mode",
  help: "The keys are under the left hand, so that the right hand can stay on the mouse. Click a key and then press the new one. The choice is saved in this browser.",
  commands: {
    select: "Edit", draw: "Draw", circle: "Circle", note: "Note", addPoint: "Add point", removePoint: "Remove point", cut: "Cut apart", pick: "Take the symbol from the selection", reverse: "Reverse direction",
    switchSymbol: "Change symbol on the selection", join: "Join lines", simplify: "Simplify", smooth: "Make smooth", checked: "Mark checked",
    undo: "Undo", redo: "Redo", wheel: "The tool wheel", bare: "Map only"
  },
  change: (command: string) => `Change the key for ${command}`,
  press: "Press a key …",
  none: "None",
  space: "Space",
  fixed: "Fixed: Esc cancels, Enter finishes, Delete removes, Backspace removes the last point while you draw, 1–9 choose the latest symbols.",
  displaced: (command: string, key: string) => `${command} had ${key} and now has no key.`,
  reserved: (key: string) => `${key} is already used for something fixed.`,
  reset: "Restore the defaults",
  wasReset: "The defaults apply again.",
  done: "Done",
  addPointHint: "Click a line or the edge of an area for a new point there.",
  removePointHint: "Click a point to remove it.",
  noPointHere: "No point to remove there.",
  noSegmentHere: "No line or edge there.",
  multiSelected: (n: number) => `${n} objects selected. Drag them to move all, drag just outside a corner to rotate. Shift-click adds or removes.`,
  multiRotate: "Drag to rotate the selection around its centre.",
  multiRemove: (n: number) => `Remove ${n} objects`,
  remove: "Remove",
  tips: {
    circle: "Click the centre and drag out to the edge. Drawn with the chosen line or area symbol.",
    area: "Draw a sub-area that a mapper can be made responsible for.",
    note: "Click the map and write a note to yourself or the others.",
    switchSymbol: "The selection gets the symbol chosen in the panel. With several selected, all with the same shape (line, area or point) change.",
    join: "Select the lines with a box or Shift-click. Lines with the same symbol whose ends meet become one line; two selected lines are always joined.",
    cut: "Click a line to split it in two there. On a vertex it is split at the point.",
    pick: "The symbol of the selected object becomes the chosen one, so that you can draw more with it.",
    reverse: "The line changes direction, so that the tags of cliffs and the dashes of fences end up on the other side.",
    smooth: "The corners become smooth curves.",
    simplify: "Removes points the shape does not need.",
    checked: "Marks the object as checked in the terrain.",
    remove: "Removes the selection. A selected vertex is removed instead of the whole object.",
    undo: "Undoes the latest step, also with Cmd/Ctrl+Z.",
    wheel: "The tools and the latest symbols in a ring at the pointer. Also with a right-click on the map.",
    bare: "Hides or shows the panel, so that the map gets the whole area.",
    keys: "See and change the keys for the tools."
  },
  needSelection: "Select something first: click an object with Edit, or drag a box around several.",
  needOtherSymbol: "First choose another symbol with the same shape in the panel.",
  needLines: "Select two or more lines with the same symbol: drag a box around them or Shift-click.",
  needShape: "Select a line or an area first.",
  needLine: "Select one or more lines first.",
  cutHint: "Cut apart: click the line where it is to be split.",
  noLineHere: "No line to cut there (the end points cannot be cut).",
  wasCut: "The line is split in two.",
  reversed: (n: number) => n === 1 ? "The line is reversed." : `${n} lines are reversed.`,
  picked: (code: string) => `Chosen symbol: ${code}.`,
  joined: (n: number) => `${n} lines became one.`,
  switched: (n: number, code: string) => n === 1 ? `1 object got the symbol ${code}.` : `${n} objects got the symbol ${code}.`,
  multiSwitch: (n: number, code: string) => `Change ${n} to ${code}`
};

export const mapProjectColorsEn: Texts<typeof mapProjectColorsSv> = {
  open: "Map colours",
  title: "Map colours",
  help: "The colour table from the map file, in drawing order with the top one first. Change a colour's CMYK in per cent: the map is redrawn at once, and the colours are written in the next map version. The map file in the archive is not changed.",
  readOnly: "Only the owners of the project can change the colours.",
  color: "Colour", c: "C", m: "M", y: "Y", k: "K",
  field: (name: string, part: string) => `${name}, ${part} in per cent`,
  changed: "Changed",
  spot: "Spot colour (changed in the mapping program)",
  reset: (name: string) => `Restore ${name}`,
  resetAll: "Restore the file's colours",
  save: "Save",
  cancel: "Cancel",
  close: "Close",
  saved: (n: number) => n === 0 ? "The map has the file's own colours." : n === 1 ? "1 colour is changed." : `${n} colours are changed.`,
  failed: "The colours could not be saved. Try again.",
  ocad: "The map is an OCAD file: the colours are shown here, but cannot be written in a new map version yet.",
  summary: (n: number) => n === 0 ? "The file's own colours" : n === 1 ? "1 changed colour" : `${n} changed colours`
};
