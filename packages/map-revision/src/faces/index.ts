import { bridgeGaps, type BridgeKind } from "./bridge-gaps";
import { closeGaps } from "./close-gaps";
import { nodeSegments, type Graph, type Segment } from "./node";
import { polygonize, type Cycle } from "./polygonize";

/**
 * Ytor ur linjer (sprintkartans ytor, ägaren 2026-11-13: «ytor är särskilt svårt»). Linjer och ytors ringar i ett plant
 * koordinatsystem delar marken i slutna rutor: linjerna nodas (`node.ts`), små glapp sluts (`close-gaps.ts`) och den plana
 * grafen blir ytor med hål (`polygonize.ts`). Ren TypeScript utan I/O och utan beroenden. Metoden är mätt mot en riktig
 * sprintkarta (Älvsjö–Solberga): linjerna sluter sig inte helt själva, så kartritaren får rätta kanter och färdiga rutor
 * att fylla, och avgör själv vad varje ruta är.
 */
export interface FacePoint { readonly x: number; readonly y: number }

/** En gränslinje: en polylinje, eller en sluten ring (`closed`). `id` följer med till ytorna som den begränsar. */
export interface FaceLine { readonly id: string; readonly points: readonly FacePoint[]; readonly closed?: boolean | undefined }

export interface FacesOptions {
  /** Största glapp som sluts, i linjernas enhet (0 = inga glapp sluts). */
  readonly gapTolerance: number;
  /** Punkter närmare varandra än så är samma punkt. Förval 0,001 (1 mm i meter, 1 µm i kartans mm). */
  readonly snap?: number | undefined;
}

/** En slutningsbit i en ytas gräns: glappet som slöts. */
export interface FaceClosure { readonly a: FacePoint; readonly b: FacePoint; readonly length: number }

export type { BridgeKind } from "./bridge-gaps";
/** Ett glapp som slöts i steg 2 (`bridge-gaps.ts`): ett hörn (två bitar), en förlängning eller en brygga (en bit). */
export interface FaceBridge { readonly kind: BridgeKind; readonly pieces: FaceClosure[] }

/** Steg 2: bryggorna i en ytas gräns får vara högst så stor del av omkretsen, annars räknas ytan som inte sluten. */
export const BRIDGE_SHARE = 0.2;

/** Är ytans bryggor rimliga (högst `BRIDGE_SHARE` av omkretsen)? Bättre «inte sluten» än att ytan rinner ut i nästa kvarter. */
export function withinBridgeShare(face: Face): boolean {
  return face.bridgeLength <= BRIDGE_SHARE * face.perimeter;
}

export interface Face {
  /** Ytterkanten moturs, utan upprepad första punkt. */
  readonly outer: FacePoint[];
  /** Hålen (öar inuti ytan), medurs. */
  readonly holes: FacePoint[][];
  /** Ytan utan hålen. */
  readonly area: number;
  /** Källinjerna (`id`) som bildar gränsen. */
  readonly sources: string[];
  /** Hur lång bit av gränsen (ytterkant och hål) varje källa i `sources` bildar. En sträcka med flera källor räknas till alla. */
  readonly lengths: number[];
  /** Hela gränsens längd (ytterkant och hål), slutna glapp medräknade. */
  readonly perimeter: number;
  /** Glappen som slöts vid grundtoleransen för att ytan skulle bli sluten (steg 2:s bryggor står i `bridges`). */
  readonly closures: FaceClosure[];
  /** Steg 2: bryggorna (nummer i `FacesResult.bridges`) som gränsen går längs, och hur lång bit av gränsen de bildar. */
  readonly bridges: number[];
  readonly bridgeLength: number;
}

export interface FacesResult {
  readonly faces: Face[];
  /** Lösa ändar före glappslutningen, och hur många av dem som slöts. */
  readonly looseEnds: number;
  readonly closedEnds: number;
  /** Steg 2: alla bryggor som slöts (tom vid grundtoleransen). */
  readonly bridges: FaceBridge[];
}

/** Ytorna vid grundtoleransen, och steg 2 med större glapp på samma graf (räknas en gång per glapp och sparas). */
export interface FaceStages extends FacesResult {
  /** Ytorna med steg 2 upp till `tolerance`, eller undefined när `deadline` (performance.now()) passerades. */
  bridged(tolerance: number, deadline?: number): FacesResult | undefined;
}

/** Förvald glapptolerans i terrängen (m): över hälften av glappen sluts vid 0,25 m, och över 2 m börjar fel saker slutas. */
export const FACE_GAP_M = 2;

function segmentsOf(lines: readonly FaceLine[]): Segment[] {
  const out: Segment[] = [];
  lines.forEach((line, index) => {
    const sources = [index], points = line.points;
    for (let at = 1; at < points.length; at += 1) {
      out.push({ ax: points[at - 1]!.x, ay: points[at - 1]!.y, bx: points[at]!.x, by: points[at]!.y, sources, closure: false });
    }
    if (line.closed && points.length > 2) {
      out.push({ ax: points[points.length - 1]!.x, ay: points[points.length - 1]!.y, bx: points[0]!.x, by: points[0]!.y, sources, closure: false });
    }
  });
  return out;
}

/** Grafen igen med nya sträckor (de kan korsa varandra och andra linjer); kanternas slutningar och bryggor följer med. */
function renode(graph: Graph, extra: readonly Segment[], snap: number): Graph {
  const { xs, ys } = graph;
  return nodeSegments([...graph.edges.map((edge): Segment => ({ ax: xs[edge.u]!, ay: ys[edge.u]!, bx: xs[edge.v]!, by: ys[edge.v]!,
    sources: edge.sources, closure: edge.closure, bridge: edge.bridge })), ...extra], snap);
}

function facesOf(graph: Graph, lines: readonly FaceLine[]): Face[] {
  const { xs, ys, edges } = graph;
  const ring = (cycle: Cycle): FacePoint[] => cycle.nodes.map(node => ({ x: xs[node]!, y: ys[node]! }));
  return polygonize(graph).map(({ outer, holes }): Face => {
    const sources = new Map<number, number>(), closures: FaceClosure[] = [], bridges = new Set<number>();
    let perimeter = 0, bridgeLength = 0;
    for (const cycle of [outer, ...holes]) for (const index of cycle.edges) {
      const edge = edges[index]!;
      const length = Math.hypot(xs[edge.v]! - xs[edge.u]!, ys[edge.v]! - ys[edge.u]!);
      perimeter += length;
      for (const source of edge.sources) sources.set(source, (sources.get(source) ?? 0) + length);
      if (edge.bridge !== undefined) { bridges.add(edge.bridge); bridgeLength += length; }
      else if (edge.closure) closures.push({ a: { x: xs[edge.u]!, y: ys[edge.u]! }, b: { x: xs[edge.v]!, y: ys[edge.v]! }, length });
    }
    const order = [...sources.keys()].sort((a, b) => a - b);
    return { outer: ring(outer), holes: holes.map(ring), area: outer.area + holes.reduce((sum, hole) => sum + hole.area, 0),
      sources: order.map(source => lines[source]!.id), lengths: order.map(source => sources.get(source)!), perimeter, closures,
      bridges: [...bridges].sort((a, b) => a - b), bridgeLength };
  });
}

/**
 * Ytorna i steg: först grundtoleransen (`gapTolerance`), och på begäran steg 2 (`bridged`) på samma nodade graf, så att den
 * som frågar om många punkter (Fyll yta i ritläget) bara räknar steg 2 när en ruta inte blev sluten.
 */
export function faceStages(lines: readonly FaceLine[], options: FacesOptions): FaceStages {
  const snap = options.snap ?? 0.001;
  let graph: Graph = nodeSegments(segmentsOf(lines), snap);
  const gaps = closeGaps(graph, options.gapTolerance, snap);
  if (gaps.closures.length) graph = renode(graph, gaps.closures, snap);
  const first: FacesResult = { faces: facesOf(graph, lines), looseEnds: gaps.looseEnds, closedEnds: gaps.closures.length, bridges: [] };
  const known = new Map<number, FacesResult>();
  return {
    ...first,
    bridged(tolerance, deadline = Infinity) {
      if (tolerance <= options.gapTolerance) return first;
      const cached = known.get(tolerance);
      if (cached) return cached;
      const bridges = bridgeGaps(graph, tolerance, snap, deadline);
      if (!bridges) return undefined;
      let result = first;
      if (bridges.length) {
        const wider = renode(graph, bridges.flatMap(bridge => bridge.pieces), snap);
        if (performance.now() > deadline) return undefined;
        result = { ...first, faces: facesOf(wider, lines), bridges: bridges.map(bridge => ({ kind: bridge.kind, pieces: bridge.pieces.map(piece => ({
          a: { x: piece.ax, y: piece.ay }, b: { x: piece.bx, y: piece.by }, length: Math.hypot(piece.bx - piece.ax, piece.by - piece.ay) })) })) };
      }
      known.set(tolerance, result);
      return result;
    }
  };
}

/** Alla slutna ytor som linjerna bildar. Den obegränsade ytan utanför tas inte med, och hängande linjer ger ingen gräns. */
export function facesFromLines(lines: readonly FaceLine[], options: FacesOptions): FacesResult {
  const { faces, looseEnds, closedEnds, bridges } = faceStages(lines, options);
  return { faces, looseEnds, closedEnds, bridges };
}

interface FaceBox { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
interface FaceBoxes { readonly outer: FaceBox; readonly holes: readonly FaceBox[] }
const faceBoxCache = new WeakMap<Face, FaceBoxes>();

function ringBox(ring: readonly FacePoint[]): FaceBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of ring) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, minY, maxX, maxY };
}

function boxesOf(face: Face): FaceBoxes {
  let cached = faceBoxCache.get(face);
  if (!cached) {
    cached = { outer: ringBox(face.outer), holes: face.holes.map(ringBox) };
    faceBoxCache.set(face, cached);
  }
  return cached;
}

const inBox = (box: FaceBox, point: FacePoint) =>
  point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;

function inRing(ring: readonly FacePoint[], point: FacePoint): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index]!, b = ring[previous]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Ytan som punkten ligger i (inte i ett hål), eller undefined utanför alla ytor. */
export function faceAt(faces: readonly Face[], point: FacePoint): Face | undefined {
  for (const face of faces) {
    const boxes = boxesOf(face);
    if (!inBox(boxes.outer, point) || !inRing(face.outer, point)) continue;
    let inHole = false;
    for (let index = 0; index < face.holes.length; index += 1) {
      if (inBox(boxes.holes[index]!, point) && inRing(face.holes[index]!, point)) { inHole = true; break; }
    }
    if (!inHole) return face;
  }
  return undefined;
}

export { mergeFaceRings } from "./merge-faces";
export { rasterFill, type RasterFillOptions, type RasterFillResult } from "./raster-fill";
