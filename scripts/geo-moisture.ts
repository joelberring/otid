/**
 * ADR-0219 K5c (del 2, ägaren 2026-11-08): fuktighet ur laserns markmodell, i geo-arbetaren. Karttapullautins höjdraster
 * (`xyz2.hmap`, 2 m) för varje ruta slås ihop, sänkorna fylls (priority flood med en liten lutning så att allt rinner),
 * flödet räknas (D8) och varje cells höjd över närmaste fuktstråk (HAND, "height above nearest drainage", ett mått nära
 * DTW) avgör om den är blöt eller fuktig. Fuktstråken är celler med minst kanaltröskelns tillrinningsyta.
 *
 * Resultatet: en bild (blått för blött, ljusblått för fuktigt, mörkblått för fuktstråken) med världsfil, och en DXF med
 * ytorna (lagren `blott` och `fuktigt`) och stråken (`fuktstrak`) som kandidater för 308/310 och 306.
 *
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`).
 */
import { crc32, deflateSync } from "node:zlib";

/** Ett rutnät med cellernas mitt i (minX + cell·x, minY + cell·y), y uppåt (norr); NaN = ingen data. Index x·height + y. */
export interface Grid { readonly minX: number; readonly minY: number; readonly cell: number; readonly width: number; readonly height: number; readonly z: Float64Array }
export interface MoistureSettings { readonly channelHa: number; readonly wetMeters: number; readonly moistMeters: number;
  /** Tillrinningen (ha) där ett fuktstråk ritas som linje; förval `CHANNEL_LINE_HA`. */
  readonly channelLineHa?: number | undefined }
/** Steget i fuktdjupets bild (meter per värde). */
export const DEPTH_STEP_METERS = 0.02;
// Ägaren 2026-11-11 (Högdalen som facit: «sankmark i hela dalar»): blött under 0,3 m och fuktigt under 0,6 m över stråket,
// och bara på flack mark (`WET_SLOPE_DEGREES`, `MOIST_SLOPE_DEGREES`). Fuktstråken ritas som linjer först från 5 ha tillrinning.
export const DEFAULT_MOISTURE: MoistureSettings = { channelHa: 1, wetMeters: 0.3, moistMeters: 0.6 };
export const WET_SLOPE_DEGREES = 3;
export const MOIST_SLOPE_DEGREES = 6;
export const CHANNEL_LINE_HA = 5;
/**
 * Lärt av Högdalenkartan 2026-11-11 (tre rutor, träff mot kartritarens kärr): där minst så stor andel av laserträffarna når
 * marken är marken öppen och sällan ett kärr (ofta utdikad, skött mark). Regeln höjde träffen (F) från 0,58 till 0,65 och
 * halverade den för stora ytan. Andelen skrivs i fuktdjupets gröna kanal, så att webbläsarens reglage kan dra i gränsen.
 */
export const OPEN_GROUND_SHARE = 0.8;
/** Steget för lutningen i fuktdjupets bild (blå kanal, grader per värde; 255 = okänt). */
export const SLOPE_STEP_DEGREES = 0.1;

/** Lutningen i grader per cell, över två celler åt varje håll (jämnar ut laserbruset). */
export function slopeDegrees(grid: Grid): Float32Array {
  const { width, height, cell, z } = grid;
  const out = new Float32Array(width * height).fill(Number.NaN);
  const at = (x: number, y: number) => z[Math.max(0, Math.min(width - 1, x)) * height + Math.max(0, Math.min(height - 1, y))]!;
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const dx = (at(x + 2, y) - at(x - 2, y)) / (4 * cell), dy = (at(x, y + 2) - at(x, y - 2)) / (4 * cell);
    const value = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI;
    if (Number.isFinite(value)) out[x * height + y] = value;
  }
  return out;
}

/** Karttapullautins höjdraster: xoffset, yoffset, scale (f64), bredd, höjd (u64) och värdena (f64), little endian. */
export function readHeightMap(bytes: Uint8Array): Grid {
  if (bytes.byteLength < 40) throw new Error("Höjdrastret är för kort");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minX = view.getFloat64(0, true), minY = view.getFloat64(8, true), cell = view.getFloat64(16, true);
  const width = Number(view.getBigUint64(24, true)), height = Number(view.getBigUint64(32, true));
  if (!(cell > 0) || width <= 0 || height <= 0 || width * height > 60_000_000 || 40 + width * height * 8 > bytes.byteLength) {
    throw new Error("Höjdrastret har ett okänt format");
  }
  const z = new Float64Array(width * height);
  for (let i = 0; i < z.length; i += 1) {
    const value = view.getFloat64(40 + i * 8, true);
    z[i] = Number.isFinite(value) && value > -1000 && value < 10000 ? value : Number.NaN;
  }
  return { minX, minY, cell, width, height, z };
}

/** Rutnäten (samma cellstorlek) i ett; där de överlappar gäller det första. */
export function mosaic(grids: readonly Grid[]): Grid {
  if (grids.length === 0) throw new Error("Inga höjdraster");
  const cell = grids[0]!.cell;
  const minX = Math.min(...grids.map(grid => grid.minX)), minY = Math.min(...grids.map(grid => grid.minY));
  const maxX = Math.max(...grids.map(grid => grid.minX + cell * (grid.width - 1)));
  const maxY = Math.max(...grids.map(grid => grid.minY + cell * (grid.height - 1)));
  const width = Math.round((maxX - minX) / cell) + 1, height = Math.round((maxY - minY) / cell) + 1;
  if (width * height > 60_000_000) throw new Error("Området är för stort för fuktigheten");
  const z = new Float64Array(width * height).fill(Number.NaN);
  for (const grid of grids) {
    if (Math.abs(grid.cell - cell) > 1e-9) throw new Error("Höjdrastren har olika cellstorlek");
    const dx = Math.round((grid.minX - minX) / cell), dy = Math.round((grid.minY - minY) / cell);
    for (let x = 0; x < grid.width; x += 1) {
      for (let y = 0; y < grid.height; y += 1) {
        const value = grid.z[x * grid.height + y]!, target = (x + dx) * height + (y + dy);
        if (!Number.isNaN(value) && Number.isNaN(z[target]!)) z[target] = value;
      }
    }
  }
  return { minX, minY, cell, width, height, z };
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];

/** En binär min-heap över cellindex med värdet som nyckel. */
class Heap {
  private items: Uint32Array; private keys: Float64Array; size = 0;
  constructor(capacity: number) { this.items = new Uint32Array(Math.max(16, capacity)); this.keys = new Float64Array(Math.max(16, capacity)); }
  push(item: number, key: number) {
    if (this.size === this.items.length) {
      const items = new Uint32Array(this.size * 2), keys = new Float64Array(this.size * 2);
      items.set(this.items); keys.set(this.keys); this.items = items; this.keys = keys;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= key) break;
      this.items[i] = this.items[parent]!; this.keys[i] = this.keys[parent]!; i = parent;
    }
    this.items[i] = item; this.keys[i] = key;
  }
  pop(): number {
    const top = this.items[0]!, item = this.items[--this.size]!, key = this.keys[this.size]!;
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1]! < this.keys[child]!) child += 1;
      if (this.keys[child]! >= key) break;
      this.items[i] = this.items[child]!; this.keys[i] = this.keys[child]!; i = child;
    }
    this.items[i] = item; this.keys[i] = key;
    return top;
  }
}

/** Sänkorna fyllda (priority flood med ε, Barnes m.fl. 2014): från kanten och cellerna intill data som saknas. */
export function fillDepressions(grid: Grid, epsilon = 1e-4): Float64Array {
  const { width, height, z } = grid;
  const filled = new Float64Array(z.length).fill(Number.NaN);
  const done = new Uint8Array(z.length);
  const heap = new Heap(2 * (width + height));
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const i = x * height + y;
      if (Number.isNaN(z[i]!)) { done[i] = 1; continue; }
      let edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      for (let k = 0; !edge && k < 8; k += 1) edge = Number.isNaN(z[(x + DX[k]!) * height + y + DY[k]!]!);
      if (edge) { filled[i] = z[i]!; done[i] = 1; heap.push(i, z[i]!); }
    }
  }
  while (heap.size > 0) {
    const i = heap.pop(), x = Math.floor(i / height), y = i - x * height;
    for (let k = 0; k < 8; k += 1) {
      const nx = x + DX[k]!, ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = nx * height + ny;
      if (done[n]) continue;
      done[n] = 1;
      filled[n] = Math.max(z[n]!, filled[i]! + epsilon);
      heap.push(n, filled[n]);
    }
  }
  return filled;
}

/** Varje cells nedströms granne (D8, brantaste lutningen) eller −1 vid kanten. */
export function flowDirections(grid: Grid, filled: Float64Array): Int32Array {
  const { width, height } = grid;
  const down = new Int32Array(filled.length).fill(-1);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const i = x * height + y, here = filled[i]!;
      if (Number.isNaN(here)) continue;
      let best = 0, target = -1;
      for (let k = 0; k < 8; k += 1) {
        const nx = x + DX[k]!, ny = y + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = nx * height + ny, there = filled[n]!;
        if (Number.isNaN(there)) continue;
        const slope = (here - there) / (k % 2 === 1 ? Math.SQRT2 : 1);
        if (slope > best) { best = slope; target = n; }
      }
      down[i] = target;
    }
  }
  return down;
}

/** Tillrinningen i celler (cellen själv inräknad) och ordningen uppströms före nedströms. */
export function flowAccumulation(down: Int32Array, filled: Float64Array): { accumulation: Float64Array; order: Uint32Array } {
  const inflow = new Uint32Array(down.length);
  for (let i = 0; i < down.length; i += 1) { const next = down[i]!; if (next >= 0) inflow[next] = inflow[next]! + 1; }
  const accumulation = new Float64Array(down.length);
  const order = new Uint32Array(down.length);
  let head = 0, tail = 0;
  for (let i = 0; i < down.length; i += 1) {
    if (Number.isNaN(filled[i]!)) continue;
    accumulation[i] = 1;
    if (inflow[i] === 0) order[tail++] = i;
  }
  while (head < tail) {
    const i = order[head++]!, next = down[i]!;
    if (next < 0) continue;
    accumulation[next] = accumulation[next]! + accumulation[i]!;
    inflow[next] = inflow[next]! - 1;
    if (inflow[next] === 0) order[tail++] = next;
  }
  return { accumulation, order: order.subarray(0, tail) };
}

/** Höjden över närmaste fuktstråk längs flödet (NaN där flödet lämnar området utan att nå ett stråk). */
export function heightAboveDrainage(grid: Grid, down: Int32Array, accumulation: Float64Array, order: Uint32Array, channelCells: number): Float32Array {
  const nearest = new Int32Array(down.length).fill(-1);
  const hand = new Float32Array(down.length).fill(Number.NaN);
  for (let j = order.length - 1; j >= 0; j -= 1) {
    const i = order[j]!;
    nearest[i] = accumulation[i]! >= channelCells ? i : down[i]! >= 0 ? nearest[down[i]!]! : -1;
    if (nearest[i] >= 0) hand[i] = Math.max(0, grid.z[i]! - grid.z[nearest[i]]!);
  }
  return hand;
}

/** 0 = torrt eller okänt, 1 = fuktigt, 2 = blött. */
export function moistureClasses(hand: Float32Array, settings: MoistureSettings, slope?: Float32Array): Uint8Array {
  const classes = new Uint8Array(hand.length);
  for (let i = 0; i < hand.length; i += 1) {
    const value = hand[i]!;
    if (Number.isNaN(value)) continue;
    const steep = slope?.[i] ?? 0;
    classes[i] = value <= settings.wetMeters && !(steep > WET_SLOPE_DEGREES) ? 2 : value <= settings.moistMeters && !(steep > MOIST_SLOPE_DEGREES) ? 1 : 0;
  }
  return classes;
}

/** PNG med rader norrifrån (RGBA). */
export function encodePng(width: number, height: number, pixel: (column: number, row: number) => readonly [number, number, number, number]): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row += 1) {
    const offset = row * (1 + width * 4);
    for (let column = 0; column < width; column += 1) raw.set(pixel(column, row), offset + 1 + column * 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0); head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0))]);
}

/** Världsfilen för rutnätet (bildens översta rad är den nordligaste). */
export function worldFile(grid: Grid): string {
  const top = grid.minY + grid.cell * (grid.height - 1);
  return [grid.cell, 0, 0, -grid.cell, grid.minX, top].join("\n") + "\n";
}

type Ring = [number, number][];

/** Masken utan små öar och med hålen fyllda (4-grannar), så att ytorna blir hela ringar utan hål. */
export function cleanMask(mask: Uint8Array, width: number, height: number, minCells: number): Uint8Array {
  const out = new Uint8Array(mask.length), seen = new Uint8Array(mask.length), stack: number[] = [];
  const component = (start: number, inside: (i: number) => boolean) => {
    const cells: number[] = [];
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!; cells.push(i);
      const x = Math.floor(i / height), y = i - x * height;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = nx * height + ny;
        if (!seen[n] && inside(n)) { seen[n] = 1; stack.push(n); }
      }
    }
    return cells;
  };
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || seen[i]) continue;
    const cells = component(i, n => mask[n] === 1);
    if (cells.length >= minCells) for (const cell of cells) out[cell] = 1;
  }
  // Hålen: det som inte är mask och inte når kanten.
  seen.fill(0);
  for (let x = 0; x < width; x += 1) {
    for (const y of [0, height - 1]) { const i = x * height + y; if (!out[i] && !seen[i]) component(i, n => !out[n]); }
  }
  for (let y = 0; y < height; y += 1) {
    for (const x of [0, width - 1]) { const i = x * height + y; if (!out[i] && !seen[i]) component(i, n => !out[n]); }
  }
  for (let i = 0; i < out.length; i += 1) if (!out[i] && !seen[i]) out[i] = 1;
  return out;
}

/**
 * Ytornas ytterkanter längs cellgränserna (masken till vänster), som ringar i kartans koordinater. Hörn där två ytor bara
 * möts diagonalt delas, så att varje ring är enkel.
 */
export function maskRings(mask: Uint8Array, grid: Grid): Ring[] {
  const { width, height, cell, minX, minY } = grid;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[x * height + y] === 1;
  // Hörnpunkternas index: (x, y) för hörnet nere till vänster om cellen (x, y); kanterna går moturs runt masken.
  const key = (x: number, y: number) => x * (height + 1) + y;
  const next = new Map<number, number[]>();
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const from = key(x1, y1), list = next.get(from);
    if (list) list.push(key(x2, y2)); else next.set(from, [key(x2, y2)]);
  };
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const rings: Ring[] = [];
  const point = (k: number): [number, number] => {
    const x = Math.floor(k / (height + 1)), y = k - x * (height + 1);
    return [minX + (x - 0.5) * cell, minY + (y - 0.5) * cell];
  };
  for (const [start, targets] of next) {
    while (targets.length) {
      const ring: number[] = [start];
      let current = targets.pop()!, previous = start;
      while (current !== start) {
        ring.push(current);
        const options = next.get(current);
        if (!options?.length) break;
        // Vid ett diagonalt hörn: sväng vänster (behåll ytan till vänster), så att ringarna inte korsar sig själva.
        let choice = 0;
        if (options.length > 1) {
          const [px, py] = point(previous), [cx, cy] = point(current);
          const heading = Math.atan2(cy - py, cx - px);
          let best = Infinity;
          options.forEach((option, index) => {
            const [ox, oy] = point(option);
            let turn = Math.atan2(oy - cy, ox - cx) - heading;
            while (turn <= -Math.PI) turn += 2 * Math.PI;
            while (turn > Math.PI) turn -= 2 * Math.PI;
            const score = -turn;
            if (score < best) { best = score; choice = index; }
          });
        }
        previous = current;
        current = options.splice(choice, 1)[0]!;
      }
      if (current === start && ring.length >= 4) rings.push(ring.map(point));
    }
  }
  return rings;
}

/** Douglas–Peucker; ringar behåller sin slutpunkt. */
export function simplify(points: readonly [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a]!, [bx, by] = points[b]!;
    const length = Math.hypot(bx - ax, by - ay);
    let worst = -1, index = -1;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = points[i]!;
      const distance = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / length;
      if (distance > worst) { worst = distance; index = i; }
    }
    if (worst > tolerance && index > 0) { keep[index] = 1; stack.push([a, index], [index, b]); }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Fuktstråken som linjer: från varje stråks början nedströms tills stråket möter ett annat eller lämnar området. */
export function channelLines(grid: Grid, down: Int32Array, accumulation: Float64Array, channelCells: number, minLengthMeters: number,
  blocked?: Uint8Array): [number, number][][] {
  const { height, cell, minX, minY } = grid;
  // Stråken slutar vid vattnet (blocked): en bäck ritas inte ut över sjön.
  const isChannel = (i: number) => accumulation[i]! >= channelCells && !blocked?.[i];
  const fed = new Uint8Array(down.length);
  for (let i = 0; i < down.length; i += 1) if (isChannel(i) && down[i]! >= 0) fed[down[i]!] = 1;
  const visited = new Uint8Array(down.length);
  const lines: [number, number][][] = [];
  const point = (i: number): [number, number] => { const x = Math.floor(i / height), y = i - x * height; return [minX + x * cell, minY + y * cell]; };
  // Stråkens början (ingen uppströms stråkcell) först, sedan det som återstår.
  const heads: number[] = [];
  for (let i = 0; i < down.length; i += 1) if (isChannel(i) && !fed[i]) heads.push(i);
  for (const head of heads) {
    const line: [number, number][] = [];
    let i = head;
    while (i >= 0 && isChannel(i)) {
      line.push(point(i));
      if (visited[i]) break;
      visited[i] = 1;
      i = down[i]!;
    }
    if (line.length >= 2 && (line.length - 1) * cell >= minLengthMeters) lines.push(simplify(line, cell * 0.5));
  }
  return lines;
}

/** DXF (R12) med slutna ytor och linjer per lager. */
export function moistureDxf(layers: readonly { readonly name: string; readonly closed: boolean; readonly parts: readonly [number, number][][];
  /** Punkter (POINT), t.ex. stenar. */
  readonly points?: readonly (readonly [number, number])[] }[]): string {
  const out: string[] = ["0", "SECTION", "2", "ENTITIES"];
  for (const layer of layers) {
    for (const [x, y] of layer.points ?? []) out.push("0", "POINT", "8", layer.name, "10", x.toFixed(2), "20", y.toFixed(2));
    for (const part of layer.parts) {
      const points = layer.closed && part.length > 1 && part[0]![0] === part.at(-1)![0] && part[0]![1] === part.at(-1)![1] ? part.slice(0, -1) : part;
      if (points.length < (layer.closed ? 3 : 2)) continue;
      out.push("0", "POLYLINE", "8", layer.name, "66", "1", "70", layer.closed ? "1" : "0");
      for (const [x, y] of points) out.push("0", "VERTEX", "8", layer.name, "10", x.toFixed(2), "20", y.toFixed(2));
      out.push("0", "SEQEND");
    }
  }
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\n");
}

/** Ringens yta med tecken: ytterkanter (moturs) är positiva, hål negativa. */
export const ringArea = (ring: readonly (readonly [number, number])[]) =>
  ring.reduce((sum, [x, y], i) => { const [nx, ny] = ring[(i + 1) % ring.length]!; return sum + x * ny - nx * y; }, 0) / 2;

/** Maskens celler som ligger i vatten (1), för att undanta dem; `water` får cellens mitt i kartans koordinater. */
export function blockedCells(grid: Omit<Grid, "z">, water: ((x: number, y: number) => boolean) | undefined): Uint8Array | undefined {
  if (!water) return undefined;
  const blocked = new Uint8Array(grid.width * grid.height);
  for (let x = 0; x < grid.width; x += 1) for (let y = 0; y < grid.height; y += 1) if (water(grid.minX + x * grid.cell, grid.minY + y * grid.cell)) blocked[x * grid.height + y] = 1;
  return blocked;
}

/**
 * Hela kedjan för höjdrastren: bilden, världsfilen, DXF:en och en sammanfattning. Med `water` (geo-water.ts) räknas sjöar
 * och hav inte som blöt mark, och fuktstråken slutar vid stranden.
 */
export function moistureFromHeightMaps(grids: readonly Grid[], settings: MoistureSettings = DEFAULT_MOISTURE, water?: (x: number, y: number) => boolean,
  groundShare?: (x: number, y: number) => number | undefined) {
  const grid = mosaic(grids);
  const blocked = blockedCells(grid, water);
  // Ytorna utan vattnet; ett hål som vattnet lämnar mitt i en yta blir inte en egen yta (bara ytterkanterna tas med).
  const dry = (mask: Uint8Array) => { if (blocked) for (let i = 0; i < mask.length; i += 1) if (blocked[i]) mask[i] = 0; return mask; };
  const outer = (rings: [number, number][][]) => blocked ? rings.filter(ring => ringArea(ring) > 0) : rings;
  const filled = fillDepressions(grid);
  const down = flowDirections(grid, filled);
  const { accumulation, order } = flowAccumulation(down, filled);
  const channelCells = Math.max(2, Math.round(settings.channelHa * 10_000 / (grid.cell * grid.cell)));
  const hand = heightAboveDrainage(grid, down, accumulation, order, channelCells);
  const slope = slopeDegrees(grid);
  const classes = moistureClasses(hand, settings, slope);
  // Markträffarnas andel per cell (255 = okänd); öppen mark blir varken blöt eller fuktig.
  const share = new Uint8Array(grid.width * grid.height).fill(255);
  if (groundShare) for (let column = 0; column < grid.width; column += 1) for (let row = 0; row < grid.height; row += 1) {
    const value = groundShare(grid.minX + column * grid.cell, grid.minY + row * grid.cell), i = column * grid.height + row;
    if (value === undefined) continue;
    share[i] = Math.min(254, Math.round(value * 254));
    if (value >= OPEN_GROUND_SHARE) classes[i] = 0;
  }
  const minCells = Math.max(4, Math.round(400 / (grid.cell * grid.cell)));
  const clean = (mask: Uint8Array) => blocked ? cleanMask(dry(cleanMask(dry(mask), grid.width, grid.height, minCells)), grid.width, grid.height, minCells)
    : cleanMask(mask, grid.width, grid.height, minCells);
  const wetMask = dry(clean(classes.map(value => value === 2 ? 1 : 0)));
  const moistMask = dry(clean(classes.map(value => value >= 1 ? 1 : 0)));
  const tolerance = grid.cell * 0.75;
  const wet = outer(maskRings(wetMask, grid)).map(ring => simplify(ring, tolerance)).filter(ring => ring.length >= 4);
  const moist = outer(maskRings(moistMask, grid)).map(ring => simplify(ring, tolerance)).filter(ring => ring.length >= 4);
  const lineCells = Math.max(channelCells, Math.round((settings.channelLineHa ?? CHANNEL_LINE_HA) * 10_000 / (grid.cell * grid.cell)));
  const channels = channelLines(grid, down, accumulation, lineCells, 50, blocked);
  const isChannel = (i: number) => accumulation[i]! >= channelCells && !blocked?.[i];
  const png = encodePng(grid.width, grid.height, (column, row) => {
    const i = column * grid.height + (grid.height - 1 - row);
    if (isChannel(i)) return [10, 40, 160, 230];
    if (wetMask[i]) return [40, 110, 230, 170];
    if (moistMask[i]) return [120, 180, 240, 110];
    return [0, 0, 0, 0];
  });
  // Ägaren 2026-11-11 («dra i markfuktighetslagren»): höjden över närmaste fuktstråk som bild, så att gränserna för blött och
  // fuktigt kan dras i webbläsaren utan en ny körning. Rött och grönt = höjden i steg om 2 cm (0–5,08 m), blått 255; utan
  // data eller i vatten genomskinligt. Lågt blir blått, högt vitt. Blå kanal: lutningen i steg om 0,1° (0–25,4°), för att
  // webbläsaren ska kunna kräva flack mark som här.
  const depthPng = encodePng(grid.width, grid.height, (column, row) => {
    const i = column * grid.height + (grid.height - 1 - row);
    const value = hand[i]!;
    if (!Number.isFinite(value) || blocked?.[i]) return [0, 0, 0, 0];
    const step = Math.min(254, Math.max(0, Math.round(value / DEPTH_STEP_METERS)));
    const steep = slope[i]!;
    // Grön kanal: markträffarnas andel (0–254 = 0–100 %, 255 okänd) när punktstatistiken finns; annars som röd (äldre format).
    return [step, groundShare ? share[i]! : step, Number.isFinite(steep) ? Math.min(254, Math.round(steep / SLOPE_STEP_DEGREES)) : 255, 255];
  });
  const dxf = moistureDxf([{ name: "blott", closed: true, parts: wet }, { name: "fuktigt", closed: true, parts: moist },
    { name: "fuktstrak", closed: false, parts: channels }]);
  const count = (mask: Uint8Array) => mask.reduce((sum, value) => sum + value, 0);
  // Om en punkt är fuktig (höjden över fuktstråket högst gränsen för fuktigt), för dikena ur terrängformen.
  const wetAt = (x: number, y: number) => {
    const column = Math.round((x - grid.minX) / grid.cell), row = Math.round((y - grid.minY) / grid.cell);
    return column >= 0 && row >= 0 && column < grid.width && row < grid.height && hand[column * grid.height + row]! <= settings.moistMeters;
  };
  return { png, depthPng, wetAt, world: worldFile(grid), dxf, summary: { wetHa: Math.round(count(wetMask) * grid.cell * grid.cell / 100) / 100,
    moistHa: Math.round(count(moistMask) * grid.cell * grid.cell / 100) / 100, wetAreas: wet.length, moistAreas: moist.length, channels: channels.length } };
}
