import type { Texts } from "../lib/language";
import type { routeChoiceSv } from "./route-choice-sv";

/** Engelska del 26: vägvalsanalysen i kontrollkartan (samma nycklar som routeChoiceSv). */
const place = (key: string) => key === "S" ? "start" : key === "F" ? "finish" : key.split(".")[0]!;
const meters = (value: number) => value >= 10_000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const routeChoiceAnalysisEn: Texts<typeof routeChoiceSv> = {
  barriersFailed: "The course setting's barriers (forbidden areas and crossing points) could not be read. Route choices are not calculated, so that nothing is suggested through forbidden areas.",
  mode: "Route choice",
  needsMapFile: "Route choices are calculated from the map file. Upload the map file (OCAD or Mapper) under Results → Map and route choice.",
  goToMapFile: "Go to Map and route choice",
  mismatch: "The course file does not seem to be made on this map. The controls are placed with the coordinates in the course file instead.",
  noPlaces: "The controls have no positions on the map file, so route choices cannot be calculated. Import a course file with positions (OCAD or Purple Pen).",
  course: "Course or variant",
  courseOption: (course: string, variant: string | null) => variant ? `${course}, variant ${variant}` : course,
  reading: "Reading the map file …",
  analysing: (done: number, total: number) => `Calculating route choices … ${done} of ${total} legs`,
  done: (total: number) => `Done: ${count(total, "leg", "legs")}.`,
  failed: "The route choices could not be calculated. Try again.",
  readFailed: "The map file could not be read for the route choices.",
  retry: "Try again",
  table: {
    caption: "Route choice per leg",
    leg: "Leg",
    straight: "Straight line",
    best: "Best route",
    climb: "Climb",
    time: "Estimated time",
    choices: "Route choices",
    verdict: "Assessment"
  },
  legName: (from: string, to: string) => `${place(from)}–${place(to)}`,
  meters,
  climb: (value: number) => `${Math.round(value)} m`,
  pending: "Calculating …",
  noRoute: "No route",
  choices: (n: number) => String(n),
  verdicts: {
    ROUTE_CHOICE: "Route choice leg",
    NO_CHOICE: "No route choice",
    ABOUT_EQUAL: "The route choices are about equally good"
  },
  verdictHelp: "The route choices are about equally good = the best route choice changes if the speeds change 15 % up or down.",
  total: (best: number, straight: number) => `Whole course: best route ${meters(best)} against the straight line ${meters(straight)}` +
    (straight > 0 ? ` (${Math.round((best / straight - 1) * 100)} % longer).` : "."),
  totalIncomplete: "The whole course is calculated when all legs are done.",
  warnings: {
    heading: "To check",
    THROUGH_OTHER_CONTROL: (code: string) => `The best route passes through the circle of control ${code}.`,
    CONTROL_IN_IMPASSABLE: (code: string) => code === "S" ? "The start is in impassable terrain." : code === "F" ? "The finish is in impassable terrain."
      : `Control ${code} is in impassable terrain.`,
    NO_ROUTE: (from: string, to: string) => `No route was found between ${place(from)} and ${place(to)}.`
  },
  legWarning: (leg: string) => `Leg ${leg}:`,
  map: (leg: string) => `Route choice on the leg ${leg}`,
  control: (code: number) => `Control ${code}`,
  legend: "Blue line = the best route. Shaded area = routes at most 5 % worse. Dashed lines in other colours = other route choices, numbered with how much longer they take (at most 25 %).",
  alternative: (index: number, percent: number) => `Route choice ${index + 1}: ${percent} % longer time`,
  alternativeLabel: (index: number, percent: number) => `${index + 1} · +${percent} %`,
  showLeg: (leg: string) => `Show ${leg} on the map`,
  settings: {
    heading: "Settings for the route choices",
    help: "Changes are recalculated at once and saved for the event.",
    contour: "Contour interval (m)",
    climbFactor: "1 m of climb counts as (m of flat road)",
    pace: "Speed in ordinary forest (min/km)",
    save: "Save the settings",
    saved: "The settings are saved.",
    failed: "The settings could not be saved.",
    invalid: "Check the numbers: contour interval 0.5–50 m, climb 0–50 m and speed 2:00–30:00 min/km.",
    unknownHeading: "Symbols not in the table",
    unknownHelp: "They count as ordinary forest. Choose how they should count.",
    unknownNone: "All symbols on the map are in the table.",
    unknownRow: (code: string, name: string, objects: number) => `${code} ${name} (${count(objects, "object", "objects")})`,
    classLabel: (code: string) => `How symbol ${code} should count`
  },
  classes: {
    FAST: "Fast (road, path, open land)",
    NORMAL: "Ordinary forest",
    SLOW: "Slow",
    VERY_SLOW: "Very slow",
    FIGHT: "Almost stop",
    IMPASSABLE: "Impassable",
    IGNORE: "Does not affect speed"
  },
  shortClasses: { FAST: "Fast", NORMAL: "Ordinary forest", SLOW: "Slow", VERY_SLOW: "Very slow", FIGHT: "Almost stop" },
  calibration: {
    heading: "The speeds against the runners' routes",
    button: "Adjust the speeds to these routes",
    help: (runners: number) => `${count(runners, "runner", "runners")} with results on the course ${runners === 1 ? "has" : "have"} an uploaded GPS route. ` +
      "The routes are processed in the browser and are not sent anywhere.",
    none: "No uploaded GPS routes for runners with results on the course yet.",
    running: "Comparing the speeds with the routes …",
    caption: "Speed against ordinary forest",
    kind: "Terrain",
    before: "Before",
    after: "After",
    samples: (n: number) => `Based on ${count(n, "leg", "legs")}.`,
    reliability: { NONE: "Too little data: the speeds do not change.", LOW: "Little data: treat the suggestion as a rough guide.",
      MEDIUM: "Quite a lot of data.", HIGH: "A lot of data." },
    save: "Save",
    saved: "The speeds are saved.",
    failed: "The speeds could not be calculated."
  },
  publish: {
    button: "Show best route choices publicly",
    withdraw: "Hide best route choices publicly",
    help: "The best route per leg is shown in the public split analysis next to the runners' routes, but only once the courses are public.",
    published: "The best route choices are shown publicly when the courses are public.",
    publishedAt: (time: string) => `Shown publicly since ${time}.`,
    withdrawn: "The best route choices are no longer shown publicly.",
    oldMap: "The best route choices were published for an earlier map file and are not shown publicly. Publish again.",
    waitForAll: "Wait until all legs are calculated.",
    failed: "The best route choices could not be published.",
    mapChanged: "The map file has been changed since the analysis was calculated. Open Route choice again."
  }
};
