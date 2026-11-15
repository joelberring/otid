import type { Texts } from "../lib/language";
import type { mapClearContoursSv, mapFlatContoursSv, mapHillsSv, mapKnollsSv, mapPitsSv, mapSavedChoiceSv, mapUnderlayStepsSv } from "./map-knolls-sv";

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
  nothing: "Nothing is left within those limits.",
  allStages: (name: string, count: number) => `${name} – all ${count} stages`
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

/** English: pits and depressions, chosen among the closed depressions found in the ground height when the base map was read. */
export const mapPitsEn: Texts<typeof mapPitsSv> = {
  heading: "Pits and depressions with sliders (111, 103)",
  help: "When the base map is read, every closed depression is found in the ground height, also those that lie between the contour levels. A small depression becomes a pit symbol and a larger one a form-line ring that follows its shape, with a slope tick. Depressions that the contours or Karttapullautin's pits already show are left out. Drag the limits: the candidates are recalculated at once, without a new run.",
  none: "No depressions have been searched for among the candidates. Read the base map from a laser job that has the ground height saved (hojd.png).",
  minDepth: (meters: string) => `Pit symbol from: ${meters} m deep`,
  ringDepth: (meters: string) => `Form-line ring from: ${meters} m deep (when the depression holds the standard's smallest depression)`,
  spacing: (meters: number) => `Minimum distance between two pit symbols: ${meters} m`,
  done: (points: number, rings: number, all: number) => `${points} pit symbols and ${rings === 1 ? "1 ring" : `${rings} rings`} of ${all} possible depressions.`,
  loaded: (points: number, rings: number, byHeight: number) => `Depressions from the ground height: ${points} pit symbols and ${rings === 1 ? "1 ring" : `${rings} rings`}; ${byHeight} closed contours and form lines got a slope tick from the height. Change it under "3. Adjust without a new run".`
};

/** English: small hills as a ring that follows the shape, instead of a dot knoll. */
export const mapHillsEn: Texts<typeof mapHillsSv> = {
  heading: "Small hills as a ring (101, 103)",
  help: "When the base map is read, every hill with its own top is found in the ground height, also those that lie between the contour levels. A hill that is high enough and holds the standard's smallest knoll gets a ring at half its height: a contour when the next level lies just above the top, otherwise a form line. Dot knolls inside the ring are removed. Hills that the contours already show are left out. The default (1 m) is measured against a mapper's map of Högdalen.",
  none: "No hills have been searched for among the candidates. Read the base map from a laser job that has the ground height saved (hojd.png).",
  ringRise: (meters: string) => `Ring from: ${meters} m high (lower hills become dot knolls or are left out)`,
  done: (rings: number, contours: number, dots: number, all: number) => `${rings === 1 ? "1 ring" : `${rings} rings`} (${contours} contours, ${rings - contours} form lines) of ${all} possible hills; ${dots === 1 ? "1 dot knoll was" : `${dots} dot knolls were`} replaced by a ring.`,
  loaded: (rings: number, dots: number) => `Small hills: ${rings === 1 ? "1 got a ring" : `${rings} got a ring`} that follows the shape (${dots === 1 ? "1 dot knoll" : `${dots} dot knolls`} replaced).`
};

/** English: "Calm contours on flat ground": form lines and small rings are removed where the ground is flat. */
export const mapClearContoursEn: Texts<typeof mapClearContoursSv> = {
  heading: "Clearer contours",
  help: "Laser contours follow the ground exactly and look cluttered. The sliders do what mappers do: smoother contours where it is flat, form lines only where they show a shape, and fewer small rings. Detail in steep and hilly terrain stays. The defaults are measured against three mappers' maps (Högdalen, Gömmaren, Djurgården).",
  none: "No finished laser job has the ground height saved (hojd.png).",
  noContours: "No contours among the candidates. Load the base map first (step 2).",
  smooth: (level: number, isDefault: boolean, meters: string, full: string, none: string) => level === 0 ? "Smoother contours on flat ground: off"
    : `Smoother contours on flat ground: ${level} of 10${isDefault ? " (default)" : ""} – smooths over ${meters} m where the ground slopes less than ${full}%, nothing above ${none}%`,
  formlines: (level: number, isDefault: boolean, convex: string, tight: string, form: number) => level === 0 ? "Fewer form lines: off"
    : `Fewer form lines: ${level} of 10${isDefault ? " (default)" : ""} – only where the ground is at least ${convex} m above its surroundings${tight === "0" ? "" : ` and no closer to a contour than ${tight} m`}${
      form <= -1 ? "" : form >= 0.5 ? "; only the hill forms (terraces and tops between the contours) remain" : form > 0 ? "; pieces on an even slope are removed, the hill forms remain"
        : "; pieces where the ground is flat below and steep above are removed, the hill forms remain"}`,
  rings: (level: number, isDefault: boolean, squareMeters: string) => level === 0 ? "Small form line rings: off"
    : `Small form line rings: ${level} of 10${isDefault ? " (default)" : ""} – removed below ${squareMeters} m²`,
  levelHelp: "0 is off and 10 is the most. The defaults follow the terrain: in flat terrain with small forms more form lines and rings are kept. Above the default the form lines are removed in order of the shape of the ground between the contours: first where the ground is flat below, then on an even slope, and the hill forms last. A contour is never moved to ground more than 1.25 m higher or lower (a quarter of the contour interval, as the standard allows).",
  run: "Show as candidates",
  done: (smoothed: string, formlines: string, rings: number) => `${smoothed} m of contour is smoothed, ${formlines} m of form line and ${rings === 1 ? "1 small ring" : `${rings} small rings`} are removed.`,
  untouched: "Nothing changes.",
  failed: "The ground height could not be read.",
  showBefore: "Show the laser contours (before)",
  showAfter: "Show the clearer ones (after)",
  before: "The laser contours are shown as they were. The sliders keep their values.",
  loaded: (smoothed: string, formlines: string, rings: number) => `Clearer contours (defaults): ${smoothed} m of contour was smoothed, ${formlines} m of form line and ${rings === 1 ? "1 small ring" : `${rings} small rings`} were removed. Change it or compare with before under "3. Adjust without a new run".`
};

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
