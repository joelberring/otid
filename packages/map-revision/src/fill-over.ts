import { flattenPath, type MapObject, type Point } from "@o-tid/map-file";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import { codeParts, type MapNorm } from "./map-norm";

/**
 * K8b V7 Fyll över (ägaren 2026-11-23, Liljeholmen och Gröndal: «se över fyllen också så att den kan fylla över ytor som skapats
 * och då ta bort dessa på den delen, som exemplet där jag ville fylla med väg»). I läget räknas Magisk fylls rutor bara av linjer
 * och av hårda ytor; markytorna (grundkartans gult, grönt, tomtmark, hårdgjord yta, berg, kärr …) är inga gränser, och den nya
 * ytans område klipps bort ur dem. Ren TypeScript utan I/O; klippningen med polygon-clipping som `areaMinus` (AI-kopplingens
 * `subtract`).
 *
 * Markytorna per norm (huvudnummer). Allt annat som är en yta är hårt och klipps aldrig: vatten 301–302, oframkomlig sankmark
 * 307, stenpelare och jätteblock (202, 206), oframkomlig vegetation (411, ISSOM 421), byggnader och skärmtak (521, 522; ISSOM
 * 526), och ytor som inte står här.
 */
const GROUND: Readonly<Record<MapNorm, (main: number) => boolean>> = {
  // ISOM 2017-2 (och äldre skogskartor med ISOM 2000-nummer: 527 bebyggelse, 529 belagd yta).
  ISOM: main => (main >= 208 && main <= 214) || (main >= 308 && main <= 310) || (main >= 401 && main <= 416 && main !== 411)
    || main === 501 || main === 520 || main === 527 || main === 529,
  // ISSprOM 2019-2: 501 hårdgjord yta (alla varianter), 520 tomtmark.
  ISSPROM: main => (main >= 208 && main <= 214) || (main >= 308 && main <= 310) || (main >= 401 && main <= 416 && main !== 411)
    || main === 501 || main === 520,
  // ISSOM 2007 (ISOM 2000:s nummer): 527 bebyggelse, 528 förbjudet område, 529 belagd yta; 421 är oframkomlig vegetation.
  ISSOM: main => (main >= 208 && main <= 214) || (main >= 308 && main <= 310) || (main >= 401 && main <= 420) || (main >= 527 && main <= 529)
};

/** Är ytsymbolen en markyta, som Fyll över fyller över och klipper? Annars är den hård: en gräns som aldrig klipps. */
export function isGroundArea(code: string | number, norm: MapNorm): boolean {
  return GROUND[norm](typeof code === "number" ? code : codeParts(code).main);
}

type Area = Extract<MapObject, { kind: "area" }>;

/** En markyta som kan klippas: objektet, och dess minsta yta (mm² på kartan) – en mindre restbit tas bort. */
export interface FillOverTarget { readonly object: Area; readonly minPieceMm2: number; /** Pröva om ytan redan täcker hela den nya. */ readonly cover?: boolean | undefined }

export interface FillOverCut {
  /** Numret i `targets`. */
  readonly target: number;
  /** Det som blir kvar (tomt = tas bort); delarna har objektets symbol och vinkel. */
  readonly pieces: Area[];
  /** Det som tas bort (skärningen med den nya ytan), ringar i kartans mm, för förhandsvisningen. */
  readonly removed: Point[][][];
  /** Med `cover`: ytan täcker redan hela den nya ytan. */
  readonly covers: boolean;
}

const ringsOf = (rings: readonly (readonly Point[])[]): Polygon => rings.map(ring => {
  const points = ring.map(point => [point.x, point.y] as [number, number]);
  const first = points[0], last = points[points.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) points.push([first[0], first[1]]);
  return points;
}).filter(ring => ring.length >= 4);
const polygonOf = (area: Area): Polygon => ringsOf(area.rings.flatMap(path => flattenPath(path)));
const ringArea = (ring: readonly (readonly [number, number])[]) => Math.abs(ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length]!;
  return sum + x * ny - nx * y;
}, 0)) / 2;
/** Ytan utan hålen. */
const pieceArea = (piece: Polygon) => Math.max(0, ringArea(piece[0] ?? []) - piece.slice(1).reduce((sum, hole) => sum + ringArea(hole), 0));
const multiArea = (multi: MultiPolygon) => multi.reduce((sum, piece) => sum + pieceArea(piece), 0);
const boxOf = (polygon: Polygon) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of polygon) for (const [x, y] of ring) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
};
const toPoints = (multi: MultiPolygon): Point[][][] => multi.map(piece => piece.map(ring => ring.map(([x, y]) => ({ x, y }))));

/**
 * Markytorna utan den nya ytans område (`rings`, ytterkanten och hålen, kartans mm). Bara ytor som den nya ytan överlappar med
 * mer än `minOverlapMm2` kommer med; en restbit under målets `minPieceMm2` tas bort, och blir inget kvar tas ytan bort. En yta
 * vars geometri inte går att klippa lämnas orörd (kommer inte med).
 */
export function fillOverCuts(rings: readonly (readonly Point[])[], targets: readonly FillOverTarget[], minOverlapMm2: number): FillOverCut[] {
  const cell = ringsOf(rings);
  if (cell.length === 0) return [];
  const box = boxOf(cell), cuts: FillOverCut[] = [];
  targets.forEach((target, index) => {
    const polygon = polygonOf(target.object);
    if (polygon.length === 0) return;
    const other = boxOf(polygon);
    if (other.maxX < box.minX || other.minX > box.maxX || other.maxY < box.minY || other.minY > box.maxY) return;
    let overlap: MultiPolygon, rest: MultiPolygon;
    try { overlap = polygonClipping.intersection(polygon, cell); } catch { return; }
    if (multiArea(overlap) <= minOverlapMm2) return;
    try { rest = polygonClipping.difference(polygon, cell); } catch { return; }
    let covers = false;
    if (target.cover) { try { covers = multiArea(polygonClipping.difference(cell, polygon)) <= minOverlapMm2; } catch { covers = false; } }
    const kept = rest.filter(piece => piece[0] && pieceArea(piece) >= target.minPieceMm2);
    cuts.push({ target: index, covers, removed: toPoints(overlap), pieces: kept.map(piece => ({ ...target.object,
      rings: piece.map(ring => ring.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y }))) })) });
  });
  return cuts;
}
