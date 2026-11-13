import type { Texts } from "../lib/language";
import type { mapProjectFillSv } from "./map-project-fill-sv";

/** The Fill area tool (the space between the map's lines is filled with the chosen area symbol). */
export const mapProjectFillEn: Texts<typeof mapProjectFillSv> = {
  hint: (code, gapM) => `Fill area: click in a space enclosed by lines or area edges and it is filled with ${code}. Gaps up to ${gapM} m are closed. Hidden layers, contours and north lines do not count as boundaries.`,
  needsArea: "Choose an area symbol in the list first: Fill area adds an area with the chosen symbol.",
  done: (code, squareMeters, closed) =>
    `Filled with ${code}: ${squareMeters} m²${closed === 0 ? "" : closed === 1 ? ", one gap was closed" : `, ${closed} gaps were closed`}. Undo removes the area.`,
  notSaved: "The area could not be added.",
  openGap: (gapM, count) => count === 1
    ? `The area is not closed – there is an opening larger than ${gapM} m (red on the map). Draw the edge there and try again.`
    : `The area is not closed – there are ${count} openings larger than ${gapM} m (red on the map). Draw the edges there and try again.`,
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
