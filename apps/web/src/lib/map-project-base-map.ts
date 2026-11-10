import type { GeoClip } from "@o-tid/contracts";
import { geodeticToGrid, gridToGeodetic, transverseMercatorFor } from "@o-tid/map-file";
import type { SourceData, SourceFeature } from "@o-tid/map-revision";

/**
 * Grundkartan G2 och G8 (ägaren 2026-11-10: «ungefär som en halvfärdig karta», utan grundkartefil: lasern, Lantmäteriets
 * marktäcke, OpenStreetMap). Här avgörs vilka av jobbets resultatfiler som tillsammans är grundkartan och hur de slås ihop
 * med OpenStreetMap, så att samma sak inte kommer två gånger:
 *
 * - branterna som linjer går före Karttapullautins korta streck,
 * - med Lantmäteriets marktäcke tas dess sankmark i stället för den uträknade fuktigheten, och laserns «öppen mark» (allt
 *   utan växtlighet, också hällmark) byter namn till `oppen_mark_laser` och får inget förslag,
 * - ur OpenStreetMap tas vägar, stigar, hus, ledningar, staket och liknande; vatten, sankmark, branter och markslag finns
 *   redan ur lasern och marktäcket, och husen tas inte med när Lantmäteriets byggnader finns.
 */
const BASE_MAP = ["kurvor.dxf", "formlinjer.dxf", "brantlinjer.dxf", "knollar.dxf", "vatten.geojson", "marktacke.geojson", "byggnader.geojson", "fukt.dxf", "vegetation.dxf"];

export function baseMapOutputs(names: readonly string[]): string[] {
  const has = new Set(names);
  return [...BASE_MAP.filter(name => has.has(name) && !(name === "fukt.dxf" && has.has("marktacke.geojson"))),
    ...(has.has("brantlinjer.dxf") ? [] : ["branter.dxf", "stup.dxf"].filter(name => has.has(name)))];
}

const SWEREF99TM = 3006;
/** OpenStreetMaps lager som grundkartan redan har ur lasern och marktäcket. */
const OSM_SKIPPED = /^OSM (vatten|vattendrag|sankmark|brant|natur|markanvändning|fritid)/;
const OSM_BUILDING = /^OSM (byggnad|skärmtak)/;

/** Rutan (SWEREF 99 TM) som latitud och longitud, för hämtningen från OpenStreetMap. */
export function clipWgs84(clip: GeoClip): { south: number; west: number; north: number; east: number } | undefined {
  const projection = transverseMercatorFor(SWEREF99TM);
  if (!projection) return undefined;
  const corners = [[clip.minX, clip.minY], [clip.maxX, clip.minY], [clip.maxX, clip.maxY], [clip.minX, clip.maxY]].map(([x, y]) => gridToGeodetic(projection, x!, y!));
  return { south: Math.min(...corners.map(c => c.latitude)), north: Math.max(...corners.map(c => c.latitude)),
    west: Math.min(...corners.map(c => c.longitude)), east: Math.max(...corners.map(c => c.longitude)) };
}

/** OpenStreetMaps objekt (longitud, latitud) i SWEREF 99 TM, utan lagren som grundkartan redan har. */
export function osmForBaseMap(osm: SourceData, hasBuildings: boolean): SourceFeature[] {
  const projection = transverseMercatorFor(SWEREF99TM);
  if (!projection) return [];
  const at = ([lon, lat]: readonly [number, number]): [number, number] => { const point = geodeticToGrid(projection, lat, lon); return [point.easting, point.northing]; };
  return osm.features.filter(feature => !OSM_SKIPPED.test(feature.layer) && !(hasBuildings && OSM_BUILDING.test(feature.layer))).map(({ layer, geometry }) => ({ layer,
    geometry: geometry.kind === "point" ? { kind: "point" as const, at: at(geometry.at) }
      : geometry.kind === "line" ? { kind: "line" as const, points: geometry.points.map(at), closed: geometry.closed } : { kind: "area" as const, rings: geometry.rings.map(ring => ring.map(at)) } }));
}

/** Jobbets filer (i `baseMapOutputs` ordning) och OpenStreetMap som en inläsning i SWEREF 99 TM. */
export function mergeBaseMap(parts: readonly { readonly name: string; readonly data: SourceData }[], osm?: SourceData): SourceData {
  const names = new Set(parts.map(part => part.name)), landCover = names.has("marktacke.geojson");
  const features = parts.flatMap(part => part.name === "vegetation.dxf" && landCover
    ? part.data.features.map(feature => feature.layer === "oppen_mark" ? { ...feature, layer: "oppen_mark_laser" } : feature) : part.data.features);
  return { features: [...features, ...(osm ? osmForBaseMap(osm, names.has("byggnader.geojson")) : [])], skipped: parts.reduce((sum, part) => sum + part.data.skipped, 0) + (osm?.skipped ?? 0),
    crs: SWEREF99TM };
}
