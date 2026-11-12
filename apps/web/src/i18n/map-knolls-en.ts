import type { Texts } from "../lib/language";
import type { mapKnollsSv, mapUnderlayStepsSv } from "./map-knolls-sv";

/** English: the headings for the order of the base layers in the side panel. */
export const mapUnderlayStepsEn: Texts<typeof mapUnderlayStepsSv> = {
  sources: "1. Fetch base layers",
  laser: "2. Laser data",
  laserHelp: "Search for laser tiles and run once. Then load the base map from the finished job: it is shown as candidates and is not saved in the map until you add them.",
  adjust: "3. Adjust without a new run",
  adjustHelp: "The sliders recalculate the candidates at once from what has already been fetched. Only the settings in the laser job (contour interval, contour smoothing) need a new run.",
  other: "Your own files"
};

/** English: small knolls with sliders, chosen among the laser job's possible knolls. */
export const mapKnollsEn: Texts<typeof mapKnollsSv> = {
  heading: "Small knolls with sliders (109)",
  help: "The laser job saves every possible small knoll with its measurements. Drag the limits: the candidates on the map are recalculated at once, without a new run.",
  none: "No finished laser job with saved knolls. Run the laser job (geo worker version 25 or later) first.",
  job: "Laser job",
  load: "Fetch the knolls",
  loading: "Fetching …",
  failed: "The knolls could not be fetched.",
  minRise: (meters: string) => `Minimum height above the surroundings: ${meters} m`,
  lowerShare: (percent: number) => `Share of the ground around that lies lower: at least ${percent}%`,
  maxFoot: (m2: number) => `Largest foot: ${m2} m² (larger becomes a contour)`,
  spacing: (meters: number) => `Minimum distance between two: ${meters} m`,
  reset: "Defaults",
  name: (job: string) => `${job} – small knolls`,
  done: (shown: number, all: number) => `${shown} small knolls of ${all} possible.`,
  nothing: "No small knolls within those limits."
};
