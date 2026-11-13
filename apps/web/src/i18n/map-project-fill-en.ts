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
  openFar: windowM => `The area is not closed within ${windowM} m of the click: an edge is missing or hidden, or the area is larger than that. Draw the missing edge, or draw the area by hand.`
};
