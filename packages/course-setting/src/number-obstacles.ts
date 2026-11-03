/**
 * Kartans hinder för kontrollnumren (ADR-0211 beslut 4): byggnader (ISOM 521, 526 och liknande), andra mörka eller svarta
 * ytor och svarta linjer nära varje kontroll. Ren funktion över kartfilen, räknad där kartan finns (editorns och
 * förhandsvisningens Worker, utskriftsarbetaren) och given till `layoutOverprint` som `numberObstacles`, så att den
 * automatiska placeringen undviker dem när det finns plats. Ett nummer som banläggaren placerat flyttas aldrig; det får en
 * notis i Varningar om det ligger på ett hinder (`numberObstacleNotices`).
 */
import { flattenPath, type MapColor, type ParsedMap, type Point } from "@o-tid/map-file";

export interface NumberObstacles {
  /** Mörka ytor (byggnader och liknande) som ringar i kartans mm. */
  readonly areas: readonly (readonly Point[])[];
  /** Svarta linjer som sträckor i kartans mm. */
  readonly lines: readonly (readonly [Point, Point])[];
}

/** Hur långt från kontrollen hindren samlas (kartans mm): ringen, avståndet och ett tresiffrigt nummer i 1:10 000 med marginal. */
export const NUMBER_OBSTACLE_REACH_MM = 20;

/** Byggnader och liknande (ISOM 2017-2 / ISSprOM 2019-2): byggnad, ruin, stort föremål; deras yta är ett hinder i alla färger. */
const BUILDING_MAINS = [521, 522, 526];

const luminance = (color: MapColor | undefined) => color ? 0.2126 * color.rgb.r + 0.7152 * color.rgb.g + 0.0722 * color.rgb.b : 1;
/** Mörk yta: så mörk att lila siffror inte läses på den (svart, mörkgrått, mörk olivgrön). */
const darkFill = (color: MapColor | undefined) => color !== undefined && color.opacity > 0.5 && luminance(color) < 0.45;
const blackLine = (color: MapColor | undefined) => color !== undefined && color.opacity > 0.5 && luminance(color) < 0.2;

export interface ObstaclePoint { readonly id: string; readonly at: Point }

interface PreparedObstacles { readonly areas: { box: [number, number, number, number]; ring: Point[] }[]; readonly lines: [Point, Point][] }
/** Kartans hinder läses en gång per karta (editorn frågar efter varje flyttad kontroll). */
const prepared = new WeakMap<ParsedMap, PreparedObstacles>();

export function computeNumberObstacles(map: ParsedMap, controls: readonly ObstaclePoint[], reachMm = NUMBER_OBSTACLE_REACH_MM): Record<string, NumberObstacles> {
  const { areas, lines } = prepared.get(map) ?? prepareObstacles(map);
  const out: Record<string, NumberObstacles> = {};
  for (const control of controls) {
    const near = (minX: number, minY: number, maxX: number, maxY: number) =>
      maxX >= control.at.x - reachMm && minX <= control.at.x + reachMm && maxY >= control.at.y - reachMm && minY <= control.at.y + reachMm;
    const a = areas.filter(item => near(...item.box)).map(item => item.ring);
    const l = lines.filter(([p, q]) => near(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.max(p.x, q.x), Math.max(p.y, q.y)));
    if (a.length > 0 || l.length > 0) out[control.id] = { areas: a, lines: l };
  }
  return out;
}

function prepareObstacles(map: ParsedMap): PreparedObstacles {
  const colors = new Map(map.colors.map(color => [color.id, color]));
  const areas: { box: [number, number, number, number]; ring: Point[] }[] = [];
  const lines: [Point, Point][] = [];
  const boxOf = (points: readonly Point[]): [number, number, number, number] => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    return [minX, minY, maxX, maxY];
  };
  for (const object of map.objects) {
    const symbol = map.symbols.get(object.symbol);
    if (!symbol || symbol.hidden) continue;
    if (object.kind === "area" && symbol.kind === "AREA") {
      const building = BUILDING_MAINS.includes(symbol.code.main);
      if (!building && !darkFill(colors.get(symbol.fill ?? -1))) continue;
      const ring = flattenPath(object.rings[0]!).flat();
      if (ring.length >= 3) areas.push({ box: boxOf(ring), ring });
    } else if (object.kind === "line" && symbol.kind === "LINE") {
      if (!symbol.strokes.some(stroke => blackLine(colors.get(stroke.color)) && stroke.width >= 0.1)) continue;
      for (const part of flattenPath(object.path)) for (let i = 1; i < part.length; i++) lines.push([part[i - 1]!, part[i]!]);
    }
  }
  const result = { areas, lines };
  prepared.set(map, result);
  return result;
}

interface Box { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number }

function pointInRing(p: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Andelen (0–1) av rutan som täcks av mörka ytor, provad i ett rutnät 5 × 3. */
export function areaCover(box: Box, obstacles: NumberObstacles | undefined): number {
  if (!obstacles || obstacles.areas.length === 0) return 0;
  let hit = 0, total = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
    const p = { x: box.cx - box.w / 2 + box.w * (i + 0.5) / 5, y: box.cy - box.h / 2 + box.h * (j + 0.5) / 3 };
    total++;
    if (obstacles.areas.some(ring => pointInRing(p, ring))) hit++;
  }
  return hit / total;
}

function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  const minX = box.cx - box.w / 2, maxX = box.cx + box.w / 2, minY = box.cy - box.h / 2, maxY = box.cy + box.h / 2;
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - minX], [dx, maxX - a.x], [-dy, a.y - minY], [dy, maxY - a.y]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

/** Antalet svarta linjer som går genom rutan. */
export function linesCrossing(box: Box, obstacles: NumberObstacles | undefined): number {
  if (!obstacles) return 0;
  let count = 0;
  for (const [a, b] of obstacles.lines) if (segmentHitsBox(a, b, box)) count++;
  return count;
}

/** Kostnaderna i placeringen (samma skala som linjer och ringar, 10 per krock): en hel ruta på ett hus kostar 8. */
export const NUMBER_OBSTACLE_COST = { area: 8, line: 3 } as const;

export function obstacleCost(box: Box, obstacles: NumberObstacles | undefined): number {
  return NUMBER_OBSTACLE_COST.area * areaCover(box, obstacles) + NUMBER_OBSTACLE_COST.line * linesCrossing(box, obstacles);
}
