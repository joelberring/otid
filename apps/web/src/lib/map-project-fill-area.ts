import { flattenPath, type MapObject, type MapSymbol, type Point } from "@o-tid/map-file";
import type { Box } from "@o-tid/map-revision";
import { FACE_GAP_M, faceAt, facesFromLines, type Face, type FaceLine } from "@o-tid/map-revision/faces";

/**
 * Ägaren 2026-11-13 («fylla ytor», sprintkartans ytor): verktyget Fyll yta. Kartans synliga linjer och ytkanter kring
 * klicket delar marken i slutna rutor (`@o-tid/map-revision/faces`); rutan under klicket blir en yta med den valda
 * symbolen, med byggnader och andra slutna öar som hål. Bara ett fönster kring klicket räknas, så att det går fort också i
 * en stor karta, och en ruta som når fönstrets kant räknas som inte sluten. Räknas i kartans Worker.
 */
export const FILL_GAP_M = FACE_GAP_M;
/** Fönstret kring klicket: så här långt åt varje håll (m i terrängen). */
export const FILL_WINDOW_M = 150;
/** Flest sträckor i fönstret; blir det fler halveras fönstret. */
const MAX_SEGMENTS = 40_000;
const FRAME = "#fönster";

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
}

export type FillResult =
  /** Ringarna i kartans mm (ytterkanten först, sedan hålen), ytan i terrängen och hur många glapp som slöts. */
  | { readonly status: "found"; readonly rings: Point[][]; readonly areaM2: number; readonly closed: number }
  /** Inte sluten: `gaps` är öppningarna som hittades (större än toleransen); tom = ytan fortsätter ut ur fönstret. */
  | { readonly status: "open"; readonly gaps: (readonly [Point, Point])[] };

/**
 * Är symbolens linjer och kanter gränser för en yta? Inte det som är släckt, och inte landformer (höjdkurvor, slänter),
 * tekniska symboler (nordlinjer, passmärken) eller banpåtryck: de korsar ytorna utan att avgränsa dem (mätningen på
 * Älvsjö–Solberga: slänt och höjdkurvor ska inte vara ytgränser).
 */
function isBoundary(symbol: MapSymbol | undefined, hidden: ReadonlySet<string>): boolean {
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

interface FillWindow { readonly box: Box; readonly faces: readonly Face[] }

/** Alla ytor i ett fönster kring `center` (halva sidan `half`, tolerans `tolerance`, allt i kartans mm). */
function fillWindow(input: FillInput, hidden: ReadonlySet<string>, center: Point, half: number, tolerance: number): FillWindow {
  for (let attempt = 0; ; attempt += 1) {
    const box = { minX: center.x - half, minY: center.y - half, maxX: center.x + half, maxY: center.y + half };
    const { lines, segments } = boundaryLines(input, hidden, box);
    if (segments > MAX_SEGMENTS && attempt < 3) { half /= 2; continue; }
    lines.push({ id: FRAME, closed: true, points: [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }] });
    return { box, faces: facesFromLines(lines, { gapTolerance: tolerance }).faces };
  }
}

/** Ytan under punkten om den är sluten (inte når fönstrets kant). */
function closedFaceAt(window: FillWindow, point: Point): Face | undefined {
  const face = faceAt(window.faces, point);
  return face && !face.sources.includes(FRAME) ? face : undefined;
}

/** Ringen utan punkter som ligger mitt på en rak sträcka (noderna där andra linjer ansluter). */
function withoutStraightPoints(ring: readonly Point[]): Point[] {
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
 * Sökaren i Workern. Fönstrets ytor sparas mellan frågorna, så att pekaren som rör sig över kartan (förhandsvisningen) bara
 * slår upp ytan under sig; de räknas om när kartan, de släckta lagren eller platsen har ändrats.
 */
export function fillFinder(): (input: FillInput, query: FillQuery) => FillResult {
  let cached: { objects: readonly MapObject[]; hiddenKey: string; center: Point; window: FillWindow } | undefined;
  return (input, query) => {
    const mmPerM = 1000 / input.scale, tolerance = FILL_GAP_M * mmPerM, half = FILL_WINDOW_M * mmPerM;
    const hidden = new Set(query.hidden), hiddenKey = [...hidden].sort().join(" ");
    const { point } = query;
    // Fönstret duger så länge punkten ligger i dess inre halva.
    const reach = cached ? (cached.window.box.maxX - cached.window.box.minX) / 4 : 0;
    if (!cached || cached.objects !== input.objects || cached.hiddenKey !== hiddenKey || Math.abs(point.x - cached.center.x) > reach
      || Math.abs(point.y - cached.center.y) > reach) {
      cached = { objects: input.objects, hiddenKey, center: point, window: fillWindow(input, hidden, point, half, tolerance) };
    }
    const face = closedFaceAt(cached.window, point);
    if (face) {
      return { status: "found", rings: [face.outer, ...face.holes].map(withoutStraightPoints), areaM2: face.area / (mmPerM * mmPerM), closed: face.closures.length };
    }
    if (!query.diagnose) return { status: "open", gaps: [] };
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
