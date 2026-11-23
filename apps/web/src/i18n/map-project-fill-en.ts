import type { Texts } from "../lib/language";
import type { mapProjectFillSv } from "./map-project-fill-sv";

/** The Fill area tool (the space between the map's lines is filled with the chosen area symbol). */
export const mapProjectFillEn: Texts<typeof mapProjectFillSv> = {
  hint: (code, baseM, gapM) => `Fill area: click in a space enclosed by lines or area edges and it is filled with ${code}. Gaps up to ${baseM} m are closed${gapM > baseM ? `, and corners that do not meet and openings up to ${gapM} m (dashed orange); Alt+click fills exactly only` : ""}. Hidden layers, contours and north lines do not count as boundaries.`,
  needsArea: "Choose an area symbol in the list first: Fill area adds an area with the chosen symbol.",
  done: (code, squareMeters, closed, bridged) =>
    `Filled with ${code}: ${squareMeters} m²${closed === 0 ? "" : closed === 1 ? ", one gap was closed" : `, ${closed} gaps were closed`}${bridged ? `, ${bridged}` : ""}. Undo removes the area.`,
  bridged: (kind, count, lengths) =>
    `${count} ${kind === "corner" ? (count === 1 ? "corner closed" : "corners closed") : kind === "extend" ? (count === 1 ? "end extended" : "ends extended")
      : (count === 1 ? "opening bridged" : "openings bridged")} (${lengths})`,
  notSaved: "The area could not be added.",
  dragHint: "Drag across several spaces (or ⇧+click) for one area; Esc clears.",
  approx: touch => `Approximate area – ${touch ? "tap" : "click"} again to add it.`,
  confirm: (code, squareMeters) => `${code}: ${squareMeters} m² – tap the space again to add it.`,
  coveredAs: (code, key) => `The area already exists as ${code} – press ${key} to switch symbol.`,
  alreadyFilled: code => `The space is already filled with ${code}.`,
  collecting: (count, squareMeters, touch) =>
    `${count} ${count === 1 ? "space" : "spaces"} collected (${squareMeters} m²) – ${touch ? "tap Add" : "click without Shift to add"}, Esc clears.`,
  merged: (code, count, squareMeters) => `Filled with ${code}: ${count} ${count === 1 ? "space" : "spaces"} as one area, ${squareMeters} m². Undo removes the area.`,
  skipped: (open, covered) => [open ? `${open} ${open === 1 ? "space was not closed" : "spaces were not closed"}` : "",
    covered ? `${covered} already filled` : ""].filter(Boolean).join(", ") + (open || covered ? " and skipped." : ""),
  noCells: "No closed space to add.",
  cellsMode: "+ space",
  cellsHelp: "Each tap adds a space (and a dragging finger collects spaces); Add fills them as one area.",
  cellsCommit: count => `Add (${count})`,
  openGap: (gapM, count) => count === 1
    ? `The area is not closed – there is an opening larger than ${gapM} m (red on the map). Draw the edge there and try again.`
    : `The area is not closed – there are ${count} openings larger than ${gapM} m (red on the map). Draw the edges there and try again.`,
  overNote: (count, codes) => count === 0 ? "Not filling over any area" : `Filling over ${count} ${count === 1 ? "area" : "areas"}${codes ? ` (${codes})` : ""}`,
  overDone: count => `${count === 1 ? "One object" : `${count} objects`} under the area were cut or removed. Undo restores everything.`,
  overLarge: (code, squareMeters, touch) => `Large area: ${code}, ${squareMeters} m² – ${touch ? "tap" : "click"} again inside it to fill over.`,
  clearedUnder: count => `${count === 1 ? "One object" : `${count} objects`} under the area (bare rock, vegetation, marsh, boulders or small landforms) were removed or clipped, as on private land. Undo restores everything.`,
  openFar: windowM => `The area is not closed within ${windowM} m of the click: an edge is missing or hidden, or the area is larger than that. Draw the missing edge, or draw the area by hand.`,
  propose: {
    barLabel: "Suggest areas",
    run: "Suggest areas",
    runAgain: "Suggest again",
    runHelp: (minM2, gapM) => `Finds every closed space between the map's lines in what is on screen that is not yet filled (at least ${minM2} m², gaps up to ${gapM} m are closed) and suggests a symbol where the rules dare to: paved area for narrow spaces between edges, out-of-bounds for fenced spaces with houses. Nothing is added until you click.`,
    busy: "Looking for spaces …",
    summary: (count, suggested, uncertain) => `${count} ${count === 1 ? "space" : "spaces"}: ${suggested} with a suggestion, ${uncertain} uncertain`,
    truncated: (shown, found) => `Showing the ${shown} nearest the centre of ${found} – zoom in for the rest.`,
    none: filled => filled > 0 ? `No unfilled closed spaces here (${filled} are already filled).` : "No closed spaces here: the lines do not close. Draw the missing edges, or zoom out.",
    tooLarge: "Too much map on screen to work out the spaces. Zoom in and try again.",
    notSprint: "Suggest areas is only available on sprint maps.",
    legend: "Filled space = suggestion (the number is shown in it), dashed blue = no suggestion, dashed orange = uncertain (large, or closed across a gap). Click a space to add it.",
    override: code => `Use the chosen symbol (${code}) instead of the suggestion`,
    acceptAll: count => `Add all with a suggestion (${count})`,
    clear: "Clear",
    added: (code, squareMeters) => `Added as ${code}: ${squareMeters} m². Undo removes the area.`,
    addedAll: count => `${count} ${count === 1 ? "area" : "areas"} added with the suggested symbol. Undo removes them all at once.`,
    needsSymbol: "The space has no suggestion: choose an area symbol in the list and click the space again."
  }
};
