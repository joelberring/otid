import type { Texts } from "../lib/language";
import type { mapProjectSplitSv } from "./map-project-split-sv";

/** Split the map area or a part with one line (like slicing a cake). */
export const mapProjectSplitEn: Texts<typeof mapProjectSplitSv> = {
  button: "Split with a line",
  buttonHelp: "Draw a line across the map area or a part. The parts share their border, so nothing ends up twice or outside. If a part is selected in the list, only that part is split.",
  hint: "Click where the line should go, across the map area or a part. Double-click or press Enter to split.",
  partPrefix: "Part",
  done: (names: readonly string[]) => `Split into ${names.join(", ")}.`,
  tooShort: "The line needs at least two points.",
  outside: "The line does not cross any area. Draw it across the map area or a part, from edge to edge.",
  notAcross: "The line does not go all the way across. Draw it from edge to edge (it may stick out beyond the edge).",
  tooComplex: "The parts get too many points to be saved. Split with a simpler line.",
  noMapArea: "The map has no known area to split yet."
};
