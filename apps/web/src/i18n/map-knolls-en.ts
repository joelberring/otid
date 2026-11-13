import type { Texts } from "../lib/language";
import type { mapFlatContoursSv, mapKnollsSv, mapSavedChoiceSv, mapUnderlayStepsSv } from "./map-knolls-sv";

/** English: the headings for the order of the base layers in the side panel. */
export const mapUnderlayStepsEn: Texts<typeof mapUnderlayStepsSv> = {
  sources: "1. Fetch base layers",
  sourcesHelp: "You do not need to fetch OpenStreetMap (roads, paths, buildings) yourself: it comes along when you load the base map in step 2. To get it on its own, see Import vectors → Fetch from OpenStreetMap at the bottom.",
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
  amount: (level: number) => `Amount: ${level} of 10${level === 5 ? " (default)" : ""}`,
  amountHelp: "1 gives few, 10 gives many.",
  fine: "Fine-tune",
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
    help: "The laser job saves every cliff from 0.8 m drop with its measurements. Drag the limits: the candidates are recalculated at once. By default, cliffs shorter than the standard's 0.6 mm on the map are left out.",
    minDrop: (meters: string) => `Minimum drop for a cliff: ${meters} m`,
    minLength: (meters: string) => `Shortest cliff: ${meters} m`,
    impassableDrop: (meters: string) => `Impassable from: ${meters} m drop`,
    impassableLength: (meters: number) => `Impassable from: ${meters} m length`,
    tags: "Passable cliffs with tags (202.1)",
    name: (job: string) => `${job} – cliffs`,
    done: (impassable: number, passable: number, all: number) => `${impassable} impassable and ${passable} passable of ${all} possible.`
  }
};

/** English: "Calm contours on flat ground": form lines and small rings are removed where the ground is flat. */
export const mapFlatContoursEn: Texts<typeof mapFlatContoursSv> = {
  heading: "Calm contours on flat ground",
  help: "On flat ground small height errors move the contours many metres sideways. Here form lines and small rings are removed where the ground slopes less than the limit. Steeper terrain is left alone.",
  none: "No moisture depth among the base layers. Run the laser job with moisture first.",
  noContours: "No contours among the candidates. Load the base map first (step 2).",
  layer: "Base layer",
  level: (level: number, degrees: string, squareMeters: string) => level === 0 ? "Off: nothing is removed"
    : `Level ${level} of 10${level === 3 ? " (default)" : ""}: ground sloping less than ${degrees}°, rings below ${squareMeters} m²`,
  levelHelp: "0 is off, 1 takes only the very flattest and 10 takes the most. Ordinary open contours are left alone.",
  run: "Show as candidates",
  done: (meters: string, rings: number) => `${meters} m of form line and ${rings === 1 ? "1 small ring" : `${rings} small rings`} on flat ground are removed.`,
  untouched: "Nothing is removed: all contours and form lines are shown.",
  failed: "The moisture depth could not be read.",
  loaded: (level: number, meters: string, rings: number) => `Calm contours on flat ground (level ${level}): ${meters} m of form line and ${rings === 1 ? "1 small ring" : `${rings} small rings`} were removed. Change it under "3. Adjust without a new run".`
};
