import type { SourceData, SourceFeature } from "../index";

/**
 * Grundkartan G8c (ägaren 2026-11-10: «flygbildstolkning för öppna ytor och berg i dagen»; Kungshatt-kedjans `s6_hall.py`):
 * ett första försök att tolka ett ortofoto som ligger som underlag. Bilden läses i celler om ca 2 m:
 *
 * - **berg i dagen**: grå och ljus (liten färgmättnad), inte grönare än rött och blått,
 * - **öppen mark**: ljus, grön eller gulgrön och jämn (skog är mörkare och fläckig av skuggor).
 *
 * Bara breda, sammanhängande ytor räknas: smala grå streck är liggande stammar, stigar och vägkanter. Ytorna blir lagren
 * `berg_i_dagen` (214) och `oppen_mark_flygbild` (401) som kandidater. Utan IR-bild skiljs torrt gräs och grus dåligt från
 * häll; resultatet ska ses som förslag att gå igenom, och är inte prövat mot riktiga flygbilder.
 */
export interface PhotoPixels { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray | Uint8Array }
export interface PhotoSettings {
  /** Så många bildpunkter i sida per cell (bilden skalas så att en cell blir ca 2 m). */
  readonly cellPixels: number;
  /** Minsta yta i celler. */
  readonly minCells: number;
  /**
   * Bilden är en falskfärgsbild (IR, rött, grönt i bildens röda, gröna och blå kanal; ägaren 2026-11-17, Lantmäteriets rgbi).
   * Då avgör växtlighetens index NDVI = (IR − rött) / (IR + rött): berg i dagen har nästan ingen levande växtlighet och är ljust,
   * öppen mark har mycket och är jämn (skogen är fläckig av skuggor). Gränserna är inte prövade mot riktiga bilder.
   */
  readonly infrared?: boolean | undefined;
}
/** NDVI under detta och ljust: berg i dagen. Över `OPEN_NDVI` och jämnt: öppen mark (falskfärgsbilden). */
export const ROCK_NDVI = 0.12, OPEN_NDVI = 0.35;
export const ROCK = 1, OPEN = 2;

/** Cellernas klass (0 = annat, 1 = berg i dagen, 2 = öppen mark); index kolumn · rader + rad, rad 0 överst. */
export function classifyPhoto(pixels: PhotoPixels, settings: PhotoSettings): { columns: number; rows: number; classes: Uint8Array } {
  const size = settings.cellPixels, columns = Math.floor(pixels.width / size), rows = Math.floor(pixels.height / size);
  const classes = new Uint8Array(Math.max(0, columns * rows));
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      let r = 0, g = 0, b = 0, sum = 0, squares = 0, count = 0;
      for (let dx = 0; dx < size; dx += 1) for (let dy = 0; dy < size; dy += 1) {
        const i = ((row * size + dy) * pixels.width + column * size + dx) * 4;
        if (pixels.data[i + 3] === 0) continue;
        const pr = pixels.data[i]! / 255, pg = pixels.data[i + 1]! / 255, pb = pixels.data[i + 2]! / 255, light = (pr + pg + pb) / 3;
        r += pr; g += pg; b += pb; sum += light; squares += light * light; count += 1;
      }
      if (count < size * size / 2) continue;
      r /= count; g /= count; b /= count;
      if (settings.infrared) {
        // r = IR, g = rött, b = grönt. Vatten och skugga är mörka i IR och räknas inte.
        const ndvi = (r - g) / (r + g + 1e-6), light = (g + b) / 2, spread = Math.sqrt(Math.max(0, squares / count - (sum / count) ** 2));
        if (ndvi < ROCK_NDVI && light > 0.3 && r > 0.25) classes[column * rows + row] = ROCK;
        else if (ndvi > OPEN_NDVI && r > 0.45 && spread < 0.06) classes[column * rows + row] = OPEN;
        continue;
      }
      const light = sum / count, spread = Math.sqrt(Math.max(0, squares / count - light * light));
      const high = Math.max(r, g, b), saturation = high === 0 ? 0 : (high - Math.min(r, g, b)) / high;
      if (saturation < 0.14 && light > 0.42 && light < 0.93 && g <= Math.max(r, b) * 1.04) classes[column * rows + row] = ROCK;
      else if (light > 0.4 && g > b * 1.18 && g >= r * 0.92 && saturation >= 0.14 && spread < 0.07) classes[column * rows + row] = OPEN;
    }
  }
  return { columns, rows, classes };
}

/** Masken utan smala delar (en cell breda försvinner) och utan små öar. */
export function compactMask(mask: Uint8Array, columns: number, rows: number, minCells: number): Uint8Array {
  const at = (source: Uint8Array, column: number, row: number) => column >= 0 && row >= 0 && column < columns && row < rows && source[column * rows + row] === 1;
  const eroded = new Uint8Array(mask.length), opened = new Uint8Array(mask.length);
  for (let c = 0; c < columns; c += 1) for (let r = 0; r < rows; r += 1) {
    if (at(mask, c, r) && at(mask, c + 1, r) && at(mask, c - 1, r) && at(mask, c, r + 1) && at(mask, c, r - 1)) eroded[c * rows + r] = 1;
  }
  for (let c = 0; c < columns; c += 1) for (let r = 0; r < rows; r += 1) {
    if (at(mask, c, r) && (at(eroded, c, r) || at(eroded, c + 1, r) || at(eroded, c - 1, r) || at(eroded, c, r + 1) || at(eroded, c, r - 1))) opened[c * rows + r] = 1;
  }
  const seen = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  for (let start = 0; start < opened.length; start += 1) {
    if (!opened[start] || seen[start]) continue;
    const cells = [start];
    seen[start] = 1;
    for (let k = 0; k < cells.length; k += 1) {
      const c = Math.floor(cells[k]! / rows), r = cells[k]! - c * rows;
      for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]] as const) {
        if (at(opened, nc, nr) && !seen[nc * rows + nr]) { seen[nc * rows + nr] = 1; cells.push(nc * rows + nr); }
      }
    }
    if (cells.length >= minCells) for (const cell of cells) out[cell] = 1;
  }
  return out;
}

type Ring = [number, number][];
/**
 * Maskens kanter som ringar i cellhörnens koordinater (kolumn, rad): ytterkanter och hål var för sig.
 * Platta `Int32Array`-fält (högst två utgående kanter per hörn) och vänstersvängsregel i 4-gradiga sadelpunkter
 * så diagonalt mötande celler ger två enkla ringar utan åtta-formade självskärningar.
 */
export function maskOutlines(mask: Uint8Array, columns: number, rows: number): Ring[] {
  if (columns <= 0 || rows <= 0) return [];
  const at = (column: number, row: number) => column >= 0 && row >= 0 && column < columns && row < rows && mask[column * rows + row] === 1;
  const stride = rows + 1, corners = (columns + 1) * stride;
  const first = new Int32Array(corners).fill(-1), second = new Int32Array(corners).fill(-1), known = new Uint8Array(corners);
  let order = new Int32Array(1024), ordered = 0;
  const key = (column: number, row: number) => column * stride + row;
  const add = (c1: number, r1: number, c2: number, r2: number) => {
    const from = key(c1, r1), to = key(c2, r2);
    if (!known[from]) {
      known[from] = 1;
      if (ordered === order.length) { const grown = new Int32Array(order.length * 2); grown.set(order); order = grown; }
      order[ordered] = from; ordered += 1;
    }
    if (first[from]! < 0) first[from] = to; else second[from] = to;
  };
  for (let c = 0; c < columns; c += 1) for (let r = 0; r < rows; r += 1) {
    if (!at(c, r)) continue;
    if (!at(c, r - 1)) add(c + 1, r, c, r);
    if (!at(c + 1, r)) add(c + 1, r + 1, c + 1, r);
    if (!at(c, r + 1)) add(c, r + 1, c + 1, r + 1);
    if (!at(c - 1, r)) add(c, r, c, r + 1);
  }
  const point = (k: number): [number, number] => [Math.floor(k / stride), k % stride];
  const rings: Ring[] = [];
  for (let n = 0; n < ordered; n += 1) {
    const start = order[n]!;
    while (first[start]! >= 0) {
      const ring = [start];
      let previous = start;
      let current: number;
      if (second[start]! >= 0) { current = second[start]!; second[start] = -1; }
      else { current = first[start]!; first[start] = -1; }
      let guard = 0;
      while (current !== start && guard++ < 4_000_000) {
        ring.push(current);
        if (first[current]! < 0) break;
        let choice = 0;
        if (second[current]! >= 0) {
          const px = Math.floor(previous / stride), py = previous - px * stride;
          const cx = Math.floor(current / stride), cy = current - cx * stride;
          const ox = Math.floor(first[current]! / stride), oy = first[current]! - ox * stride;
          // Rad ökar nedåt: vänstersväng kring fylld cell har negativ kryssprodukt (c − p) × (o − c) < 0.
          if ((cx - px) * (oy - cy) - (cy - py) * (ox - cx) > 0) choice = 1;
        }
        previous = current;
        if (choice === 0) { current = first[current]!; first[previous] = second[previous]!; second[previous] = -1; }
        else { current = second[current]!; second[previous] = -1; }
      }
      if (current === start && ring.length >= 4) rings.push(ring.map(point));
    }
  }
  return rings;
}

/** Öppen Douglas–Peucker (iterativt) för en halva av en ring. */
function simplifyOpen(points: Ring, tolerance: number): Ring {
  if (points.length <= 2 || tolerance <= 0) return points.slice();
  const keep = new Uint8Array(points.length), stack: [number, number][] = [[0, points.length - 1]];
  keep[0] = 1; keep[points.length - 1] = 1;
  while (stack.length) {
    const [from, to] = stack.pop()!;
    const [ax, ay] = points[from]!, [bx, by] = points[to]!, length = Math.hypot(bx - ax, by - ay);
    let worst = -1, distance = tolerance;
    for (let i = from + 1; i < to; i += 1) {
      const [px, py] = points[i]!;
      const d = length > 0 ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length : Math.hypot(px - ax, py - ay);
      if (d > distance) { distance = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([from, worst], [worst, to]); }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Douglas–Peucker för en sluten ring: delas vid punkten längst från startpunkten innan vardera halvan förenklas. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  const closed = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1];
  const open = closed ? ring.slice(0, -1) : ring;
  if (open.length <= 3 || tolerance <= 0) return ring.slice();
  const [sx, sy] = open[0]!;
  let far = 1, best = -1;
  for (let i = 1; i < open.length; i += 1) {
    const d = Math.hypot(open[i]![0] - sx, open[i]![1] - sy);
    if (d > best) { best = d; far = i; }
  }
  const firstHalf = simplifyOpen(open.slice(0, far + 1), tolerance);
  const secondHalf = simplifyOpen([...open.slice(far), open[0]!], tolerance);
  const combined = [...firstHalf, ...secondHalf.slice(1, -1)];
  if (combined.length < 3) return ring.slice();
  return closed ? [...combined, combined[0]!] : combined;
}

/**
 * Hela tolkningen: bildens ytor som vektordata. `toSource` räknar en bildpunkt (kolumn, rad) till källans koordinater
 * (kartans koordinatsystem), och `crs` är dess EPSG-kod.
 */
export function interpretPhoto(pixels: PhotoPixels, settings: PhotoSettings, toSource: (column: number, row: number) => [number, number], crs: number)
  : { data: SourceData; rockCells: number; openCells: number } {
  const { columns, rows, classes } = classifyPhoto(pixels, settings);
  const features: SourceFeature[] = [];
  const counts = { rock: 0, open: 0 };
  for (const [value, layer, name] of [[ROCK, "berg_i_dagen", "rock"], [OPEN, "oppen_mark_flygbild", "open"]] as const) {
    const mask = compactMask(classes.map(cell => cell === value ? 1 : 0), columns, rows, settings.minCells);
    counts[name] = mask.reduce((sum, cell) => sum + cell, 0);
    for (const ring of maskOutlines(mask, columns, rows)) {
      const simple = simplifyRing(ring, 0.75);
      if (simple.length < 4) continue;
      features.push({ layer, geometry: { kind: "line", closed: true, points: simple.map(([column, row]) => toSource(column * settings.cellPixels, row * settings.cellPixels)) } });
    }
  }
  return { data: { features, skipped: 0, crs }, rockCells: counts.rock, openCells: counts.open };
}
