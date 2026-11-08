import { mapPointToWgs84, type MapGeoreference, type Point } from "@o-tid/map-file";
import type { Bounds } from "./course-setting-viewport";

/** Ett delområde (etapp): namnet och polygonen i kartans mm. */
export interface BoxArea { readonly name: string; readonly polygon: readonly (readonly Point[])[] }

/** Rutan kring kartan eller en etapp (kartans mm) och samma ruta i WGS 84. */
export function areaBox(bounds: Bounds, georeference: MapGeoreference, area?: BoxArea): { box: Bounds; wgs84: { south: number; west: number; north: number; east: number } } {
  const outline = area?.polygon[0];
  const box: Bounds = outline && outline.length >= 3 ? { minX: Math.min(...outline.map(p => p.x)), maxX: Math.max(...outline.map(p => p.x)),
    minY: Math.min(...outline.map(p => p.y)), maxY: Math.max(...outline.map(p => p.y)) } : bounds;
  const corners = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }]
    .map(point => mapPointToWgs84(georeference, point));
  return { box, wgs84: { south: Math.min(...corners.map(c => c.latitude)), north: Math.max(...corners.map(c => c.latitude)),
    west: Math.min(...corners.map(c => c.longitude)), east: Math.max(...corners.map(c => c.longitude)) } };
}
