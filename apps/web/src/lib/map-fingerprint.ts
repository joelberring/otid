import type { MapFingerprintPayload } from "@o-tid/contracts";
import { symbolSetHash, type MapExtent, type MapFingerprint } from "@o-tid/domain";
import { mapPointToProjected, type ParsedMap } from "@o-tid/map-file";

/**
 * ADR-0210 beslut 1: kartversionens fingeravtryck, räknat i kartfilens Worker när versionen kontrolleras (ADR-0196), så att
 * servern kan jämföra kartorna utan att läsa om stora filer. Ytan i kartans mm, ytan i terrängen (hörnen räknade genom
 * georeferensen när koordinatsystemet är känt), skalan, symbolerna som används och antalet objekt.
 */
export const FINGERPRINT_MAX_SYMBOLS = 600;

function projectedExtent(map: ParsedMap): MapFingerprint["projected"] {
  const georeference = map.georeference;
  const bounds = map.bounds;
  if (!georeference || georeference.crs.kind !== "EPSG" || !bounds) return null;
  const corners = [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.minX, y: bounds.maxY }, { x: bounds.maxX, y: bounds.maxY }]
    .map(point => mapPointToProjected(georeference, point));
  const xs = corners.map(point => point.easting);
  const ys = corners.map(point => point.northing);
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  const extent: MapExtent = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  if (extent.maxX <= extent.minX || extent.maxY <= extent.minY) return null;
  return { epsg: georeference.crs.code, extent: roundExtent(extent, 1) };
}

const roundExtent = (extent: MapExtent, decimals: number): MapExtent => {
  const factor = 10 ** decimals;
  const round = (value: number) => Math.round(value * factor) / factor;
  return { minX: round(extent.minX), minY: round(extent.minY), maxX: round(extent.maxX), maxY: round(extent.maxY) };
};

/** Fingeravtrycket, eller null för en karta utan objekt eller skala. */
export function mapFingerprint(map: ParsedMap): MapFingerprintPayload | null {
  if (!map.bounds || !(map.scale >= 100 && map.scale <= 1_000_000)) return null;
  const codes = new Set<string>();
  for (const object of map.objects) {
    const code = map.symbols.get(object.symbol)?.code.text.trim() || object.symbol;
    codes.add(code.slice(0, 24));
  }
  const symbols = [...codes].sort().slice(0, FINGERPRINT_MAX_SYMBOLS);
  return { scale: Math.round(map.scale), bounds: roundExtent(map.bounds, 2), projected: projectedExtent(map), symbols, symbolHash: symbolSetHash(symbols),
    objectCount: map.objects.length };
}
