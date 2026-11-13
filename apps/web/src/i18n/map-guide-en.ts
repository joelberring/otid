import type { Texts } from "../lib/language";
import type { mapGuideSv } from "./map-guide-sv";

/** English: the guide "New base map" at the top of Base layers. Four steps, one button at a time. */
export const mapGuideEn: Texts<typeof mapGuideSv> = {
  heading: "New base map",
  intro: "Four steps from laser data to objects in the map. The guide does the same as the panels further down, in the right order.",
  show: "Show the steps",
  hide: "Hide the steps",
  stepNames: { area: "Area", run: "Fetch and run", wait: "Wait", review: "Review and add" },
  marks: { done: "Done", current: "You are here", todo: "Coming up" },
  stepLabel: (number: number, name: string, mark: string) => `Step ${number}: ${name} (${mark})`,
  area: {
    label: "What should the base map cover?",
    whole: "The whole map",
    size: (tiles: number, km2: number | undefined, most: number) => `${km2 === undefined ? "" : `About ${formatKm2(km2)} km², `}${tiles === 1 ? "1 laser tile" : `${tiles} laser tiles`} (one run takes at most ${most}).`,
    tooLargeSearch: (name: string | undefined, maxKm2: number) => `${name ?? "The whole map"} is too large for one run: a search for laser data takes at most ${maxKm2} km², and at most about 28 km in either direction.`,
    tooLargeTiles: (name: string | undefined, tiles: number, most: number) => `${name ?? "The whole map"} is too large for one run: the area covers ${tiles} laser tiles and one run takes at most ${most}.`,
    splitNext: "Split the area into smaller parts with a line and run one part at a time. Press the button, draw the line across the area on the map and double-click. Then come back here (the Layers tab) and choose one of the parts.",
    splitByOwner: "Ask an owner of the map to split the area: the Review tab › Sub-areas › Split with a line. Then choose one of the parts here.",
    pickSmaller: "There are parts already: choose a smaller part in the list above.",
    manual: "If you would rather choose laser tiles yourself, do it under 2. Laser data further down."
  },
  split: "Split with a line",
  run: {
    checking: "Checking your credentials for Lantmäteriet …",
    credential: "The laser data is fetched with your own credentials for Lantmäteriet (Geotorget). Enter them once; then reload this page and the guide continues here.",
    help: (name: string | undefined) => `Searches Lantmäteriet for laser tiles for ${name ?? "the whole map"} and starts the run on the geo server with the defaults: contours, cliffs, moisture (marshes), `
      + "vegetation, and Lantmäteriet's land cover and buildings when your account has them.",
    automatic: "You do not need to fetch OpenStreetMap (paths, roads, buildings) or the Swedish Forest Agency's clear-cuts yourself: they are fetched automatically when the base map is loaded in step 4.",
    button: "Fetch laser data and run",
    again: "Run again",
    starting: "Starting the run …",
    failed: (error: string | null) => `The previous run failed${error ? `: ${error}` : "."} Run again; if it happens once more, split the area into smaller parts (step 1).`,
    unusable: "The latest run for the area has no files for the base map (it is older or did not complete). Run once more.",
    contours: "Contours",
    contourStyles: { detailed: "Detailed", normal: "Normal", generalized: "Generalised", veryGeneralized: "Very generalised" },
    contoursHelp: "How much the elevation model is smoothed before the contours are drawn. Generalised suits flat terrain where small forms are mostly noise. The choice is remembered for the map.",
    noTiles: "Lantmäteriet has no laser tiles for the area. Check that the map is in the right place (in Sweden, the right coordinate system), or choose another area in step 1."
  },
  wait: {
    queued: "The run is waiting for the geo server.",
    running: "The run is in progress.",
    progress: (step: string, done: number, total: number) => total > 1 ? `Step in the run: ${step} (${done} of ${total}).` : `Step in the run: ${step}.`,
    ahead: (count: number) => count === 0 ? "Your run is next in line." : count === 1 ? "1 run is ahead of yours in the queue." : `${count} runs are ahead of yours in the queue.`,
    close: "You can close the page or keep drawing: the run continues on the geo server, and the guide is on the right step when you come back.",
    estimate: (minutes: number, basis: "history" | "guess") => basis === "history"
      ? `Expect about ${formatMinutes(minutes)} from the start, judging by the project's earlier runs. The queue can add waiting time.`
      : `Expect about ${formatMinutes(minutes)} from the start. This is a rough guess from the size of the area; the queue can add waiting time.`,
    cancel: "Cancel the run",
    cancelSure: "Cancel the run? What has been calculated so far is lost.",
    cancelYes: "Yes, cancel",
    cancelNo: "No, continue"
  },
  review: {
    load: (name: string) => `${name} is finished. Load the base map: it is shown as candidates on top of the map and is not saved until you add them.`,
    button: "Load the base map",
    candidates: (count: number) => `The base map is now shown as candidates${count ? ` (${count} objects)` : ""}. Look at the map, and add them with the button "Add … objects to the map" in the row below the map `
      + "(single layers can be unticked there too).",
    adjust: "For more or fewer spot heights, cliffs, green, moisture or clear-cuts: drag the sliders under 3. Adjust without a new run further down. They recalculate the candidates at once.",
    computing: "Calculating candidates …",
    restart: "Run again instead"
  },
  finished: (name: string | undefined) => `The base map for ${name ?? "the whole map"} has been added.`,
  finishedNext: "Undo removes it again. For another part, or a new run of the same area, press New run.",
  restart: "New run",
  problems: {
    SOURCE_NO_CREDENTIAL: "The credentials for Lantmäteriet are missing. Enter them under My account, reload the page and press the button again.",
    SOURCE_REJECTED: "Lantmäteriet did not accept the credentials, or Laserdata Nedladdning, skog has not been ordered at Geotorget. Check the user name and password under My account "
      + "and the order at Geotorget, then press the button again.",
    SOURCE_AREA_TOO_LARGE: "The area is too large for one search. Split it into smaller parts (step 1) and run one part at a time.",
    SOURCE_THROTTLED: "Too many searches in the last hour. Wait a while (at most an hour) and press the button again.",
    SOURCE_UNAVAILABLE: "Lantmäteriet did not answer just now. Wait a few minutes and press the button again.",
    GEO_JOB_BUSY: "You already have two runs waiting or in progress. Wait until one is finished, or cancel one under 2. Laser data › Jobs, then press the button again.",
    GEO_JOB_QUOTA: "This month's quota of laser tiles is used up for your account. Run a smaller part, or wait until next month."
  },
  retry: "Try again in a while. If it still does not work, the steps can be done by hand under 2. Laser data further down."
};

function formatKm2(km2: number): string { return (km2 < 10 ? Math.round(km2 * 10) / 10 : Math.round(km2)).toString(); }
function formatMinutes(minutes: number): string {
  if (minutes < 90) return `${minutes} minutes`;
  return `${Math.round(minutes / 30) / 2} hours`;
}
