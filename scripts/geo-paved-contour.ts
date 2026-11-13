/**
 * De belagda ytornas kant ur masken (ägaren 2026-11-13: «jämna vägkanter»). Rasterkanten (trappsteg i 2 m-celler) gav
 * taggiga kanter med spikar och inbuktningar också efter förenkling; i stället jämnas masken ut och kanten dras mellan
 * cellerna (provat på Bandhagen–Hagsätra: jämna kanter med oförändrad träff mot kartan):
 *
 * 1. Masken sluts ett steg (3 × 3).
 * 2. Den görs om till flyttal och jämnas ut med ett gaussiskt filter (sigma 1,5 celler, ±4 celler, separabelt).
 * 3. Konturen dras vid nivån 0,5 (marching squares) med linjär interpolation mellan cellernas mittpunkter. Runt rutnätet
 *    ligger en ram av nollor, så att alla ringar sluts. Ytan ligger till vänster om linjen: ytterkanter går moturs och hål
 *    medurs, som `maskRings`. I ett sadelfall (två motstående hörn inne) avgör rutans medelvärde om ytan hänger ihop.
 *
 * Bara Nodes egna moduler.
 */
import { closeMask } from "./geo-generalize.ts";

export const SMOOTH_SIGMA_CELLS = 1.5;
const KERNEL_RADIUS = 4;

/** Masken (index x · höjd + y) som flyttal, utjämnad med ett gaussiskt filter; utanför rutnätet räknas som 0. */
export function blurMask(mask: Uint8Array, width: number, height: number, sigma = SMOOTH_SIGMA_CELLS): Float32Array {
  const kernel = new Float64Array(2 * KERNEL_RADIUS + 1);
  let total = 0;
  for (let k = -KERNEL_RADIUS; k <= KERNEL_RADIUS; k += 1) { kernel[k + KERNEL_RADIUS] = Math.exp(-(k * k) / (2 * sigma * sigma)); total += kernel[k + KERNEL_RADIUS]!; }
  for (let k = 0; k < kernel.length; k += 1) kernel[k] = kernel[k]! / total;
  const along = new Float32Array(mask.length), out = new Float32Array(mask.length);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let k = Math.max(-KERNEL_RADIUS, -y); k <= KERNEL_RADIUS && y + k < height; k += 1) if (mask[x * height + y + k]) sum += kernel[k + KERNEL_RADIUS]!;
    along[x * height + y] = sum;
  }
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let k = Math.max(-KERNEL_RADIUS, -x); k <= KERNEL_RADIUS && x + k < width; k += 1) sum += kernel[k + KERNEL_RADIUS]! * along[(x + k) * height + y]!;
    out[x * height + y] = sum;
  }
  return out;
}

/**
 * Konturerna vid `level` i ett fält med värdet i cellernas mitt (index x · höjd + y). `minX`, `minY` är mitten av cellen
 * (0, 0). Ger slutna ringar (utan upprepad slutpunkt) med ytan till vänster.
 */
export function contourRings(field: Float32Array, grid: { readonly minX: number; readonly minY: number; readonly cell: number; readonly width: number; readonly height: number },
  level = 0.5): [number, number][][] {
  const { width, height, cell } = grid, columns = width + 2, rows = height + 2;
  // Noderna med ramen: nod (i, j) är cellen (i − 1, j − 1), och ramen är 0.
  const value = (i: number, j: number) => i < 1 || j < 1 || i > width || j > height ? 0 : field[(i - 1) * height + j - 1]!;
  // Kanterna mellan noder: 2 · nod för kanten åt höger från noden, 2 · nod + 1 för kanten uppåt.
  const edges = 2 * columns * rows, next = new Int32Array(edges).fill(-1), px = new Float64Array(edges), py = new Float64Array(edges);
  const node = (i: number, j: number) => i * rows + j;
  const cross = (i: number, j: number, upward: boolean): number => {
    const key = 2 * node(i, j) + (upward ? 1 : 0), a = value(i, j), b = upward ? value(i, j + 1) : value(i + 1, j), t = (level - a) / (b - a);
    px[key] = grid.minX + (i - 1 + (upward ? 0 : t)) * cell; py[key] = grid.minY + (j - 1 + (upward ? t : 0)) * cell;
    return key;
  };
  for (let i = 0; i + 1 < columns; i += 1) for (let j = 0; j + 1 < rows; j += 1) {
    // Rutans hörn moturs från nere till vänster, och kanterna i samma ordning: nedre, högra, övre, vänstra.
    const inside = [value(i, j) >= level, value(i + 1, j) >= level, value(i + 1, j + 1) >= level, value(i, j + 1) >= level];
    const count = inside.filter(Boolean).length;
    if (count === 0 || count === 4) continue;
    const keys = [() => cross(i, j, false), () => cross(i + 1, j, true), () => cross(i, j + 1, false), () => cross(i, j, true)];
    // Runt rutan moturs: där kanten går från inne till ute börjar en sträcka, där den går från ute till inne slutar en.
    const starts: number[] = [], ends: number[] = [];
    for (let k = 0; k < 4; k += 1) {
      if (inside[k] && !inside[(k + 1) % 4]) starts.push(k);
      else if (!inside[k] && inside[(k + 1) % 4]) ends.push(k);
    }
    // Sadelfallet: hänger ytan ihop genom rutans mitt går sträckan till nästa slut moturs, annars till det föregående.
    const joined = starts.length === 2 && (value(i, j) + value(i + 1, j) + value(i + 1, j + 1) + value(i, j + 1)) / 4 >= level;
    for (const start of starts) {
      let end = ends[0]!;
      if (starts.length === 2) for (let step = 1; step < 4; step += 1) { const k = (start + (joined ? step : 4 - step)) % 4; if (ends.includes(k)) { end = k; break; } }
      next[keys[start]!()] = keys[end]!();
    }
  }
  const rings: [number, number][][] = [];
  for (let start = 0; start < edges; start += 1) {
    if (next[start]! < 0) continue;
    const ring: [number, number][] = [];
    for (let key = start; key >= 0 && next[key]! >= 0;) {
      const last = ring[ring.length - 1];
      if (!last || last[0] !== px[key]! || last[1] !== py[key]!) ring.push([px[key]!, py[key]!]);
      const following = next[key]!;
      next[key] = -1; key = following;
    }
    if (ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]) ring.pop();
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Maskens utjämnade kant som ringar i meter. `minX`, `minY` är mitten av cellen (0, 0). */
export function smoothMaskRings(mask: Uint8Array, grid: { readonly minX: number; readonly minY: number; readonly cell: number; readonly width: number; readonly height: number })
  : [number, number][][] {
  return contourRings(blurMask(closeMask(mask, grid.width, grid.height), grid.width, grid.height), grid);
}
