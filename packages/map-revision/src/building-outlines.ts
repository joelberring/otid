import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import { flattenPath, type MapObject, type PathCommand, type Point } from "@o-tid/map-file";

/**
 * Kant runt husen (ägaren 2026-11-23: «husen blev helt svarta fast de ska bli grå med svart kant. om det bara finns en hatch
 * borde programmet göra en kant runt när det lägger in»). ISSprOM 2019-2 521: «black (outline), black 50%», och gränser
 * mellan hus som rör varandra ritas inte. När kartans byggnad (521) är en yta utan egen kant och kartan har en kantsymbol
 * (521.1 «Kant, byggnad»), ritas kanten som slutna linjer runt sammanhängande hus: husen som rör eller överlappar varandra slås
 * ihop (unionen, med gårdarna inuti som hål), så att gemensamma väggar inte får någon linje.
 *
 * `buildingOutlines` ger linjerna att lägga till och de befintliga kantlinjerna som ska bort (de som ligger längs husen som
 * räknas om). En befintlig kant som redan stämmer står kvar, så att åtgärden kan köras igen utan att något ändras.
 */
type Ring = Point[];
export interface OutlineObject { readonly key: string; readonly object: MapObject }
export interface OutlinePlan {
  /** Nya kantlinjer (slutna: sista punkten är den första). */
  readonly add: readonly MapObject[];
  /** Kantlinjer som ersätts. */
  readonly remove: readonly string[];
  /** Hus i de omräknade grupperna. */
  readonly houses: number;
}

/** Koordinaterna avrundas till 0,001 mm, så att hus som delar vägg i filen också delar den i unionen. */
const snap = (value: number) => Math.round(value * 1000) / 1000;
/** En kantlinje som ligger så här nära (mm) husens kant hör till dem. */
const HUG_MM = 0.05;
/** Så nära (mm) måste en befintlig kant följa den nya för att få stå kvar. */
const SAME_MM = 0.01;

const ringsOf = (object: MapObject): Ring[] => object.kind !== "area" ? []
  : object.rings.flatMap(path => flattenPath(path)).map(line => line.map(point => ({ x: snap(point.x), y: snap(point.y) })))
    .map(ring => ring.length > 1 && ring[0]!.x === ring.at(-1)!.x && ring[0]!.y === ring.at(-1)!.y ? ring.slice(0, -1) : ring)
    .filter(ring => ring.length >= 3);
const pointsOf = (object: MapObject): Point[] => object.kind === "line" ? flattenPath(object.path).flat() : [];

interface Box { minX: number; minY: number; maxX: number; maxY: number }
const boxOf = (points: readonly Point[]): Box => points.reduce((box, p) => ({ minX: Math.min(box.minX, p.x), minY: Math.min(box.minY, p.y),
  maxX: Math.max(box.maxX, p.x), maxY: Math.max(box.maxY, p.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
const overlaps = (a: Box, b: Box, margin: number) => a.minX <= b.maxX + margin && b.minX <= a.maxX + margin && a.minY <= b.maxY + margin && b.minY <= a.maxY + margin;

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
const ringDistance = (p: Point, rings: readonly Ring[]) => Math.min(...rings.map(ring =>
  Math.min(...ring.map((point, i) => segmentDistance(p, point, ring[(i + 1) % ring.length]!)))));

const toPolygon = (rings: readonly Ring[]): Polygon => rings.map(ring => [...ring.map(p => [p.x, p.y] as [number, number]), [ring[0]!.x, ring[0]!.y] as [number, number]]);
const fromMulti = (multi: MultiPolygon): Ring[] => multi.flatMap(polygon => polygon.map(ring => ring.slice(0, -1).map(([x, y]) => ({ x, y }))))
  .filter(ring => ring.length >= 3);

/** Grupper av hus vars rutor rör varandra (union–find, husen sorterade i x). */
function groups(boxes: readonly Box[]): number[][] {
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]!));
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a]!.minX - boxes[b]!.minX);
  for (let i = 0; i < order.length; i += 1) {
    const a = boxes[order[i]!]!;
    for (let j = i + 1; j < order.length && boxes[order[j]!]!.minX <= a.maxX + 0.001; j += 1) {
      if (overlaps(a, boxes[order[j]!]!, 0.001)) parent[find(order[i]!)] = find(order[j]!);
    }
  }
  const out = new Map<number, number[]>();
  boxes.forEach((_, i) => out.set(find(i), [...(out.get(find(i)) ?? []), i]));
  return [...out.values()];
}

/**
 * Kanten runt husen. `only`: bara grupperna med de här husen (markerade); utan den alla hus. `edges` är kartans befintliga
 * kantlinjer (kantsymbolens objekt), `edgeSymbol` symbolen de nya får.
 */
export function buildingOutlines(houses: readonly OutlineObject[], edges: readonly OutlineObject[], edgeSymbol: string,
  only?: ReadonlySet<string>): OutlinePlan {
  const shaped = houses.map(house => ({ key: house.key, rings: ringsOf(house.object) })).filter(house => house.rings.length > 0);
  const boxes = shaped.map(house => boxOf(house.rings[0]!));
  const edgeRows = edges.map(edge => ({ key: edge.key, points: pointsOf(edge.object) })).filter(edge => edge.points.length >= 2)
    .map(edge => ({ ...edge, box: boxOf(edge.points) }));
  const add: MapObject[] = [], remove = new Set<string>(), kept = new Set<string>();
  let count = 0;
  for (const members of groups(boxes)) {
    if (only && !members.some(i => only.has(shaped[i]!.key))) continue;
    count += members.length;
    let union: Ring[];
    try {
      const [first, ...rest] = members.map(i => toPolygon(shaped[i]!.rings));
      union = fromMulti(rest.length ? polygonClipping.union(first!, ...rest) : [first!]);
    } catch {
      // En trasig ring (självkorsande yta) ger varje hus sin egen kant.
      union = members.flatMap(i => shaped[i]!.rings);
    }
    if (union.length === 0) continue;
    const box = boxOf(union.flat());
    const hugging = edgeRows.filter(edge => !kept.has(edge.key) && overlaps(edge.box, box, HUG_MM)
      && edge.points.every(point => ringDistance(point, union) <= HUG_MM));
    for (const ring of union) {
      const same = hugging.find(edge => !kept.has(edge.key) && edge.points.length >= ring.length
        && edge.points.every(point => ringDistance(point, [ring]) <= SAME_MM) && ring.every(point => ringDistance(point, [edge.points]) <= SAME_MM));
      if (same) { kept.add(same.key); continue; }
      const path: PathCommand[] = [...ring, ring[0]!].map((point, index) => ({ type: index === 0 ? "M" : "L", x: point.x, y: point.y }));
      add.push({ kind: "line", symbol: edgeSymbol, path });
    }
    for (const edge of hugging) if (!kept.has(edge.key)) remove.add(edge.key);
  }
  return { add, remove: [...remove], houses: count };
}
