import { flattenPath, type MapObject, type Point } from "@o-tid/map-file";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import { isGroundArea } from "./fill-over";
import { codeParts, isSprintNorm, type MapNorm } from "./map-norm";

/**
 * Ägaren 2026-11-23 («det är egentligen bra om ytorna inte sitter ihop i superstora delar ifall man behöver ändra. ganska stora
 * ok»): ytor som O-Tid skapar (grundkartans vegetation, öppen mark, tomtmark och hårdgjord yta, Fyll över många rutor,
 * Utvidga) får inte bli jättelika objekt. En yta över gränsen delas i bitar som ligger kant i kant (samma punkter längs snittet).
 *
 * Gränsen per norm och symbol (`AREA_SPLIT_TABLE`), i terrängen: för markytor ett kvarter eller en park på en sprintkarta (3 ha),
 * ett större skifte på en skogskarta (20 ha); vatten, hus och oframkomligt delas aldrig.
 * Snitten är raka och följer kartans norr (kartans x- och y-axel) i ett rutnät med fasta linjer (var 150 m respektive 400 m från
 * kartans nollpunkt), så att grannytor delas på samma linjer. Varje steg delar biten där den är smalast bland rutnätets linjer
 * (ett smalt ställe är oftast en naturlig gräns: en väg, ett sund, en midja mellan två fält) så länge båda delarna blir minst en
 * femtedel; annars närmast mitten. Kurvor plattas till i de delade ytorna (som när Fyll över klipper); en yta under gränsen
 * lämnas orörd.
 */
export interface AreaSplitRow {
  /** Symbolerna raden gäller (för läsaren). */
  readonly symbols: string;
  readonly test: (main: number, norm: MapNorm) => boolean;
  /** Största ytan i terrängen (m²); `null` = delas aldrig. */
  readonly maxM2: number | null;
}
/**
 * Gränserna per norm: symbol → största yta. Första raden som passar gäller; en yta som ingen rad tar delas inte. Vatten delas
 * aldrig (ägaren 2026-11-23: «typ hav får gärna vara större»), inte heller hus, skärmtak och oframkomligt.
 */
const NEVER: readonly AreaSplitRow[] = [
  { symbols: "301–307 vatten, grunt vatten och oframkomlig sankmark", test: main => main >= 301 && main <= 307, maxM2: null },
  { symbols: "411 opasserbar vegetation, 521–526 byggnader och skärmtak (ISSOM 421, 526)", test: main => main === 411 || main === 421 || (main >= 521 && main <= 526), maxM2: null }
];
const ground = (maxM2: number): AreaSplitRow => ({ symbols: "markytor: 208–214, 308–310, 401–416, 501, 520 (ISSOM 527–529)", test: (main, norm) => isGroundArea(main, norm), maxM2 });
export const AREA_SPLIT_TABLE: Readonly<Record<"sprint" | "forest", { readonly gridM: number; readonly rows: readonly AreaSplitRow[] }>> = {
  sprint: { gridM: 150, rows: [...NEVER, ground(30_000)] },
  forest: { gridM: 400, rows: [...NEVER, ground(200_000)] }
};

export interface AreaSplitLimit {
  /** Största ytan i kartans mm². */
  readonly maxMm2: number;
  /** Rutnätets steg i kartans mm. */
  readonly gridMm: number;
}

/** Gränsen i kartans mm för symbolnumret i normen och skalan; `undefined` = ytan delas inte. */
export function areaSplitLimit(code: string, norm: MapNorm, scale: number): AreaSplitLimit | undefined {
  const table = AREA_SPLIT_TABLE[isSprintNorm(norm) ? "sprint" : "forest"], main = codeParts(code).main, metre = scale / 1000;
  const row = table.rows.find(entry => entry.test(main, norm));
  return row && row.maxM2 !== null ? { maxMm2: row.maxM2 / (metre * metre), gridMm: table.gridM / metre } : undefined;
}

type Area = Extract<MapObject, { kind: "area" }>;
type XY = [number, number];

const closed = (ring: readonly Point[]): XY[] => {
  const points = ring.map(point => [point.x, point.y] as XY);
  const first = points[0], last = points[points.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) points.push([first[0], first[1]]);
  return points;
};
export const areaPolygon = (area: Area): Polygon => area.rings.flatMap(path => flattenPath(path)).map(closed).filter(ring => ring.length >= 4);
const ringArea = (ring: readonly (readonly [number, number])[]) => Math.abs(ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length]!;
  return sum + x * ny - nx * y;
}, 0)) / 2;
export const polygonArea = (polygon: Polygon) => Math.max(0, ringArea(polygon[0] ?? []) - polygon.slice(1).reduce((sum, hole) => sum + ringArea(hole), 0));
export const multiArea = (multi: MultiPolygon) => multi.reduce((sum, piece) => sum + polygonArea(piece), 0);
export interface Box { minX: number; minY: number; maxX: number; maxY: number }
export const polygonBox = (polygon: Polygon): Box => {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const ring of polygon) for (const [x, y] of ring) {
    box.minX = Math.min(box.minX, x); box.minY = Math.min(box.minY, y); box.maxX = Math.max(box.maxX, x); box.maxY = Math.max(box.maxY, y);
  }
  return box;
};

/** Bitarna på var sida om linjen x = c (axis "x") eller y = c. Båda sidorna klipps mot samma kant, så punkterna längs snittet blir lika. */
function halves(piece: Polygon, axis: "x" | "y", c: number, box: Box): [MultiPolygon, MultiPolygon] | undefined {
  const pad = 1 + Math.max(box.maxX - box.minX, box.maxY - box.minY);
  const lo = { minX: box.minX - pad, minY: box.minY - pad }, hi = { maxX: box.maxX + pad, maxY: box.maxY + pad };
  // Kanten på snittet är samma sträcka i båda rektanglarna, i samma riktning.
  const rect = (a: XY, b: XY, far: XY, farB: XY): Polygon => [[a, b, farB, far, a]];
  const first: Polygon = axis === "x" ? rect([c, lo.minY], [c, hi.maxY], [lo.minX, lo.minY], [lo.minX, hi.maxY])
    : rect([lo.minX, c], [hi.maxX, c], [lo.minX, lo.minY], [hi.maxX, lo.minY]);
  const second: Polygon = axis === "x" ? rect([c, lo.minY], [c, hi.maxY], [hi.maxX, lo.minY], [hi.maxX, hi.maxY])
    : rect([lo.minX, c], [hi.maxX, c], [lo.minX, hi.maxY], [hi.maxX, hi.maxY]);
  try { return [polygonClipping.intersection(piece, first), polygonClipping.intersection(piece, second)]; } catch { return undefined; }
}

/** Tecknad dubbel area för en ring (används för att bestämma orientering oberoende av med-/moturs). */
function signedTwice(ring: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x, y] = ring[i]!, [nx, ny] = ring[(i + 1) % ring.length]!;
    sum += x * ny - nx * y;
  }
  return sum;
}

/**
 * O(V)-beräkning av area på den undre sidan (coord <= c) och snittets längd längs linjen `coord = c`:
 * - Arean fås exakt med Greens sats i flyttat koordinatsystem (u = x − c resp. v = y − c), där slutkanterna längs snittet
 *   bidrar med exakt 0.
 * - Snittlängden är längden av `{ y : (c − ε, y) ∈ polygon }` (halvöppen skärning `(a < c) !== (b < c)`), samma längd som
 *   snittkanterna i `halves(piece, axis, c)[0]`.
 */
function cutMetrics(piece: Polygon, ringSigns: readonly number[], axis: "x" | "y", c: number, totalArea: number, crossings: number[])
  : { leftArea: number; rightArea: number; cutLen: number } {
  let leftTwice = 0;
  crossings.length = 0;
  for (let r = 0; r < piece.length; r += 1) {
    const ring = piece[r]!, sign = ringSigns[r]!;
    let ringTwice = 0;
    const n = ring.length;
    if (axis === "x") {
      for (let i = 0; i < n; i += 1) {
        const [x1, y1] = ring[i]!, [x2, y2] = ring[(i + 1) % n]!;
        const u1 = x1 - c, u2 = x2 - c;
        if (u1 <= 0 && u2 <= 0) {
          ringTwice += u1 * y2 - u2 * y1;
        } else if (u1 <= 0 && u2 > 0) {
          const yc = y1 + (y2 - y1) * (-u1) / (u2 - u1);
          ringTwice += u1 * yc;
        } else if (u1 > 0 && u2 <= 0) {
          const yc = y1 + (y2 - y1) * (-u1) / (u2 - u1);
          ringTwice -= u2 * yc;
        }
        if ((x1 < c) !== (x2 < c)) crossings.push(y1 + (y2 - y1) * (c - x1) / (x2 - x1));
      }
    } else {
      for (let i = 0; i < n; i += 1) {
        const [x1, y1] = ring[i]!, [x2, y2] = ring[(i + 1) % n]!;
        const v1 = y1 - c, v2 = y2 - c;
        if (v1 <= 0 && v2 <= 0) {
          ringTwice += x1 * v2 - x2 * v1;
        } else if (v1 <= 0 && v2 > 0) {
          const xc = x1 + (x2 - x1) * (-v1) / (v2 - v1);
          ringTwice -= xc * v1;
        } else if (v1 > 0 && v2 <= 0) {
          const xc = x1 + (x2 - x1) * (-v1) / (v2 - v1);
          ringTwice += xc * v2;
        }
        if ((y1 < c) !== (y2 < c)) crossings.push(x1 + (x2 - x1) * (c - y1) / (y2 - y1));
      }
    }
    leftTwice += sign * ringTwice;
  }
  const leftArea = Math.max(0, Math.min(totalArea, leftTwice / 2));
  const rightArea = Math.max(0, totalArea - leftArea);
  let cutLen = 0;
  if (crossings.length >= 2) {
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) cutLen += crossings[k + 1]! - crossings[k]!;
  }
  return { leftArea, rightArea, cutLen };
}

/** Högst så många rutnätslinjer per axel och delningssteg (skyddar mot korrupta jättekoordinater). */
const MAX_GRID_LINES = 64;
/** En yta som kräver fler bitar än så (korrupta jättekoordinater) delas inte. */
const MAX_SPLIT_PIECES = 5_000;

/** Bitar (polygon-clipping) under gränsen; `undefined` om klippningen inte går att räkna. */
function splitPolygon(polygon: Polygon, limit: AreaSplitLimit): Polygon[] | undefined {
  if (polygonArea(polygon) > limit.maxMm2 * MAX_SPLIT_PIECES) return undefined;
  const done: Polygon[] = [], queue: Polygon[] = [polygon];
  const crossings: number[] = [];
  for (let guard = 0; queue.length; guard += 1) {
    if (guard > 10_000) return undefined;
    const piece = queue.pop()!, area = polygonArea(piece);
    if (area <= limit.maxMm2) { done.push(piece); continue; }
    const box = polygonBox(piece);
    const ringSigns = piece.map((ring, r) => (r === 0 ? 1 : -1) * (signedTwice(ring) >= 0 ? 1 : -1));
    const sqrtArea = Math.sqrt(area);
    const candidates: { axis: "x" | "y"; c: number; score: number }[] = [];
    for (const axis of ["x", "y"] as const) {
      const from = axis === "x" ? box.minX : box.minY, to = axis === "x" ? box.maxX : box.maxY, middle = (from + to) / 2;
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
      const firstK = Math.floor(from / limit.gridMm) + 1, lastK = Math.ceil(to / limit.gridMm) - 1;
      if (lastK < firstK) continue;
      const count = lastK - firstK + 1;
      const stride = count > MAX_GRID_LINES ? Math.ceil(count / MAX_GRID_LINES) : 1;
      for (let k = firstK; k <= lastK; k += stride) {
        const c = k * limit.gridMm;
        if (!(c > from && c < to)) continue;
        const { leftArea, rightArea, cutLen } = cutMetrics(piece, ringSigns, axis, c, area, crossings);
        if (leftArea <= 1e-12 || rightArea <= 1e-12) continue;
        // Smalast först (snittets längd mot bitens storlek), bara om båda delarna blir minst en femtedel; annars närmast mitten.
        const balanced = Math.min(leftArea, rightArea) >= 0.2 * area;
        const score = balanced ? cutLen / sqrtArea : 1e6 + Math.abs(c - middle);
        candidates.push({ axis, c, score });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    let chosen: [MultiPolygon, MultiPolygon] | undefined;
    // Anropa bara `polygonClipping.intersection` för det vinnande snittet (med fallback om det snittet vore degenererat).
    for (const candidate of candidates) {
      const parts = halves(piece, candidate.axis, candidate.c, box);
      if (!parts) continue;
      if (multiArea(parts[0]) <= 0 || multiArea(parts[1]) <= 0) continue;
      chosen = parts;
      break;
    }
    if (!chosen) { done.push(piece); continue; }
    queue.push(...chosen[0], ...chosen[1]);
  }
  return done;
}

const toRings = (piece: Polygon): Area["rings"] => piece.map(ring => ring.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y })));

/** Ytan i bitar under gränsen (samma symbol och egenskaper); ytan själv när den är under gränsen eller inte går att dela. */
export function splitArea(object: Area, limit: AreaSplitLimit): Area[] {
  const polygon = areaPolygon(object);
  if (polygon.length === 0 || polygonArea(polygon) <= limit.maxMm2) return [object];
  const pieces = splitPolygon(polygon, limit);
  if (!pieces || pieces.length <= 1) return [object];
  return pieces.map(piece => ({ ...object, rings: toRings(piece) }));
}

/** Nya objekt med de stora ytorna delade efter tabellen (`codeOf` ger symbolens nummer). */
export function splitLargeAreas(objects: readonly MapObject[], codeOf: (symbol: string) => string | undefined, norm: MapNorm, scale: number): MapObject[] {
  return objects.flatMap((object): MapObject[] => {
    if (object.kind !== "area") return [object];
    const code = codeOf(object.symbol), limit = code ? areaSplitLimit(code, norm, scale) : undefined;
    return limit ? splitArea(object, limit) : [object];
  });
}

/** «Dela stora ytor» för kartans befintliga ytor (vatten och hus hoppas över): objekten som delas och deras bitar (första ersätter objektet). */
export function largeAreaPlan(rows: readonly { readonly key: string; readonly code: string; readonly object: MapObject }[], norm: MapNorm, scale: number)
  : { readonly key: string; readonly objects: readonly MapObject[]; readonly areaM2: number }[] {
  const metre = scale / 1000;
  return rows.flatMap(row => {
    const limit = areaSplitLimit(row.code, norm, scale);
    if (row.object.kind !== "area" || !limit) return [];
    const polygon = areaPolygon(row.object), area = polygonArea(polygon);
    if (area <= limit.maxMm2) return [];
    const pieces = splitArea(row.object, limit);
    return pieces.length > 1 ? [{ key: row.key, objects: pieces, areaM2: area * metre * metre }] : [];
  });
}
