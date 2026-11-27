import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import type { SourceData, SourceFeature } from "../vector-parse";
import { clipLine, clipRing } from "../vector-import";
import { nestRings } from "../ring-nesting";
import { joinSeams } from "../seam-join";

/**
 * Ägaren 2026-11-13 (Ornö södra, delad i tre etapper: «man kan bara se en remsa i taget … går det att fixa så att alla remsor
 * ses samtidigt eller att de läses ihop?»): en laserkörning som servern delat i etapper läses in som en grundkarta. Varje
 * etapp bearbetas med 50 m marginal, så etapperna överlappar; varje etapps objekt klipps till etappens egen klippruta och
 * filerna med samma namn slås ihop innan grundkartan sätts ihop (`mergeBaseMap`). Klipprutorna ligger kant i kant.
 *
 * Etapp G5: ytor som klipps längs etappsnitt (vatten, vegetation 401–410, fukt/sankmark 307/308/310, berg i dagen 214 och
 * belagd yta 501) unioneras rent per exakt samma lager (endast polygoner som faktiskt nuddar ett etappsnitt), med hål
 * bevarade och säker fallback vid ogiltiga självskärningar; terränglinjer fogas över skarven (`joinSeams`).
 */
export interface StageBox { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
/** Ett inre etappsnitt där två etapper möts kant i kant. */
export interface StageSeam { readonly axis: "x" | "y"; readonly at: number; readonly from: number; readonly to: number }
type Pair = readonly [number, number];
type Ring = [number, number][];

const SEAM_EPS = 0.05;
const AREA_EPS = 1e-6;
const MAX_SELF_CHECK_VERTICES = 400;
/** Karttapullautins råa korta brantstreck (inte sammanhängande brantlinjer). */
const RAW_TICK_FILES = /^(branter|stup)\.dxf$/i;

/** Ytlager som får unioneras över etappsnitt (per exakt samma lager): vatten, vegetation (401–410), fukt/sankmark (307/308/310), berg (214) och belagd yta (501). */
const UNION_AREA_LAYER =
  /^(?:vatten|oppen_mark(?:_.*)?|open_land|gr[oö]n(?:t|_(?:l[aä]ttl[oö]pt|sv[aå]rl[oö]pt|mycket_sv[aå]rl[oö]pt))|undervegetation(?:_(?:l[aä]ttl[oö]pt|sv[aå]rl[oö]pt))?|hygge_(?:f[aä]rskt|sly(?:_mark)?|ungskog)|vegetation|bl[oö]tt|fukt(?:igt?)?|sankmark(?:_.*)?|myr|marsh|berg_i_dagen(?:_laser)?|bergh[aä]ll|bare_rock|berg|belagd_yta(?:_laser)?|belagt|asfalt|parkering|paved|OSM belagd yta(?: \(.+\))?|(?:214|301|307|308|310|40[1-9]|410|501)(?:\.0)?)$/i;

const isUnionAreaLayer = (layer: string) => UNION_AREA_LAYER.test(layer);
const inside = (box: StageBox, [x, y]: Pair) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
const toPoints = (points: readonly Pair[]) => points.map(([x, y]) => ({ x, y }));
const toPairs = (points: readonly { x: number; y: number }[]): Ring => points.map(point => [point.x, point.y]);

const ringArea = (ring: readonly Pair[]) =>
  Math.abs(ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0)) / 2;

const netPolygonArea = (polygon: readonly (readonly Pair[])[]) =>
  polygon.reduce((sum, ring, i) => sum + (i === 0 ? 1 : -1) * ringArea(ring), 0);

const boxOfRing = (ring: readonly Pair[]): StageBox => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};

/** Öppen ring utan dubbletter och utan strikt kolinjära skarvpunkter (inom `tolerance`). */
function cleanRing(ring: readonly Pair[], tolerance = 1e-6): Ring {
  const deduped: Ring = [];
  for (const [x, y] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(x - prev[0], y - prev[1]) > 1e-9) deduped.push([x, y]);
  }
  while (deduped.length > 1 && Math.hypot(deduped[0]![0] - deduped[deduped.length - 1]![0], deduped[0]![1] - deduped[deduped.length - 1]![1]) <= 1e-9) {
    deduped.pop();
  }
  if (deduped.length < 3) return [];
  if (tolerance <= 0) return deduped;
  const kept: Ring = [];
  const n = deduped.length;
  for (let i = 0; i < n; i += 1) {
    const prev = kept[kept.length - 1] ?? deduped[(i + n - 1) % n]!;
    const curr = deduped[i]!;
    const next = i === n - 1 && kept.length > 0 ? kept[0]! : deduped[(i + 1) % n]!;
    const dx = next[0] - prev[0], dy = next[1] - prev[1], chord = Math.hypot(dx, dy);
    if (chord <= 1e-9) continue;
    const cross = Math.abs(dx * (prev[1] - curr[1]) - (prev[0] - curr[0]) * dy);
    if (cross > tolerance * chord) kept.push(curr);
  }
  return kept.length >= 3 ? kept : deduped;
}

/** Egentlig självskärning (två icke-intilliggande kanter korsar varandra strikt i sitt inre; hörnnuddning tillåts). */
function hasProperSelfIntersection(ring: readonly Pair[]): boolean {
  const n = ring.length;
  if (n < 4 || n > MAX_SELF_CHECK_VERTICES) return false;
  const eps = 1e-9;
  const orient = (a: Pair, b: Pair, c: Pair) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    const aMinX = Math.min(a[0], b[0]), aMaxX = Math.max(a[0], b[0]);
    const aMinY = Math.min(a[1], b[1]), aMaxY = Math.max(a[1], b[1]);
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const c = ring[j]!, d = ring[(j + 1) % n]!;
      if (aMaxX < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < aMinX || aMaxY < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < aMinY) continue;
      const o1 = orient(a, b, c), o2 = orient(a, b, d);
      if (!((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps))) continue;
      const o3 = orient(c, d, a), o4 = orient(c, d, b);
      if ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps)) return true;
    }
  }
  return false;
}

/** Validerar och stänger ringar till en `polygon-clipping`-polygon; `undefined` vid ogiltig eller självskärande geometri. */
function toValidPolygon(rings: readonly (readonly Pair[])[]): Polygon | undefined {
  if (rings.length === 0) return undefined;
  const cleaned: Ring[] = [];
  for (let i = 0; i < rings.length; i += 1) {
    const ring = cleanRing(rings[i]!, 0);
    if (ring.length < 3 || ringArea(ring) <= AREA_EPS) {
      if (i === 0) return undefined;
      continue;
    }
    if (hasProperSelfIntersection(ring)) return undefined;
    cleaned.push([...ring, [ring[0]![0], ring[0]![1]]]);
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Slutna DXF-linjer i ytlager läggs i varandra (`nestRings`) till riktiga ytor med hål före klippning/union. */
function nestClosedAreaLines(features: readonly SourceFeature[], matchLayer: (layer: string) => boolean): SourceFeature[] {
  const byLayer = new Map<string, { template: SourceFeature; rings: Ring[] }>();
  for (const feature of features) {
    if (feature.geometry.kind !== "line" || !feature.geometry.closed || feature.geometry.points.length < 3 || !matchLayer(feature.layer)) continue;
    const ring = cleanRing(feature.geometry.points, 0);
    if (ring.length < 3) continue;
    const entry = byLayer.get(feature.layer);
    if (entry) entry.rings.push(ring);
    else byLayer.set(feature.layer, { template: feature, rings: [ring] });
  }
  if (byLayer.size === 0) return [...features];
  const out: SourceFeature[] = [];
  const emitted = new Set<string>();
  for (const feature of features) {
    if (feature.geometry.kind === "line" && feature.geometry.closed && feature.geometry.points.length >= 3 && matchLayer(feature.layer)) {
      if (emitted.has(feature.layer)) continue;
      emitted.add(feature.layer);
      const entry = byLayer.get(feature.layer);
      if (!entry) continue;
      for (const nested of nestRings(entry.rings.map(toPoints))) {
        out.push({ ...entry.template, geometry: { kind: "area", rings: nested.map(toPairs) } });
      }
      continue;
    }
    out.push(feature);
  }
  return out;
}

/** Klipper en polygon (ytterring + hål) mot klipprutan med `polygon-clipping`, med säker fallback till `clipRing`. */
function clipPolygonToBox(rings: readonly (readonly Pair[])[], box: StageBox): Ring[][] {
  if (rings.length === 0) return [];
  const outerBox = boxOfRing(rings[0]!);
  if (outerBox.maxX < box.minX || outerBox.minX > box.maxX || outerBox.maxY < box.minY || outerBox.minY > box.maxY) return [];
  const valid = toValidPolygon(rings);
  if (valid) {
    const clipPoly: Polygon = [[[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY], [box.minX, box.minY]]];
    try {
      const cut = polygonClipping.intersection(valid, clipPoly);
      const result: Ring[][] = [];
      for (const poly of cut) {
        const openRings = poly.map(ring => cleanRing(ring, 1e-6)).filter(ring => ring.length >= 3 && ringArea(ring) > AREA_EPS);
        if (openRings.length > 0) result.push(openRings);
      }
      return result;
    } catch { /* faller tillbaka till clipRing nedan */ }
  }
  const [outer, ...holes] = rings.map(ring => toPairs(clipRing(toPoints(ring), box)));
  if (!outer || outer.length < 3) return [];
  return [[outer, ...holes.filter(ring => ring.length >= 3)]];
}

/** Objekten klippta till rutan: punkter utanför tas bort, linjer delas vid kanten och ytor klipps (hål bevaras eller klipps rent). */
export function clipFeaturesToBox(features: readonly SourceFeature[], box: StageBox): SourceFeature[] {
  const prepared = nestClosedAreaLines(features, isUnionAreaLayer);
  const out: SourceFeature[] = [];
  for (const feature of prepared) {
    const geometry = feature.geometry;
    if (geometry.kind === "point") { if (inside(box, geometry.at)) out.push(feature); continue; }
    if (geometry.kind === "line") {
      if (geometry.points.every(point => inside(box, point))) { out.push(feature); continue; }
      // En sluten linje som går över kanten blir öppna bitar (med den stängande sträckan).
      const points = geometry.closed ? [...geometry.points, geometry.points[0]!] : geometry.points;
      for (const piece of clipLine(toPoints(points), box)) out.push({ ...feature, geometry: { kind: "line", points: toPairs(piece), closed: false } });
      continue;
    }
    if (geometry.rings.every(ring => ring.every(point => inside(box, point)))) { out.push(feature); continue; }
    for (const rings of clipPolygonToBox(geometry.rings, box)) out.push({ ...feature, geometry: { kind: "area", rings } });
  }
  return out;
}

/** Delade inre etappsnitt mellan intilliggande etapprutor. */
export function stageSeams(boxes: readonly StageBox[]): StageSeam[] {
  const seams: StageSeam[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i]!;
    for (let j = i + 1; j < boxes.length; j += 1) {
      const b = boxes[j]!;
      if (Math.abs(a.maxX - b.minX) <= SEAM_EPS || Math.abs(b.maxX - a.minX) <= SEAM_EPS) {
        const at = Math.abs(a.maxX - b.minX) <= SEAM_EPS ? (a.maxX + b.minX) / 2 : (b.maxX + a.minX) / 2;
        const from = Math.max(a.minY, b.minY), to = Math.min(a.maxY, b.maxY);
        if (to > from + AREA_EPS) seams.push({ axis: "x", at, from, to });
      }
      if (Math.abs(a.maxY - b.minY) <= SEAM_EPS || Math.abs(b.maxY - a.minY) <= SEAM_EPS) {
        const at = Math.abs(a.maxY - b.minY) <= SEAM_EPS ? (a.maxY + b.minY) / 2 : (b.maxY + a.minY) / 2;
        const from = Math.max(a.minX, b.minX), to = Math.min(a.maxX, b.maxX);
        if (to > from + AREA_EPS) seams.push({ axis: "y", at, from, to });
      }
    }
  }
  return seams;
}

function touchesSeam(ring: readonly Pair[], box: StageBox, seam: StageSeam): boolean {
  if (seam.axis === "x") {
    if (box.minX > seam.at + SEAM_EPS || box.maxX < seam.at - SEAM_EPS || box.maxY < seam.from - SEAM_EPS || box.minY > seam.to + SEAM_EPS) return false;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      if (Math.abs(a[0] - seam.at) <= SEAM_EPS && a[1] >= seam.from - SEAM_EPS && a[1] <= seam.to + SEAM_EPS) return true;
      if ((a[0] < seam.at) !== (b[0] < seam.at)) {
        const y = a[1] + (b[1] - a[1]) * (seam.at - a[0]) / (b[0] - a[0]);
        if (y >= seam.from - SEAM_EPS && y <= seam.to + SEAM_EPS) return true;
      }
    }
    return false;
  }
  if (box.minY > seam.at + SEAM_EPS || box.maxY < seam.at - SEAM_EPS || box.maxX < seam.from - SEAM_EPS || box.minX > seam.to + SEAM_EPS) return false;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    if (Math.abs(a[1] - seam.at) <= SEAM_EPS && a[0] >= seam.from - SEAM_EPS && a[0] <= seam.to + SEAM_EPS) return true;
    if ((a[1] < seam.at) !== (b[1] < seam.at)) {
      const x = a[0] + (b[0] - a[0]) * (seam.at - a[1]) / (b[1] - a[1]);
      if (x >= seam.from - SEAM_EPS && x <= seam.to + SEAM_EPS) return true;
    }
  }
  return false;
}

interface AreaEntry { readonly feature: SourceFeature; readonly polygon: Polygon; readonly box: StageBox }

function tryUnion(a: MultiPolygon, b: MultiPolygon): MultiPolygon | undefined {
  const areaA = a.reduce((sum, poly) => sum + netPolygonArea(poly), 0);
  const areaB = b.reduce((sum, poly) => sum + netPolygonArea(poly), 0);
  let merged: MultiPolygon;
  try { merged = polygonClipping.union(a, b); } catch { return undefined; }
  if (merged.length === 0) return undefined;
  let totalArea = 0;
  for (const poly of merged) {
    if (poly.length === 0) return undefined;
    for (const ring of poly) {
      if (ring.length < 4) return undefined;
      for (const [x, y] of ring) if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    }
    const net = netPolygonArea(poly);
    if (!Number.isFinite(net) || net <= AREA_EPS) return undefined;
    totalArea += net;
  }
  const minExpected = Math.max(areaA, areaB) * 0.95 - 1e-3;
  const maxExpected = (areaA + areaB) * 1.05 + 1e-3;
  if (totalArea < minExpected || totalArea > maxExpected) return undefined;
  return merged;
}

function unionCluster(cluster: readonly AreaEntry[]): SourceFeature[] {
  if (cluster.length < 2) return cluster.map(entry => entry.feature);
  let level: { multi: MultiPolygon; sources: AreaEntry[] }[] = cluster.map(entry => ({ multi: [entry.polygon], sources: [entry] }));
  while (level.length > 1) {
    const next: { multi: MultiPolygon; sources: AreaEntry[] }[] = [];
    let mergedAny = false;
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!, b = level[i + 1];
      if (!b) { next.push(a); continue; }
      const merged = tryUnion(a.multi, b.multi);
      if (merged) { next.push({ multi: merged, sources: [...a.sources, ...b.sources] }); mergedAny = true; }
      else next.push(a, b);
    }
    level = next;
    if (!mergedAny) break;
  }
  const out: SourceFeature[] = [];
  for (const item of level) {
    if (item.sources.length === 1) { out.push(item.sources[0]!.feature); continue; }
    const template = item.sources[0]!.feature;
    const features: SourceFeature[] = [];
    for (const poly of item.multi) {
      const rings = poly.map(ring => cleanRing(ring, 1e-6)).filter(ring => ring.length >= 3 && ringArea(ring) > AREA_EPS);
      if (rings.length > 0) features.push({ ...template, geometry: { kind: "area", rings } });
    }
    if (features.length > 0) out.push(...features);
    else for (const source of item.sources) out.push(source.feature);
  }
  return out;
}

/** Sammanhängande kluster av polygoner vars omslutande rutor nuddar eller överlappar varandra (sveplinje + union-find). */
function clusterTouching(entries: readonly AreaEntry[]): AreaEntry[][] {
  const n = entries.length;
  if (n < 2) return entries.map(entry => [entry]);
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    let cur = x;
    while (parent[cur] !== root) { const next = parent[cur]!; parent[cur] = root; cur = next; }
    return root;
  };
  const unite = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => entries[a]!.box.minX - entries[b]!.box.minX);
  for (let i = 0; i < n; i += 1) {
    const idxA = order[i]!, boxA = entries[idxA]!.box, limitX = boxA.maxX + SEAM_EPS;
    for (let j = i + 1; j < n; j += 1) {
      const idxB = order[j]!, boxB = entries[idxB]!.box;
      if (boxB.minX > limitX) break;
      if (boxA.minY - SEAM_EPS <= boxB.maxY && boxB.minY - SEAM_EPS <= boxA.maxY) unite(idxA, idxB);
    }
  }
  const groups = new Map<number, AreaEntry[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i), list = groups.get(root);
    if (list) list.push(entries[i]!); else groups.set(root, [entries[i]!]);
  }
  return [...groups.values()];
}

function unionPolygonsByLayer(features: readonly SourceFeature[], matchLayer: (layer: string) => boolean, seams?: readonly StageSeam[]): SourceFeature[] {
  if (seams && seams.length === 0) return [...features];
  const prepared = nestClosedAreaLines(features, matchLayer);
  const rest: SourceFeature[] = [];
  const byLayer = new Map<string, AreaEntry[]>();
  for (const feature of prepared) {
    if (feature.geometry.kind !== "area" || !matchLayer(feature.layer)) { rest.push(feature); continue; }
    const outer = feature.geometry.rings[0];
    if (!outer || outer.length < 3) { rest.push(feature); continue; }
    const box = boxOfRing(outer);
    if (seams && !seams.some(seam => touchesSeam(outer, box, seam))) { rest.push(feature); continue; }
    const polygon = toValidPolygon(feature.geometry.rings);
    if (!polygon) { rest.push(feature); continue; }
    const list = byLayer.get(feature.layer);
    const entry: AreaEntry = { feature, polygon, box };
    if (list) list.push(entry); else byLayer.set(feature.layer, [entry]);
  }
  if (byLayer.size === 0) return rest;
  for (const entries of byLayer.values()) {
    if (entries.length < 2) { rest.push(entries[0]!.feature); continue; }
    for (const cluster of clusterTouching(entries)) rest.push(...unionCluster(cluster));
  }
  return rest;
}

/**
 * Etapp-union för ytor i exakt samma lager (vatten, vegetation 401–410, fukt/sankmark 307/308/310, berg i dagen 214 och
 * belagd yta 501). Med `seams` unioneras bara polygoner som faktiskt nuddar ett etappsnitt, vilket gör stora kartor snabba.
 */
export function unionStageAreas(features: readonly SourceFeature[], seams?: readonly StageSeam[]): SourceFeature[] {
  return unionPolygonsByLayer(features, isUnionAreaLayer, seams);
}

/**
 * Etapperna som en uppsättning filer: varje fil klippt till sin etapp och filerna med samma namn ihopslagna, i den ordning
 * namnen först förekommer. Koordinatsystemet tas från den första filen som anger det. Ytor över etappsnitt unioneras per
 * exakt samma lager och terränglinjer fogas över skarvarna.
 */
export function joinStages(stages: readonly { readonly box: StageBox; readonly parts: readonly { readonly name: string; readonly data: SourceData }[] }[]):
  { name: string; data: SourceData }[] {
  const seams = stageSeams(stages.map(stage => stage.box));
  const byName = new Map<string, { features: SourceFeature[]; crs: number | undefined; skipped: number }>();
  for (const stage of stages) {
    for (const part of stage.parts) {
      const joined = byName.get(part.name) ?? { features: [], crs: undefined, skipped: 0 };
      joined.features.push(...clipFeaturesToBox(part.data.features, stage.box));
      joined.crs ??= part.data.crs;
      joined.skipped += part.data.skipped;
      byName.set(part.name, joined);
    }
  }
  return [...byName].map(([name, joined]) => {
    const united = seams.length > 0 ? unionStageAreas(joined.features, seams) : joined.features;
    const features = stages.length >= 2 && !RAW_TICK_FILES.test(name) ? joinSeams(united) : united;
    return { name, data: { features, skipped: joined.skipped, ...(joined.crs !== undefined ? { crs: joined.crs } : {}) } };
  });
}

/**
 * Vattnet som går över en etappgräns är två ytor som möts längs gränsen; strandlinjen dras längs ytornas kanter och skulle
 * då gå rakt över sjön. Vattenytorna slås därför ihop till hela sjöar.
 */
export function unionWater(features: readonly SourceFeature[]): SourceFeature[] {
  return unionPolygonsByLayer(features, layer => layer === "vatten");
}
