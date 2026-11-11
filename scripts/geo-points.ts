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
export const POINT_BANDS = 8;

export function readPointStats(bytes: Uint8Array): PointStats {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 40) throw new Error("Punktstatistiken är för kort");
  const minX = view.getFloat64(0, true), minY = view.getFloat64(8, true), cell = view.getFloat64(16, true);
  const width = Number(view.getBigUint64(24, true)), height = Number(view.getBigUint64(32, true));
  if (!(cell > 0) || bytes.byteLength !== 40 + width * height * POINT_BANDS * 4) throw new Error("Punktstatistiken har fel storlek");
  const values = new Float32Array(width * height * POINT_BANDS);
  for (let i = 0; i < values.length; i += 1) values[i] = view.getFloat32(40 + i * 4, true);
  return { minX, minY, cell, width, height, values };
}

/** Rutorna har samma klippruta och därmed samma rutnät: antalen läggs ihop, höjden tar den högsta, medelvärdena vägs. */
export function mergePointStats(tiles: readonly PointStats[]): PointStats {
  const first = tiles[0];
  if (!first) throw new Error("Ingen punktstatistik");
  const same = tiles.every(tile => tile.width === first.width && tile.height === first.height && tile.minX === first.minX && tile.minY === first.minY && tile.cell === first.cell);
  if (!same) throw new Error("Punktstatistikens rutor har olika rutnät");
  if (tiles.length === 1) return first;
  const values = new Float32Array(first.values.length);
  for (let cell = 0; cell < first.width * first.height; cell += 1) {
    const o = cell * POINT_BANDS;
    let top = Number.NaN, ground = 0, intensity = 0, spread = 0;
    for (const tile of tiles) {
      const v = tile.values;
      if (Number.isFinite(v[o]!) && !(top >= v[o]!)) top = v[o]!;
      for (const band of [1, 2, 3, 4, 5]) values[o + band] = values[o + band]! + v[o + band]!;
      const n = v[o + 2]!;
      if (n > 0) { ground += n; intensity += n * v[o + 6]!; spread += n * v[o + 7]! * v[o + 7]!; }
    }
    values[o] = top;
    values[o + 6] = ground > 0 ? intensity / ground : Number.NaN;
    values[o + 7] = ground > 0 ? Math.sqrt(spread / ground) : Number.NaN;
  }
  return { ...first, values };
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

const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export function pointImages(stats: PointStats): { veg: Buffer; ground: Buffer; canopy: Buffer; world: string } {
  const { width, height, cell, values } = stats;
  const at = (column: number, line: number) => (column * height + (height - 1 - line)) * POINT_BANDS;
  const image = (pixel: (o: number, n: number) => readonly [number, number, number]) => encodePng(width, height, (column, line) => {
    const o = at(column, line), n = values[o + 1]!;
    return n > 0 ? [...pixel(o, n), 255] as [number, number, number, number] : [0, 0, 0, 0];
  });
  return {
    veg: image((o, n) => [Math.min(254, byte((Number.isFinite(values[o]!) ? values[o]! : 0) / 0.2)), byte(255 * values[o + 2]! / n), byte(255 * values[o + 4]! / n)]),
    ground: image((o, n) => [byte(255 * values[o + 3]! / n), Number.isFinite(values[o + 6]!) ? byte(values[o + 6]! / 64) : 0,
      Number.isFinite(values[o + 7]!) ? Math.min(254, byte(values[o + 7]! * 100)) : 255]),
    canopy: image((o, n) => [byte(255 * values[o + 5]! / n), byte(n), 0]),
    world: `${cell}\n0\n0\n${-cell}\n${stats.minX + cell / 2}\n${stats.minY + (height - 0.5) * cell}\n`
  };
}
