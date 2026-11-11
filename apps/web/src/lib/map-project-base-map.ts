import type { GeoClip } from "@o-tid/contracts";
import { geodeticToGrid, gridToGeodetic, transverseMercatorFor } from "@o-tid/map-file";
import { joinSeams, type SourceData, type SourceFeature } from "@o-tid/map-revision";
import { smallRingsToPoints } from "./map-project-small-rings";
import { yardsOf } from "./map-project-yards";

/**
 * Grundkartan G2 och G8 (ägaren 2026-11-10: «ungefär som en halvfärdig karta», utan grundkartefil: lasern, Lantmäteriets
 * marktäcke, OpenStreetMap). Här avgörs vilka av jobbets resultatfiler som tillsammans är grundkartan och hur de slås ihop
 * med OpenStreetMap, så att samma sak inte kommer två gånger:
 *
 * - branterna som linjer går före Karttapullautins korta streck,
 * - med Lantmäteriets marktäcke byter laserns «öppen mark» (allt utan växtlighet, också hällmark) namn till
 *   `oppen_mark_laser` och får inget förslag; marktäckets sankmark och den uträknade fuktigheten kommer båda med,
 * - en opasserbar brant som är för kort för två taggar blir en brant (ägaren 2026-11-11: «det ska alltid vara minst två
 *   taggar på taggbranter»),
 * - kurvorna och formlinjerna fogas över laserrutornas skarvar (`joinSeams`),
 * - slutna kurvor under ISOM:s minsta mått blir små kullar eller gropar (`smallRingsToPoints`),
 * - tomterna: OpenStreetMaps bostadsområden (`tomtmark_osm`), marktäckets låga bebyggelse (`tomtmark_marktacke`) och
 *   ringar kring hus utanför dem (`tomtmark_hus`, `yardsOf`), i var sitt lager så att kandidatraden kan välja,
 * - ur OpenStreetMap tas vägar, stigar, hus, ledningar, staket och liknande; vatten, sankmark, branter och markslag finns
 *   redan ur lasern och marktäcket, och husen tas inte med när Lantmäteriets byggnader finns.
 */
const BASE_MAP = ["kurvor.dxf", "formlinjer.dxf", "brantlinjer.dxf", "knollar.dxf", "vatten.geojson", "marktacke.geojson", "byggnader.geojson", "fukt.dxf", "vegetation.dxf"];

export function baseMapOutputs(names: readonly string[]): string[] {
  const has = new Set(names);
  // Ägaren 2026-11-11 («inga kärr kom med»): den uträknade fuktigheten följer med också när marktäcket finns; marktäckets
  // sankmark är grov och missar de små kärren i dalbottnarna.
  return [...BASE_MAP.filter(name => has.has(name)),
    ...(has.has("brantlinjer.dxf") ? [] : ["branter.dxf", "stup.dxf"].filter(name => has.has(name)))];
}

const SWEREF99TM = 3006;
/** OpenStreetMaps lager som grundkartan redan har ur lasern och marktäcket. */
const OSM_SKIPPED = /^OSM (vatten|vattendrag|sankmark|brant|natur|markanvändning|fritid)/;
/** Ägaren 2026-11-11: OpenStreetMaps grå bostadsområden är en första tomtmark (flerbostadshusens rättas efteråt). */
const OSM_RESIDENTIAL = "OSM markanvändning (residential)";
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
  return osm.features.filter(feature => feature.layer === OSM_RESIDENTIAL || (!OSM_SKIPPED.test(feature.layer) && !(hasBuildings && OSM_BUILDING.test(feature.layer))))
    .map(({ layer, geometry }) => ({ layer: layer === OSM_RESIDENTIAL ? "tomtmark_osm" : layer,
    geometry: geometry.kind === "point" ? { kind: "point" as const, at: at(geometry.at) }
      : geometry.kind === "line" ? { kind: "line" as const, points: geometry.points.map(at), closed: geometry.closed } : { kind: "area" as const, rings: geometry.rings.map(ring => ring.map(at)) } }));
}

/**
 * Kortaste opasserbara brant (meter i terrängen) som får två taggar: med taggarna 1 mm isär och en halv i varje ände
 * (normens 201 och `spacedDistances` i ritningen) behövs 1,5 mm på kartan.
 */
export const twoTagMeters = (scale: number) => 1.5 * scale / 1000;
const lineLength = (points: readonly (readonly [number, number])[]) => points.reduce((sum, point, i) =>
  i === 0 ? 0 : sum + Math.hypot(point[0] - points[i - 1]![0], point[1] - points[i - 1]![1]), 0);

/** Jobbets filer (i `baseMapOutputs` ordning) och OpenStreetMap som en inläsning i SWEREF 99 TM; `scale` är kartans skala. */
export function mergeBaseMap(parts: readonly { readonly name: string; readonly data: SourceData }[], osm?: SourceData, scale?: number): SourceData {
  const names = new Set(parts.map(part => part.name)), landCover = names.has("marktacke.geojson");
  const shortest = scale ? twoTagMeters(scale) : 0;
  // G3: kurvorna och formlinjerna fogas över laserrutornas skarvar.
  const features = parts.flatMap(part => (/^(kurvor|formlinjer)\.dxf$/.test(part.name) ? joinSeams(part.data.features) : part.data.features).map(feature => {
    if (part.name === "vegetation.dxf" && landCover && feature.layer === "oppen_mark") return { ...feature, layer: "oppen_mark_laser" };
    if (feature.layer === "bebyggelse_lag") return { ...feature, layer: "tomtmark_marktacke" };
    if (feature.layer === "brant_opasserbar" && feature.geometry.kind === "line" && lineLength(feature.geometry.points) < shortest) return { ...feature, layer: "brant_passerbar" };
    return feature;
  }));
  const all = [...(scale ? smallRingsToPoints(features, scale) : features), ...(osm ? osmForBaseMap(osm, names.has("byggnader.geojson")) : [])];
  return { features: [...all, ...yardsOf(all)], skipped: parts.reduce((sum, part) => sum + part.data.skipped, 0) + (osm?.skipped ?? 0),
    crs: SWEREF99TM };
}
