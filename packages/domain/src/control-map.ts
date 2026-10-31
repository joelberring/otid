import { invertRasterCoordinate, projectRasterPixel, type RasterAffineTransform } from "./raster-georeference";

/**
 * Steg 52 (ADR-0176): kontrollkartan. Ren layout utan I/O: kontrollernas, startens och målets lägen i en gemensam ram,
 * belastningen per kontroll och löparens stämplingar mot banan. Webben ritar resultatet som SVG.
 *
 * Ramen väljs i ordning: kartfilens mm direkt till bildens pixlar (steg 59, när bilden är ritad ur kartfilen och banfilen
 * hör till kartan); kartbilden (georefererad, pixlar) när lägen i WGS 84 finns; annars lägena i meter runt mittpunkten
 * (norr uppåt); annars kartlägena (IOF MapPosition, mm) i meter med kartans skala. Ett läge som bara har kartläge
 * placeras i en WGS 84-ram när minst två andra punkter har båda (likformig anpassning).
 */
export type ControlMapFrame = "MAP" | "GEO" | "PAPER" | "NONE";
export interface ControlMapGeo { readonly latitude: number; readonly longitude: number }
export interface ControlMapPaper { readonly x: number; readonly y: number }
export interface ControlMapPlace { readonly key: string; readonly geo?: ControlMapGeo | undefined; readonly paper?: ControlMapPaper | undefined }
export interface ControlMapXY { readonly x: number; readonly y: number }

export interface ControlMapLayoutInput {
  readonly places: readonly ControlMapPlace[];
  /** Georefererad kartbild. */
  readonly map?: { readonly transform: RasterAffineTransform; readonly width: number; readonly height: number } | undefined;
  /** Kartans skala (t.ex. 10000) för kartlägena. */
  readonly scale?: number | null | undefined;
  /** Steg 59: kartfilen som kartbilden är ritad ur. */
  readonly mapFile?: ControlMapFileFrame | undefined;
}

/**
 * Kartfilen bakom kartbilden (steg 59, ADR-0179 beslut 5): bildens upplösning och kartans punkt (mm, y uppåt) i bildens
 * övre vänstra hörn, kartans yta i mm, skala och, när filen har en georeferens, kartans mm → WGS 84.
 */
export interface ControlMapFileFrame {
  readonly render: { readonly pxPerMm: number; readonly originX: number; readonly originY: number };
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  readonly image: { readonly width: number; readonly height: number };
  readonly scale: number;
  /** Kartans mm → WGS 84; undefined från funktionen = kan inte räknas om (då kontrolleras bara ytan). */
  readonly toGeo?: ((paper: ControlMapPaper) => ControlMapGeo | undefined) | undefined;
}

/** Kartlägen får ligga så långt utanför kartans yta (mm), t.ex. en start strax utanför kartramen. */
export const MAP_FILE_BOUNDS_MARGIN_MM = 10;
/** Största skillnad mellan banfilens Position och kartläget via kartfilens georeferens. */
export const MAP_FILE_MAX_DEVIATION_METERS = 10;

/**
 * Hur kartfilen användes: USED = lägena ligger på kartfilens mm; MISMATCH = banfilen verkar inte vara gjord på kartan
 * (ett kartläge utanför kartan eller mer än 10 m från Position), dagens ordning används; null = ingen kartfil eller inga
 * kartlägen.
 */
export type ControlMapFileUse = "USED" | "MISMATCH" | null;

export interface ControlMapLayout {
  readonly frame: ControlMapFrame;
  /** Meter per enhet i ramen (null = okänd skala). */
  readonly metersPerUnit: number | null;
  readonly points: ReadonlyMap<string, ControlMapXY>;
  /** Ytan som punkterna täcker (null utan punkter). */
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | null;
  readonly mapFile: ControlMapFileUse;
}

const EARTH = 6_371_008.8;
const RAD = Math.PI / 180;

function geoDistance(from: ControlMapGeo, to: ControlMapGeo): number {
  const dLat = (to.latitude - from.latitude) * RAD, dLng = (to.longitude - from.longitude) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.latitude * RAD) * Math.cos(to.latitude * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Likformig anpassning (skala, vridning, förskjutning) från kartlägen till ramen ur punkter som har båda. */
function similarity(pairs: readonly { from: ControlMapXY; to: ControlMapXY }[]): ((point: ControlMapXY) => ControlMapXY) | undefined {
  if (pairs.length < 2) return undefined;
  const mean = (list: readonly ControlMapXY[]) => ({ x: list.reduce((sum, p) => sum + p.x, 0) / list.length,
    y: list.reduce((sum, p) => sum + p.y, 0) / list.length });
  const from = mean(pairs.map(pair => pair.from)), to = mean(pairs.map(pair => pair.to));
  let re = 0, im = 0, norm = 0;
  for (const pair of pairs) {
    const px = pair.from.x - from.x, py = pair.from.y - from.y, qx = pair.to.x - to.x, qy = pair.to.y - to.y;
    // a = Σ q · conj(p) / Σ |p|²
    re += qx * px + qy * py; im += qy * px - qx * py; norm += px * px + py * py;
  }
  if (norm < 1e-9) return undefined;
  const a = re / norm, b = im / norm;
  return point => ({ x: to.x + a * (point.x - from.x) - b * (point.y - from.y), y: to.y + b * (point.x - from.x) + a * (point.y - from.y) });
}

/** Kartläget med y nedåt (IOF MapPosition har y uppåt). */
const paperXY = (paper: ControlMapPaper): ControlMapXY => ({ x: paper.x, y: -paper.y });

/** Kartfilens kontroll: alla kartlägen inom kartans yta och, med georeferens, nära Position. */
function mapFileFits(frame: ControlMapFileFrame, places: readonly ControlMapPlace[]): boolean {
  const { bounds } = frame, margin = MAP_FILE_BOUNDS_MARGIN_MM;
  for (const place of places) {
    const paper = place.paper!;
    if (!Number.isFinite(paper.x) || !Number.isFinite(paper.y) || paper.x < bounds.minX - margin || paper.x > bounds.maxX + margin ||
      paper.y < bounds.minY - margin || paper.y > bounds.maxY + margin) return false;
    // Utan omräkning (koordinatsystemet stöds inte) kontrolleras bara ytan.
    const expected = place.geo && frame.toGeo ? frame.toGeo(paper) : undefined;
    if (expected && !(geoDistance(expected, place.geo!) <= MAP_FILE_MAX_DEVIATION_METERS)) return false;
  }
  return true;
}

function finish(frame: ControlMapFrame, metersPerUnit: number | null, points: ReadonlyMap<string, ControlMapXY>,
  mapFile: ControlMapFileUse): ControlMapLayout {
  const rounded = new Map([...points].map(([key, point]) => [key, { x: round(point.x), y: round(point.y) }]));
  const all = [...rounded.values()];
  const bounds = all.length === 0 ? null : { minX: Math.min(...all.map(p => p.x)), minY: Math.min(...all.map(p => p.y)),
    maxX: Math.max(...all.map(p => p.x)), maxY: Math.max(...all.map(p => p.y)) };
  return { frame, metersPerUnit, points: rounded, bounds, mapFile };
}

/** Kartfilens ram: kartlägen direkt till bildens pixlar, lägen med bara WGS 84 via kartbildens georeferens. */
function mapFileLayout(frame: ControlMapFileFrame, input: ControlMapLayoutInput): ControlMapLayout {
  const { pxPerMm, originX, originY } = frame.render;
  const points = new Map<string, ControlMapXY>();
  for (const place of input.places) {
    if (place.paper) points.set(place.key, { x: (place.paper.x - originX) * pxPerMm, y: (originY - place.paper.y) * pxPerMm });
    else if (place.geo && input.map) {
      const pixel = invertRasterCoordinate(input.map.transform, place.geo.longitude, place.geo.latitude);
      points.set(place.key, { x: pixel.pixelX, y: pixel.pixelY });
    }
  }
  const meters = frame.scale / 1000 / pxPerMm;
  return finish("MAP", Number.isFinite(meters) && meters > 0 ? meters : null, points, "USED");
}

export function layoutControlMap(input: ControlMapLayoutInput): ControlMapLayout {
  let mapFile: ControlMapFileUse = null;
  const onPaper = input.places.filter(place => place.paper);
  if (input.mapFile && onPaper.length > 0) {
    if (mapFileFits(input.mapFile, onPaper)) return mapFileLayout(input.mapFile, input);
    mapFile = "MISMATCH";
  }
  const geo = input.places.filter(place => place.geo);
  const paper = input.places.filter(place => place.paper);
  const points = new Map<string, ControlMapXY>();
  let frame: ControlMapFrame = "NONE";
  let metersPerUnit: number | null = null;
  if (geo.length > 0) {
    let toFrame: (point: ControlMapGeo) => ControlMapXY;
    if (input.map) {
      const { transform } = input.map;
      frame = "MAP";
      toFrame = point => { const pixel = invertRasterCoordinate(transform, point.longitude, point.latitude); return { x: pixel.pixelX, y: pixel.pixelY }; };
      const middle = projectRasterPixel(transform, input.map.width / 2, input.map.height / 2);
      const right = projectRasterPixel(transform, input.map.width / 2 + 100, input.map.height / 2);
      const meters = geoDistance(middle, right) / 100;
      metersPerUnit = Number.isFinite(meters) && meters > 0 ? meters : null;
    } else {
      frame = "GEO";
      const latitude = geo.reduce((sum, place) => sum + place.geo!.latitude, 0) / geo.length;
      const longitude = geo.reduce((sum, place) => sum + place.geo!.longitude, 0) / geo.length;
      const cos = Math.cos(latitude * RAD);
      toFrame = point => ({ x: (point.longitude - longitude) * RAD * EARTH * cos, y: -(point.latitude - latitude) * RAD * EARTH });
      metersPerUnit = 1;
    }
    for (const place of geo) points.set(place.key, toFrame(place.geo!));
    // Kartläge när WGS 84 saknas: anpassat efter punkter som har båda.
    const fit = similarity(input.places.filter(place => place.geo && place.paper)
      .map(place => ({ from: paperXY(place.paper!), to: points.get(place.key)! })));
    if (fit) for (const place of paper) if (!points.has(place.key)) points.set(place.key, fit(paperXY(place.paper!)));
  } else if (paper.length > 0) {
    frame = "PAPER";
    const factor = input.scale && input.scale > 0 ? input.scale / 1000 : 1;
    metersPerUnit = input.scale && input.scale > 0 ? 1 : null;
    for (const place of paper) { const xy = paperXY(place.paper!); points.set(place.key, { x: xy.x * factor, y: xy.y * factor }); }
  }
  return finish(frame, metersPerUnit, points, mapFile);
}

/** En bana eller variant: kontrollerna i ordning. `variant` null = banan utan gafflingar. */
export interface ControlLoadCourse { readonly courseId: string; readonly variants: readonly { readonly code: string | null; readonly controlCodes: readonly number[] }[] }
export interface ControlLoadEntry { readonly courseId: string; readonly variantCode: string | null }

export interface ControlLoad {
  readonly code: number;
  /** Banor som har kontrollen. */
  readonly courses: number;
  /** Banor och varianter som har kontrollen (en bana utan gafflingar räknas som en). */
  readonly variants: number;
  /** Anmälda (ej strukna) vars bana eller variant har kontrollen. */
  readonly planned: number;
  /** Löpare som stämplat kontrollen enligt avläsningarna. */
  readonly punched: number;
}

/**
 * Belastningen per kontroll. En löpare i en gafflad klass utan variant räknas på en kontroll som alla varianter har.
 * `punched` är kontrollkoderna som varje avläst löpare stämplat (en gång per löpare).
 */
export function controlLoads(courses: readonly ControlLoadCourse[], entries: readonly ControlLoadEntry[],
  punched: readonly (readonly number[])[]): ControlLoad[] {
  const codes = new Set<number>();
  for (const course of courses) for (const variant of course.variants) for (const code of variant.controlCodes) codes.add(code);
  const byCourse = new Map(courses.map(course => [course.courseId, course]));
  const loads = new Map([...codes].map(code => [code, { code, courses: 0, variants: 0, planned: 0, punched: 0 }]));
  for (const course of courses) {
    const inCourse = new Set<number>();
    for (const variant of course.variants) for (const code of new Set(variant.controlCodes)) { inCourse.add(code); loads.get(code)!.variants += 1; }
    for (const code of inCourse) loads.get(code)!.courses += 1;
  }
  for (const entry of entries) {
    const course = byCourse.get(entry.courseId);
    if (!course) continue;
    const variant = course.variants.find(row => row.code === entry.variantCode) ?? (course.variants.length === 1 ? course.variants[0] : undefined);
    const own = variant ? new Set(variant.controlCodes)
      : new Set([...new Set(course.variants.flatMap(row => row.controlCodes))].filter(code => course.variants.every(row => row.controlCodes.includes(code))));
    for (const code of own) loads.get(code)!.planned += 1;
  }
  for (const runner of punched) for (const code of new Set(runner)) { const load = loads.get(code); if (load) load.punched += 1; }
  return [...loads.values()].sort((left, right) => left.code - right.code);
}

export type RunnerControlMark = "OK" | "MISSING" | "WRONG_ORDER" | "NEUTRAL";

export interface RunnerControlMarkRow {
  readonly code: number;
  /** Platsen i banan (1 = första kontrollen). */
  readonly position: number;
  readonly mark: RunnerControlMark;
  /** Föregående och nästa kontroll ("S" och "M" för start och mål), för "Kontroll 47 saknas, mellan 46 och 48". */
  readonly previous: number | "S";
  readonly next: number | "M";
}

/**
 * Löparens stämplingar mot banan: en kontroll med sträcktid är stämplad; en utan sträcktid som ändå finns bland brickans
 * extra stämplingar (bedömningens `extraPunches`) är stämplad i fel ordning; annars saknas den. En kontroll ur funktion är
 * frivillig (NEUTRAL) när den inte stämplats.
 */
export function runnerControlMarks(courseCodes: readonly number[], splits: readonly { readonly controlCode: number; readonly occurrence: number }[],
  extraCodes: readonly number[], outOfOrder: ReadonlySet<number> = new Set()): RunnerControlMarkRow[] {
  const stamped = new Set(splits.map(split => `${split.controlCode}.${split.occurrence}`));
  const onCard = new Map<number, number>();
  for (const code of extraCodes) onCard.set(code, (onCard.get(code) ?? 0) + 1);
  const seen = new Map<number, number>();
  return courseCodes.map((code, index) => {
    const occurrence = (seen.get(code) ?? 0) + 1;
    seen.set(code, occurrence);
    const mark: RunnerControlMark = stamped.has(`${code}.${occurrence}`) ? "OK" : outOfOrder.has(code) ? "NEUTRAL"
      : (onCard.get(code) ?? 0) > 0 ? "WRONG_ORDER" : "MISSING";
    return { code, position: index + 1, mark, previous: index === 0 ? "S" : courseCodes[index - 1]!,
      next: index === courseCodes.length - 1 ? "M" : courseCodes[index + 1]! };
  });
}
