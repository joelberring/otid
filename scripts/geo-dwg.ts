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
const xy = (value: unknown): Xy | undefined => {
  if (Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number" && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    return [value[0], value[1]];
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.x === "number" && typeof obj.y === "number" && Number.isFinite(obj.x) && Number.isFinite(obj.y)) return [obj.x, obj.y];
    if (obj.point !== undefined) return xy(obj.point);
  }
  return undefined;
};
const number = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

const ARC_SAGITTA = 0.02;
const MAX_ARC_STEP = Math.PI / 4;
const MAX_ARC_STEPS = 512;
const MAX_SPLINE_POINTS = 512;

/** Sagitta-adaptivt antal steg för en båge med svepet `sweep` och radien `radius`. */
function arcSteps(sweep: number, radius: number, sagitta = ARC_SAGITTA): number {
  const absSweep = Math.abs(sweep);
  if (absSweep === 0) return 1;
  let step = MAX_ARC_STEP;
  if (radius > 0 && sagitta > 0) {
    const cosHalf = 1 - sagitta / radius;
    if (cosHalf > Math.cos(MAX_ARC_STEP / 2)) step = 2 * Math.acos(Math.min(1, cosHalf));
  }
  return Math.max(1, Math.min(MAX_ARC_STEPS, Math.ceil(absSweep / step)));
}

/** Punkterna längs en båge från `start` till `end` (radianer, moturs), sagitta-adaptivt delad. */
function arcPoints(center: Xy, radius: number, start: number, end: number): Xy[] {
  let sweep = end - start;
  while (sweep <= 0) sweep += Math.PI * 2;
  const steps = arcSteps(sweep, radius);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = start + sweep * i / steps;
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)] as Xy;
  });
}

/** Punkterna längs en ellipsbåge (radianer, moturs) med medelpunkt, storaxelvektor och axelkvot. */
function ellipsePoints(center: Xy, major: Xy, ratio: number, start: number, end: number): Xy[] {
  let sweep = end - start;
  while (sweep <= 0) sweep += Math.PI * 2;
  const majorLen = Math.hypot(major[0], major[1]);
  const steps = arcSteps(sweep, Math.max(majorLen, majorLen * Math.abs(ratio)));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = start + sweep * i / steps;
    return [
      center[0] + major[0] * Math.cos(a) - major[1] * ratio * Math.sin(a),
      center[1] + major[1] * Math.cos(a) + major[0] * ratio * Math.sin(a)
    ] as Xy;
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
  const steps = arcSteps(Math.abs(angle), radius);
  return Array.from({ length: steps }, (_, i) => {
    if (i === steps - 1) return b;
    const t = from + angle * (i + 1) / steps;
    return [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)] as Xy;
  });
}

function clampedUniformKnots(count: number, degree: number): number[] {
  const knots: number[] = [], spans = count - degree;
  for (let i = 0; i <= degree; i += 1) knots.push(0);
  for (let i = 1; i < spans; i += 1) knots.push(i / spans);
  for (let i = 0; i <= degree; i += 1) knots.push(1);
  return knots;
}

function validKnots(knots: readonly number[], count: number, degree: number): boolean {
  if (knots.length !== count + degree + 1) return false;
  for (let i = 1; i < knots.length; i += 1) {
    if (!Number.isFinite(knots[i]!) || knots[i]! < knots[i - 1]!) return false;
  }
  return Number.isFinite(knots[0]!) && knots[count]! > knots[degree]!;
}

function deBoor(control: readonly Xy[], weights: readonly number[] | undefined, knots: readonly number[], degree: number, span: number, t: number): Xy {
  const hx = new Float64Array(degree + 1), hy = new Float64Array(degree + 1), hw = new Float64Array(degree + 1);
  for (let j = 0; j <= degree; j += 1) {
    const idx = span - degree + j, w = weights ? (weights[idx] ?? 1) : 1, pt = control[idx]!;
    hx[j] = pt[0] * w; hy[j] = pt[1] * w; hw[j] = w;
  }
  for (let r = 1; r <= degree; r += 1) {
    for (let j = degree; j >= r; j -= 1) {
      const i = span - degree + j;
      const denom = knots[i + degree + 1 - r]! - knots[i]!;
      const alpha = denom === 0 ? 0 : (t - knots[i]!) / denom, inv = 1 - alpha;
      hx[j] = inv * hx[j - 1]! + alpha * hx[j]!;
      hy[j] = inv * hy[j - 1]! + alpha * hy[j]!;
      hw[j] = inv * hw[j - 1]! + alpha * hw[j]!;
    }
  }
  const w = hw[degree]!;
  return w !== 0 ? [hx[degree]! / w, hy[degree]! / w] : [hx[degree]!, hy[degree]!];
}

function pointToSegmentDistSq(p: Xy, a: Xy, b: Xy): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], lenSq = dx * dx + dy * dy;
  if (lenSq === 0) { const rx = p[0] - a[0], ry = p[1] - a[1]; return rx * rx + ry * ry; }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const rx = p[0] - (a[0] + t * dx), ry = p[1] - (a[1] + t * dy);
  return rx * rx + ry * ry;
}

/** Evaluerar en B-spline/NURBS med De Boor + adaptiv sagitta-plattning (fristående utan paketimport). */
function evaluateBSpline(control: readonly Xy[], rawDegree: number, rawKnots: readonly number[], rawWeights?: readonly number[], sagitta = ARC_SAGITTA): Xy[] {
  const n = control.length;
  if (n < 2) return control.slice();
  const degree = Math.max(1, Math.min(Math.floor(rawDegree) || 3, n - 1));
  if (degree === 1) return control.slice();
  const knots = validKnots(rawKnots, n, degree) ? rawKnots : clampedUniformKnots(n, degree);
  const weights = rawWeights && rawWeights.length === n && rawWeights.some(w => w !== 1) ? rawWeights : undefined;
  const tolSq = sagitta * sagitta;
  const out: Xy[] = [];
  const push = (pt: Xy) => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 1e-9) out.push(pt);
  };
  const subdivide = (span: number, t0: number, p0: Xy, t1: number, p1: Xy, depth: number) => {
    const tm = (t0 + t1) / 2;
    const pm = deBoor(control, weights, knots, degree, span, tm);
    if (out.length < MAX_SPLINE_POINTS && depth < 6 && (depth < 1 || pointToSegmentDistSq(pm, p0, p1) > tolSq)) {
      subdivide(span, t0, p0, tm, pm, depth + 1);
      subdivide(span, tm, pm, t1, p1, depth + 1);
      return;
    }
    push(pm);
    push(p1);
  };
  for (let span = degree; span < n; span += 1) {
    const t0 = knots[span]!, t1 = knots[span + 1]!;
    if (!(t1 > t0)) continue;
    const p0 = deBoor(control, weights, knots, degree, span, t0);
    const p1 = deBoor(control, weights, knots, degree, span, t1);
    push(p0);
    subdivide(span, t0, p0, t1, p1, 0);
  }
  return out.length >= 2 ? out : control.slice();
}

function extractControls(raw: unknown): { points: Xy[]; weights: number[] } {
  const points: Xy[] = [], weights: number[] = [];
  if (!Array.isArray(raw)) return { points, weights };
  for (const entry of raw) {
    const at = xy(entry);
    if (!at) continue;
    points.push(at);
    let w = 1;
    if (Array.isArray(entry) && typeof entry[3] === "number" && Number.isFinite(entry[3]) && entry[3] > 0) w = entry[3];
    else if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const rawW = typeof obj.w === "number" ? obj.w : typeof obj.weight === "number" ? obj.weight : 1;
      if (Number.isFinite(rawW) && rawW > 0) w = rawW;
    }
    weights.push(w);
  }
  return { points, weights };
}

function extractKnots(raw: unknown): number[] {
  return Array.isArray(raw) ? (raw as unknown[]).filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : [];
}

function splinePoints(source: Json, fitKey: string, ctrlKey: string): Xy[] {
  const rawFit = source[fitKey];
  const fit = Array.isArray(rawFit) ? (rawFit as unknown[]).flatMap(point => { const at = xy(point); return at ? [at] : []; }) : [];
  if (fit.length >= 2) return fit;
  const { points, weights } = extractControls(source[ctrlKey]);
  if (points.length < 2) return points;
  const degree = number(source.degree, 3);
  const knots = extractKnots(source.knots);
  const weighted = source.weighted === 1 || source.is_rational === 1 || weights.some(w => w !== 1);
  return evaluateBSpline(points, degree, knots, weighted ? weights : undefined);
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

/** En skraffyrs kant: polylinje (med bågar) eller kanter (raka, cirkelbågar, ellipsbågar och splines). */
function hatchRing(path: Json): Xy[] | undefined {
  if (Array.isArray(path.polyline_paths)) {
    const points = (path.polyline_paths as Json[]).flatMap(point => { const at = xy(point.point); return at ? [{ at, bulge: number(point.bulge) }] : []; });
    return ring(withBulges(points, true));
  }
  if (!Array.isArray(path.segs)) return undefined;
  const out: Xy[] = [];
  const append = (part: readonly Xy[]) => {
    for (const pt of part) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 1e-9) out.push(pt);
    }
  };
  for (const segment of path.segs as Json[]) {
    if (segment.curve_type === 1) {
      const a = xy(segment.first_endpoint), b = xy(segment.second_endpoint);
      if (a && b) append([a, b]);
    } else if (segment.curve_type === 2) {
      const center = xy(segment.center), radius = number(segment.radius);
      if (!center || !(radius > 0)) continue;
      const start = number(segment.start_angle), end = number(segment.end_angle);
      // Medurs: vinklarna är speglade i x-axeln (som i DXF), bågen går från −start till −end medurs.
      const points = segment.is_ccw === 0 ? arcPoints(center, radius, -end, -start).reverse() : arcPoints(center, radius, start, end);
      append(points);
    } else if (segment.curve_type === 3) {
      const center = xy(segment.center), major = xy(segment.endpoint) ?? xy(segment.sm_axis);
      if (!center || !major) continue;
      const ratio = number(segment.minor_major_ratio, number(segment.axis_ratio, 1));
      const start = number(segment.start_angle), end = number(segment.end_angle);
      const points = segment.is_ccw === 0 ? ellipsePoints(center, major, ratio, -end, -start).reverse() : ellipsePoints(center, major, ratio, start, end);
      append(points);
    } else if (segment.curve_type === 4) {
      const points = splinePoints(segment, "fitpts", "control_points");
      if (points.length >= 2) append(points);
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
      if (owner !== undefined && at) {
        const list = vertices.get(owner);
        if (list) list.push({ at, bulge: number(object.bulge) });
        else vertices.set(owner, [{ at, bulge: number(object.bulge) }]);
      }
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
      case "ELLIPSE": {
        const center = xy(object.center), major = xy(object.sm_axis);
        const ratio = number(object.axis_ratio, 1), start = number(object.start_angle, 0), end = number(object.end_angle, Math.PI * 2);
        pending.push({ layer, build: () => center && major ? line(ellipsePoints(center, major, ratio, start, end)) : undefined });
        break;
      }
      case "SPLINE": {
        const points = splinePoints(object, "fit_pts", "ctrl_pts");
        const closed = number(object.closed_b) === 1 || (number(object.flag) & 1) !== 0;
        pending.push({ layer, build: () => {
          if (points.length < 2) return undefined;
          const coords = closed && points.length >= 3 && (points[0]![0] !== points[points.length - 1]![0] || points[0]![1] !== points[points.length - 1]![1])
            ? [...points, points[0]!] : points;
          return line(coords);
        } });
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
