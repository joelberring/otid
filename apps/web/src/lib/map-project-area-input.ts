/**
 * ADR-0219 (K1, nya kartor): kartans område till API:t (`mapProjectAreaInputSchema`). Ur en GeoJSON-fil (största polygonen,
 * med hål) eller en mittpunkt med bredd och höjd. Koordinater större än 180 tolkas som SWEREF 99 TM (meter), annars WGS 84.
 */
export interface AreaInput { readonly crs: "WGS84" | "SWEREF99TM"; readonly rings: [number, number][][] }

type Ring = [number, number][];

function polygonsOf(value: unknown): Ring[][] {
  if (!value || typeof value !== "object") return [];
  const node = value as { type?: unknown; features?: unknown; geometry?: unknown; geometries?: unknown; coordinates?: unknown };
  switch (node.type) {
    case "FeatureCollection": return Array.isArray(node.features) ? node.features.flatMap(polygonsOf) : [];
    case "Feature": return polygonsOf(node.geometry);
    case "GeometryCollection": return Array.isArray(node.geometries) ? node.geometries.flatMap(polygonsOf) : [];
    case "Polygon": return [rings(node.coordinates)].filter(polygon => polygon.length > 0);
    case "MultiPolygon": return Array.isArray(node.coordinates) ? node.coordinates.map(rings).filter(polygon => polygon.length > 0) : [];
    default: return [];
  }
}

function rings(value: unknown): Ring[] {
  if (!Array.isArray(value)) return [];
  const out: Ring[] = [];
  for (const ring of value) {
    if (!Array.isArray(ring)) return [];
    const points: Ring = [];
    for (const point of ring) {
      if (!Array.isArray(point) || typeof point[0] !== "number" || typeof point[1] !== "number" || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return [];
      points.push([point[0], point[1]]);
    }
    // GeoJSON upprepar första punkten sist; API:t vill ha den en gång.
    const [first] = points, last = points[points.length - 1];
    if (first && last && points.length > 1 && first[0] === last[0] && first[1] === last[1]) points.pop();
    if (points.length < 3) return [];
    out.push(points);
  }
  return out;
}

function ringArea(ring: Ring): number {
  let sum = 0;
  ring.forEach(([x1, y1], index) => {
    const [x2, y2] = ring[(index + 1) % ring.length]!;
    sum += x1 * y2 - x2 * y1;
  });
  return Math.abs(sum) / 2;
}

/** Den största polygonen i en GeoJSON-text, eller undefined. */
export function areaFromGeoJson(text: string): AreaInput | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return undefined; }
  const polygons = polygonsOf(parsed);
  if (polygons.length === 0) return undefined;
  const largest = polygons.reduce((best, polygon) => ringArea(polygon[0]!) > ringArea(best[0]!) ? polygon : best);
  const projected = largest.flat().some(([x, y]) => Math.abs(x) > 180 || Math.abs(y) > 180);
  return { crs: projected ? "SWEREF99TM" : "WGS84", rings: largest.map(ring => ring.slice(0, 2000)).slice(0, 20) };
}

/**
 * "59.3075, 17.79" (latitud, longitud) → punkten, eller undefined. Avgränsare: komma med mellanslag, semikolon eller
 * mellanslag ("59,3075 17,79" med decimalkomma går också), eller ett ensamt komma mellan tal med decimalpunkt.
 */
export function parseLatLon(text: string): { latitude: number; longitude: number } | undefined {
  const trimmed = text.trim();
  let parts = trimmed.split(/\s*;\s*|,\s+|\s+/).filter(Boolean);
  if (parts.length === 1 && trimmed.includes(".")) parts = trimmed.split(",");
  if (parts.length !== 2) return undefined;
  const [latitude, longitude] = parts.map(part => /^-?\d+(?:[.,]\d+)?$/.test(part) ? Number(part.replace(",", ".")) : Number.NaN) as [number, number];
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude } : undefined;
}

/** En rektangel `width` × `height` meter runt mittpunkten, i WGS 84 (tillräckligt noga för några km). */
export function areaFromCenter(center: { latitude: number; longitude: number }, width: number, height: number): AreaInput {
  const dLat = height / 2 / 111_320;
  const dLon = width / 2 / (111_320 * Math.cos(center.latitude * Math.PI / 180));
  const { latitude: lat, longitude: lon } = center;
  return { crs: "WGS84", rings: [[[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat]]] };
}
