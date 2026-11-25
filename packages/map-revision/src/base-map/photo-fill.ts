import { flattenPath, type MapObject, type MapSymbol, type Point } from "@o-tid/map-file";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import { areaMinimum, isGroundArea, type Box, type MapNorm } from "../index";
import { faceStages, FACE_GAP_M, type FaceLine } from "../faces";
import { BUILT_MAINS, maskBuilt } from "./built-mask";

/**
 * Fyll ytor ur flygbilden (ägaren 2026-11-23), rutorna och inläggningen. Rutorna räknas som Fyll över (K8b V7): kartans synliga
 * linjer och hårda ytor är gränser (markytorna 401–416, 501, 520 … är det inte), glapp upp till `FACE_GAP_M` sluts, och landformer
 * (1xx) och tekniska symboler (6xx–7xx) korsar rutorna utan att avgränsa dem. Varje ruta får ett läge: ofylld, täckt av
 * grundkartans markytor, eller under en hård yta (hus, vatten – räknas inte). Inläggningen klipper bort de nya ytornas område ur
 * alla synliga markytor på en gång (ett objekt under flera rutor klipps en gång) och rensar under hårdgjord yta som Fyll yta.
 * Ren TypeScript utan I/O: kartans Worker och kartjobbet `PHOTO_CELLS` (AI-kopplingens `classify_cells`).
 */
export interface PhotoFillMap {
  readonly objects: readonly MapObject[]; readonly boxes: readonly Box[]; readonly symbols: ReadonlyMap<string, MapSymbol>;
  readonly scale: number; readonly norm: MapNorm;
}

export interface PhotoFillCell {
  /** Rutans id: interiörpunkten i hundradels mm (samma karta och område ger samma id). */
  readonly id: string;
  /** Ytterkanten och hålen i kartans mm. */
  readonly rings: Point[][];
  readonly at: Point; readonly areaM2: number;
  /** Ofylld, eller täckt av markytor (koderna). */
  readonly state: "empty" | "ground"; readonly groundCodes: readonly string[];
}

export interface PhotoFillOptions {
  readonly hidden?: ReadonlySet<string> | undefined;
  /** Rutor som redan täcks av grundkartans markytor kommer också med. */
  readonly includeGround?: boolean | undefined;
  /** Bara rutor vars interiörpunkt ligger i den här rutan (etapperna); förval hela `box`. */
  readonly core?: Box | undefined;
  /** Projektets kartområde (ringar i kartans mm). */
  readonly area?: readonly (readonly Point[])[] | undefined;
}

/** Mindre rutor än så (m²) är glipor mellan linjer som nästan ligger på varandra. */
const MIN_CELL_M2 = 1;
const FRAME = "#ram";

const visible = (symbol: MapSymbol | undefined, hidden: ReadonlySet<string> | undefined) => !!symbol && !symbol.hidden && !hidden?.has(symbol.id);
/** Avgränsar symbolen rutor? Inte landformer och tekniska symboler. */
const separates = (symbol: MapSymbol) => { const main = symbol.code.main; return !(main >= 100 && main < 200) && !(main >= 600 && main < 800); };

function clip(a: Point, b: Point, box: Box): [Point, Point] | undefined {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.minX], [dx, box.maxX - a.x], [-dy, a.y - box.minY], [dy, box.maxY - a.y]] as const) {
    if (p === 0) { if (q < 0) return undefined; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return undefined; if (t > t0) t0 = t; } else { if (t < t0) return undefined; if (t < t1) t1 = t; }
  }
  return [{ x: a.x + t0 * dx, y: a.y + t0 * dy }, { x: a.x + t1 * dx, y: a.y + t1 * dy }];
}
const overlaps = (a: Box, b: Box) => a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;

function insideRings(rings: readonly (readonly Point[])[], p: Point): boolean {
  let inside = false;
  for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Punkter inuti ringarna: mitten av de bredaste bitarna längs några vågräta linjer (den första är interiörpunkten). */
function cellSamplePoints(rings: readonly (readonly Point[])[], lines = 5): Point[] {
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  let minY = Infinity, maxY = -Infinity;
  for (const point of outer) { minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  const out: { at: Point; width: number }[] = [];
  for (let k = 0; k < lines; k += 1) {
    const y = minY + (maxY - minY) * (k + 0.5) / lines + (maxY - minY) * 1e-7;
    const xs: number[] = [];
    for (const ring of rings) for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const width = xs[i + 1]! - xs[i]!;
      if (width > 0) for (const f of [0.25, 0.5, 0.75]) out.push({ at: { x: xs[i]! + width * f, y }, width: f === 0.5 ? width : width / 2 });
    }
  }
  out.sort((a, b) => b.width - a.width);
  return out.map(item => item.at);
}

/** Rutorna i `box` (kartans mm). Undefined när rutan har fler sträckor än `maxSegments`. */
export function photoFillCells(map: PhotoFillMap, box: Box, options: PhotoFillOptions = {}, maxSegments = 120_000): PhotoFillCell[] | undefined {
  const mmPerM = 1000 / map.scale, hidden = options.hidden;
  const lines: FaceLine[] = [];
  const hard: { box: Box; rings: Point[][] }[] = [], ground: { box: Box; rings: Point[][]; code: string }[] = [];
  let segments = 0;
  for (let index = 0; index < map.objects.length; index += 1) {
    const object = map.objects[index]!;
    if (object.kind !== "line" && object.kind !== "area") continue;
    const bounds = map.boxes[index];
    if (bounds && !overlaps(bounds, box)) continue;
    const symbol = map.symbols.get(object.symbol);
    if (!symbol || !visible(symbol, hidden) || !separates(symbol)) continue;
    if (object.kind === "area") {
      const rings = object.rings.flatMap(path => flattenPath(path));
      if (isGroundArea(symbol.code.main, map.norm)) { ground.push({ box: bounds ?? box, rings, code: symbol.code.text }); continue; }
      hard.push({ box: bounds ?? box, rings });
    }
    for (const polyline of object.kind === "line" ? flattenPath(object.path) : object.rings.flatMap(path => flattenPath(path))) {
      const first = polyline[0], last = polyline[polyline.length - 1];
      const points = object.kind === "area" && first && last && (first.x !== last.x || first.y !== last.y) ? [...polyline, first] : polyline;
      let run: Point[] | undefined;
      for (let at = 1; at < points.length; at += 1) {
        const piece = clip(points[at - 1]!, points[at]!, box);
        if (!piece) { run = undefined; continue; }
        segments += 1;
        if (segments > maxSegments) return undefined;
        const last = run?.[run.length - 1];
        if (run && last && last.x === piece[0].x && last.y === piece[0].y) run.push(piece[1]);
        else { run = [piece[0], piece[1]]; lines.push({ id: String(index), points: run }); }
      }
    }
  }
  lines.push({ id: FRAME, closed: true, points: [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }] });
  const faces = faceStages(lines, { gapTolerance: FACE_GAP_M * mmPerM }).faces;
  const core = options.core ?? box, cells: PhotoFillCell[] = [];
  const coveredBy = <T extends { box: Box; rings: Point[][] }>(list: readonly T[], p: Point) =>
    list.find(item => p.x >= item.box.minX && p.x <= item.box.maxX && p.y >= item.box.minY && p.y <= item.box.maxY && insideRings(item.rings, p));
  for (const face of faces) {
    if (face.sources.includes(FRAME)) continue;
    const areaM2 = face.area / (mmPerM * mmPerM);
    if (areaM2 < MIN_CELL_M2) continue;
    const rings = [face.outer, ...face.holes].map(ring => ring.map(point => ({ x: point.x, y: point.y })));
    const samples = cellSamplePoints(rings).slice(0, 15), at = samples[0];
    if (!at || at.x < core.minX || at.x >= core.maxX || at.y < core.minY || at.y >= core.maxY) continue;
    if (options.area?.length && !insideRings(options.area, at)) continue;
    let hardCount = 0, groundCount = 0;
    const codes = new Set<string>();
    for (const sample of samples) {
      if (coveredBy(hard, sample)) { hardCount += 1; continue; }
      const found = coveredBy(ground, sample);
      if (found) { groundCount += 1; codes.add(found.code); }
    }
    if (hardCount * 2 > samples.length) continue;
    const state = groundCount * 2 >= samples.length ? "ground" : "empty";
    if (state === "ground" && !options.includeGround) continue;
    cells.push({ id: `${Math.round(at.x * 100)}:${Math.round(at.y * 100)}`, rings, at, areaM2, state, groundCodes: [...codes].sort() });
  }
  cells.sort((a, b) => b.at.y - a.at.y || a.at.x - b.at.x);
  return cells;
}

type Area = Extract<MapObject, { kind: "area" }>;
const polygonOf = (rings: readonly (readonly Point[])[]): Polygon => rings.map(ring => {
  const points = ring.map(point => [point.x, point.y] as [number, number]);
  const first = points[0], last = points[points.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) points.push([first[0], first[1]]);
  return points;
}).filter(ring => ring.length >= 4);
const ringArea = (ring: readonly (readonly [number, number])[]) => Math.abs(ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length]!;
  return sum + x * ny - nx * y;
}, 0)) / 2;
const pieceArea = (piece: Polygon) => Math.max(0, ringArea(piece[0] ?? []) - piece.slice(1).reduce((sum, hole) => sum + ringArea(hole), 0));
const boxOfPolygon = (polygon: Polygon): Box => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of polygon) for (const [x, y] of ring) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
};

/** En ny yta med symbolen (varje ring sluten med första punkten upprepad, som ritverktygen gör). */
export function photoFillArea(symbol: string, rings: readonly (readonly Point[])[]): Area {
  return { kind: "area", symbol, angle: 0,
    rings: rings.map(ring => [...ring, ring[0]!].map((point, index) => ({ type: index === 0 ? "M" as const : "L" as const, x: point.x, y: point.y }))) };
}

/** Ett befintligt objekt som ändras: numret i `map.objects` och det som blir kvar (tomt = tas bort). */
export interface PhotoFillCut { readonly index: number; readonly objects: MapObject[] }

/**
 * Det som ändras i kartan när rutorna läggs in: varje synlig markyta som rutorna överlappar klipps mot alla dem på en gång
 * (restbitar under normens minsta yta eller 1 m² bort), och under hårdgjord yta och tomtmark rensas markens detaljer
 * (`maskBuilt`, som Fyll yta). Ett objekt kommer med högst en gång.
 */
export function photoFillCuts(map: PhotoFillMap, cells: readonly { readonly rings: readonly (readonly Point[])[]; readonly symbol: string }[],
  hidden?: ReadonlySet<string>): PhotoFillCut[] {
  const mm2PerM2 = (1000 / map.scale) ** 2;
  const entries = cells.flatMap(cell => {
    const polygon = polygonOf(cell.rings);
    return polygon.length > 0 ? [{ cell, polygon }] : [];
  });
  const polygons = entries.map(entry => entry.polygon);
  const boxes = polygons.map(boxOfPolygon);
  const built = entries.flatMap(({ cell, polygon }) => BUILT_MAINS.has(map.symbols.get(cell.symbol)?.code.main ?? 0) ? [polygon] : []);
  const builtBoxes = built.map(boxOfPolygon);
  const cuts: PhotoFillCut[] = [];
  const mainOf = (id: string) => map.symbols.get(id)?.code.main;
  map.objects.forEach((object, index) => {
    const bounds = map.boxes[index];
    if (!bounds) return;
    const symbol = map.symbols.get(object.symbol);
    if (!symbol || !visible(symbol, hidden)) return;
    if (object.kind === "area" && isGroundArea(symbol.code.main, map.norm)) {
      const near = polygons.filter((_, i) => overlaps(boxes[i]!, bounds));
      if (near.length === 0) return;
      const own = polygonOf(object.rings.flatMap(path => flattenPath(path)));
      if (own.length === 0) return;
      let overlap: MultiPolygon, rest: MultiPolygon;
      try { overlap = polygonClipping.intersection(own, polygonClipping.union(near[0]!, ...near.slice(1))); } catch { return; }
      if (overlap.reduce((sum, piece) => sum + pieceArea(piece), 0) <= 0.1 * mm2PerM2) return;
      try { rest = polygonClipping.difference(own, ...near); } catch { return; }
      const minimum = Math.max(areaMinimum(symbol.code.text, map.scale) ?? 0, mm2PerM2);
      cuts.push({ index, objects: rest.filter(piece => piece[0] && pieceArea(piece) >= minimum).map(piece => ({ ...object, source: undefined,
        rings: piece.map(ring => ring.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y }))) })) });
      return;
    }
    if (built.length === 0 || !built.some((_, i) => overlaps(builtBoxes[i]!, bounds))) return;
    const kept = maskBuilt([object], built, mainOf).objects;
    if (kept.length === 1 && kept[0] === object) return;
    cuts.push({ index, objects: kept.map(piece => ({ ...piece, source: undefined })) });
  });
  return cuts.map(cut => ({ index: cut.index, objects: cut.objects.map(piece => { const plain = { ...piece } as MapObject & { source?: unknown }; delete plain.source; return plain; }) }));
}
