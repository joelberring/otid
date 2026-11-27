/**
 * Ägaren 2026-11-11 («egna beräkningar av laserdatat motsvarande Karttapullautin»): punkternas statistik i 2 m-celler ur
 * lasclip (`punkter<n>.bin`, tools/lasclip `point_stats`): vegetationens höjd, andelen träffar i skikt, markträffarnas andel,
 * intensitet och spridning. Här läses filerna, rutorna slås ihop och statistiken skrivs som tre bilder (träningsdata via
 * AI-kopplingen, och underlag för egna regler för grönt, öppet och berg i dagen):
 *
 * - `lasveg.png`: R = vegetationens höjd i steg om 0,2 m (0–50,8 m), G = markträffarnas andel (0–255), B = andelen 1–3 m.
 * - `lasmark.png`: R = andelen 0,3–1 m, G = markträffarnas medelintensitet / 64, B = markpunkternas spridning i cm (255 = okänd).
 * - `laskron.png`: R = andelen över 3 m, G = antal punkter i cellen (högst 255).
 *
 * Genomskinligt där cellen saknar punkter. Bara Nodes egna moduler.
 */
import { encodePng } from "./geo-moisture.ts";

export interface PointStats { readonly minX: number; readonly minY: number; readonly cell: number; readonly width: number; readonly height: number;
  /** Åtta värden per cell (x * höjd + y): högst, antal, mark, 0,3–1 m, 1–3 m, över 3 m, intensitet, spridning. */
  readonly values: Float32Array }
export interface PointStatsBounds { readonly minX: number; readonly minY: number; readonly cell: number; readonly width: number; readonly height: number }
export interface PointStatsAccumulator { add(tile: PointStats): void; finish(): PointStats }
export const POINT_BANDS = 8;
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function readPointStats(bytes: Uint8Array): PointStats {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 40) throw new Error("Punktstatistiken är för kort");
  const minX = view.getFloat64(0, true), minY = view.getFloat64(8, true), cell = view.getFloat64(16, true);
  const width = Number(view.getBigUint64(24, true)), height = Number(view.getBigUint64(32, true));
  const count = width * height * POINT_BANDS;
  if (!(cell > 0) || bytes.byteLength !== 40 + count * 4) throw new Error("Punktstatistiken har fel storlek");
  let values: Float32Array;
  if (LITTLE_ENDIAN) {
    const dataOffset = bytes.byteOffset + 40;
    if ((dataOffset & 3) === 0) {
      values = new Float32Array(bytes.buffer, dataOffset, count).slice();
    } else {
      const copy = new Uint8Array(count * 4);
      copy.set(bytes.subarray(40));
      values = new Float32Array(copy.buffer);
    }
  } else {
    values = new Float32Array(count);
    for (let i = 0; i < count; i += 1) values[i] = view.getFloat32(40 + i * 4, true);
  }
  return { minX, minY, cell, width, height, values };
}

/** Strömmande ackumulator för beskurna eller helrutade `punkter*.bin`-filer över samma globala rutnät. */
export function createPointStatsAccumulator(bounds: PointStatsBounds): PointStatsAccumulator {
  const { minX, minY, cell, width, height } = bounds, size = width * height;
  const values = new Float32Array(size * POINT_BANDS);
  for (let i = 0; i < size; i += 1) {
    const o = i * POINT_BANDS;
    values[o] = Number.NaN; values[o + 6] = Number.NaN; values[o + 7] = Number.NaN;
  }
  const intensitySum = new Float64Array(size), spreadSqSum = new Float64Array(size);
  return {
    add(tile: PointStats) {
      if (Math.abs(tile.cell - cell) > 1e-9) throw new Error("Punktstatistikens rutor har olika rutnät");
      const dx = Math.round((tile.minX - minX) / cell), dy = Math.round((tile.minY - minY) / cell);
      if (Math.abs(tile.minX - (minX + dx * cell)) > 1e-4 * cell || Math.abs(tile.minY - (minY + dy * cell)) > 1e-4 * cell) {
        throw new Error("Punktstatistikens rutor har olika rutnät");
      }
      const v = tile.values;
      const x0 = Math.max(0, -dx), x1 = Math.min(tile.width, width - dx);
      const y0 = Math.max(0, -dy), y1 = Math.min(tile.height, height - dy);
      for (let x = x0; x < x1; x += 1) {
        const srcCol = x * tile.height, dstCol = (x + dx) * height + dy;
        for (let y = y0; y < y1; y += 1) {
          const so = (srcCol + y) * POINT_BANDS;
          const top = v[so]!, total = v[so + 1]!;
          if (total === 0 && !Number.isFinite(top)) continue;
          const dstCell = dstCol + y, doff = dstCell * POINT_BANDS;
          if (Number.isFinite(top) && !(values[doff]! >= top)) values[doff] = top;
          values[doff + 1] = values[doff + 1]! + total;
          const n = v[so + 2]!;
          values[doff + 2] = values[doff + 2]! + n;
          values[doff + 3] = values[doff + 3]! + v[so + 3]!;
          values[doff + 4] = values[doff + 4]! + v[so + 4]!;
          values[doff + 5] = values[doff + 5]! + v[so + 5]!;
          if (n > 0) {
            intensitySum[dstCell] = intensitySum[dstCell]! + n * v[so + 6]!;
            const sp = v[so + 7]!;
            spreadSqSum[dstCell] = spreadSqSum[dstCell]! + n * sp * sp;
          }
        }
      }
    },
    finish(): PointStats {
      for (let c = 0; c < size; c += 1) {
        const o = c * POINT_BANDS, ground = values[o + 2]!;
        values[o + 6] = ground > 0 ? intensitySum[c]! / ground : Number.NaN;
        values[o + 7] = ground > 0 ? Math.sqrt(spreadSqSum[c]! / ground) : Number.NaN;
      }
      return { minX, minY, cell, width, height, values };
    }
  };
}

/** Rutorna slås ihop på samma cellrutnät (stödjer både identiska och beskurna delrutor): antal summeras, höjd tar max, medel vägs. */
export function mergePointStats(tiles: readonly PointStats[]): PointStats {
  const first = tiles[0];
  if (!first) throw new Error("Ingen punktstatistik");
  if (tiles.length === 1) return first;
  const cell = first.cell;
  let minX = first.minX, minY = first.minY, maxX = first.minX + first.width * cell, maxY = first.minY + first.height * cell;
  for (let k = 1; k < tiles.length; k += 1) {
    const t = tiles[k]!;
    if (Math.abs(t.cell - cell) > 1e-9) throw new Error("Punktstatistikens rutor har olika rutnät");
    if (t.minX < minX) minX = t.minX;
    if (t.minY < minY) minY = t.minY;
    const tx1 = t.minX + t.width * cell, ty1 = t.minY + t.height * cell;
    if (tx1 > maxX) maxX = tx1;
    if (ty1 > maxY) maxY = ty1;
  }
  const width = Math.round((maxX - minX) / cell), height = Math.round((maxY - minY) / cell);
  const acc = createPointStatsAccumulator({ minX, minY, cell, width, height });
  for (const tile of tiles) acc.add(tile);
  return acc.finish();
}

/**
 * Markträffarnas andel av alla träffar inom ±`reach` celler kring punkten (0–1), eller inget utan punkter. Hög andel = öppen
 * mark. Används för kärren (geo-moisture.ts): lärt av Högdalenkartan 2026-11-11, där flacka sänkor på öppen, skött mark sällan
 * är kärr (de är utdikade) medan samma form under träd är det.
 */
export function groundShareAt(stats: PointStats, reach = 2): (x: number, y: number) => number | undefined {
  const { width, height, cell, values } = stats, stride = height + 1;
  const all = new Float64Array((width + 1) * stride), ground = new Float64Array(all.length);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const o = (x * height + y) * POINT_BANDS, i = (x + 1) * stride + y + 1;
    all[i] = values[o + 1]! + all[x * stride + y + 1]! + all[(x + 1) * stride + y]! - all[x * stride + y]!;
    ground[i] = values[o + 2]! + ground[x * stride + y + 1]! + ground[(x + 1) * stride + y]! - ground[x * stride + y]!;
  }
  const sum = (table: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    table[x1 * stride + y1]! - table[x0 * stride + y1]! - table[x1 * stride + y0]! + table[x0 * stride + y0]!;
  return (px, py) => {
    const x = Math.floor((px - stats.minX) / cell), y = Math.floor((py - stats.minY) / cell);
    if (x < 0 || y < 0 || x >= width || y >= height) return undefined;
    const x0 = Math.max(0, x - reach), x1 = Math.min(width, x + reach + 1), y0 = Math.max(0, y - reach), y1 = Math.min(height, y + reach + 1);
    const n = sum(all, x0, y0, x1, y1);
    return n > 0 ? sum(ground, x0, y0, x1, y1) / n : undefined;
  };
}

export interface VegetationSignals { readonly openAt: (x: number, y: number) => boolean | undefined; readonly denseAt: (x: number, y: number) => boolean | undefined;
  /** Halvöppet (404): lågt med spridda träd, se `SEMI_TREE_SHARE`. */
  readonly semiAt?: (x: number, y: number) => boolean | undefined;
  /** Andelen träffar 1–3 m över marken (medel inom 4 m), 0 där vegetationen är lägre än 2 m: sparas i klassbilden så att mängden grönt kan dras utan en ny körning. */
  readonly denseShareAt?: (x: number, y: number) => number | undefined }
/**
 * Gränserna lärda av Högdalenkartan 2026-11-11 (tre rutor, mot kartritarens gula och gröna ytor).
 * Ägaren 2026-11-15 («trimma otid mot tyresta»): öppet kräver vegetation under 1 m (förut 1,5 m). Mot Tyresta (Pär Svensson
 * 2025, 6,5 km²) blev det öppna 150 → 130 ha mot kartritarens 82 (F 0,60 → 0,62), i Högdalen A F 0,33 → 0,35 och B oförändrat.
 * Tätt buskskikt (8 %) är oförändrat: Tyresta ville ha 10–12 %, Högdalen 8 %; i medel lika.
 */
export const OPEN_SHARE = 0.5, OPEN_HEIGHT_M = 1, DENSE_MID_SHARE = 0.08, DENSE_MIN_HEIGHT_M = 2;
/**
 * Ägaren 2026-11-16 (Väddö: hagmark och lövskog skannad lövfritt blev 403, «nyttja halvöppen mark mer», också halvtäta
 * frötallar): inom 8 m (9 × 9 celler) är minst 40 % lågt (under 1 m) och 25–60 % träd (högsta träff över 3 m), eller det är
 * öppet och minst 25 % träd. Mätt mot sex facitrutor (Högdalen, Djurgården, Gömmaren; kartritarnas 402 och 404, 9 ha): det
 * halvöppna gick från inget till F 0,37 (15 ha), det öppna F 0,39 → 0,37 och allt gult F 0,58 → 0,60.
 */
export const SEMI_LOW_SHARE = 0.4, SEMI_TREE_SHARE = 0.25, SEMI_TREE_MAX = 0.6, TREE_HEIGHT_M = 3;

/**
 * Öppet och tätt ur punktmolnet (lärt av Högdalenkartan 2026-11-11):
 * - **öppet** (gult): minst hälften av cellerna inom 6 m har ingen vegetation över 1,5 m. Träffade kartritarens gula ytor
 *   (401–404) med rätt mängd yta på alla tre rutorna (F 0,72), mot F 0,5 för Karttapullautins klass.
 * - **tätt** (grönt): i medel minst 8 % av träffarna 1–3 m över marken inom 4 m, och vegetationen i medel minst 2 m hög. Hittar två
 *   till tre gånger så mycket av kartritarens gröna som Karttapullautin, med rätt mängd yta.
 * Utan punkter i närheten: inget svar (Karttapullautins klass gäller).
 */
export function vegetationSignals(stats: PointStats, openShare = OPEN_SHARE, denseShare = DENSE_MID_SHARE): VegetationSignals {
  const { width, height, cell, values } = stats, stride = height + 1;
  const table = () => new Float64Array((width + 1) * stride);
  const known = table(), low = table(), mid = table(), tall = table(), trees = table();
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const o = (x * height + y) * POINT_BANDS, n = values[o + 1]!, top = Number.isFinite(values[o]!) ? values[o]! : 0;
    const i = (x + 1) * stride + y + 1, left = x * stride + y + 1, below = (x + 1) * stride + y, corner = x * stride + y;
    const add = (t: Float64Array, value: number) => { t[i] = value + t[left]! + t[below]! - t[corner]!; };
    add(known, n > 0 ? 1 : 0); add(low, n > 0 && top < OPEN_HEIGHT_M ? 1 : 0); add(mid, n > 0 ? values[o + 4]! / n : 0); add(tall, n > 0 ? top : 0);
    add(trees, n > 0 && top > TREE_HEIGHT_M ? 1 : 0);
  }
  const sum = (t: Float64Array, x: number, y: number, reach: number) => {
    const x0 = Math.max(0, x - reach), x1 = Math.min(width, x + reach + 1), y0 = Math.max(0, y - reach), y1 = Math.min(height, y + reach + 1);
    return t[x1 * stride + y1]! - t[x0 * stride + y1]! - t[x1 * stride + y0]! + t[x0 * stride + y0]!;
  };
  const cellOf = (px: number, py: number): [number, number] | undefined => {
    const x = Math.floor((px - stats.minX) / cell), y = Math.floor((py - stats.minY) / cell);
    return x < 0 || y < 0 || x >= width || y >= height ? undefined : [x, y];
  };
  return {
    openAt: (px, py) => { const at = cellOf(px, py); if (!at) return undefined; const n = sum(known, ...at, 3); return n > 0 ? sum(low, ...at, 3) / n >= openShare : undefined; },
    semiAt: (px, py) => {
      const at = cellOf(px, py); if (!at) return undefined;
      const n = sum(known, ...at, 4), near = sum(known, ...at, 3);
      if (n <= 0 || near <= 0) return undefined;
      const treeShare = sum(trees, ...at, 4) / n;
      if (treeShare < SEMI_TREE_SHARE) return false;
      return sum(low, ...at, 3) / near >= openShare || (sum(low, ...at, 4) / n >= SEMI_LOW_SHARE && treeShare < SEMI_TREE_MAX);
    },
    denseAt: (px, py) => {
      const at = cellOf(px, py); if (!at) return undefined;
      const n = sum(known, ...at, 2);
      return n > 0 ? sum(mid, ...at, 2) / n >= denseShare && sum(tall, ...at, 2) / n >= DENSE_MIN_HEIGHT_M : undefined;
    },
    denseShareAt: (px, py) => {
      const at = cellOf(px, py); if (!at) return undefined;
      const n = sum(known, ...at, 2);
      return n > 0 ? (sum(tall, ...at, 2) / n >= DENSE_MIN_HEIGHT_M ? sum(mid, ...at, 2) / n : 0) : undefined;
    }
  };
}

const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export function pointImages(stats: PointStats): { veg: Buffer; ground: Buffer; canopy: Buffer; world: string } {
  const { width, height, cell, values } = stats;
  const image = (write: (o: number, n: number, out: Uint8Array, p: number) => void) => encodePng(width, height, (column, line, out, p) => {
    const o = (column * height + (height - 1 - line)) * POINT_BANDS, n = values[o + 1]!;
    if (n > 0) { write(o, n, out, p); out[p + 3] = 255; }
    else { out[p] = 0; out[p + 1] = 0; out[p + 2] = 0; out[p + 3] = 0; }
  });
  return {
    veg: image((o, n, out, p) => {
      out[p] = Math.min(254, byte((Number.isFinite(values[o]!) ? values[o]! : 0) / 0.2));
      out[p + 1] = byte(255 * values[o + 2]! / n);
      out[p + 2] = byte(255 * values[o + 4]! / n);
    }),
    ground: image((o, n, out, p) => {
      out[p] = byte(255 * values[o + 3]! / n);
      out[p + 1] = Number.isFinite(values[o + 6]!) ? byte(values[o + 6]! / 64) : 0;
      out[p + 2] = Number.isFinite(values[o + 7]!) ? Math.min(254, byte(values[o + 7]! * 100)) : 255;
    }),
    canopy: image((o, n, out, p) => {
      out[p] = byte(255 * values[o + 5]! / n);
      out[p + 1] = byte(n);
      out[p + 2] = 0;
    }),
    world: `${cell}\n0\n0\n${-cell}\n${stats.minX + cell / 2}\n${stats.minY + (height - 0.5) * cell}\n`
  };
}
