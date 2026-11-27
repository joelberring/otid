import { elongatedAngle, elongatedKnoll } from "./elongated-knolls";
import type { SourceFeature } from "../index";

/**
 * Grundkartan G3, små slutna kurvor (ägaren 2026-11-11: «många små höjder borde ritats som punkthöjder i stället, för att minska
 * på antal täta kurvor», «kolla på standarden … orienteringskartor ska kunna läsas i fart»). Måtten är ISOM 2017-2:s minsta,
 * räknade på kartan och yttermått:
 * - höjdkurva (101): en kulle minst 0,9 mm lång och 0,6 mm bred, en grop minst 1,1 × 0,7 mm (gropen ska rymma ett lutningsstreck);
 * - formlinje (103): en kulle eller grop minst 1,1 mm lång; en mindre formlinjering tas bort;
 * - stödkurva (102): små kullar och gropar ritas normalt inte med stödkurvan, så en liten sådan ring blir en vanlig höjdkurva.
 * En för liten höjdkurva blir liten kulle (`dotknoll`, 109) eller liten grop (`udepression`, 111), utan dubblett där
 * Karttapullautins egen knoll eller grop redan ligger. Kulle eller grop avgörs av lagret (Karttapullautins `depression`) eller av
 * den närmaste omslutande kurvan, annars av närmaste kurva med annan höjd inom 40 m. Mellankurvorna (`_intermed`) visas inte och
 * rörs inte. Måtten räknas med en marginal (`GENERALIZE`, 20 %) över normens minsta, så att kartan generaliseras något och går att
 * läsa i fart (ägaren 2026-11-11).
 */
export const GENERALIZE = 1.2;
const CONTOUR = /^(contour|depression)(_index)?$/;
const FORMLINE = /^formline$/;
const ANY = /^(contour|depression)(_index|_intermed)?$/;
const NEAR_METERS = 40;
/** Minsta längd och bredd i mm för kulle och grop. */
export const ISOM_RINGS = { knoll: [0.9, 0.6], depression: [1.1, 0.7], formline: [1.1, 0] } as const;
/**
 * ISOM 2017-2 § 102 (stödkurva): små slutna kullar, gropar och korta isolerade öppna snuttar ritas som vanlig kurva (101).
 * Mätt mot fyra RH2000-facitkartor (Högdalen, Tyresta, Gömmaren, Djurgården): slutna kullar under 6,5 mm omkrets (97,5 m i
 * 1:15 000/1:10 000) eller 2,5 mm² yta (562 m²), slutna sänkor under 10 mm / 6 mm², samt isolerade öppna snuttar under 4 mm
 * (60 m) som inte når utsnittets kant nedgraderas till vanlig kurva.
 */
export const INDEX_MIN_PERIM_MM = 6.5, INDEX_MIN_AREA_MM2 = 2.5;
export const INDEX_DEP_MIN_PERIM_MM = 10, INDEX_DEP_MIN_AREA_MM2 = 6;
export const INDEX_OPEN_MIN_MM = 4;
/** Terrängskala enligt ISOM 2017-2: 1:10 000 är en förstoring av 1:15 000, så måtten i terrängen är desamma; sprint räknas för sig. */
const terrainScale = (scale: number) => scale <= 5000 ? scale : Math.max(scale, 15000);
type Ring = readonly (readonly [number, number])[];

const lineLengthOf = (points: Ring, closed: boolean): number => {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) sum += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  if (closed && points.length > 2) sum += Math.hypot(points[0]![0] - points[points.length - 1]![0], points[0]![1] - points[points.length - 1]![1]);
  return sum;
};

const isMultipleOf = (value: number, step: number): boolean => Math.abs(value / step - Math.round(value / step)) * step <= 0.02;

/**
 * Kontrollerar att stödkurvors höjd stämmer med kurvornas ekvidistans (var 5:e kurva från havsnivå, eller var 4:e om en
 * sprintfil genomgående använder 10 m på 2,5 m-ekvidistans). Vid färre än tre olika kurvnivåer prövas inte höjden.
 */
function validIndexElevation(features: readonly SourceFeature[]): (elevation: number | undefined) => boolean {
  const levelSet = new Set<number>();
  const indexElevs: number[] = [];
  for (const feature of features) {
    if (feature.geometry.kind !== "line" || feature.elevation === undefined || !CONTOUR.test(feature.layer)) continue;
    levelSet.add(Math.round(feature.elevation * 100) / 100);
    if (/_index$/.test(feature.layer)) indexElevs.push(feature.elevation);
  }
  const levels = [...levelSet].sort((a, b) => a - b);
  if (levels.length < 3 || indexElevs.length === 0) return () => true;
  const gaps = new Map<number, number>();
  for (let i = 1; i < levels.length; i += 1) {
    const gap = Math.round((levels[i]! - levels[i - 1]!) * 100) / 100;
    if (gap >= 0.5) gaps.set(gap, (gaps.get(gap) ?? 0) + 1);
  }
  let interval = 0, bestCount = 0;
  for (const [gap, count] of gaps) {
    if (count > bestCount || (count === bestCount && gap < interval)) { bestCount = count; interval = gap; }
  }
  if (!(interval >= 0.5)) return () => true;
  const step5 = 5 * interval, step4 = 4 * interval;
  let match5 = 0, match4 = 0;
  for (const z of indexElevs) {
    if (isMultipleOf(z, step5)) match5 += 1;
    if (isMultipleOf(z, step4)) match4 += 1;
  }
  const expectedStep = match4 > match5 ? step4 : step5;
  return elevation => elevation === undefined || (isMultipleOf(elevation, interval) && isMultipleOf(elevation, expectedStep));
}

/** Om en ändpunkt på en öppen kurva når kurvornas yttre utbredningskant (kurvan fortsätter utanför utsnittet). */
function dataEdgeTest(features: readonly SourceFeature[], openMin: number): (point: readonly [number, number]) => boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const feature of features) {
    if (feature.geometry.kind !== "line") continue;
    for (const [x, y] of feature.geometry.points) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || (maxX - minX < openMin * 3 && maxY - minY < openMin * 3)) return () => false;
  const eps = 2;
  return ([x, y]) => Math.abs(x - minX) <= eps || Math.abs(x - maxX) <= eps || Math.abs(y - minY) <= eps || Math.abs(y - maxY) <= eps;
}

type Box = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
interface RingMeta {
  readonly box: Box;
  readonly area: number;
  readonly centre: [number, number];
  extent?: { length: number; width: number } | undefined;
}
const ringMetaCache = new WeakMap<Ring, RingMeta>();

const boxOfPoints = (ring: Ring): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const [x, y] = ring[i]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};
const touchesBox = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
const containsBox = (outer: Box, inner: Box) => outer.minX <= inner.minX && outer.maxX >= inner.maxX && outer.minY <= inner.minY && outer.maxY >= inner.maxY;

/** Ringens yta (i koordinaternas enhet i kvadrat). */
export const ringArea = (ring: Ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x, y] = ring[i]!, [nx, ny] = ring[(i + 1) % ring.length]!;
    sum += x * ny - nx * y;
  }
  return Math.abs(sum) / 2;
};
const centreOf = (ring: Ring): [number, number] => {
  let sx = 0, sy = 0;
  for (let i = 0; i < ring.length; i += 1) { sx += ring[i]![0]; sy += ring[i]![1]; }
  return [sx / ring.length, sy / ring.length];
};
function metaOf(ring: Ring): RingMeta {
  let meta = ringMetaCache.get(ring);
  if (!meta) {
    meta = { box: boxOfPoints(ring), area: ringArea(ring), centre: centreOf(ring) };
    ringMetaCache.set(ring, meta);
  }
  return meta;
}
function inside(ring: Ring, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const EXTENT_DIRS: readonly (readonly [number, number])[] = Array.from({ length: 36 }, (_, i) => [
  Math.cos(i * 5 * Math.PI / 180), Math.sin(i * 5 * Math.PI / 180)
] as const);

/** Längd och bredd: största och minsta utsträckning över riktningar var femte grad. */
export function extentOf(ring: Ring): { length: number; width: number } {
  let length = 0, width = Infinity;
  for (let d = 0; d < EXTENT_DIRS.length; d += 1) {
    const [c, s] = EXTENT_DIRS[d]!;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i]!;
      const proj = p[0] * c + p[1] * s;
      if (proj < lo) lo = proj;
      if (proj > hi) hi = proj;
    }
    const span = hi - lo;
    if (span > length) length = span;
    if (span < width) width = span;
  }
  return { length, width };
}
function extentCached(ring: Ring): { length: number; width: number } {
  const meta = metaOf(ring);
  return (meta.extent ??= extentOf(ring));
}

/** Spatialt rutnät över objekt med bbox. */
class BoxGrid<T extends { readonly box: Box }> {
  private readonly cells = new Map<number, number[]>();
  private readonly overflow: number[] = [];
  private readonly seen: Int32Array;
  private stamp = 0;
  private readonly cell: number;
  private readonly originX: number;
  private readonly originY: number;
  constructor(private readonly items: readonly T[], fixedCell?: number) {
    this.seen = new Int32Array(items.length);
    let sum = 0, ox = Infinity, oy = Infinity;
    for (const item of items) {
      sum += Math.max(item.box.maxX - item.box.minX, item.box.maxY - item.box.minY);
      if (item.box.minX < ox) ox = item.box.minX;
      if (item.box.minY < oy) oy = item.box.minY;
    }
    this.originX = Number.isFinite(ox) ? ox : 0;
    this.originY = Number.isFinite(oy) ? oy : 0;
    this.cell = fixedCell ?? (items.length ? Math.max(5, Math.min(250, sum / items.length)) : 20);
    for (let i = 0; i < items.length; i += 1) {
      const b = items[i]!.box;
      const x0 = Math.floor((b.minX - this.originX) / this.cell), x1 = Math.floor((b.maxX - this.originX) / this.cell);
      const y0 = Math.floor((b.minY - this.originY) / this.cell), y1 = Math.floor((b.maxY - this.originY) / this.cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
        this.overflow.push(i);
        continue;
      }
      for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
        const key = (cx + 0x1000000) * 0x2000000 + (cy + 0x1000000);
        const list = this.cells.get(key);
        if (list) list.push(i); else this.cells.set(key, [i]);
      }
    }
  }
  someInBox(box: Box, test: (item: T) => boolean): boolean {
    if (this.items.length === 0) return false;
    this.stamp += 1;
    if (this.stamp === 0x7fffffff) { this.seen.fill(0); this.stamp = 1; }
    const x0 = Math.floor((box.minX - this.originX) / this.cell), x1 = Math.floor((box.maxX - this.originX) / this.cell);
    const y0 = Math.floor((box.minY - this.originY) / this.cell), y1 = Math.floor((box.maxY - this.originY) / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
      for (let i = 0; i < this.items.length; i += 1) {
        const item = this.items[i]!;
        if (touchesBox(item.box, box) && test(item)) return true;
      }
      return false;
    }
    for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
      const list = this.cells.get((cx + 0x1000000) * 0x2000000 + (cy + 0x1000000));
      if (!list) continue;
      for (let i = 0; i < list.length; i += 1) {
        const idx = list[i]!;
        if (this.seen[idx] === this.stamp) continue;
        this.seen[idx] = this.stamp;
        const item = this.items[idx]!;
        if (touchesBox(item.box, box) && test(item)) return true;
      }
    }
    for (let i = 0; i < this.overflow.length; i += 1) {
      const idx = this.overflow[i]!;
      if (this.seen[idx] === this.stamp) continue;
      this.seen[idx] = this.stamp;
      const item = this.items[idx]!;
      if (touchesBox(item.box, box) && test(item)) return true;
    }
    return false;
  }
  forEachInBox(box: Box, visit: (item: T) => void) {
    this.someInBox(box, item => { visit(item); return false; });
  }
}

/** Dynamiskt punktrutnät för stenar, kullar och punkthöjder. */
class PointGrid<T> {
  private readonly cells = new Map<number, { x: number; y: number; item: T }[]>();
  private readonly overflow: { x: number; y: number; item: T }[] = [];
  private originX = 0;
  private originY = 0;
  private hasOrigin = false;
  constructor(private readonly cell: number) {}
  add(x: number, y: number, item: T) {
    if (!this.hasOrigin) { this.originX = x; this.originY = y; this.hasOrigin = true; }
    const cx = Math.floor((x - this.originX) / this.cell), cy = Math.floor((y - this.originY) / this.cell);
    const entry = { x, y, item };
    if (Math.abs(cx) > 1e7 || Math.abs(cy) > 1e7) { this.overflow.push(entry); return; }
    const key = (cx + 0x1000000) * 0x2000000 + (cy + 0x1000000);
    const list = this.cells.get(key);
    if (list) list.push(entry); else this.cells.set(key, [entry]);
  }
  someInBox(box: Box, test: (x: number, y: number, item: T) => boolean): boolean {
    if (!this.hasOrigin) return false;
    const x0 = Math.floor((box.minX - this.originX) / this.cell), x1 = Math.floor((box.maxX - this.originX) / this.cell);
    const y0 = Math.floor((box.minY - this.originY) / this.cell), y1 = Math.floor((box.maxY - this.originY) / this.cell);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256 || Math.abs(x0) > 1e7 || Math.abs(x1) > 1e7 || Math.abs(y0) > 1e7 || Math.abs(y1) > 1e7) {
      for (const list of this.cells.values()) for (const entry of list) {
        if (entry.x >= box.minX && entry.x <= box.maxX && entry.y >= box.minY && entry.y <= box.maxY && test(entry.x, entry.y, entry.item)) return true;
      }
    } else {
      for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
        const list = this.cells.get((cx + 0x1000000) * 0x2000000 + (cy + 0x1000000));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 1) {
          const entry = list[i]!;
          if (entry.x >= box.minX && entry.x <= box.maxX && entry.y >= box.minY && entry.y <= box.maxY && test(entry.x, entry.y, entry.item)) return true;
        }
      }
    }
    for (let i = 0; i < this.overflow.length; i += 1) {
      const entry = this.overflow[i]!;
      if (entry.x >= box.minX && entry.x <= box.maxX && entry.y >= box.minY && entry.y <= box.maxY && test(entry.x, entry.y, entry.item)) return true;
    }
    return false;
  }
}

/**
 * Ägaren 2026-11-13 («små höjder sluts aldrig i form»): Karttapullautins formlinjer slutar där marken planar ut, så en liten kulle
 * blir en krok som nästan når runt. En kort öppen formlinje (högst 8 mm på kartan) vars ändar ligger nära varandra (högst 1 mm
 * och högst en tredjedel av längden) sluts.
 */
export function closeFormlineHooks(features: readonly SourceFeature[], scale: number): SourceFeature[] {
  const mm = (value: number) => value * terrainScale(scale) / 1000;
  return features.map(feature => {
    const geometry = feature.geometry;
    if (!FORMLINE.test(feature.layer) || geometry.kind !== "line" || geometry.closed || geometry.points.length < 4) return feature;
    const points = geometry.points, first = points[0]!, last = points[points.length - 1]!;
    const length = points.reduce((sum, point, i) => i === 0 ? 0 : sum + Math.hypot(point[0] - points[i - 1]![0], point[1] - points[i - 1]![1]), 0);
    const gap = Math.hypot(last[0] - first[0], last[1] - first[1]);
    return length <= mm(8) && gap <= mm(1) && gap <= length / 3 ? { ...feature, geometry: { ...geometry, closed: true } } : feature;
  });
}

const POINT_AT = (feature: SourceFeature) => (feature.geometry as { at: readonly [number, number] }).at;
/** Punkthöjder (109, 110) i grundkartan: Karttapullautins, otidgeos och laserns. */
const KNOLL_POINT = /^dotknoll(_laser|_avlang)?$/i;
const STONE = /^(sten|stort_block)$/;

/**
 * Ägaren 2026-11-13: «punkthöjder hamnar ofta på små vanliga höjder … det vanliga ska bort om de redovisas som punkthöjd» och
 * «sten och punkthöjd på varandra kan inte stämma, programmet måste välja».
 * - En liten sluten kurva eller formlinje (högst 2,5 mm lång på kartan, utan någon annan kurva inuti) som har en punkthöjd i sig
 *   tas bort: kullen visas med punkten.
 * - En sten och en punkthöjd inom 0,4 mm på kartan är samma upphöjning. Laserns kulle (prövad mot markmodellen med fot och
 *   höjd) vinner över stenen; stenen vinner över Karttapullautins knoll, som också tar små block.
 */
export function oneMarkPerKnoll(features: readonly SourceFeature[], scale: number): SourceFeature[] {
  const mm = (value: number) => value * terrainScale(scale) / 1000;
  const knolls = features.filter(feature => feature.geometry.kind === "point" && KNOLL_POINT.test(feature.layer));
  const stones = features.filter(feature => feature.geometry.kind === "point" && STONE.test(feature.layer));
  const stoneRadius = mm(0.4), stoneRadiusSq = stoneRadius * stoneRadius;
  const knollGrid = new PointGrid<{ feature: SourceFeature; index: number }>(Math.max(stoneRadius, 1));
  for (let i = 0; i < knolls.length; i += 1) {
    const knoll = knolls[i]!, [x, y] = POINT_AT(knoll);
    knollGrid.add(x, y, { feature: knoll, index: i });
  }
  const dropped = new Set<SourceFeature>();
  for (const stone of stones) {
    const [sx, sy] = POINT_AT(stone);
    let bestIndex = Infinity;
    let hit: SourceFeature | undefined;
    knollGrid.someInBox({ minX: sx - stoneRadius, minY: sy - stoneRadius, maxX: sx + stoneRadius, maxY: sy + stoneRadius }, (kx, ky, entry) => {
      const dx = kx - sx, dy = ky - sy;
      if (dx * dx + dy * dy <= stoneRadiusSq && entry.index < bestIndex) {
        bestIndex = entry.index;
        hit = entry.feature;
      }
      return false;
    });
    if (!hit) continue;
    dropped.add(/_laser$/i.test(hit.layer) ? stone : hit);
  }
  const maxRingLen = mm(2.5);
  const marksGrid = new PointGrid<true>(Math.max(maxRingLen, 10));
  for (const knoll of knolls) {
    if (dropped.has(knoll)) continue;
    const [x, y] = POINT_AT(knoll);
    marksGrid.add(x, y, true);
  }
  const ringOf = (feature: SourceFeature) => (feature.geometry as { points: Ring }).points;
  const ringEntries = features
    .filter(feature => feature.geometry.kind === "line" && feature.geometry.closed && (CONTOUR.test(feature.layer) || FORMLINE.test(feature.layer)))
    .map(feature => {
      const ring = ringOf(feature), meta = metaOf(ring);
      return { feature, ring, box: meta.box };
    });
  const ringsGrid = new BoxGrid(ringEntries);
  for (const entry of ringEntries) {
    const { feature, ring, box } = entry;
    if (box.maxX - box.minX > maxRingLen || box.maxY - box.minY > maxRingLen) continue;
    if (extentCached(ring).length > maxRingLen) continue;
    if (!marksGrid.someInBox(box, (x, y) => inside(ring, x, y))) continue;
    // En ring med en annan ring inuti är en del av en större form, inte en enskild liten kulle.
    if (ringsGrid.someInBox(box, other => other.feature !== feature && containsBox(box, other.box)
      && other.ring.every(([x, y]) => inside(ring, x, y)))) continue;
    dropped.add(feature);
  }
  return features.filter(feature => !dropped.has(feature));
}

/** `scale` är kartans skala (t.ex. 10000); kurvorna i meter. */
export function smallRingsToPoints(input: readonly SourceFeature[], scale: number, generalize = GENERALIZE): SourceFeature[] {
  const features = closeFormlineHooks(input, scale);
  const tScale = terrainScale(scale);
  const mapMm = (mm: number) => mm * tScale / 1000;
  const meters = (mm: number) => mm * generalize * tScale / 1000;
  const ringOf = (feature: SourceFeature) => (feature.geometry as { points: Ring }).points;
  const levelled = features
    .filter(feature => feature.geometry.kind === "line" && ANY.test(feature.layer) && feature.elevation !== undefined)
    .map(feature => {
      const ring = ringOf(feature);
      return { feature, ring, box: boxOfPoints(ring) };
    });
  const levelledGrid = new BoxGrid(levelled, NEAR_METERS);
  const rings = levelled
    .filter(row => row.feature.geometry.kind === "line" && row.feature.geometry.closed)
    .map(row => {
      const meta = metaOf(row.ring);
      return { feature: row.feature, ring: row.ring, area: meta.area, box: meta.box };
    });
  const ringsGrid = new BoxGrid(rings);
  const marksGrid = new PointGrid<true>(Math.max(meters(ISOM_RINGS.depression[0]), 15));
  for (const feature of features) {
    if (feature.geometry.kind === "point" && /DOTKNOLL|DEPRESSION/i.test(feature.layer)) {
      const [x, y] = (feature.geometry as { at: readonly [number, number] }).at;
      marksGrid.add(x, y, true);
    }
  }
  const replaced = new Map<SourceFeature, SourceFeature | undefined>(), added: SourceFeature[] = [];
  const indexLevelOk = validIndexElevation(features);
  const openMin = mapMm(INDEX_OPEN_MIN_MM);
  const onDataEdge = dataEdgeTest(features, openMin);
  const closedIndexMinPerim = mapMm(INDEX_MIN_PERIM_MM), closedIndexMinArea = mapMm(1) * mapMm(1) * INDEX_MIN_AREA_MM2;
  const depIndexMinPerim = mapMm(INDEX_DEP_MIN_PERIM_MM), depIndexMinArea = mapMm(1) * mapMm(1) * INDEX_DEP_MIN_AREA_MM2;

  /** Kulle (sant), grop (falskt) eller okänt. */
  const isKnoll = (feature: SourceFeature, ring: Ring): boolean | undefined => {
    if (/^depression/.test(feature.layer)) return false;
    const height = feature.elevation;
    if (height === undefined) return undefined;
    const meta = metaOf(ring);
    const [cx, cy] = meta.centre, area = meta.area;
    let aroundArea = Infinity;
    let outside: number | undefined;
    ringsGrid.forEachInBox({ minX: cx, minY: cy, maxX: cx, maxY: cy }, other => {
      if (other.area > area && other.area < aroundArea && other.feature.elevation !== height && inside(other.ring, cx, cy)) {
        aroundArea = other.area;
        outside = other.feature.elevation;
      }
    });
    if (outside === undefined) {
      let bestSq = NEAR_METERS * NEAR_METERS;
      levelledGrid.forEachInBox({ minX: cx - NEAR_METERS, minY: cy - NEAR_METERS, maxX: cx + NEAR_METERS, maxY: cy + NEAR_METERS }, other => {
        if (other.feature.elevation === height) return;
        const pts = other.ring;
        for (let i = 0; i < pts.length; i += 1) {
          const dx = pts[i]![0] - cx, dy = pts[i]![1] - cy, dSq = dx * dx + dy * dy;
          if (dSq < bestSq) { bestSq = dSq; outside = other.feature.elevation; }
        }
      });
    }
    return outside === undefined ? undefined : outside < height;
  };

  for (const feature of features) {
    if (feature.geometry.kind !== "line" || feature.geometry.points.length < 2) continue;
    const contour = CONTOUR.test(feature.layer), formline = FORMLINE.test(feature.layer);
    if (!contour && !formline) continue;
    const pts = feature.geometry.points;
    if (!feature.geometry.closed) {
      // Korta isolerade öppna stödkurvesnuttar (eller på fel höjdnivå) nedgraderas till vanlig höjdkurva (ISOM 102).
      if (/_index$/.test(feature.layer)) {
        const touchesEdge = onDataEdge(pts[0]!) || onDataEdge(pts[pts.length - 1]!);
        if (!indexLevelOk(feature.elevation) || (!touchesEdge && lineLengthOf(pts, false) < openMin)) {
          replaced.set(feature, { ...feature, layer: feature.layer.replace(/_index$/, "") });
        }
      }
      continue;
    }
    if (pts.length < 3) continue;
    const ring = ringOf(feature);
    const { length, width } = extentCached(ring);
    if (formline) { if (length < meters(ISOM_RINGS.formline[0])) replaced.set(feature, undefined); continue; }
    const knoll = isKnoll(feature, ring);
    const [minLength, minWidth] = knoll === false ? ISOM_RINGS.depression : ISOM_RINGS.knoll;
    if (length >= meters(minLength) && width >= meters(minWidth)) {
      // Stödkurva (ISOM 102) runt en liten kulle, en liten/medelstor grop eller på fel höjdnivå blir en vanlig höjdkurva (101).
      if (/_index$/.test(feature.layer)) {
        const perim = lineLengthOf(ring, true), area = metaOf(ring).area;
        const isDep = /^depression/.test(feature.layer);
        const tooSmall = isDep ? (perim < depIndexMinPerim || area < depIndexMinArea) : (perim < closedIndexMinPerim || area < closedIndexMinArea);
        if (!indexLevelOk(feature.elevation) || tooSmall) replaced.set(feature, { ...feature, layer: feature.layer.replace(/_index$/, "") });
      }
      continue;
    }
    if (knoll === undefined) continue;
    replaced.set(feature, undefined);
    const meta = metaOf(ring);
    if (marksGrid.someInBox(meta.box, (x, y) => inside(ring, x, y))) continue;
    const centre = meta.centre;
    marksGrid.add(centre[0], centre[1], true);
    // En avlång liten kulle blir en avlång punkthöjd (110), vriden efter kurvan (ägaren 2026-11-15).
    const long = knoll ? elongatedAngle(ring) : undefined;
    added.push(long !== undefined ? elongatedKnoll(centre, long) : { layer: knoll ? "dotknoll" : "udepression", geometry: { kind: "point", at: centre } });
  }
  // Laserns egna små kullar (scripts/geo-rock.ts, `dotknoll_laser`) tas bort där Karttapullautin/otidgeo redan har en inom 6 m
  // eller där en kvarvarande sluten höjdkurva (under 3 000 m²) redan visar toppen. Alla kvarvarande slutna 101-toppringar
  // skyddas här så att `oneMarkPerKnoll` inte raderar verkliga små 101-höjder (16–37 m) till förmån för en punkthöjd.
  const kept = features.flatMap(feature => !replaced.has(feature) ? [feature] : replaced.get(feature) ? [replaced.get(feature)!] : []);
  const summits: { ring: Ring; box: Box }[] = [];
  for (const feature of kept) {
    if (feature.geometry.kind !== "line" || !feature.geometry.closed || !CONTOUR.test(feature.layer)) continue;
    const ring = ringOf(feature), meta = metaOf(ring);
    if (meta.area >= 3000) continue;
    summits.push({ ring, box: meta.box });
  }
  const summitGrid = new BoxGrid(summits);
  const othersGrid = new PointGrid<true>(6);
  for (const feature of kept) {
    if (feature.geometry.kind === "point" && /DOTKNOLL/i.test(feature.layer) && feature.layer !== "dotknoll_laser") {
      const [x, y] = (feature.geometry as { at: readonly [number, number] }).at;
      othersGrid.add(x, y, true);
    }
  }
  for (const feature of added) {
    if (feature.geometry.kind === "point" && /DOTKNOLL/i.test(feature.layer) && feature.layer !== "dotknoll_laser") {
      const [x, y] = (feature.geometry as { at: readonly [number, number] }).at;
      othersGrid.add(x, y, true);
    }
  }
  // Kvar: en liten kurva som har en punkthöjd i sig tas bort (punkten visar kullen), och sten eller punkthöjd väljs (`oneMarkPerKnoll`).
  return oneMarkPerKnoll([...kept.filter(feature => {
    if (feature.layer !== "dotknoll_laser" || feature.geometry.kind !== "point") return true;
    const [x, y] = feature.geometry.at;
    const nearOther = othersGrid.someInBox({ minX: x - 6, minY: y - 6, maxX: x + 6, maxY: y + 6 }, (ox, oy) => {
      const dx = ox - x, dy = oy - y;
      return dx * dx + dy * dy < 36;
    });
    if (nearOther) return false;
    return !summitGrid.someInBox({ minX: x, minY: y, maxX: x, maxY: y }, row => inside(row.ring, x, y));
  }), ...added], scale);
}
