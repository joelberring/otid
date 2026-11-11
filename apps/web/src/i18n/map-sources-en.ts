import type { Texts } from "../lib/language";
import type { mapSourcesSv } from "./map-sources-sv";
import { mapSourcesAccountEn } from "./account-en";

/** Engelska del 33: ortofoton, markfuktighet och laserdata med Karttapullautin i kartprojektet. */
type Sources = typeof mapSourcesSv;

export const mapSourcesOrthoEn: Texts<Sources["ortho"]> = {
  heading: "Orthophoto from Lantmäteriet",
  help: "Search aerial photos for the whole map or a stage with your own credentials for Lantmäteriet; the chosen ones are added as base layers (one per image tile). © Lantmäteriet.",
  noCredential: "Add your credentials for Lantmäteriet under My account first.",
  account: "My account",
  where: "Area",
  whole: "The whole map",
  search: "Search orthophotos",
  searching: "Searching …",
  none: "No orthophotos were found for the area.",
  item: (when: string | null, collection: string | null, id: string) => [when?.slice(0, 10), collection, id].filter(Boolean).join(" · "),
  add: (n: number) => n === 1 ? "Add 1 image as a base layer" : `Add ${n} images as base layers`,
  adding: (done: number, total: number) => `Fetching image ${done} of ${total} …`,
  added: (n: number) => n === 1 ? "1 base layer added. It is under Base layers above, where it is shown, hidden and made transparent."
    : `${n} base layers added. They are under Base layers above, where they are shown, hidden and made transparent.`,
  failed: (n: number) => n === 1 ? "1 image could not be added. The reason is under Base layers above." : `${n} images could not be added. The reason is under Base layers above.`,
  name: (collection: string | null, id: string) => `Orthophoto ${collection ?? ""} ${id}`.replace(/\s+/g, " ").trim().slice(0, 80),
  problems: {
    SOURCE_NO_CREDENTIAL: "Add your credentials for Lantmäteriet under My account first.",
    SOURCE_REJECTED: "Lantmäteriet did not accept the credentials, or the product is not ordered on Geotorget.",
    SOURCE_AREA_TOO_LARGE: "The area is too large for one search. Choose a stage.",
    SOURCE_THROTTLED: "Too many searches in the last hour. Try again later.",
    SOURCE_UNAVAILABLE: "Lantmäteriet did not answer right now. Try again in a while.",
    OUTSIDE: "The image does not cover the area.",
    generic: (status: number | string) => `That did not work (${status}).`
  }
};

export const mapSourcesMoistureEn: Texts<Sources["moisture"]> = {
  heading: "Soil moisture (SLU)",
  help: "SLU's soil moisture map (2 m, open data from the Swedish Forest Agency) for the whole map or a stage, as a base layer. Blue is wet: "
    + "use it to find marshes, wet channels and ditches to survey.",
  fetch: "Fetch soil moisture",
  fetching: "Fetching soil moisture …",
  name: (area?: string) => `Soil moisture SLU ${area ?? "whole map"}`.slice(0, 80),
  added: "The soil moisture is added as a base layer.",
  attribution: "Soil moisture map SLU, Swedish Forest Agency."
};

export const mapSourcesLaserEn: Texts<Sources["laser"]> = {
  heading: "Laser data and Karttapullautin",
  help: "Search laser tiles (2.5 × 2.5 km) for the whole map or a stage with your own credentials for Lantmäteriet. The geo server runs "
    + "Karttapullautin: the image is added as a base layer, and contours, form lines, cliffs and knolls can be loaded as candidates. "
    + "The laser data is clipped to the map's area (or the stage) with a 50 m margin before it is processed.",
  attribution: "Laserdata Nedladdning, skog © Lantmäteriet, CC BY 4.0 (processed with Karttapullautin, GPL-3).",
  search: "Search laser tiles",
  searching: "Searching …",
  none: "No laser tiles were found for the area.",
  item: (when: string | null, id: string, bytes: number | null) =>
    [when?.slice(0, 10), id, bytes ? `${Math.round(bytes / 1_000_000)} MB` : null].filter(Boolean).join(" · "),
  name: "Name of the result",
  defaultName: (area?: string) => `Karttapullautin ${area ?? "whole map"}`.slice(0, 80),
  interval: "Contour interval",
  intervalOption: (meters: number) => `${meters} m`,
  formlines: "Form lines",
  formlineOptions: { 0: "No form lines", 1: "Contours at half the interval", 2: "Form lines where needed" },
    choicesHeading: "Settings",
    choiceLabels: { cliffs: "Cliffs", contours: "Contours", knolls: "Knolls", green: "Green", undergrowth: "Undergrowth" },
    choiceLevels: {
      cliffs: { less: "Fewer", default: "Default", more: "More" }, contours: { less: "Smoother", default: "Default", more: "More detailed" },
      knolls: { less: "Fewer", default: "Default", more: "More" }, green: { less: "Less", default: "Default", more: "More" },
      undergrowth: { less: "Less", default: "Default", more: "More" }
    },
    choicesHelp: "Karttapullautin measures green as the share of laser hits 1–2.65 m above ground (the shrub layer) against the hits on the ground, and weighs in the tree crowns. Try a stage first, or run a finished job again and compare.",
    rerun: "Run again with other settings",
    rerunHeading: (name: string) => `Run ${name} again with the same tiles and area:`,
    rerunName: (name: string) => `${name} (new)`.slice(0, 80),
    rerunStart: "Run again",
    sample: "Area",
    sampleWhole: "The job's whole area",
    sampleMiddle: "Sample square 250 × 250 m in the middle",
    sampleArea: (name: string) => `Sample square 250 × 250 m in ${name}`,
    sampleSuffix: " (sample)",
    more: "Advanced: values in Karttapullautin",
    moreHelp: "The values are written to Karttapullautin's pullauta.ini (the name is in brackets). Leave a field empty for Karttapullautin's default. "
      + "Try a small stage first and compare the images.",
    settingLabels: {
      smoothing: "Contour smoothing", curviness: "Contour curviness", knolls: "Knolls", formlinesteepness: "Form lines by steepness",
      cliff1: "Cliffs, threshold 1", cliff2: "Cliffs, threshold 2", cliffsteepfactor: "Cliffs, steepness factor",
      yellowheight: "Open land, maximum height", greenground: "Green, height of the ground layer", greenhigh: "Green, maximum height", undergrowth: "Undergrowth",
      topweight: "Green, weight of the crowns", greenscale: "Green, factor on the limits"
    },
    settingHints: {
      smoothing: "Default 0.7. A higher value gives smoother contours.", curviness: "Default 1.1. A higher value exaggerates the bends.",
      knolls: "Default 0.6. A higher value gives fewer but more distinct knolls.", formlinesteepness: "Default 0.37. A higher value gives more form lines.",
      cliff1: "Default 1.15: drop in metres per metre sideways for a passable cliff to be drawn. A lower value gives more cliffs.",
      cliff2: "Default 2.0: the same measure for an impassable cliff.", cliffsteepfactor: "Default 0.38.",
      yellowheight: "Default 0.9 m.", greenground: "Default 0.9 m.", greenhigh: "Default 2 m.",
      undergrowth: "Default 0.35. A lower value gives more undergrowth.",
      topweight: "Default 0.8. A lower value means that green under dense crowns is not counted up.", greenscale: "Default 1. A larger value gives less green."
    },
    settingField: (label: string, key: string, low: number, high: number) => `${label} (${key}, ${low}–${high})`,
    settingDefault: "default",
    settingsUsed: (list: string) => `Settings: ${list}`,
    clipped: (width: number, height: number) => `Clipped to the area, ${width} × ${height} m`,
    unclipped: "The whole laser tiles",
  moisture: "Also calculate the moisture (marshes and wet channels from the terrain model)",
  channel: "Wet channels from catchment",
  channelOption: (ha: number) => `${ha} ha`,
  wet: "Wet below",
  wetOption: (meters: number) => `${meters} m above the channel`,
  moistureAdded: "The moisture is added as a base layer.",
  vegetation: "Also make areas of the vegetation (open land, green and undergrowth from the laser returns)",
  minArea: "Smallest area",
  minAreaOption: (m2: number) => `${m2} m²`,
  start: (n: number) => n === 1 ? "Run Karttapullautin on 1 tile" : `Run Karttapullautin on ${n} tiles`,
  started: "The job is in the queue.",
  jobs: "The jobs",
  status: {
    QUEUED: "Waiting for the geo server", RUNNING: "Running", DONE: "Done", FAILED: "Failed", CANCELLED: "Cancelled"
  },
  progress: (step: string, done: number, total: number) => total > 1 ? `${step} (${done} of ${total})` : step,
  dwgJob: "DWG drawing",
  tiles: (n: number) => n === 1 ? "1 tile" : `${n} tiles`,
  layerAdded: "The image is added as a base layer.",
  outputs: {
    "kurvor.dxf": "Contours", "formlinjer.dxf": "Form lines", "branter.dxf": "Cliffs", "stup.dxf": "Steep cliffs", "knollar.dxf": "Knolls",
    "fukt.dxf": "Marshes and wet channels", "diken.dxf": "Ditches from the terrain shape", "berg.dxf": "Boulders and bare rock", "vegetation.dxf": "Vegetation areas", "vatten.geojson": "Lakes and water", "brantlinjer.dxf": "Cliffs as lines", "marktacke.geojson": "Land cover from Lantmäteriet", "byggnader.geojson": "Buildings from Lantmäteriet", "ritning.geojson": "The drawing"
  },
  loadBaseMap: "Load the base map",
    osmMissing: "OpenStreetMap could not be fetched now, so paths, roads and houses are missing. Fetch them under Import vectors.",
    extras: { LAND_COVER: "Also read land cover from Lantmäteriet (water, open land, fields, marsh)", BUILDINGS: "Also read buildings from Lantmäteriet" },
    baseMap: "The base map",
    load: (label: string) => `Load ${label.toLowerCase()} as candidates`,
  loaded: (label: string) => `${label} are shown as candidates below under Vector file.`,
  cancel: "Cancel",
  remove: "Remove",
  server: {
    READY: "The geo server is running.",
    STARTING: "The geo server is starting (a few minutes).",
    OFF: "The geo server starts when a job is waiting.",
    UNAVAILABLE: "The geo server cannot be started right now. The jobs wait in the queue; whoever runs O-Tid has been notified.",
    BUDGET: "The month's budget for the geo server is used up. The jobs wait in the queue until next month or until the budget is raised.",
    NOT_CONFIGURED: "The geo server is not set up on this installation. The jobs wait in the queue."
  },
  problems: {
    SOURCE_NO_CREDENTIAL: "Add your credentials for Lantmäteriet under My account first.",
    SOURCE_REJECTED: "Lantmäteriet did not accept the credentials, or Laserdata Nedladdning skog is not ordered on Geotorget.",
    SOURCE_AREA_TOO_LARGE: "The area is too large for one search. Choose a stage.",
    SOURCE_THROTTLED: "Too many searches in the last hour. Try again later.",
    SOURCE_UNAVAILABLE: "Lantmäteriet did not answer right now. Try again in a while.",
    GEO_JOB_BUSY: "You already have two jobs waiting or running. Wait until one is done.",
    GEO_JOB_QUOTA: "The month's quota of laser tiles is used up for your account.",
    generic: (status: number | string) => `That did not work (${status}).`
  }
};

/** Hela `mapSourcesSv` på engelska (kontot står i `account-en.ts`). */
export const mapSourcesEn: Texts<Sources> = {
  account: mapSourcesAccountEn,
  ortho: mapSourcesOrthoEn,
  photo: {
    heading: "Interpret aerial photo (bare rock, open land)",
    help: "A first attempt: an orthophoto that is a base layer is interpreted here in the browser. Grey and light areas become bare rock (214), light green and even areas open land (401). "
      + "Only broad areas count. Dry grass, gravel and roofs can become bare rock, so go through the suggestions before you put them in.",
    none: "No visible base layer. Fetch an orthophoto above and keep it shown.",
    layer: "Base layer",
    run: "Interpret the photo",
    name: (layer: string) => `${layer} – photo interpretation`.slice(0, 120),
    done: (rock: number, open: number) => `${rock} ha bare rock and ${open} ha open land are shown as candidates below under Vector file.`,
    nothing: "No broad grey or light green areas were found in the photo.",
    failed: "The photo could not be interpreted."
  },
  depth: {
    heading: "Moisture with sliders (wet and moist)",
    help: "The laser run's moisture depth (height above the nearest moisture channel) is read here. Drag the limits: the areas show at once as candidates on the map, "
      + "without a new run. Wet becomes marsh (308) and moist indistinct marsh (310).",
    none: "No moisture depth shown. Run Karttapullautin with moisture and keep the base layer ending in “fuktdjup” shown.",
    layer: "Base layer",
    wet: (meters: string) => `Wet: up to ${meters} m above the channel`,
    moist: (meters: string) => `Moist: up to ${meters} m`,
    minArea: (square: number) => `Smallest area: ${square} m²`,
    run: "Show as candidates",
    name: (layer: string) => `${layer} – wet and moist`.slice(0, 120),
    done: (wet: string, moist: string) => `${wet} ha wet and ${moist} ha moist. Change the limits and it is recalculated.`,
    nothing: "No areas with these limits.",
    failed: "The moisture depth could not be read."
  },
  moisture: mapSourcesMoistureEn,
  laser: mapSourcesLaserEn
};
