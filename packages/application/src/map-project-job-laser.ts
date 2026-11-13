import { GEO_CLIP_MARGIN_M, MCP_LASER_OUTPUT_MAX_OBJECTS, MCP_LASER_OUTPUT_MAX_POINTS, MCP_LASER_OUTPUT_MAX_POINTS_PER_OBJECT } from "@o-tid/contracts";
import { isSupportedEpsg, type MapGeoreference, type Point } from "@o-tid/map-file";
import {
  areaBox, guessCrs, isSprintNorm, laserClip, mapNorm, objectBox, parseDxf, parseGeoJson, sourcePointToMap, VectorParseError, WGS84_EPSG, type SourceData, type SourceFeature
} from "@o-tid/map-revision";
import { candidateSymbols } from "@o-tid/map-revision/base-map";
import type { Box, LoadedProjectMap } from "./map-project-job-run";

/**
 * Ägaren 2026-11-13 (AI-kopplingen startar och läser laserkörningar): det som behöver kartans georeferens görs som kartjobb i
 * utskriftsarbetaren, där grundfilen ändå läses. `runLaserArea` ger rutorna för en ny körning (samma uträkning som
 * laserpanelen i webbläsaren), `runLaserOutput` läser en av körningens vektorfiler och räknar om den till kartans mm.
 * Ren kod utan I/O.
 */
type Polygon = readonly (readonly Point[])[];
const SWEREF99TM = 3006;

/** Kartans ruta som i editorn: objektens utbredning, eller kartans område när kartan är tom. */
function boundsOf(loaded: LoadedProjectMap, area: Polygon | null): Box | undefined {
  let box: Box | undefined;
  const grow = (b: Box) => { box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : { ...b }; };
  for (const object of loaded.objects) { const b = objectBox(object); if (Number.isFinite(b.minX)) grow(b); }
  if (!box) for (const point of area?.[0] ?? []) grow({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y });
  return box;
}

/**
 * Sökrutan (WGS 84) och klipprutan (SWEREF 99 TM med marginal) för hela kartan eller en etapp. Utan etapp klipps laserdatan
 * till kartans eget område när projektet har ett (som i laserpanelen), annars till kartans ruta.
 */
export function runLaserArea(loaded: LoadedProjectMap, area: Polygon | null, stage: Polygon | null) {
  const georeference = loaded.base.georeference;
  if (!georeference) return { problem: "Kartan saknar georeferens, så laserdata kan inte sökas för den." };
  const bounds = boundsOf(loaded, area);
  if (!bounds) return { problem: "Kartan är tom och har inget område, så det går inte att säga var laserdata ska sökas." };
  const named = stage ? { name: "", polygon: stage } : undefined;
  const mapArea = !stage && area?.[0] && area[0].length >= 3 ? { name: "", polygon: area } : undefined;
  const clip = laserClip(bounds, georeference, GEO_CLIP_MARGIN_M, named ?? mapArea);
  // Sprintkartor får belagd yta ur lasern som förval (`paved`), som i laserpanelen.
  const sprint = isSprintNorm(mapNorm({ scale: loaded.base.scale, symbols: candidateSymbols(loaded.base).map(([, code, kind]) => ({ code, kind })) }));
  return { wgs84: areaBox(bounds, georeference, named).wgs84, clip: clip ?? null, sprint };
}

export interface LaserOutputRequest { area?: Box | undefined; layers?: readonly string[] | undefined; limit?: number | undefined; offset?: number | undefined;
  maxPoints?: number | undefined }

const round = (value: number) => Math.round(value * 100) / 100;
/** Högst `max` punkter jämnt ur linjen, alltid med den första och den sista. */
function thin<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  const out: T[] = [];
  for (let index = 0; index < max; index += 1) out.push(points[Math.round(index * (points.length - 1) / (max - 1))]!);
  return out;
}

/** Egenskaperna som går att visa: tal, korta texter och ja/nej (högst 20). */
function plainProperties(properties: Readonly<Record<string, unknown>> | undefined): Record<string, number | string | boolean> | undefined {
  const out: Record<string, number | string | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (count >= 20) break;
    if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean") out[key.slice(0, 40)] = value;
    else if (typeof value === "string") out[key.slice(0, 40)] = value.slice(0, 80);
    else continue;
    count += 1;
  }
  return count ? out : undefined;
}

/**
 * Filens koordinatsystem: det filen anger (5845, SWEREF 99 TM + RH 2000, är 3006 i planet), annars gissat ur talen, annars
 * SWEREF 99 TM för en laserkörning. GeoJSON utan angivet system läses som WGS 84 av tolken; har den stora tal gissas systemet.
 */
function crsOf(data: SourceData, georeference: MapGeoreference, laser: boolean): number | undefined {
  const declared = data.crs === 5845 ? SWEREF99TM : data.crs;
  const guessed = guessCrs(data, georeference);
  if (declared !== undefined && !(declared === WGS84_EPSG && guessed !== undefined && guessed !== WGS84_EPSG)) return declared;
  return guessed ?? (laser ? SWEREF99TM : undefined);
}

/**
 * En vektorfil ur en laserkörning (DXF eller GeoJSON) som objekt i kartans mm med y uppåt, inom rutan och lagren som begärts.
 * Svaret är sidindelat (`offset`, `limit`) och avgränsat i antal punkter; `truncated` säger att mer finns från `nextOffset`.
 */
export function runLaserOutput(loaded: LoadedProjectMap, file: { name: string; text: string; laser: boolean }, request: LaserOutputRequest) {
  const georeference = loaded.base.georeference;
  if (!georeference) return { problem: "Kartan saknar georeferens, så filen kan inte räknas om till kartans mm." };
  let data: SourceData;
  try { data = file.name.endsWith(".dxf") ? parseDxf(file.text) : parseGeoJson(file.text, { properties: true }); }
  catch (error) { return { problem: error instanceof VectorParseError ? error.message : "Filen gick inte att läsa." }; }
  const crs = crsOf(data, georeference, file.laser);
  if (crs === undefined || !(crs === WGS84_EPSG || isSupportedEpsg(crs))) return { problem: "Filens koordinatsystem är okänt eller stöds inte." };
  const at = ([x, y]: readonly [number, number]): [number, number] => { const point = sourcePointToMap(georeference, crs, x, y); return [point.x, point.y]; };
  const layers = request.layers && request.layers.length > 0 ? new Set(request.layers) : undefined;
  const limit = Math.min(MCP_LASER_OUTPUT_MAX_OBJECTS, Math.max(1, request.limit ?? 100)), offset = Math.max(0, request.offset ?? 0);
  const maxPoints = Math.min(MCP_LASER_OUTPUT_MAX_POINTS_PER_OBJECT, Math.max(2, request.maxPoints ?? 50));
  const counts = new Map<string, number>();
  const matches: { feature: SourceFeature; paths: [number, number][][] }[] = [];
  for (const feature of data.features) {
    if (layers && !layers.has(feature.layer)) continue;
    const g = feature.geometry;
    const paths = (g.kind === "point" ? [[g.at]] : g.kind === "line" ? [g.points] : g.rings).map(path => path.map(at));
    if (request.area) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const path of paths) for (const [x, y] of path) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      if (!(minX <= request.area.maxX && maxX >= request.area.minX && minY <= request.area.maxY && maxY >= request.area.minY)) continue;
    }
    counts.set(feature.layer, (counts.get(feature.layer) ?? 0) + 1);
    matches.push({ feature, paths });
  }
  const objects: Record<string, unknown>[] = [];
  let used = 0;
  for (const { feature, paths } of matches.slice(offset, offset + limit)) {
    const g = feature.geometry;
    const vertices = paths.reduce((sum, path) => sum + path.length, 0);
    // Flera ringar delar på objektets punkter i förhållande till sin längd (minst tre per ring).
    const kept = paths.map(path => thin(path, paths.length === 1 ? maxPoints : Math.max(3, Math.floor(maxPoints * path.length / vertices)))
      .map(([x, y]) => [round(x), round(y)]));
    const points = kept.reduce((sum, path) => sum + path.length, 0);
    if (objects.length > 0 && used + points > MCP_LASER_OUTPUT_MAX_POINTS) break;
    used += points;
    const properties = plainProperties(feature.properties);
    objects.push({ layer: feature.layer, kind: g.kind,
      ...(g.kind === "point" ? { at: kept[0]![0] } : g.kind === "line" ? { points: kept[0], closed: g.closed } : { rings: kept }),
      ...(g.kind === "point" ? {} : { vertices }), ...(feature.elevation !== undefined ? { elevation: feature.elevation } : {}),
      ...(properties ? { properties } : {}) });
  }
  const next = offset + objects.length;
  return {
    file: file.name, crs: `EPSG:${crs}`, units: "Kartans mm med y uppåt (som list_objects).", total: matches.length, offset, returned: objects.length,
    truncated: next < matches.length, ...(next < matches.length ? { nextOffset: next } : {}), skipped: data.skipped,
    layers: [...counts].map(([layer, count]) => ({ layer, count })).sort((a, b) => b.count - a.count).slice(0, 100), objects
  };
}
