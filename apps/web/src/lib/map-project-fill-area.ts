import { flattenPath, type MapObject, type MapSymbol, type Point } from "@o-tid/map-file";
import type { Box } from "@o-tid/map-revision";
import { FACE_GAP_M, faceAt, faceStages, rasterFill, withinBridgeShare, type BridgeKind, type Face, type FaceLine, type FaceStages, type FacesResult } from "@o-tid/map-revision/faces";

/**
 * Ägaren 2026-11-13 («fylla ytor», sprintkartans ytor): verktyget Fyll yta. Kartans synliga linjer och ytkanter kring
 * klicket delar marken i slutna rutor (`@o-tid/map-revision/faces`); rutan under klicket blir en yta med den valda
 * symbolen, med byggnader och andra slutna öar som hål. Bara ett fönster kring klicket räknas, så att det går fort också i
 * en stor karta, och en ruta som når fönstrets kant räknas som inte sluten. Räknas i kartans Worker.
 */
export const FILL_GAP_M = FACE_GAP_M;
/**
 * K8b V2 (magisk fyll): när rutan inte är sluten vid `FILL_GAP_M` prövas hörn som inte möts, rak förlängning och bryggor
 * mellan ändar upp till Glapp (förval 4 m, statusradens val 2/4/8/15 m); Alt+klick fyller bara exakt (`exact`).
 */
export const FILL_BRIDGE_M = 4;
/** Steg 2 får ta så här lång tid per fönster (ms) när pekaren hovrar; annars räknas rutan som inte sluten. Klicket får
 * försöka igen med längre tid (`FILL_BRIDGE_CLICK_MS`). */
export const FILL_BRIDGE_MS = 150;
const FILL_BRIDGE_CLICK_MS = 1000;
/**
 * K8b V4, reserven för röriga ställen: när varken grundtoleransen eller steg 2 ger en sluten ruta vid ett klick ritas
 * gränslinjerna som en bild (rutor på `FILL_ROUGH_CELL_M`) i ett fönster `FILL_ROUGH_WINDOW_M` åt varje håll, med tidsgräns
 * (`@o-tid/map-revision/faces`, `rasterFill`). Resultatet är ungefärligt och visas först (`approx`).
 */
const FILL_ROUGH_CELL_M = 0.2;
const FILL_ROUGH_WINDOW_M = 75;
const FILL_ROUGH_SNAP_M = 0.3;
const FILL_ROUGH_SIMPLIFY_M = 0.1;
const FILL_ROUGH_MS = 200;
/** Fönstret kring klicket: så här långt åt varje håll (m i terrängen). */
export const FILL_WINDOW_M = 150;
/** Flest sträckor i fönstret; blir det fler halveras fönstret. */
const MAX_SEGMENTS = 40_000;
/** Fönstrets ram som gränslinje: en ruta som har den i sin gräns når fönstrets kant och är inte sluten. */
export const FILL_FRAME = "#fönster";

export interface FillInput {
  readonly objects: readonly MapObject[]; readonly boxes: readonly Box[]; readonly symbols: ReadonlyMap<string, MapSymbol>;
  /** Kartans skala (1:scale). */
  readonly scale: number;
}

export interface FillQuery {
  readonly point: Point;
  /** Släckta symboler: de är inga gränser. */
  readonly hidden: readonly string[];
  /** Klicket (inte pekaren som bara hovrar): leta också upp öppningen när ytan inte är sluten. */
  readonly diagnose: boolean;
  /** Glapp (m i terrängen) för steg 2; förval `FILL_BRIDGE_M`. Högst grundtoleransen = bara exakt. */
  readonly gapM?: number | undefined;
  /** Bara exakt (Alt+klick): grundtoleransen, inga bryggor. */
  readonly exact?: boolean | undefined;
}

/** Ett glapp som slöts utöver grundtoleransen: ett hörn (två bitar), en förlängning eller en brygga, i kartans mm. */
export interface FillBridge { readonly kind: BridgeKind; readonly pieces: (readonly [Point, Point])[]; readonly lengthsM: number[] }

export type FillResult =
  /** Ringarna i kartans mm (ytterkanten först, sedan hålen), ytan i terrängen och hur många glapp som slöts. */
  | { readonly status: "found"; readonly rings: Point[][]; readonly areaM2: number; readonly closed: number; readonly bridges: FillBridge[];
      /** Reserven (bilden) gav ytan: ungefärlig, visas först. */
      readonly approx?: boolean | undefined;
      /** Rutan täcks redan helt av en yta på kartan (översta; nummer i `input.objects` och dess symbol). */
      readonly covered?: { readonly index: number; readonly symbol: string } | undefined }
  /** Inte sluten: `gaps` är öppningarna som hittades (större än toleransen); tom = ytan fortsätter ut ur fönstret. */
  | { readonly status: "open"; readonly gaps: (readonly [Point, Point])[] };

/**
 * Är symbolens linjer och kanter gränser för en yta? Inte det som är släckt, och inte landformer (höjdkurvor, slänter),
 * tekniska symboler (nordlinjer, passmärken) eller banpåtryck: de korsar ytorna utan att avgränsa dem (mätningen på
 * Älvsjö–Solberga: slänt och höjdkurvor ska inte vara ytgränser).
 */
export function isBoundary(symbol: MapSymbol | undefined, hidden: ReadonlySet<string>): boolean {
  if (!symbol || symbol.hidden || hidden.has(symbol.id)) return false;
  const main = symbol.code.main;
  return !(main >= 100 && main < 200) && !(main >= 600 && main < 800);
}

/** Sträckan a–b klippt mot rutan (Liang–Barsky), eller undefined utanför. */
function clip(a: Point, b: Point, box: Box): [Point, Point] | undefined {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.minX], [dx, box.maxX - a.x], [-dy, a.y - box.minY], [dy, box.maxY - a.y]] as const) {
    if (p === 0) { if (q < 0) return undefined; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return undefined; if (t > t0) t0 = t; }
    else { if (t < t0) return undefined; if (t < t1) t1 = t; }
  }
  return [t0 === 0 ? a : { x: a.x + t0 * dx, y: a.y + t0 * dy }, t1 === 1 ? b : { x: a.x + t1 * dx, y: a.y + t1 * dy }];
}

/** Gränslinjerna i fönstret: linjeobjekten och ytornas ringar, klippta mot fönstret, och antalet sträckor. */
function boundaryLines(input: FillInput, hidden: ReadonlySet<string>, box: Box): { lines: FaceLine[]; segments: number } {
  const lines: FaceLine[] = [];
  let segments = 0;
  input.objects.forEach((object, index) => {
    if (object.kind !== "line" && object.kind !== "area") return;
    const bounds = input.boxes[index];
    if (bounds && (bounds.maxX < box.minX || bounds.minX > box.maxX || bounds.maxY < box.minY || bounds.minY > box.maxY)) return;
    if (!isBoundary(input.symbols.get(object.symbol), hidden)) return;
    for (const path of object.kind === "line" ? [object.path] : object.rings) for (const polyline of flattenPath(path)) {
      const first = polyline[0], last = polyline[polyline.length - 1];
      // En ytas ring sluts även när filen inte upprepar första punkten.
      const points = object.kind === "area" && first && last && (first.x !== last.x || first.y !== last.y) ? [...polyline, first] : polyline;
      let run: Point[] | undefined;
      for (let at = 1; at < points.length; at += 1) {
        const piece = clip(points[at - 1]!, points[at]!, box);
        if (!piece) { run = undefined; continue; }
        segments += 1;
        if (run && run[run.length - 1] === piece[0]) run.push(piece[1]);
        else { run = [piece[0], piece[1]]; lines.push({ id: String(index), points: run }); }
        if (piece[1] !== points[at]) run = undefined;
      }
    }
  });
  return { lines, segments };
}

interface FillWindow { readonly box: Box; readonly faces: readonly Face[]; readonly stages: FaceStages }

/**
 * Alla ytor i en ruta (kartans mm): gränslinjerna klippta mot rutan, med rutans ram som egen gränslinje (`FILL_FRAME`).
 * Källorna (`Face.sources`) är objektens nummer i `input.objects`. Undefined när rutan har fler sträckor än `maxSegments`.
 */
export function fillFaces(input: FillInput, hidden: ReadonlySet<string>, box: Box, tolerance: number, maxSegments = Infinity): Face[] | undefined {
  return fillStages(input, hidden, box, tolerance, maxSegments)?.faces;
}

/** Som `fillFaces`, med steg 2 på samma graf på begäran. */
function fillStages(input: FillInput, hidden: ReadonlySet<string>, box: Box, tolerance: number, maxSegments: number): FaceStages | undefined {
  const { lines, segments } = boundaryLines(input, hidden, box);
  if (segments > maxSegments) return undefined;
  lines.push({ id: FILL_FRAME, closed: true, points: [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }] });
  return faceStages(lines, { gapTolerance: tolerance });
}

/** Alla ytor i ett fönster kring `center` (halva sidan `half`, tolerans `tolerance`, allt i kartans mm). */
function fillWindow(input: FillInput, hidden: ReadonlySet<string>, center: Point, half: number, tolerance: number): FillWindow {
  for (let attempt = 0; ; attempt += 1) {
    const box = { minX: center.x - half, minY: center.y - half, maxX: center.x + half, maxY: center.y + half };
    const stages = fillStages(input, hidden, box, tolerance, attempt < 3 ? MAX_SEGMENTS : Infinity);
    if (stages) return { box, faces: stages.faces, stages };
    half /= 2;
  }
}

/** Ytan under punkten om den är sluten (inte når fönstrets kant). */
function closedFaceAt(window: { readonly faces: readonly Face[] }, point: Point): Face | undefined {
  const face = faceAt(window.faces, point);
  return face && !face.sources.includes(FILL_FRAME) ? face : undefined;
}

/** Den översta ytan på kartan (synlig, en gräns) som punkten ligger i; rutorna följer ytornas kanter, så den täcker hela rutan. */
function coveringArea(input: FillInput, hidden: ReadonlySet<string>, point: Point): { index: number; symbol: string } | undefined {
  for (let index = input.objects.length - 1; index >= 0; index -= 1) {
    const object = input.objects[index]!, box = input.boxes[index];
    if (object.kind !== "area" || (box && (point.x < box.minX || point.x > box.maxX || point.y < box.minY || point.y > box.maxY))) continue;
    if (!isBoundary(input.symbols.get(object.symbol), hidden)) continue;
    let inside = false;
    for (const path of object.rings) for (const ring of flattenPath(path)) {
      for (let at = 0, previous = ring.length - 1; at < ring.length; previous = at, at += 1) {
        const a = ring[at]!, b = ring[previous]!;
        if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
    }
    if (inside) return { index, symbol: object.symbol };
  }
  return undefined;
}

/** Reserven: ytan ur en bild av gränslinjerna kring punkten (halva Glapp som radie), eller undefined (öppen eller för långsam). */
function roughFill(input: FillInput, hidden: ReadonlySet<string>, point: Point, gapM: number): { rings: Point[][]; areaM2: number } | undefined {
  const mmPerM = 1000 / input.scale, half = FILL_ROUGH_WINDOW_M * mmPerM;
  const box = { minX: point.x - half, minY: point.y - half, maxX: point.x + half, maxY: point.y + half };
  const result = rasterFill(boundaryLines(input, hidden, box).lines, point, { box, cell: FILL_ROUGH_CELL_M * mmPerM, radius: gapM / 2 * mmPerM,
    snap: FILL_ROUGH_SNAP_M * mmPerM, simplify: FILL_ROUGH_SIMPLIFY_M * mmPerM, deadline: performance.now() + FILL_ROUGH_MS });
  return result.status === "found" ? { rings: [result.outer, ...result.holes], areaM2: result.area / (mmPerM * mmPerM) } : undefined;
}

/** Ringen utan punkter som ligger mitt på en rak sträcka (noderna där andra linjer ansluter). */
export function withoutStraightPoints(ring: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const a = out[out.length - 1] ?? ring[ring.length - 1]!, b = ring[index]!, c = ring[(index + 1) % ring.length]!;
    const length = Math.hypot(c.x - a.x, c.y - a.y);
    const off = length === 0 ? 0 : Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / length;
    const between = (b.x - a.x) * (c.x - a.x) + (b.y - a.y) * (c.y - a.y) >= 0 && (b.x - c.x) * (a.x - c.x) + (b.y - c.y) * (a.y - c.y) >= 0;
    if (length > 0 && off < 1e-6 && between) continue;
    out.push({ x: b.x, y: b.y });
  }
  return out.length >= 3 ? out : ring.map(point => ({ x: point.x, y: point.y }));
}

/**
 * Sökaren i Workern. Fönstrets graf och ytor sparas mellan frågorna, så att pekaren som rör sig över kartan
 * (förhandsvisningen) bara slår upp ytan under sig; de räknas om när kartan, de släckta lagren eller platsen har ändrats.
 * Steg 2 (större glapp) räknas bara när rutan under punkten inte är sluten, en gång per fönster och glapp, med tidsgräns.
 */
export function fillFinder(): (input: FillInput, query: FillQuery) => FillResult {
  let cached: { objects: readonly MapObject[]; hiddenKey: string; center: Point; window: FillWindow; bridged: Map<number, FacesResult | null> } | undefined;
  return (input, query) => {
    const mmPerM = 1000 / input.scale, tolerance = FILL_GAP_M * mmPerM, half = FILL_WINDOW_M * mmPerM;
    const hidden = new Set(query.hidden), hiddenKey = [...hidden].sort().join(" ");
    const { point } = query;
    // Fönstret duger så länge punkten ligger i dess inre halva.
    const reach = cached ? (cached.window.box.maxX - cached.window.box.minX) / 4 : 0;
    if (!cached || cached.objects !== input.objects || cached.hiddenKey !== hiddenKey || Math.abs(point.x - cached.center.x) > reach
      || Math.abs(point.y - cached.center.y) > reach) {
      cached = { objects: input.objects, hiddenKey, center: point, window: fillWindow(input, hidden, point, half, tolerance), bridged: new Map() };
    }
    const covered = coveringArea(input, hidden, point);
    const found = (face: Face, bridges: FillBridge[]): FillResult => ({ status: "found", rings: [face.outer, ...face.holes].map(withoutStraightPoints),
      areaM2: face.area / (mmPerM * mmPerM), closed: face.closures.length, bridges, covered });
    const face = closedFaceAt(cached.window, point);
    if (face) return found(face, []);
    const gapM = query.exact ? FILL_GAP_M : query.gapM ?? FILL_BRIDGE_M;
    if (gapM > FILL_GAP_M) {
      let wider = cached.bridged.get(gapM);
      if (wider === undefined || (wider === null && query.diagnose)) {
        wider = cached.window.stages.bridged(gapM * mmPerM, performance.now() + (query.diagnose ? FILL_BRIDGE_CLICK_MS : FILL_BRIDGE_MS)) ?? null;
        cached.bridged.set(gapM, wider);
      }
      const bridged = wider && closedFaceAt(wider, point);
      if (wider && bridged && withinBridgeShare(bridged)) {
        return found(bridged, bridged.bridges.map(index => {
          const { kind, pieces } = wider.bridges[index]!;
          return { kind, pieces: pieces.map(piece => [piece.a, piece.b] as const), lengthsM: pieces.map(piece => piece.length / mmPerM) };
        }));
      }
    }
    if (!query.diagnose) return { status: "open", gaps: [] };
    const rough = query.exact ? undefined : roughFill(input, hidden, point, gapM);
    if (rough) return { status: "found", rings: rough.rings, areaM2: rough.areaM2, closed: 0, bridges: [], approx: true, covered };
    // Var är öppningen? Pröva med större tolerans: blir ytan sluten då är de långa slutningsbitarna öppningarna.
    for (const factor of [4, 16]) {
      const wider = closedFaceAt(fillWindow(input, hidden, point, half, tolerance * factor), point);
      if (!wider) continue;
      const long = wider.closures.filter(closure => closure.length > tolerance);
      return { status: "open", gaps: (long.length ? long : wider.closures).map(closure => [closure.a, closure.b] as const) };
    }
    return { status: "open", gaps: [] };
  };
}

/** Ytobjektet för ringarna (varje ring sluten med första punkten upprepad, som ritverktygen gör). */
export function fillObject(symbol: string, rings: readonly (readonly Point[])[]): MapObject {
  return { kind: "area", symbol, angle: 0,
    rings: rings.map(ring => [...ring, ring[0]!].map((point, index) => ({ type: index === 0 ? "M" as const : "L" as const, x: point.x, y: point.y }))) };
}
