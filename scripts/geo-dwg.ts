/**
 * ADR-0219 K6b: DWG-ritningar i geo-arbetaren. LibreDWG:s `dwgread -O JSON` läser allt i ritningen (omvandlingen till DXF och
 * till GeoJSON tappar skraffyrerna, där baskartans ytor ligger, se planen för baskartor), och här blir modellrymdens objekt
 * GeoJSON med lagrets namn: linjer, polylinjer (med bågar), cirklar och bågar, skraffyrernas kanter som ytor, fyllda
 * fyrhörningar, punkter och blockens insättningspunkter (med blockets namn). Texter hoppas över.
 *
 * Utdata från dwgread kan bli stort, så objekten läses ett i taget ur strömmen (bara ett objekt i minnet åt gången).
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`).
 */

type Xy = [number, number];
type Geometry = { type: "Point"; coordinates: Xy } | { type: "LineString"; coordinates: Xy[] } | { type: "Polygon"; coordinates: Xy[][] };
export interface DwgFeature { readonly type: "Feature"; readonly properties: { readonly layer: string; readonly block?: string }; readonly geometry: Geometry }
type Json = Record<string, unknown>;

/** Handtagets värde: entitetens eget [kod, storlek, värde] eller en referens [kod, storlek, värde, absolut]. */
function handle(value: unknown): number | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const last: unknown = (value as unknown[])[value.length - 1];
  return typeof last === "number" ? last : undefined;
}
const xy = (value: unknown): Xy | undefined => Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number"
  && Number.isFinite(value[0]) && Number.isFinite(value[1]) ? [value[0], value[1]] : undefined;
const number = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Punkterna längs en båge från `start` till `end` (radianer, moturs), högst 10° mellan punkterna. */
function arcPoints(center: Xy, radius: number, start: number, end: number): Xy[] {
  let sweep = end - start;
  while (sweep <= 0) sweep += Math.PI * 2;
  const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 18)));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = start + sweep * i / steps;
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)] as Xy;
  });
}

/** Sträckan från `a` till `b` med en båge (`bulge` = tan(vinkeln/4), positiv moturs); utan `a`. */
export function bulgeSegment(a: Xy, b: Xy, bulge: number): Xy[] {
  if (!bulge || Math.abs(bulge) < 1e-9) return [b];
  const angle = 4 * Math.atan(bulge), chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (chord === 0) return [b];
  const radius = chord / (2 * Math.sin(Math.abs(angle) / 2));
  const middle: Xy = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const toCenter = radius * Math.cos(Math.abs(angle) / 2);
  const sign = bulge > 0 ? 1 : -1;
  const normal: Xy = [-(b[1] - a[1]) / chord * sign, (b[0] - a[0]) / chord * sign];
  const center: Xy = [middle[0] + normal[0] * toCenter, middle[1] + normal[1] * toCenter];
  const from = Math.atan2(a[1] - center[1], a[0] - center[0]);
  const steps = Math.max(2, Math.ceil(Math.abs(angle) / (Math.PI / 18)));
  return Array.from({ length: steps }, (_, i) => {
    if (i === steps - 1) return b;
    const t = from + angle * (i + 1) / steps;
    return [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)] as Xy;
  });
}

/** Punkterna med bågarna; sluten = tillbaka till den första. */
function withBulges(points: readonly { at: Xy; bulge: number }[], closed: boolean): Xy[] {
  if (points.length === 0) return [];
  const out: Xy[] = [points[0]!.at];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) out.push(...bulgeSegment(points[i]!.at, points[(i + 1) % points.length]!.at, points[i]!.bulge));
  return out;
}

const line = (points: Xy[]): Geometry | undefined => points.length >= 2 ? { type: "LineString", coordinates: points } : undefined;
const ring = (points: Xy[]): Xy[] | undefined => {
  if (points.length < 3) return undefined;
  const first = points[0]!, last = points[points.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
};

/** En skraffyrs kant: polylinje (med bågar) eller kanter (raka och bågar). */
function hatchRing(path: Json): Xy[] | undefined {
  if (Array.isArray(path.polyline_paths)) {
    const points = (path.polyline_paths as Json[]).flatMap(point => { const at = xy(point.point); return at ? [{ at, bulge: number(point.bulge) }] : []; });
    return ring(withBulges(points, true));
  }
  if (!Array.isArray(path.segs)) return undefined;
  const out: Xy[] = [];
  for (const segment of path.segs as Json[]) {
    if (segment.curve_type === 1) {
      const a = xy(segment.first_endpoint), b = xy(segment.second_endpoint);
      if (a && b) { if (out.length === 0) out.push(a); out.push(b); }
    } else if (segment.curve_type === 2) {
      const center = xy(segment.center), radius = number(segment.radius);
      if (!center || !(radius > 0)) continue;
      const start = number(segment.start_angle), end = number(segment.end_angle);
      // Medurs: vinklarna är speglade i x-axeln (som i DXF), bågen går från −start till −end medurs.
      const points = segment.is_ccw === 0 ? arcPoints(center, radius, -end, -start).reverse() : arcPoints(center, radius, start, end);
      out.push(...(out.length === 0 ? points : points.slice(1)));
    }
  }
  return ring(out);
}

/**
 * Objekten ur dwgreads JSON, ett i taget: i listan `OBJECTS` räknas klamrarna (utanför strängar) så att varje objekt kan
 * tolkas för sig.
 */
export async function* dwgObjects(chunks: AsyncIterable<string>): AsyncGenerator<Json> {
  let state: "before" | "inside" = "before", text = "", depth = 0, inString = false, escaped = false, start = -1, scanned = 0;
  for await (const chunk of chunks) {
    text += chunk;
    if (state === "before") {
      const at = text.search(/"OBJECTS"\s*:\s*\[/);
      if (at < 0) { text = text.slice(-64); continue; }
      text = text.slice(text.indexOf("[", at) + 1);
      state = "inside"; scanned = 0;
    }
    for (let i = scanned; i < text.length; i += 1) {
      const c = text[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === "\"") inString = false;
        continue;
      }
      if (c === "\"") { inString = true; continue; }
      if (c === "{") { if (depth === 0) start = i; depth += 1; }
      else if (c === "}") {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          try { yield JSON.parse(text.slice(start, i + 1)) as Json; } catch { /* ett trasigt objekt hoppas över */ }
          start = -1;
        }
      } else if (c === "]" && depth === 0) return;
    }
    // Det som redan lästs klart släpps; ett påbörjat objekt behålls.
    if (start >= 0) { text = text.slice(start); scanned = text.length; start = 0; }
    else { text = ""; scanned = 0; }
  }
}

/** Ritningens modellrymd som GeoJSON-objekt med lagrets namn (och blockets för insättningar). */
export async function dwgFeatures(objects: AsyncIterable<Json>): Promise<{ features: DwgFeature[]; skipped: number }> {
  const layers = new Map<number, string>(), blocks = new Map<number, string>();
  const pending: { layer: number | undefined; build: () => Geometry | undefined; block?: number | undefined; owner?: number | undefined }[] = [];
  const vertices = new Map<number, { at: Xy; bulge: number }[]>();
  let skipped = 0;
  for await (const object of objects) {
    const own = handle(object.handle);
    if (object.object === "LAYER" && own !== undefined && typeof object.name === "string") { layers.set(own, object.name); continue; }
    if (object.object === "BLOCK_HEADER" && own !== undefined && typeof object.name === "string") { blocks.set(own, object.name); continue; }
    const kind = object.entity;
    if (typeof kind !== "string") continue;
    if (kind === "VERTEX_2D" || kind === "VERTEX_3D") {
      const owner = handle(object.ownerhandle), at = xy(object.point);
      if (owner !== undefined && at) vertices.set(owner, [...(vertices.get(owner) ?? []), { at, bulge: number(object.bulge) }]);
      continue;
    }
    // Bara modellrymden (inte blockens innehåll eller pappersrymden): `entmode` 2, eller 0 med ägaren *Model_Space (prövas sist).
    if (object.entmode !== 2 && object.entmode !== 0) continue;
    const owner = object.entmode === 0 ? handle(object.ownerhandle) ?? -1 : undefined;
    const start = pending.length;
    const layer = handle(object.layer);
    switch (kind) {
      case "LINE": { const a = xy(object.start), b = xy(object.end); pending.push({ layer, build: () => a && b ? line([a, b]) : undefined }); break; }
      case "LWPOLYLINE": {
        const points = Array.isArray(object.points) ? (object.points as unknown[]).flatMap(point => { const at = xy(point); return at ? [at] : []; }) : [];
        const bulges = Array.isArray(object.bulges) ? object.bulges as number[] : [];
        const closed = (number(object.flag) & 512) !== 0 || (number(object.flag) & 1) !== 0;
        pending.push({ layer, build: () => line(withBulges(points.map((at, i) => ({ at, bulge: number(bulges[i]) })), closed)) });
        break;
      }
      case "POLYLINE_2D": case "POLYLINE_3D": {
        const key = own, closed = (number(object.flag) & 1) !== 0;
        pending.push({ layer, build: () => key === undefined ? undefined : line(withBulges(vertices.get(key) ?? [], closed)) });
        break;
      }
      case "ARC": {
        const center = xy(object.center), radius = number(object.radius);
        pending.push({ layer, build: () => center && radius > 0 ? line(arcPoints(center, radius, number(object.start_angle), number(object.end_angle))) : undefined });
        break;
      }
      case "CIRCLE": {
        const center = xy(object.center), radius = number(object.radius);
        pending.push({ layer, build: () => { const points = center && radius > 0 ? ring(arcPoints(center, radius, 0, Math.PI * 2)) : undefined;
          return points ? { type: "Polygon", coordinates: [points] } : undefined; } });
        break;
      }
      case "HATCH": {
        const rings = Array.isArray(object.paths) ? (object.paths as Json[]).flatMap(path => { const r = hatchRing(path); return r ? [r] : []; }) : [];
        pending.push({ layer, build: () => rings.length ? { type: "Polygon", coordinates: rings } : undefined });
        break;
      }
      case "SOLID": {
        const corners = [object.corner1, object.corner2, object.corner4, object.corner3].flatMap(corner => { const at = xy(corner); return at ? [at] : []; });
        pending.push({ layer, build: () => { const points = ring(corners.filter((point, i) => i === 0 || point[0] !== corners[i - 1]![0] || point[1] !== corners[i - 1]![1]));
          return points && points.length >= 4 ? { type: "Polygon", coordinates: [points] } : undefined; } });
        break;
      }
      case "SPLINE": {
        const points = Array.isArray(object.fit_pts) ? (object.fit_pts as unknown[]).flatMap(point => { const at = xy(point); return at ? [at] : []; }) : [];
        pending.push({ layer, build: () => line(points) });
        break;
      }
      case "POINT": {
        const x = number(object.x, Number.NaN), y = number(object.y, Number.NaN);
        pending.push({ layer, build: () => Number.isFinite(x) && Number.isFinite(y) ? { type: "Point", coordinates: [x, y] } : undefined });
        break;
      }
      case "INSERT": {
        const at = xy(object.ins_pt);
        pending.push({ layer, block: handle(object.block_header), build: () => at ? { type: "Point", coordinates: at } : undefined });
        break;
      }
      default: skipped += 1;
    }
    for (let i = start; i < pending.length; i += 1) pending[i]!.owner = owner;
  }
  const modelSpace = new Set([...blocks].filter(([, name]) => name.toUpperCase() === "*MODEL_SPACE").map(([key]) => key));
  const features: DwgFeature[] = [];
  for (const entry of pending) {
    if (entry.owner !== undefined && !modelSpace.has(entry.owner)) { skipped += 1; continue; }
    const geometry = entry.build();
    if (!geometry) { skipped += 1; continue; }
    const block = entry.block !== undefined ? blocks.get(entry.block) : undefined;
    features.push({ type: "Feature", properties: { layer: (entry.layer !== undefined ? layers.get(entry.layer) : undefined) ?? "0", ...(block ? { block } : {}) }, geometry });
  }
  return { features, skipped };
}
