import type { Texts } from "../lib/language";
import type { mapDrawingBasisSv } from "./map-drawing-basis-sv";

/** English: drawing basis for freehand mapping. */
export const mapDrawingBasisEn: Texts<typeof mapDrawingBasisSv> = {
  heading: "Basis for freehand mapping",
  help: "For mappers who draw themselves in OCAD or on drafting film: download what the laser job has computed, without loading anything into the map. Everything is in SWEREF 99 TM.",
  none: "No finished laser job has the ground height saved (hojd.png). Run the laser first.",
  job: "Laser job",
  allStages: (name: string, count: number) => `${name} – all ${count} stages`,
  dxfHeading: "Chosen layers as DXF",
  dxfHelp: "One file with a layer per symbol and the ISOM number in the layer name (e.g. 305_Dike), so the layers can be matched to symbols when the file is imported into OCAD.",
  contours: "Dense contours",
  noContours: "None",
  interval: (meters: string) => `${meters} m`,
  smooth: "Lightly smooth the laser noise",
  smoothHelp: "Removes 0.1–0.2 m of noise without moving the landforms. Without smoothing the 0.25 m contours become jagged.",
  banks: "Bank edges (road edges, embankments, ditch edges)",
  banksHelp: "Steep bands of 0.3–4 m between flatter ground, at least 12 m long. Finds embankments and road banks but also some short rock and earth edges. New and not yet measured against a real map.",
  files: {
    "diken.dxf": "Ditches", "knollar.dxf": "Knolls (Karttapullautin)", "kullar.geojson": "Small hills", "formlinjer.dxf": "Form lines",
    "kurvor.dxf": "Contours from the job", "brantlinjer.dxf": "Cliffs", "stup.dxf": "Cliffs (raw ticks)", "fukt.dxf": "Marshes and wet channels",
    "berg.dxf": "Boulders and bare rock", "vatten.geojson": "Lakes and water", "byggnader.geojson": "Buildings (Lantmäteriet)",
    "vegetation.dxf": "Vegetation areas", "belagt.dxf": "Paved area"
  },
  downloadDxf: "Download DXF",
  working: "Computing …",
  dxfDone: (layers: string) => `Done: ${layers}.`,
  imagesHeading: "Background images as GeoTIFF",
  imagesHelp: "Opens as a background map in OCAD and the OCAD app in the right place.",
  shade: "Hillshade (light from four directions)",
  vegetation: "Vegetation height (yellow 0.5–2 m, green 2–5 m, lighter the taller)",
  relief: "Small ground forms (brown raised, blue sunken)",
  noVegetation: "The job does not have the vegetation height saved.",
  printHeading: "Field print for drafting film",
  printHelp: "Light pages to draw on, split into sheets with 10 mm overlap and a coordinate grid.",
  scale: "Scale",
  paper: "Paper",
  landscape: "Landscape",
  printInterval: "Contour interval",
  printLayers: "On the print",
  printLayersHelp: "The layers chosen for the DXF above are included too.",
  downloadPdf: "Create PDF",
  tooManyPages: (pages: number, max: number) => `That makes ${pages} sheets (at most ${max}). Choose a smaller scale or larger paper.`,
  printTitle: "Basis for freehand mapping",
  printFooter: (page: number, pages: number, scale: string, interval: string, date: string) => `sheet ${page} of ${pages} · 1:${scale} · contour interval ${interval} m · ${date} · O-Tid`,
  failed: "It did not work. Try again; if it happens again the area may be too large for the browser."
};
