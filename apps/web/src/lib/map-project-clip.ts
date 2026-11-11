import { geodeticToGrid, mapPointToWgs84, transverseMercatorFor, type MapGeoreference } from "@o-tid/map-file";
import type { GeoClip } from "@o-tid/contracts";
import { areaBox, type BoxArea } from "./map-project-area-box";
import type { Bounds } from "./course-setting-viewport";

/** Lantmäteriets laserdata ligger i SWEREF 99 TM. */
const LASER_EPSG = 3006;

/**
 * Grundkartan G1 (ägaren 2026-11-10): rutan som laserdatan klipps till innan Karttapullautin körs. Kartans område (eller
 * etappen) räknas om till SWEREF 99 TM, och rutan runt dess fyra hörn utökas med marginalen (hela meter). Kartan är oftast
 * vriden mot magnetisk nord, så rutan blir något större än området; marginalen gör att kanten på laserdatan (där
 * Karttapullautin ritar falska branter) hamnar utanför kartan.
 */
export function laserClip(bounds: Bounds, georeference: MapGeoreference, marginM: number, area?: BoxArea): GeoClip | undefined {
  const projection = transverseMercatorFor(LASER_EPSG);
  if (!projection) return undefined;
  const { box } = areaBox(bounds, georeference, area);
  const corners = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }].map(point => {
    const position = mapPointToWgs84(georeference, point);
    return geodeticToGrid(projection, position.latitude, position.longitude);
  });
  if (corners.some(corner => !Number.isFinite(corner.easting) || !Number.isFinite(corner.northing))) return undefined;
  return {
    minX: Math.floor(Math.min(...corners.map(corner => corner.easting)) - marginM), minY: Math.floor(Math.min(...corners.map(corner => corner.northing)) - marginM),
    maxX: Math.ceil(Math.max(...corners.map(corner => corner.easting)) + marginM), maxY: Math.ceil(Math.max(...corners.map(corner => corner.northing)) + marginM)
  };
}

/** G6, provrutan (ägaren 2026-11-11): en ruta på `side` m kring `center` (SWEREF 99 TM), inom jobbets klippruta. */
export const SAMPLE_SIDE_M = 250;
export function sampleClip(center: readonly [number, number], within: GeoClip | null, side = SAMPLE_SIDE_M): GeoClip | undefined {
  const half = side / 2, [cx, cy] = [Math.round(center[0]), Math.round(center[1])];
  const box = { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
  const clipped = within ? { minX: Math.max(box.minX, within.minX), minY: Math.max(box.minY, within.minY), maxX: Math.min(box.maxX, within.maxX),
    maxY: Math.min(box.maxY, within.maxY) } : box;
  return clipped.maxX - clipped.minX >= 50 && clipped.maxY - clipped.minY >= 50 ? clipped : undefined;
}
export const clipCenter = (clip: GeoClip): [number, number] => [(clip.minX + clip.maxX) / 2, (clip.minY + clip.maxY) / 2];
