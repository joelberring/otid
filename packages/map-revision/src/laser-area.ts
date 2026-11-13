import { geodeticToGrid, mapPointToWgs84, transverseMercatorFor, type MapGeoreference, type Point } from "@o-tid/map-file";

/**
 * Rutorna som en laserkörning gäller: sökrutan hos Lantmäteriet (WGS 84) och klipprutan för laserdatan (SWEREF 99 TM).
 * Samma uträkning i webbläsaren (laserpanelen) och på servern (AI-kopplingens start_laser_job), så att de ger samma jobb.
 */
export interface MapBox { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
/** Ett delområde (etapp): namnet och polygonen i kartans mm. */
export interface BoxArea { readonly name: string; readonly polygon: readonly (readonly Point[])[] }

/** Rutan kring kartan eller en etapp (kartans mm) och samma ruta i WGS 84. */
export function areaBox(bounds: MapBox, georeference: MapGeoreference, area?: BoxArea): { box: MapBox; wgs84: { south: number; west: number; north: number; east: number } } {
  const outline = area?.polygon[0];
  const box: MapBox = outline && outline.length >= 3 ? { minX: Math.min(...outline.map(p => p.x)), maxX: Math.max(...outline.map(p => p.x)),
    minY: Math.min(...outline.map(p => p.y)), maxY: Math.max(...outline.map(p => p.y)) } : bounds;
  const corners = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }]
    .map(point => mapPointToWgs84(georeference, point));
  return { box, wgs84: { south: Math.min(...corners.map(c => c.latitude)), north: Math.max(...corners.map(c => c.latitude)),
    west: Math.min(...corners.map(c => c.longitude)), east: Math.max(...corners.map(c => c.longitude)) } };
}

/** Lantmäteriets laserdata ligger i SWEREF 99 TM. */
const LASER_EPSG = 3006;

/**
 * Grundkartan G1 (ägaren 2026-11-10): rutan som laserdatan klipps till innan Karttapullautin körs. Kartans område (eller
 * etappen) räknas om till SWEREF 99 TM, och rutan runt dess fyra hörn utökas med marginalen (hela meter). Kartan är oftast
 * vriden mot magnetisk nord, så rutan blir något större än området; marginalen gör att kanten på laserdatan (där
 * Karttapullautin ritar falska branter) hamnar utanför kartan.
 */
export function laserClip(bounds: MapBox, georeference: MapGeoreference, marginM: number, area?: BoxArea): MapBox | undefined {
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
