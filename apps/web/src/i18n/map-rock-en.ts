import type { Texts } from "../lib/language";
import type { mapRockSv } from "./map-rock-sv";

/** English: bare rock with a slider in the map project. */
const areasOf = (areas: number) => areas === 1 ? "1 area" : `${areas} areas`;
export const mapRockEn: Texts<typeof mapRockSv> = {
  heading: "Bare rock with a slider (214)",
  help: "Bare rock from the roughness of the laser ground, how open the vegetation is and the distance to water. A low value takes only clear outcrops; a higher one adds smoother outcrops, shore cliffs and rock under sparse forest.",
  none: "No rock image among the base layers. Run the laser job again to get it.",
  layer: "Base layer",
  amount: (level: number) => `Amount: ${level} of 10${level === 3 ? " (default)" : ""}`,
  amountHelp: "1 gives few, 10 gives many.",
  run: "Show as candidates",
  name: (layer: string) => `${layer} – bare rock`.slice(0, 120),
  done: (areas: number, hectares: string) => `${areasOf(areas)}, ${hectares} ha of bare rock are shown as candidates. Change the amount and it is recalculated.`,
  nothing: "No bare rock with that amount.",
  failed: "The rock image could not be read.",
  loaded: (level: number, areas: number, hectares: string) => `Bare rock (amount ${level} of 10): ${areasOf(areas)}, ${hectares} ha. Change it under "3. Adjust without a new run".`,
  loadFailed: "The rock image could not be read, so bare rock comes from the laser file."
};
