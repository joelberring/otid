import type {
  PublicMapBounds, PublicMapFootprint, PublicMapNorm, RaceMapSourceMetadata
} from "@o-tid/contracts";
import type { Database } from "@o-tid/database";
import { countiesForMunicipalities, municipalitiesForBounds, type Wgs84Bounds } from "@o-tid/domain";
import {
  drawMap, isSupportedEpsg, mapPointToWgs84, projectedToWgs84, readMapFile, type MapCrs, type MapDrawingContext,
  type MapGeoreference, type ParsedMap
} from "@o-tid/map-file";
import { readMapContent } from "./map-content";

/**
 * Etapp 3.2: serverrenderad rasterkarta och georeferens-metadata ur `.ocd`/`.omap`.
 * Används av den publika kartbanken (förhandsvisningsbilder, automatisk kommuntaggning)
 * och av nedladdningsspärrade klubbkartor (högupplöst PNG till `race_map` utan att källfilen
 * någonsin skickas till webbläsaren).
 */
export interface ServerCanvas {
  readonly context: MapDrawingContext;
  png(): Uint8Array;
}
export type ServerCanvasFactory = (width: number, height: number) => Promise<ServerCanvas> | ServerCanvas;

export interface ProjectedExtentInput {
  readonly epsg: number;
  readonly extent: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
}

export interface GeoMetadata {
  readonly wgs84Bounds: Wgs84Bounds;
  readonly footprint: PublicMapFootprint;
  readonly municipalityCodes: string[];
  readonly countyCodes: string[];
}

export interface ExtractedMapMetadata {
  readonly parsed: ParsedMap;
  readonly format: "OCD" | "OMAP";
  readonly version: string;
  readonly scale: number;
  readonly norm: PublicMapNorm;
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  readonly georeference: MapGeoreference | null;
  readonly wgs84Bounds: PublicMapBounds | null;
  readonly footprint: PublicMapFootprint | null;
  readonly municipalityCodes: string[];
  readonly countyCodes: string[];
  readonly summary: RaceMapSourceMetadata["summary"];
}

export interface RenderedMapPng {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly render: { readonly pxPerMm: number; readonly originX: number; readonly originY: number };
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
  readonly tiePoints: RaceMapSourceMetadata["tiePoints"];
}

export const RACE_RASTER_TARGET_DPI = 180;
export const RACE_RASTER_MAX_SIDE_PX = 4096;
export const PREVIEW_RASTER_TARGET_DPI = 100;
export const PREVIEW_RASTER_MAX_SIDE_PX = 1200;

const MM_PER_INCH = 25.4;
const FALLBACK_BOUNDS = { minX: -50, minY: -50, maxX: 50, maxY: 50 } as const;

type NativeCanvasModule = {
  createCanvas(width: number, height: number): {
    getContext(kind: "2d"): unknown;
    toBuffer(mime: "image/png"): Buffer;
  };
};

let nativeCanvasPromise: Promise<NativeCanvasModule> | null = null;

async function loadNativeCanvas(): Promise<NativeCanvasModule> {
  if (!nativeCanvasPromise) {
    // Dynamisk import så att klientpaket aldrig drar in den nativa modulen.
    const moduleName = "@napi-rs/canvas";
    nativeCanvasPromise = import(moduleName) as Promise<NativeCanvasModule>;
  }
  return nativeCanvasPromise;
}

/** Skapar en server-canvas via `@napi-rs/canvas` (Skia) med samma 2D-kontext som webbläsaren. */
export const createServerMapCanvas: ServerCanvasFactory = async (width, height) => {
  const nativeCanvas = await loadNativeCanvas();
  const canvas = nativeCanvas.createCanvas(width, height);
  const context = canvas.getContext("2d") as MapDrawingContext;
  return { context, png: () => new Uint8Array(canvas.toBuffer("image/png")) };
};

function roundCoord(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function geoFromCorners(corners: readonly ({ readonly longitude: number; readonly latitude: number } | null)[]): GeoMetadata | null {
  if (corners.length < 3 || corners.some(c => !c || !Number.isFinite(c.longitude) || !Number.isFinite(c.latitude))) {
    return null;
  }
  const valid = corners as { readonly longitude: number; readonly latitude: number }[];
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const footprint: PublicMapFootprint = [];
  for (const pt of valid) {
    const lon = roundCoord(pt.longitude);
    const lat = roundCoord(pt.latitude);
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    footprint.push([lon, lat]);
  }
  const wgs84Bounds: Wgs84Bounds = { minLon, minLat, maxLon, maxLat };
  const municipalityCodes = municipalitiesForBounds(wgs84Bounds);
  const countyCodes = countiesForMunicipalities(municipalityCodes);
  return { wgs84Bounds, footprint, municipalityCodes, countyCodes };
}

/**
 * Räknar WGS84-utbredning, polygon och svenska kommunkoder direkt från en sparad
 * `club_map_version_check.fingerprint.projected` utan att läsa om hela kartfilen.
 */
export function boundsAndMunicipalitiesFromProjected(projected: ProjectedExtentInput | null | undefined): GeoMetadata | null {
  if (!projected) return null;
  const { epsg, extent } = projected;
  if (!isSupportedEpsg(epsg)) return null;
  const crs: MapCrs = { kind: "EPSG", code: epsg };
  const corners = [
    projectedToWgs84(crs, extent.minX, extent.minY),
    projectedToWgs84(crs, extent.maxX, extent.minY),
    projectedToWgs84(crs, extent.maxX, extent.maxY),
    projectedToWgs84(crs, extent.minX, extent.maxY)
  ];
  return geoFromCorners(corners);
}

/** Härleder kartnorm (ISOM / ISSprOM / OTHER) ur kartans skala. */
export function detectMapNorm(scale: number | null | undefined): PublicMapNorm {
  if (!scale || !Number.isFinite(scale)) return "OTHER";
  if (scale <= 5000) return "ISSprOM";
  if (scale >= 7500 && scale <= 15000) return "ISOM";
  return "OTHER";
}

function validBoundsOf(parsed: ParsedMap): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = parsed.bounds;
  if (b && Number.isFinite(b.minX) && Number.isFinite(b.minY) && Number.isFinite(b.maxX) && Number.isFinite(b.maxY)
    && b.maxX > b.minX && b.maxY > b.minY) {
    return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
  }
  return { ...FALLBACK_BOUNDS };
}

/** Läser en `.ocd`/`.omap`-buffert och extraherar skala, norm, gränser, georeferens och kommuner. */
export function extractMapMetadata(bytes: Uint8Array, fileName: string): ExtractedMapMetadata {
  const parsed = readMapFile(bytes, fileName);
  const bounds = validBoundsOf(parsed);
  const scale = Math.max(100, Math.min(1_000_000, Math.round(parsed.scale || 10_000)));
  const norm = detectMapNorm(scale);
  let geo: GeoMetadata | null = null;
  if (parsed.georeference) {
    const corners = [
      mapPointToWgs84(parsed.georeference, { x: bounds.minX, y: bounds.minY }),
      mapPointToWgs84(parsed.georeference, { x: bounds.maxX, y: bounds.minY }),
      mapPointToWgs84(parsed.georeference, { x: bounds.maxX, y: bounds.maxY }),
      mapPointToWgs84(parsed.georeference, { x: bounds.minX, y: bounds.maxY })
    ];
    geo = geoFromCorners(corners);
  }
  const summary: RaceMapSourceMetadata["summary"] = {
    objectCount: parsed.objects.length,
    warnings: parsed.warnings.slice(0, 200).map(w => ({
      code: w.code.slice(0, 80) || "WARNING",
      count: w.count,
      text: w.text.slice(0, 300) || w.code
    })),
    simplifications: []
  };
  return {
    parsed,
    format: parsed.format,
    version: (parsed.version || parsed.format).slice(0, 80),
    scale,
    norm,
    bounds,
    georeference: parsed.georeference,
    wgs84Bounds: geo?.wgs84Bounds ?? null,
    footprint: geo?.footprint ?? null,
    municipalityCodes: geo?.municipalityCodes ?? [],
    countyCodes: geo?.countyCodes ?? [],
    summary
  };
}

/**
 * Ritar en inläst karta till PNG på servern och räknar tre georeferenspunkter (tiePoints)
 * om kartan har georeferens.
 */
export async function renderParsedMapToPng(
  parsed: ParsedMap,
  options: {
    readonly targetDpi?: number | undefined;
    readonly maxSidePx?: number | undefined;
    readonly createCanvas?: ServerCanvasFactory | undefined;
  } = {}
): Promise<RenderedMapPng> {
  const bounds = validBoundsOf(parsed);
  const targetDpi = options.targetDpi ?? RACE_RASTER_TARGET_DPI;
  const maxSidePx = options.maxSidePx ?? RACE_RASTER_MAX_SIDE_PX;
  const widthMm = Math.max(1, bounds.maxX - bounds.minX);
  const heightMm = Math.max(1, bounds.maxY - bounds.minY);
  let pxPerMm = targetDpi / MM_PER_INCH;
  const maxDimMm = Math.max(widthMm, heightMm);
  if (maxDimMm * pxPerMm > maxSidePx) {
    pxPerMm = maxSidePx / maxDimMm;
  }
  // Håll pxPerMm inom kontraktets gräns (<= 100) och säkerställ minst 1 px per sida.
  pxPerMm = Math.min(100, Math.max(1 / maxDimMm, pxPerMm));
  const width = Math.max(1, Math.min(maxSidePx, Math.ceil(widthMm * pxPerMm)));
  const height = Math.max(1, Math.min(maxSidePx, Math.ceil(heightMm * pxPerMm)));
  const origin = { x: bounds.minX, y: bounds.maxY };

  const factory = options.createCanvas ?? createServerMapCanvas;
  const canvas = await factory(width, height);
  drawMap(canvas.context, parsed, { pxPerMm, origin, cull: false, background: true });
  const png = canvas.png();

  let tiePoints: RaceMapSourceMetadata["tiePoints"] = null;
  if (parsed.georeference) {
    const tl = mapPointToWgs84(parsed.georeference, { x: origin.x, y: origin.y });
    const tr = mapPointToWgs84(parsed.georeference, { x: origin.x + width / pxPerMm, y: origin.y });
    const bl = mapPointToWgs84(parsed.georeference, { x: origin.x, y: origin.y - height / pxPerMm });
    if (tl && tr && bl) {
      tiePoints = [
        { pixelX: 0, pixelY: 0, latitude: tl.latitude, longitude: tl.longitude },
        { pixelX: width, pixelY: 0, latitude: tr.latitude, longitude: tr.longitude },
        { pixelX: 0, pixelY: height, latitude: bl.latitude, longitude: bl.longitude }
      ];
    }
  }

  return { png, width, height, render: { pxPerMm, originX: origin.x, originY: origin.y }, bounds, tiePoints };
}

/** Läser en kartfil ur `map_content` och ritar en PNG + fullständig metadata för tävling eller förhandsvisning. */
export async function renderMapContentToPng(
  db: Database,
  sha256: string,
  fileName: string,
  options: {
    readonly mode: "race" | "preview";
    readonly createCanvas?: ServerCanvasFactory | undefined;
  }
): Promise<{ readonly meta: ExtractedMapMetadata; readonly rendered: RenderedMapPng; readonly sourceMetadata: RaceMapSourceMetadata } | null> {
  const bytes = await readMapContent(db, sha256);
  if (!bytes) return null;
  const meta = extractMapMetadata(new Uint8Array(bytes), fileName);
  const rendered = await renderParsedMapToPng(meta.parsed, {
    targetDpi: options.mode === "race" ? RACE_RASTER_TARGET_DPI : PREVIEW_RASTER_TARGET_DPI,
    maxSidePx: options.mode === "race" ? RACE_RASTER_MAX_SIDE_PX : PREVIEW_RASTER_MAX_SIDE_PX,
    createCanvas: options.createCanvas
  });
  const sourceMetadata: RaceMapSourceMetadata = {
    formatVersion: 1,
    format: meta.format,
    version: meta.version,
    scale: meta.scale,
    bounds: rendered.bounds,
    georeference: meta.georeference,
    render: rendered.render,
    summary: meta.summary,
    tiePoints: rendered.tiePoints
  };
  return { meta, rendered, sourceMetadata };
}
