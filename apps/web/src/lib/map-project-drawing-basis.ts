import {
  bankLines, basisLayerName, cellMeters, contourClass, hillshade, isolines, localRelief, mosaicGrids, pixelToWorld, reliefColor,
  rgbOf, simplifyLine, smoothGrid, stepColor, VEGETATION_STEPS, worldFileAffine, writeDxf, type DxfLayer, type GridPart, type HeightGrid
} from "@o-tid/map-revision/base-map";
import { importLayers, parseDxf, parseGeoJson, type SourceData } from "@o-tid/map-revision";
import { HEIGHT_IMAGE, HEIGHT_WORLD, jobHeights } from "./map-project-clear-contours";
import { bitmapPixels } from "./map-project-flat-contours";

/**
 * Underlag för frihandsritning (Högdalens kartritare via ägaren 2026-11-16, plan i projektets
 * `plan-underlag-frihandsritning-2026-11-16.md`): det laserkörningen redan sparat, utan kandidater och utan kartans symboler.
 * Allt räknas i webbläsaren ur körningens filer (alla etapper på en gång), i SWEREF 99 TM:
 * - en DXF med valda lager, ett lager per symbol med ISOM-numret i namnet, täta kurvor och släntkanter,
 * - GeoTIFF-bilder: terrängskuggning, vegetationens höjd och markens småformer (bakgrundskartor i OCAD),
 * - kurvorna och bilderna som grund för fältutskriften (`map-project-field-print.ts`).
 */
export interface BasisJob { readonly jobId: string; readonly outputs: readonly { readonly name: string }[] }

/** Körningens vektorfiler som går att välja, i den ordning de visas. */
export const BASIS_FILES = ["diken.dxf", "knollar.dxf", "kullar.geojson", "formlinjer.dxf", "kurvor.dxf", "brantlinjer.dxf", "stup.dxf",
  "fukt.dxf", "berg.dxf", "vatten.geojson", "byggnader.geojson", "vegetation.dxf", "belagt.dxf"] as const;
export type BasisFile = (typeof BASIS_FILES)[number];
export const BASIS_INTERVALS = [0.25, 0.5, 1, 2.5, 5] as const;
const VEGETATION_IMAGE = "lasveg.png", VEGETATION_WORLD = "lasveg.pgw";
/** Ringar kortare än så här (bildpunkter, 1 m) är laserns brus. */
const MIN_RING_CELLS = 6;
/** Förenklingen av kurvorna (bildpunkter): 0,15 m är under vad någon ritar men halverar filen. */
const SIMPLIFY_CELLS = 0.15;
/** Småformernas omgivning (m): stenar och gropar upp till några meter breda syns. */
const RELIEF_RADIUS_M = 5;

export const hasHeights = (job: BasisJob) => [HEIGHT_IMAGE, HEIGHT_WORLD].every(name => job.outputs.some(output => output.name === name));
export const filesOf = (jobs: readonly BasisJob[]) => BASIS_FILES.filter(name => jobs.some(job => job.outputs.some(output => output.name === name)));
export const hasVegetation = (jobs: readonly BasisJob[]) => jobs.some(job => [VEGETATION_IMAGE, VEGETATION_WORLD].every(name => job.outputs.some(output => output.name === name)));

const fetchOutput = (base: string, jobId: string, name: string) =>
  fetch(`${base}/geo-jobs/${jobId}/outputs/${name}`, { credentials: "same-origin" }).then(response => response.ok ? response : undefined, () => undefined);

/** Markens höjd ur alla etapper som ett rutnät (1 m). */
export async function loadGround(base: string, jobs: readonly BasisJob[]): Promise<GridPart | undefined> {
  const parts = (await Promise.all(jobs.filter(hasHeights).map(job => jobHeights(base, job)))).filter(part => part !== undefined && part !== "failed");
  return mosaicGrids(parts);
}

/**
 * Vegetationens högsta höjd över mark ur punktmolnet (`lasveg.png`: röd = höjden i 0,2 m-steg, genomskinligt utan punkter;
 * `pointImages` i geo-arbetaren).
 */
export async function loadVegetation(base: string, jobs: readonly BasisJob[]): Promise<GridPart | undefined> {
  const parts: GridPart[] = [];
  for (const job of jobs) {
    if (![VEGETATION_IMAGE, VEGETATION_WORLD].every(name => job.outputs.some(output => output.name === name))) continue;
    const [image, world] = await Promise.all([fetchOutput(base, job.jobId, VEGETATION_IMAGE), fetchOutput(base, job.jobId, VEGETATION_WORLD)]);
    if (!image || !world) continue;
    const affine = worldFileAffine(await world.text());
    const bitmap = await createImageBitmap(await image.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" }).catch(() => undefined);
    const pixels = bitmap && bitmapPixels(bitmap);
    bitmap?.close();
    if (!affine || !pixels) continue;
    const meters = new Float32Array(pixels.width * pixels.height).fill(NaN);
    for (let p = 0; p < meters.length; p += 1) if (pixels.data[p * 4 + 3]! >= 128) meters[p] = pixels.data[p * 4]! * 0.2;
    parts.push({ grid: { columns: pixels.width, rows: pixels.height, meters }, affine });
  }
  return mosaicGrids(parts);
}

export interface ContourLine { readonly level: number; readonly major: number; readonly points: readonly (readonly [number, number])[]; readonly closed: boolean }
/** Kurvorna i SWEREF 99 TM med nivå och klass (hela metrar, var femte meter …). */
export function contoursOf(ground: GridPart, interval: number, smooth: boolean): ContourLine[] {
  const grid: HeightGrid = smooth ? smoothGrid(ground.grid, 1) : ground.grid;
  return isolines(grid, interval, { minRingCells: MIN_RING_CELLS }).map(line => ({
    level: line.level, major: contourClass(line.level, interval), closed: line.closed,
    points: simplifyLine(line.points, SIMPLIFY_CELLS).map(point => pixelToWorld(ground.affine, point))
  }));
}
export function banksOf(ground: GridPart): (readonly (readonly [number, number])[])[] {
  return bankLines(ground.grid, cellMeters(ground.affine)).map(line => line.points.map(point => pixelToWorld(ground.affine, point)));
}

/** Kurvlagrets namn: `hojdkurva_025` för ekvidistansen, `hojdkurva_1m` och `hojdkurva_5m` för de grövre nivåerna. */
export function contourLayer(major: number, interval: number): string {
  const label = (value: number) => String(value).replace(".", "");
  return major === interval ? `hojdkurva_${label(interval)}` : `hojdkurva_${label(major)}m`;
}
export const BANK_LAYER = "slantkant_vagkant";

export interface BasisChoice {
  readonly files: readonly BasisFile[];
  /** Täta kurvor med den här ekvidistansen, eller inga. */
  readonly interval: number | undefined;
  readonly smooth: boolean;
  readonly banks: boolean;
}
export interface BasisDxf { readonly text: string; readonly layers: readonly { readonly name: string; readonly objects: number }[] }

/** Valda filers objekt som lager: GeoJSON och DXF läses, ytor blir slutna linjer. */
export async function basisVectors(base: string, jobs: readonly BasisJob[], file: BasisFile): Promise<Map<string, { lines: { points: (readonly [number, number])[]; closed: boolean; z?: number | undefined }[]; points: (readonly [number, number])[] }>> {
  const features: SourceData["features"][number][] = [];
  for (const job of jobs) {
    if (!job.outputs.some(output => output.name === file)) continue;
    const response = await fetchOutput(base, job.jobId, file);
    if (!response) continue;
    const text = await response.text();
    try { features.push(...(file.endsWith(".geojson") ? parseGeoJson(text) : parseDxf(text)).features); } catch { /* en etapp utan läsbar fil hoppas över; resten används */ }
  }
  const names = new Map(importLayers({ features, skipped: 0 }).map(layer => [layer.name, basisLayerName(layer, file)] as const));
  const layers = new Map<string, { lines: { points: (readonly [number, number])[]; closed: boolean; z?: number | undefined }[]; points: (readonly [number, number])[] }>();
  for (const feature of features) {
    const name = names.get(feature.layer)!;
    let layer = layers.get(name);
    if (!layer) { layer = { lines: [], points: [] }; layers.set(name, layer); }
    const { geometry } = feature;
    if (geometry.kind === "point") layer.points.push(geometry.at);
    else if (geometry.kind === "line") layer.lines.push({ points: [...geometry.points], closed: geometry.closed, z: feature.elevation });
    else for (const ring of geometry.rings) layer.lines.push({ points: [...ring], closed: true });
  }
  return layers;
}

/** AutoCAD-färgen efter ISOM-numrets första siffra (brunt, svart, blått, grönt …), bara för att lagren ska gå att skilja åt. */
const colorOf = (name: string) => ({ "1": 32, "2": 7, "3": 5, "4": 3, "5": 7 } as Record<string, number>)[name[0] ?? ""] ?? 8;

export async function basisDxf(base: string, jobs: readonly BasisJob[], choice: BasisChoice, ground: GridPart | undefined): Promise<BasisDxf> {
  const layers = new Map<string, DxfLayer & { lines: DxfLayer["lines"][number][]; points: (readonly [number, number])[] }>();
  const layerOf = (name: string, color: number) => {
    let layer = layers.get(name);
    if (!layer) { layer = { name, color, lines: [], points: [] }; layers.set(name, layer); }
    return layer;
  };
  for (const file of choice.files) {
    for (const [name, content] of await basisVectors(base, jobs, file)) {
      const layer = layerOf(name, colorOf(name));
      layer.lines.push(...content.lines); layer.points.push(...content.points);
    }
  }
  if (ground && choice.interval !== undefined) {
    for (const line of contoursOf(ground, choice.interval, choice.smooth)) {
      layerOf(contourLayer(line.major, choice.interval), line.major === choice.interval ? 33 : 32).lines.push({ points: line.points, closed: line.closed, z: line.level });
    }
  }
  if (ground && choice.banks) for (const points of banksOf(ground)) layerOf(BANK_LAYER, 1).lines.push({ points, closed: false });
  const list = [...layers.values()].filter(layer => layer.lines.length + layer.points.length > 0);
  return { text: writeDxf(list), layers: list.map(layer => ({ name: layer.name, objects: layer.lines.length + layer.points.length })) };
}

export type BasisImage = "shade" | "vegetation" | "relief";
/** Bildens RGB och läge; skuggningen ljus från fyra håll (diken och kanter syns oavsett riktning). */
export function imageOf(kind: BasisImage, ground: GridPart | undefined, vegetation: GridPart | undefined): { rgb: Uint8Array; part: GridPart } | undefined {
  if (kind === "vegetation") return vegetation && { rgb: rgbOf(vegetation.grid.meters, value => stepColor(VEGETATION_STEPS, value)), part: vegetation };
  if (!ground) return undefined;
  const cell = cellMeters(ground.affine);
  if (kind === "relief") return { rgb: rgbOf(localRelief(ground.grid, RELIEF_RADIUS_M / cell), value => reliefColor(value)), part: ground };
  const gray = hillshade(ground.grid, cell, [315, 45, 135, 225], 2);
  const rgb = new Uint8Array(gray.length * 3);
  for (let i = 0; i < gray.length; i += 1) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = gray[i]!;
  return { rgb, part: ground };
}

/** GeoTIFF (RGB, okomprimerad) i SWEREF 99 TM, som OCAD läser som bakgrundskarta med rätt läge. */
export async function geoTiff(rgb: Uint8Array, { grid, affine }: GridPart): Promise<ArrayBuffer> {
  const { writeArrayBuffer } = await import("geotiff");
  const cell = cellMeters(affine);
  // Världsfilen ger första bildpunktens mitt; GeoTIFF:s fästpunkt (PixelIsArea) är dess övre vänstra hörn.
  return writeArrayBuffer(rgb, {
    width: grid.columns, height: grid.rows, BitsPerSample: [8, 8, 8], PhotometricInterpretation: 2, SamplesPerPixel: 3,
    ModelPixelScale: [cell, cell, 0], ModelTiepoint: [0, 0, 0, affine[2] - cell / 2, affine[5] + cell / 2, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 3006
  }) as ArrayBuffer;
}
