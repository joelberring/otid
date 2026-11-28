/**
 * Etapp G4B: kopplingen mellan `scripts/geo-worker.ts` och O-Tids egen MIT-Rust-motor `tools/otidgeo` (`run`, `veg`, `rasters`).
 *
 * Bara Nodes egna moduler (och syskonmoduler i `scripts/` + delade `vegetation-shapes.ts`), så filen körs direkt av Node i
 * `deploy/geo.Dockerfile` utan transpilering.
 */
import { constants as fsConstants } from "node:fs";
import { access, copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { VEG_DIFFICULT, VEG_FIGHT, VEG_FOREST, VEG_NONE, VEG_OPEN, VEG_SEMI, VEG_SLOW, vegetationLayerMask, vegetationRing,
  vegetationShapeSteps } from "../packages/map-revision/src/base-map/vegetation-shapes.ts";
import { decodePng, toRgba, type Box } from "./geo-merge.ts";
import { type Grid, maskRings, moistureDxf, simplify } from "./geo-moisture.ts";
import { GREEN_STEPS, readWorldFile, SEMI_ALPHA } from "./geo-vegetation.ts";

export type GeoEngine = "otidgeo" | "pullautin";

/** Faller tillbaka på `"pullautin"` för äldre jobb utan uttryckligt `engine`-fält. */
export function resolveEngine(engine?: string | null): GeoEngine {
  return engine === "otidgeo" ? "otidgeo" : "pullautin";
}

/** Styr hur bildmotorfri Karttapullautin körs (aldrig `pngmerge`; `contoursonly=1` utom vid `rawTicks` eller legacy-fallback utan `otidgeo`). */
export function pullautinPlan(
  job: { readonly cliffs?: { readonly rawTicks?: boolean } | null | undefined; readonly vegetation?: unknown },
  hasOtidgeo: boolean
): { readonly contoursOnly: boolean; readonly useOtidgeoVeg: boolean; readonly kpVegeBitmode: boolean; readonly runPngMerge: false } {
  const wantVeg = Boolean(job.vegetation);
  const useOtidgeoVeg = wantVeg && hasOtidgeo;
  const kpVegeBitmode = wantVeg && !useOtidgeoVeg;
  const contoursOnly = job.cliffs?.rawTicks !== true && !kpVegeBitmode;
  return { contoursOnly, useOtidgeoVeg, kpVegeBitmode, runPngMerge: false };
}

/** Kontrollerar om en binärfil finns och är körbar (`X_OK`). */
export async function hasExecutable(path: string): Promise<boolean> {
  return access(path, fsConstants.X_OK).then(() => true, () => false);
}

export const FORMLINE_MODES = ["off", "sparse", "normal", "dense"] as const;
export type FormlineModeName = typeof FORMLINE_MODES[number];

export const OTIDGEO_PROFILES = ["very-detailed", "detailed", "normal", "generalized", "very-generalized"] as const;
export type OtidgeoProfileName = typeof OTIDGEO_PROFILES[number];

interface OtidgeoProfileSpec {
  readonly smooth_m: number;
  readonly taubin: number;
  readonly curviness: number;
  readonly min_loop_area: number;
  readonly min_clearance: number;
  readonly formline_gap: number;
  readonly formline_max_slope: number;
}

/**
 * De 4 icke-normala kurvprofilerna i `tools/otidgeo/src/types.rs` (synkade med `contourStyleSettings` i webben), så att
 * `otidgeoRunArgs` kan skicka `--profile <namn>` och hålla inre profilfält (t.ex. `simplify_m`, `formline_min_slope_deg`)
 * i full synk.
 */
const OTIDGEO_PROFILE_SPECS: Readonly<Record<"forest" | "sprint", Readonly<Record<Exclude<OtidgeoProfileName, "normal">, OtidgeoProfileSpec>>>> = {
  forest: {
    "very-detailed": { smooth_m: 0.62, taubin: 1, curviness: 0.34, min_loop_area: 15, min_clearance: 0.85, formline_gap: 3, formline_max_slope: 20.5 },
    "detailed": { smooth_m: 0.76, taubin: 1, curviness: 0.29, min_loop_area: 22, min_clearance: 1.15, formline_gap: 3.5, formline_max_slope: 19 },
    "generalized": { smooth_m: 1.42, taubin: 3, curviness: 0.14, min_loop_area: 58, min_clearance: 1.95, formline_gap: 5.5, formline_max_slope: 14.5 },
    "very-generalized": { smooth_m: 2.1, taubin: 4, curviness: 0.08, min_loop_area: 100, min_clearance: 2.4, formline_gap: 7.6, formline_max_slope: 11.5 }
  },
  sprint: {
    "very-detailed": { smooth_m: 0.45, taubin: 1, curviness: 0.34, min_loop_area: 8, min_clearance: 0.5, formline_gap: 2.1, formline_max_slope: 20 },
    "detailed": { smooth_m: 0.56, taubin: 1, curviness: 0.29, min_loop_area: 11, min_clearance: 0.68, formline_gap: 2.6, formline_max_slope: 18.5 },
    "generalized": { smooth_m: 1.05, taubin: 3, curviness: 0.14, min_loop_area: 24, min_clearance: 1.2, formline_gap: 4.4, formline_max_slope: 14 },
    "very-generalized": { smooth_m: 1.55, taubin: 4, curviness: 0.08, min_loop_area: 40, min_clearance: 1.5, formline_gap: 5.8, formline_max_slope: 11 }
  }
};

/** Känner igen vilken av de 4 icke-normala kurvprofilerna som jobbets inställningar motsvarar (för `--profile`). */
export function inferOtidgeoProfile(settings: Readonly<Record<string, number>>): Exclude<OtidgeoProfileName, "normal"> | undefined {
  const table = isNum(settings.contour_interval) && settings.contour_interval <= 3 ? OTIDGEO_PROFILE_SPECS.sprint : OTIDGEO_PROFILE_SPECS.forest;
  for (const name of ["very-detailed", "detailed", "generalized", "very-generalized"] as const) {
    const spec = table[name];
    if (settings.smooth_m === spec.smooth_m && settings.taubin === spec.taubin && settings.curviness === spec.curviness
      && settings.min_loop_area === spec.min_loop_area && settings.min_clearance === spec.min_clearance) {
      return name;
    }
  }
  return undefined;
}

/** Mappar `settings.formline` (`0..3`) till `otidgeo --formline-mode`. */
export function formlineModeOf(value: number | undefined): FormlineModeName | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const idx = Math.max(0, Math.min(3, Math.round(value)));
  return FORMLINE_MODES[idx]!;
}

const isNum = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export interface OtidgeoJobOptions {
  readonly settings: Readonly<Record<string, number>>;
  readonly clip?: Box | null | undefined;
  readonly vegetation?: { readonly minAreaM2: number } | null | undefined;
}

/**
 * Bygger CLI-flaggor för `otidgeo run`.
 *
 * `greenscale` behåller O-Tids riktning (större = mindre grönt, t.ex. 1,5), medan `otidgeo --green-scale` multiplicerar
 * grönpoängen (större = mer grönt) och därför får `1 / greenscale`.
 */
export function otidgeoRunArgs(inputs: readonly string[], outDir: string, job: OtidgeoJobOptions): string[] {
  const s = job.settings;
  const sprint = isNum(s.contour_interval) && s.contour_interval <= 3;
  const profile = inferOtidgeoProfile(s);
  const profileSpec = profile ? OTIDGEO_PROFILE_SPECS[sprint ? "sprint" : "forest"][profile] : undefined;
  const args: string[] = ["run"];
  for (const input of inputs) args.push("--input", input);
  args.push("--out", outDir);
  if (isNum(s.contour_interval)) args.push("--interval", String(s.contour_interval));
  if (profile) args.push("--profile", profile);
  if (isNum(s.smooth_m)) args.push("--smooth-m", String(s.smooth_m));
  if (isNum(s.taubin)) args.push("--taubin-passes", String(Math.round(s.taubin)));
  if (isNum(s.curviness)) args.push("--curviness", String(s.curviness));
  if (isNum(s.min_loop_area)) args.push("--min-loop-area-m2", String(s.min_loop_area));
  if (isNum(s.min_clearance)) args.push("--min-clearance-m", String(s.min_clearance));
  const fl = formlineModeOf(s.formline);
  if (fl) args.push("--formline-mode", fl);
  // När `--profile` känns igen och `--formline-mode` är `sparse` eller `dense` låter vi otidgeos Pass 3 skala
  // profilens hjälpkurveförval, såvida inte användaren skrivit in ett avvikande handvärde.
  const scaledFormlineMode = fl === "sparse" || fl === "dense";
  if (isNum(s.formline_gap) && !(profileSpec && scaledFormlineMode && s.formline_gap === profileSpec.formline_gap)) {
    args.push("--formline-min-gap-m", String(s.formline_gap));
  }
  if (isNum(s.formline_max_slope) && !(profileSpec && scaledFormlineMode && s.formline_max_slope === profileSpec.formline_max_slope)) {
    args.push("--formline-max-slope-deg", String(s.formline_max_slope));
  }
  if (isNum(s.veg_smooth)) args.push("--veg-smooth", String(s.veg_smooth));
  if (isNum(s.greenscale) && s.greenscale > 0) args.push("--green-scale", String(round4(1 / s.greenscale)));
  if (isNum(s.openshare)) args.push("--open-share", String(s.openshare));
  if (isNum(s.topweight)) args.push("--canopy-weight", String(s.topweight));
  if (isNum(s.undergrowth)) args.push("--undergrowth-thresh", String(s.undergrowth));
  // Webben skickar alltid GEO_JOB_DEFAULTS.minAreaM2 = 300; i sprint låter vi otidgeo använda sitt sprintanpassade förval.
  if (isNum(job.vegetation?.minAreaM2) && !(sprint && job.vegetation.minAreaM2 === 300)) {
    args.push("--min-veg-area-m2", String(job.vegetation.minAreaM2));
  }
  if (isNum(s.knollshare)) args.push("--knoll-share", String(s.knollshare));
  if (s.overview !== 0) args.push("--overview");
  if (job.clip) args.push("--clip", `${job.clip.minX},${job.clip.minY},${job.clip.maxX},${job.clip.maxY}`);
  return args;
}

/**
 * Bygger CLI-flaggor för `otidgeo veg` (används i bildmotorfri `pullautin` för `vegetationsklasser.png` + `.pgw`).
 * När `fromPullautin` är sant skalas KP:s `undergrowth` (förval 0,35) och `topweight` (förval 0,8) till `otidgeo`:s skala.
 */
export function otidgeoVegArgs(inputs: readonly string[], outDir: string, job: OtidgeoJobOptions, fromPullautin = false): string[] {
  const s = job.settings;
  const args: string[] = ["veg"];
  for (const input of inputs) args.push("--input", input);
  args.push("--out", outDir);
  if (isNum(s.contour_interval)) args.push("--interval", String(s.contour_interval));
  if (isNum(s.veg_smooth)) args.push("--veg-smooth", String(s.veg_smooth));
  if (isNum(s.greenscale) && s.greenscale > 0) args.push("--green-scale", String(round4(1 / s.greenscale)));
  if (isNum(s.openshare)) args.push("--open-share", String(s.openshare));
  if (isNum(s.topweight)) args.push("--canopy-weight", String(fromPullautin ? round4(s.topweight * (0.34 / 0.8)) : s.topweight));
  if (isNum(s.undergrowth)) args.push("--undergrowth-thresh", String(fromPullautin ? round4(s.undergrowth * (0.058 / 0.35)) : s.undergrowth));
  const sprint = isNum(s.contour_interval) && s.contour_interval <= 3;
  if (isNum(job.vegetation?.minAreaM2) && !(sprint && job.vegetation.minAreaM2 === 300)) {
    args.push("--min-veg-area-m2", String(job.vegetation.minAreaM2));
  }
  if (job.clip) args.push("--clip", `${job.clip.minX},${job.clip.minY},${job.clip.maxX},${job.clip.maxY}`);
  return args;
}

export interface OtidgeoRastersOptions {
  readonly groundFiles: readonly string[];
  readonly waterFiles?: readonly string[] | undefined;
  readonly pointFiles?: readonly string[] | undefined;
  readonly vegPng?: string | undefined;
  readonly outDir: string;
  readonly heightRasters?: boolean | undefined;
  readonly pointImages?: boolean | undefined;
  readonly waterGeoJson?: boolean | undefined;
  readonly moisture?: { readonly channelHa: number; readonly wetMeters: number; readonly moistMeters: number } | null | undefined;
  readonly cliffs?: {
    readonly minDrop: number;
    readonly impassableDrop: number;
    readonly impassableLength: number;
    readonly tags?: boolean | undefined;
    readonly c3g?: string | undefined;
    readonly c2g?: string | undefined;
  } | null | undefined;
  readonly ditchesTracks?: boolean | undefined;
  readonly rock?: { readonly mode: number; readonly knolls?: boolean | undefined; readonly knollShare?: number | undefined } | null | undefined;
}

/** Bygger CLI-flaggor för `otidgeo rasters` (delad multi-trådad Rust-rastermotor för båda motorerna). */
export function otidgeoRastersArgs(opts: OtidgeoRastersOptions): string[] {
  const args: string[] = ["rasters"];
  for (const file of opts.groundFiles) args.push("--ground", file);
  for (const file of opts.waterFiles ?? []) args.push("--water", file);
  for (const file of opts.pointFiles ?? []) args.push("--points", file);
  if (opts.vegPng) args.push("--veg-png", opts.vegPng);
  args.push("--out", opts.outDir);
  if (opts.heightRasters) args.push("--height-rasters");
  if (opts.pointImages && opts.pointFiles?.length) args.push("--point-images");
  if (opts.waterGeoJson && opts.waterFiles?.length) args.push("--water-geojson");
  if (opts.moisture) {
    args.push("--moisture", "--channel-ha", String(opts.moisture.channelHa),
      "--wet-meters", String(opts.moisture.wetMeters), "--moist-meters", String(opts.moisture.moistMeters));
  }
  if (opts.cliffs) {
    args.push("--cliffs", "--cliff-min-drop", String(opts.cliffs.minDrop),
      "--cliff-impassable-drop", String(opts.cliffs.impassableDrop), "--cliff-impassable-length", String(opts.cliffs.impassableLength));
    if (opts.cliffs.tags) args.push("--cliff-tags");
    if (opts.cliffs.c3g) args.push("--cliff-c3g", opts.cliffs.c3g);
    if (opts.cliffs.c2g) args.push("--cliff-c2g", opts.cliffs.c2g);
  }
  if (opts.ditchesTracks) args.push("--ditches-tracks");
  if (opts.rock) {
    args.push("--rock", "--rock-mode", String(opts.rock.mode));
    if (opts.rock.knolls) args.push("--knolls");
    if (isNum(opts.rock.knollShare)) args.push("--knoll-share", String(opts.rock.knollShare));
  }
  return args;
}

export interface RastersSummary {
  readonly waterHa?: number; readonly waterAreas?: number;
  readonly wetHa?: number; readonly moistHa?: number; readonly wetAreas?: number; readonly moistAreas?: number;
  readonly channels?: number; readonly terrainChannels?: number;
  readonly cliffs201?: number; readonly cliffs202?: number;
  readonly cliffMeters201?: number; readonly cliffMeters202?: number; readonly cliffsDropped?: number;
  readonly ditches?: number; readonly tracks?: number;
  readonly boulders?: number; readonly knolls?: number; readonly bareRockAreas?: number; readonly cappedPoints?: number;
  readonly msHeight?: number; readonly msMoisture?: number; readonly msCliffs?: number;
  readonly msTracks?: number; readonly msRock?: number; readonly msTotal?: number;
}

/** Mappar `rasters-summary.json` till samma fält i jobbsummeringen som JS-stegen. */
export function summaryFromRasters(r: RastersSummary, flags: {
  readonly water: boolean; readonly moisture: boolean; readonly cliffs: boolean; readonly ditchesTracks: boolean; readonly rock: boolean;
}): Record<string, number> {
  const out: Record<string, number> = {};
  if (flags.water && isNum(r.waterHa)) out.waterHa = r.waterHa;
  if (flags.moisture) {
    if (isNum(r.wetHa)) out.wetHa = r.wetHa;
    if (isNum(r.moistHa)) out.moistHa = r.moistHa;
    if (isNum(r.channels)) out.channels = r.channels;
  }
  if (flags.cliffs && (r.cliffs201 ?? 0) + (r.cliffs202 ?? 0) > 0) {
    if (isNum(r.cliffs201)) out.cliffs201 = r.cliffs201;
    if (isNum(r.cliffs202)) out.cliffs202 = r.cliffs202;
    if (isNum(r.cliffMeters201)) out.cliffMeters201 = r.cliffMeters201;
    if (isNum(r.cliffMeters202)) out.cliffMeters202 = r.cliffMeters202;
    if (isNum(r.cliffsDropped)) out.cliffsDropped = r.cliffsDropped;
  }
  if (flags.ditchesTracks) {
    if (isNum(r.ditches)) out.ditches = r.ditches;
    if (isNum(r.terrainChannels)) out.terrainChannels = r.terrainChannels;
    if (isNum(r.tracks) && r.tracks > 0) out.tracks = r.tracks;
  }
  if (flags.rock) {
    if (isNum(r.boulders)) out.boulders = r.boulders;
    if (isNum(r.knolls)) out.knolls = r.knolls;
    if (isNum(r.bareRockAreas)) out.bareRockAreas = r.bareRockAreas;
    if (isNum(r.cappedPoints) && r.cappedPoints > 0) out.cappedPoints = r.cappedPoints;
  }
  if (isNum(r.msHeight)) out.msRastersHeight = Math.round(r.msHeight);
  if (isNum(r.msMoisture)) out.msRastersMoisture = Math.round(r.msMoisture);
  if (isNum(r.msCliffs)) out.msRastersCliffs = Math.round(r.msCliffs);
  if (isNum(r.msTracks)) out.msRastersTracks = Math.round(r.msTracks);
  if (isNum(r.msRock)) out.msRastersRock = Math.round(r.msRock);
  return out;
}

/** Läser alla klippta `.las`/`.laz`-rutor i `./in/` i sorterad ordning, som relativa sökvägar för `otidgeo`. */
export async function listLaserInputs(dir: string): Promise<string[]> {
  const names = (await readdir(join(dir, "in"))).filter(name => /\.(las|laz)$/i.test(name)).sort();
  return names.map(name => join("in", name));
}

/** Kopierar valfria filer från `otidgeo`:s utdatakatalog till jobbets rotkatalog om de finns. */
export async function copyPresent(fromDir: string, toDir: string, names: readonly string[]): Promise<string[]> {
  const existing = new Set(await readdir(fromDir).catch(() => [] as string[]));
  const copied: string[] = [];
  for (const name of names) {
    if (!existing.has(name)) continue;
    await copyFile(join(fromDir, name), join(toDir, name));
    copied.push(name);
  }
  return copied;
}

/**
 * Bygger `vegetation.dxf`, hektarsummering samt `openAt`/`forestAt` direkt ur `otidgeo`:s färdigklassade RGBA-bild
 * `vegetationsklasser.png` + `.pgw` (utan att köra om `generalizeVegetation`, så `veg_smooth` och `minAreaM2` bevaras exakt).
 */
export function vegetationFromClassPng(
  pngBytes: Uint8Array,
  worldText: string,
  options?: { readonly vegSmooth?: number | undefined; readonly scale?: number | undefined },
  water?: (x: number, y: number) => boolean
) {
  const image = toRgba(decodePng(pngBytes)), world = readWorldFile(worldText);
  const { width, height, data } = image, cell = world.size;
  const minX = world.left, minY = world.top - (height - 1) * cell;
  const labels = new Uint8Array(width * height), und = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) {
    const wx = minX + x * cell;
    for (let y = 0; y < height; y += 1) {
      const line = height - 1 - y, o = (line * width + x) * 4, i = x * height + y;
      const alpha = data[o + 3]!;
      if (alpha < 128 || water?.(wx, minY + y * cell)) continue;
      const value = data[o]!, low = value & 15, shade = low >= 2 ? low - 2 : -1;
      if (low === 1) labels[i] = Math.abs(alpha - SEMI_ALPHA) <= 20 ? VEG_SEMI : VEG_OPEN;
      else if (shade >= GREEN_STEPS.fight) labels[i] = VEG_FIGHT;
      else if (shade >= GREEN_STEPS.difficult) labels[i] = VEG_DIFFICULT;
      else if (shade >= GREEN_STEPS.slow) labels[i] = VEG_SLOW;
      else labels[i] = VEG_FOREST;
      const u = value >> 4;
      if (u >= 2) und[i] = 2;
      else if (u >= 1) und[i] = 1;
    }
  }
  const area = cell * cell;
  const full: Grid = { minX, minY, cell, width, height, z: new Float64Array(0) };
  const vegSmooth = options?.vegSmooth;
  const smoothLevel = vegSmooth === undefined ? 3 : vegSmooth <= 0.1 ? 0 : Math.max(1, Math.min(8, Math.round(vegSmooth * 3)));
  const steps = smoothLevel > 0 ? vegetationShapeSteps({ cellMeters: cell, scale: options?.scale ?? 15_000, level: smoothLevel }) : undefined;
  const summary: Record<string, number> = {};
  const landLayers: readonly (readonly [string, string, number])[] = [
    ["oppen_mark", "401", VEG_OPEN],
    ["oppen_mark_spridda_trad", "404", VEG_SEMI],
    ["gron_lattlopt", "406", VEG_SLOW],
    ["gron_svarlopt", "408", VEG_DIFFICULT],
    ["gron_mycket_svarlopt", "410", VEG_FIGHT]
  ];
  const parts = landLayers.map(([name, code, lab]) => {
    const mask = vegetationLayerMask(labels, width, height, lab);
    const rings = maskRings(mask, full)
      .map(ring => steps ? vegetationRing(ring, steps.tolerance * cell, steps.rounds) : simplify(ring, cell * 0.5))
      .filter(ring => ring.length >= 4);
    let cells = 0;
    for (let i = 0; i < mask.length; i += 1) if (mask[i]) cells += 1;
    summary[`ha${code}`] = Math.round(cells * area / 100) / 100;
    return { name, closed: true, parts: rings };
  });
  for (const [name, code, minUnd] of [["undervegetation_lattlopt", "407", 1], ["undervegetation_svarlopt", "409", 2]] as const) {
    const mask = new Uint8Array(und.length);
    let cells = 0;
    for (let i = 0; i < und.length; i += 1) if (und[i]! >= minUnd) { mask[i] = 1; cells += 1; }
    const rings = maskRings(mask, full).map(ring => simplify(ring, cell * 0.75)).filter(ring => ring.length >= 4);
    summary[`ha${code}`] = Math.round(cells * area / 100) / 100;
    parts.push({ name, closed: true, parts: rings });
  }
  const openAt = (x: number, y: number) => {
    const col = Math.round((x - minX) / cell), row = Math.round((y - minY) / cell);
    if (col < 0 || row < 0 || col >= width || row >= height) return false;
    const lab = labels[col * height + row]!;
    return lab === VEG_OPEN || lab === VEG_SEMI;
  };
  const forestAt = (x: number, y: number) => {
    const col = Math.round((x - minX) / cell), row = Math.round((y - minY) / cell);
    return col >= 0 && row >= 0 && col < width && row < height && labels[col * height + row] === VEG_FOREST;
  };
  return { dxf: moistureDxf(parts), summary, openAt, forestAt, hasData: labels.some(lab => lab !== VEG_NONE) };
}
