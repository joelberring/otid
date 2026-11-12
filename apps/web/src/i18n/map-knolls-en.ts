import type { Texts } from "../lib/language";
import type { mapKnollsSv, mapSavedChoiceSv, mapUnderlayStepsSv } from "./map-knolls-sv";

/** English: the headings for the order of the base layers in the side panel. */
export const mapUnderlayStepsEn: Texts<typeof mapUnderlayStepsSv> = {
  sources: "1. Fetch base layers",
  laser: "2. Laser data",
  laserHelp: "Search for laser tiles and run once. Then load the base map from the finished job: it is shown as candidates and is not saved in the map until you add them.",
  adjust: "3. Adjust without a new run",
  adjustHelp: "The sliders recalculate the candidates at once from what has already been fetched. Only the settings in the laser job (contour interval, contour smoothing) need a new run.",
  other: "Your own files"
};

/** English: shared by the sliders that choose among what the laser job has saved. */
export const mapSavedChoiceEn: Texts<typeof mapSavedChoiceSv> = {
  none: "No finished laser job has saved this. Run the laser job once more (geo worker version 25 or later).",
  job: "Laser job",
  load: "Fetch",
  loading: "Fetching …",
  failed: "It could not be fetched.",
  reset: "Defaults",
  nothing: "Nothing is left within those limits."
};

/** English: small knolls and cliffs with sliders, chosen among what the laser job has saved with its measurements. */
export const mapKnollsEn: Texts<typeof mapKnollsSv> = {
  knolls: {
    heading: "Small knolls with sliders (109)",
    help: "The laser job saves every possible small knoll with its measurements. Drag the limits: the candidates on the map are recalculated at once, without a new run.",
    minRise: (meters: string) => `Minimum height above the surroundings: ${meters} m`,
    lowerShare: (percent: number) => `Share of the ground around that lies lower: at least ${percent}%`,
    maxFoot: (m2: number) => `Largest foot: ${m2} m² (larger becomes a contour)`,
    spacing: (meters: number) => `Minimum distance between two: ${meters} m`,
    name: (job: string) => `${job} – small knolls`,
    done: (shown: number, all: number) => `${shown} small knolls of ${all} possible.`
  },
  cliffs: {
    heading: "Cliffs with sliders (201, 202)",
    help: "The laser job saves every cliff from 0.8 m drop with its measurements. Drag the limits: the candidates are recalculated at once. Cliffs shorter than the standard's 0.6 mm on the map are left out.",
    minDrop: (meters: string) => `Minimum drop for a cliff: ${meters} m`,
    impassableDrop: (meters: string) => `Impassable from: ${meters} m drop`,
    impassableLength: (meters: number) => `Impassable from: ${meters} m length`,
    tags: "Passable cliffs with tags (202.1)",
    name: (job: string) => `${job} – cliffs`,
    done: (impassable: number, passable: number, all: number) => `${impassable} impassable and ${passable} passable of ${all} possible.`
  }
};
