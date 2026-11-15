import type { SourceFeature } from "../index";
import type { HeightGrid } from "./clear-contours";
import { isRing } from "./depressions";
import type { PixelAffine } from "./flat-contours";
import { blend } from "./knoll-choice";
import { elongateKnolls } from "./elongated-knolls";
import { maskOutlines, simplifyRing } from "./photo-interpret";
import { chaikin, smoothedHeights } from "./pit-search";
import { ISOM_RINGS, ringArea } from "./small-rings";

/**
 * Små höjder som ring efter formen (ägaren 2026-11-15: «färre punkthöjder och fler små höjder»). Punkthöjdernas regel hoppar
 * över kullar med stor fot i tron att en höjdkurva visar dem, men det gör den bara om en nivå råkar korsa: i Högdalen var 18
 * av grundkartans 58 punkthöjder en ring hos kartritaren, och i Grövelsjön korsade 65 av 119 höjder på 1–2,5 m ingen nivå.
 *
 * Här söks varje höjd med egen topp ur höjdrastret, också de som sitter på sidan av en större höjd: cellerna tas uppifrån och
 * ner och växer ihop till höjder, och när två möts har den lägre toppen nått sin sadel. Höjden över sadeln är dess stigning och
 * cellerna över sadeln dess fot. Ringen dras på halva höjden (mätt mot kartritarens ringar i Högdalen: där ligger hennes, inte
 * vid foten). En höjd som är hög nog och vars ring rymmer normens minsta höjd blir en ring: en höjdkurva när en nivå ligger
 * inom en fjärdedel av ekvidistansen ovanför toppen (normen låter kurvan flyttas så mycket), annars en hjälpkurva. Punkthöjder
 * inne i en sådan ring tas bort; ringen visar höjden. Höjder som grundkartan redan visar med en liten sluten kurva tas inte med.
 *
 * Rastret räknas i rutor som går omlott, så att minnet inte växer med kartans storlek; en höjd tas med i rutan där toppen
 * ligger. Vatten (celler utan höjd som inte hänger ihop med rastrets kant) räknas som lågt, så en holme är en höjd; mark
 * utan data vid kanten är okänd, och en höjd som når dit tas inte med. Ren kod utan I/O.
 */
type Position = readonly [number, number];
export interface HillCandidate {
  /** Toppen, dess höjd (m ö.h.), stigningen över sadeln (m) och fotens yta (m²). */
  readonly at: readonly [number, number]; readonly top: number; readonly rise: number; readonly areaM2: number;
  /** Höjdens ring på halva höjden (minst 0,25 m över sadeln), för de höjder som kan bli en ring. */
  readonly ring?: readonly (readonly [number, number])[] | undefined;
}
/**
 * Lägre höjder än så sparas inte; en kant sparas för alla höjder vars fot ligger mellan gränserna (m²): den visar formen också
 * för en liten höjd (avlånga punkthöjder, `elongated-knolls.ts`). Ringarna börjar vid `RING_FROM_RISE`.
 */
export const HILL_MIN_RISE = 0.4;
const RING_FROM_RISE = 0.6, RING_MIN_M2 = 12, RING_MAX_M2 = 6000;
/** Rutans kärna och marginalen runt den (celler); en höjd med fot upp till `RING_MAX_M2` ryms i marginalen. */
const TILE_CORE = 1536, TILE_MARGIN = 128;

/** Celler utan höjd som hänger ihop med rastrets kant (mark utan data); övriga celler utan höjd är vatten. */
function outsideCells(z: Float32Array, columns: number, rows: number): Uint8Array {
  const outside = new Uint8Array(z.length), stack: number[] = [];
  const seed = (cell: number) => { if (!outside[cell] && z[cell] !== z[cell]) { outside[cell] = 1; stack.push(cell); } };
  for (let column = 0; column < columns; column += 1) { seed(column); seed((rows - 1) * columns + column); }
  for (let row = 0; row < rows; row += 1) { seed(row * columns); seed(row * columns + columns - 1); }
  while (stack.length) {
    const cell = stack.pop()!, row = Math.floor(cell / columns), column = cell - row * columns;
    if (column > 0) seed(cell - 1);
    if (column < columns - 1) seed(cell + 1);
    if (row > 0) seed(cell - columns);
    if (row < rows - 1) seed(cell + columns);
  }
  return outside;
}

interface Found { readonly top: number; readonly saddle: number; readonly cells: number }

/** Höjderna i en ruta (kolumnerna `c0`–`c1` och raderna `r0`–`r1`, slutet ej med): toppens cell i hela rastret, sadelns höjd och fotens celler. */
function hillsInTile(z: Float32Array, outside: Uint8Array, columns: number, rows: number, c0: number, r0: number, c1: number, r1: number, maxCells: number): Found[] {
  const width = c1 - c0, height = r1 - r0, n = width * height, local = new Float32Array(n);
  let high = -Infinity, low = Infinity;
  for (let row = r0; row < r1; row += 1) for (let column = c0; column < c1; column += 1) {
    const value = z[row * columns + column]!;
    local[(row - r0) * width + column - c0] = value;
    if (value === value) { if (value > high) high = value; if (value < low) low = value; }
  }
  if (!(high > low)) return [];
  // Cellerna uppifrån och ner: räknesortering på höjden i centimeter.
  const bucket = (value: number) => Math.round((high - value) * 100), buckets = bucket(low) + 1;
  const starts = new Int32Array(buckets + 1);
  for (let cell = 0; cell < n; cell += 1) { const value = local[cell]!; if (value === value) starts[bucket(value) + 1]! += 1; }
  for (let i = 0; i < buckets; i += 1) starts[i + 1]! += starts[i]!;
  const order = new Int32Array(starts[buckets]!), next = starts.slice(0, buckets);
  for (let cell = 0; cell < n; cell += 1) { const value = local[cell]!; if (value === value) order[next[bucket(value)]!++] = cell; }
  // Varje höjd: en rot med sin topp, sitt antal celler, sin lägsta cell hittills och om den når okänd mark.
  const parent = new Int32Array(n).fill(-1), top = new Int32Array(n), count = new Int32Array(n), open = new Uint8Array(n), lowest = new Float32Array(n);
  const find = (cell: number): number => {
    let root = cell;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[cell] !== root) { const up = parent[cell]!; parent[cell] = root; cell = up; }
    return root;
  };
  const found: Found[] = [];
  const die = (root: number, saddle: number) => {
    if (!open[root] && count[root]! <= maxCells) found.push({ top: (r0 + Math.floor(top[root]! / width)) * columns + c0 + top[root]! % width, saddle, cells: count[root]! });
  };
  for (let k = 0; k < order.length; k += 1) {
    const cell = order[k]!, row = Math.floor(cell / width), column = cell - row * width, level = local[cell]!;
    parent[cell] = cell; top[cell] = cell; count[cell] = 1;
    // Cellen når okänd mark om den ligger i rutans kant eller intill mark utan data.
    let edge = row === 0 || column === 0 || row === height - 1 || column === width - 1;
    for (let dr = -1; dr <= 1 && !edge; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      const r = row + dr, c = column + dc;
      if (r >= 0 && r < height && c >= 0 && c < width && outside[(r0 + r) * columns + c0 + c]) { edge = true; break; }
    }
    if (edge) open[cell] = 1;
    let root = cell;
    for (let dr = -1; dr <= 1; dr += 1) {
      const r = row + dr;
      if (r < 0 || r >= height) continue;
      for (let dc = -1; dc <= 1; dc += 1) {
        const c = column + dc;
        if ((dr === 0 && dc === 0) || c < 0 || c >= width) continue;
        const other = r * width + c;
        if (parent[other] === -1) continue;
        const theirs = find(other);
        if (theirs === root) continue;
        if (root === cell) { parent[cell] = theirs; count[theirs]! += 1; if (edge) open[theirs] = 1; root = theirs; continue; }
        // Två höjder möts här: den med lägre topp har nått sin sadel. En som når okänd mark kan fortsätta högre utanför
        // rutan och räknas därför alltid som den högre.
        const keep = open[theirs] !== open[root] ? (open[theirs] ? theirs : root) : local[top[theirs]!]! >= local[top[root]!]! ? theirs : root, gone = keep === theirs ? root : theirs;
        die(gone, level);
        parent[gone] = keep; count[keep]! += count[gone]!;
        root = keep;
      }
    }
    lowest[root] = level;
  }
  // Det som aldrig mötte något högre och inte når okänd mark är en holme: sadeln är strandens höjd (höjdens lägsta cell).
  for (let k = 0; k < order.length; k += 1) { const cell = order[k]!; if (parent[cell] === cell) die(cell, lowest[cell]!); }
  return found;
}

/**
 * Alla höjder med egen topp som kandidater, högst stigning först. `affine` säger var rastret ligger (bildpunktens mitt till
 * koordinater, som `worldFileAffine`).
 */
export function findHills(grid: HeightGrid, affine: PixelAffine): HillCandidate[] {
  const { columns, rows } = grid;
  if (columns < 3 || rows < 3) return [];
  const z = smoothedHeights(grid), outside = outsideCells(z, columns, rows);
  const [a, b, c, d, e, f] = affine, cellM2 = Math.abs(a * e - b * d);
  const toSource = (column: number, row: number): [number, number] => [a * column + b * row + c, d * column + e * row + f];
  const maxCells = Math.ceil(RING_MAX_M2 / cellM2), round = (value: number) => Math.round(value * 100) / 100;
  const out: HillCandidate[] = [];
  for (let coreR = 0; coreR < rows; coreR += TILE_CORE) for (let coreC = 0; coreC < columns; coreC += TILE_CORE) {
    const c0 = Math.max(0, coreC - TILE_MARGIN), r0 = Math.max(0, coreR - TILE_MARGIN);
    const c1 = Math.min(columns, coreC + TILE_CORE + TILE_MARGIN), r1 = Math.min(rows, coreR + TILE_CORE + TILE_MARGIN);
    for (const hill of hillsInTile(z, outside, columns, rows, c0, r0, c1, r1, maxCells)) {
      const topRow = Math.floor(hill.top / columns), topColumn = hill.top - topRow * columns, height = z[hill.top]!, rise = height - hill.saddle;
      // Rutorna går omlott: höjden hör till rutan där toppen ligger.
      if (topRow < coreR || topRow >= coreR + TILE_CORE || topColumn < coreC || topColumn >= coreC + TILE_CORE) continue;
      const areaM2 = hill.cells * cellM2;
      if (rise < HILL_MIN_RISE || areaM2 < 4) continue;
      let ring: [number, number][] | undefined;
      if (areaM2 >= RING_MIN_M2) {
        // Ringen: cellerna som hänger ihop med toppen och ligger minst halva stigningen (minst 0,25 m) över sadeln.
        const limit = hill.saddle + Math.max(0.25, rise / 2), reach = Math.ceil(Math.sqrt(maxCells)) + 2;
        const minC = Math.max(0, topColumn - reach), minR = Math.max(0, topRow - reach), maxC = Math.min(columns - 1, topColumn + reach), maxR = Math.min(rows - 1, topRow + reach);
        const width = maxC - minC + 3, tall = maxR - minR + 3, part = new Uint8Array(width * tall);
        const at = (column: number, row: number) => (column - minC + 1) * tall + (row - minR + 1);
        const stack = [hill.top];
        part[at(topColumn, topRow)] = 1;
        let cells = 0, whole = true;
        while (stack.length) {
          const cell = stack.pop()!, row = Math.floor(cell / columns), column = cell - row * columns;
          cells += 1;
          // Större än en ring får vara, eller ut till sökrutans kant: ingen kant sparas.
          if (cells > maxCells || column === minC || column === maxC || row === minR || row === maxR) { whole = false; break; }
          for (const [nc, nr] of [[column - 1, row], [column + 1, row], [column, row - 1], [column, row + 1]] as const) {
            if (nc < minC || nc > maxC || nr < minR || nr > maxR) continue;
            if (!part[at(nc, nr)] && z[nr * columns + nc]! >= limit) { part[at(nc, nr)] = 1; stack.push(nr * columns + nc); }
          }
        }
        const outline = whole ? maskOutlines(part, width, tall).sort((p, q) => q.length - p.length)[0] : undefined;
        if (outline && outline.length >= 8) {
          ring = simplifyRing(chaikin(outline, 2), 0.2).map(([column, row]) => { const [x, y] = toSource(column + minC - 1.5, row + minR - 1.5); return [round(x), round(y)]; });
        }
      }
      const [x, y] = toSource(topColumn, topRow);
      out.push({ at: [round(x), round(y)], top: round(height), rise: round(rise), areaM2: Math.round(areaM2), ...(ring ? { ring } : {}) });
    }
  }
  return out.sort((p, q) => q.rise - p.rise);
}

export interface HillLimits {
  /** Minsta stigning över sadeln (m) för att en höjd ska bli en ring. */
  readonly ringRise: number;
}
/**
 * Förvalet mätt mot kartritarens karta i Högdalen (två block om 0,36 km²): 11 respektive 3 nya ringar, och hon har en ring på
 * 7 respektive 3 av platserna; av 9 punkthöjder som ringarna ersatte har hon 3. Lägre gräns gav fler ringar utan fler träffar.
 */
export const DEFAULT_HILL_LIMITS: HillLimits = { ringRise: 1 };
export const DEFAULT_HILL_LEVEL = 5;
const FEWEST_HILLS: HillLimits = { ringRise: 2.5 }, MOST_HILLS: HillLimits = { ringRise: RING_FROM_RISE };
export const hillLimitsAt = (level: number): HillLimits => blend(DEFAULT_HILL_LIMITS, level < 5 ? FEWEST_HILLS : MOST_HILLS, level < 5 ? (5 - level) / 4 : (level - 5) / 5);

/** En ring ritas upp till den ytan (m²); större höjder visas av höjdkurvorna. */
export const HILL_RING_MAX_M2 = 3000;
/**
 * Minsta ring i terrängen (m²): normens minsta höjd (0,9 × 0,6 mm) som en ellips i 1:15 000. Kartor i 1:10 000 är förstoringar
 * av 1:15 000, så måttet i terrängen är detsamma; bara sprintens skalor räknas för sig. Mätt i Högdalen: kartritarens ringar
 * var större än så på halva höjden (8 av 13), hennes punkthöjder mindre (8 av 8).
 */
export function hillRingMinM2(scale: number): number {
  const terrain = (scale >= 7500 ? Math.max(scale, 15000) : scale) / 1000;
  return Math.PI / 4 * ISOM_RINGS.knoll[0] * ISOM_RINGS.knoll[1] * terrain * terrain;
}
/** Ekvidistansen (m) och hur långt över toppen en nivå får ligga för att ringen ska ritas som höjdkurva (ISOM 2017-2 § 101: 25 %). */
export const CONTOUR_INTERVAL = 5, CONTOUR_SHIFT = 0.25;
export const HILL_CONTOUR_LAYER = "contour_hojd", HILL_FORMLINE_LAYER = "formline_hojd";
/** Höjdsökningens egna lager i grundkartan (reglagen byter bara dem). */
export const HILL_LAYERS = /^(contour_hojd|formline_hojd)$/;
const SHOWN_RING = /^(contour|depression)(_index)?$|^formline$/i, KNOLL_POINT = /^dotknoll(_laser|_avlang)?$/i;

function inside(ring: readonly Position[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export interface HillChoice { readonly rings: { readonly points: readonly (readonly [number, number])[]; readonly contour: boolean }[] }

/**
 * Valet bland höjderna, högst stigning först: en höjd som är minst `ringRise` hög och vars ring på halva höjden är minst
 * `hillRingMinM2` och högst `HILL_RING_MAX_M2` stor blir en ring. `shown` är
 * grundkartan som den ser ut: en höjd med toppen i en liten sluten kurva eller hjälpkurva visas redan. Ringen ritas som
 * höjdkurva när närmaste nivå över sadeln ligger högst en fjärdedel av ekvidistansen över toppen, annars som hjälpkurva.
 */
export function chooseHills(candidates: readonly HillCandidate[], limits: HillLimits, scale: number, shown: readonly SourceFeature[] = [], interval = CONTOUR_INTERVAL): HillChoice {
  const least = hillRingMinM2(scale);
  const shownRings = shown.filter(feature => SHOWN_RING.test(feature.layer) && isRing(feature)).map(feature => {
    const points = (feature.geometry as { points: readonly Position[] }).points;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { points, area: ringArea(points), minX, minY, maxX, maxY };
  });
  const rings: HillChoice["rings"][number][] = [];
  for (const hill of [...candidates].sort((p, q) => q.rise - p.rise)) {
    if (!hill.ring || hill.rise < limits.ringRise) continue;
    const [x, y] = hill.at, area = ringArea(hill.ring);
    if (area < least || area > HILL_RING_MAX_M2) continue;
    // Visas redan: toppen ligger i en liten sluten kurva, eller en sådan ligger i höjdens ring (då skulle det bli två ringar i varandra).
    if (shownRings.some(ring => ring.area <= 3 * Math.max(hill.areaM2, 100)
      && ((x >= ring.minX && x <= ring.maxX && y >= ring.minY && y <= ring.maxY && inside(ring.points, x, y)) || inside(hill.ring!, ring.points[0]![0], ring.points[0]![1])))) continue;
    // En höjd på en annan vald höjd (toppen inne i dess ring) eller som omsluter en redan vald ring ritas inte en gång till.
    if (rings.some(ring => inside(ring.points, x, y) || inside(hill.ring!, ring.points[0]![0], ring.points[0]![1]))) continue;
    const level = Math.ceil((hill.top - hill.rise) / interval + 1e-9) * interval;
    rings.push({ points: hill.ring, contour: level - hill.top <= CONTOUR_SHIFT * interval });
  }
  return { rings };
}

/** Höjdernas ringar som objekt i sina egna lager. */
export const hillFeatures = (choice: HillChoice): SourceFeature[] => choice.rings.map(ring => ({ layer: ring.contour ? HILL_CONTOUR_LAYER : HILL_FORMLINE_LAYER,
  geometry: { kind: "line", closed: true, points: ring.points.map(([x, y]) => [x, y] as [number, number]) } }));

export interface HillSettled {
  readonly features: SourceFeature[];
  /** Punkthöjderna som togs bort för att de ligger i en ring; `unsettleHills` lägger tillbaka dem. */
  readonly hidden: SourceFeature[];
  /** Ringarna som lades till, och hur många av dem som är höjdkurvor (resten är hjälpkurvor). */
  readonly rings: number; readonly contours: number;
}

/**
 * Grundkartan med höjdernas ringar: valet görs mot kurvorna som de är, ringarna läggs till i egna lager och punkthöjder inne i
 * en ring tas bort (ringen visar höjden). `features` ska vara utan tidigare ringar (`unsettleHills`).
 */
export function settleHills(features: readonly SourceFeature[], candidates: readonly HillCandidate[], limits: HillLimits, scale: number): HillSettled {
  const choice = chooseHills(candidates, limits, scale, features), hidden: SourceFeature[] = [];
  const kept = choice.rings.length === 0 ? [...features] : features.filter(feature => {
    if (feature.geometry.kind !== "point" || !KNOLL_POINT.test(feature.layer)) return true;
    const [x, y] = feature.geometry.at;
    if (!choice.rings.some(ring => inside(ring.points, x, y))) return true;
    hidden.push(feature);
    return false;
  });
  // Punkthöjder med en avlång höjd bakom sig blir avlånga (110).
  return { features: [...elongateKnolls(kept, candidates), ...hillFeatures(choice)], hidden, rings: choice.rings.length,
    contours: choice.rings.filter(ring => ring.contour).length };
}

/** Grundkartan som den var före `settleHills`: utan höjdernas ringar och med de borttagna punkthöjderna tillbaka. */
export const unsettleHills = (features: readonly SourceFeature[], hidden: readonly SourceFeature[]): SourceFeature[] =>
  [...features.filter(feature => !HILL_LAYERS.test(feature.layer)), ...hidden];
