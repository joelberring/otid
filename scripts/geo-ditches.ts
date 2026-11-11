/**
 * Diken ur terrängformen (ägaren 2026-11-11: «terrängformstolkning, dvs markfuktighet kopplat till terrängform för diken»).
 * Markrastret från `lasclip` (1 m) jämförs med sin omgivning: den lokala reliefen är höjden minus medelhöjden inom `radius`
 * meter. Celler som ligger under omgivningen, har minst `depth` m högre mark på båda sidor och hör till en smal sänka (högst `maxWidth` m bred; breda sänkor
 * är gropar och dalar) tunnas till mittlinjer. Bara linjer som till minst hälften är fuktiga enligt fuktigheten tas med (annars
 * hällsprickor, hjulspår och stigar): en rak blir ett dike (`dike`, 305), en krokig ett fuktstråk (`fuktstrak_terrang`, 306).
 * Reliefen blir också en bild att tona som underlag (`relief.png`): mörkt under omgivningen, ljust över.
 *
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`).
 */
import { paths, thin, type GroundGrid } from "./geo-cliffs.ts";
import { encodePng, simplify } from "./geo-moisture.ts";

export interface DitchSettings { readonly depth: number; readonly radius: number; readonly maxWidth: number; readonly minLength: number; readonly straight: number }
export const DEFAULT_DITCHES: DitchSettings = { depth: 0.2, radius: 4, maxWidth: 4, minLength: 15, straight: 0.85 };
const MAX_CELLS = 60_000_000;

/** Summerad tabell (bredd+1 × höjd+1, kolumnvis) och summan i en ruta [x0, x1) × [y0, y1). */
function integral(values: ArrayLike<number>, width: number, height: number): Float64Array {
  const table = new Float64Array((width + 1) * (height + 1)), stride = height + 1;
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    table[(x + 1) * stride + y + 1] = values[x * height + y]! + table[x * stride + y + 1]! + table[(x + 1) * stride + y]! - table[x * stride + y]!;
  }
  return table;
}
function boxSum(table: Float64Array, height: number, x: number, y: number, reach: number, width: number): number {
  const stride = height + 1;
  const x0 = Math.max(0, x - reach), x1 = Math.min(width, x + reach + 1), y0 = Math.max(0, y - reach), y1 = Math.min(height, y + reach + 1);
  return table[x1 * stride + y1]! - table[x0 * stride + y1]! - table[x1 * stride + y0]! + table[x0 * stride + y0]!;
}

/** Höjden minus medelhöjden inom `radius` m (NaN där marken saknas). Index x·height + y som markrastret. */
export function localRelief(ground: GroundGrid, radius: number): Float32Array {
  const { width, height, z } = ground;
  if (width * height > MAX_CELLS) throw new Error("Området är för stort för reliefen");
  const reach = Math.max(1, Math.round(radius / ground.cell));
  const finite = Float64Array.from(z, value => Number.isFinite(value) ? value : 0), counts = Uint8Array.from(z, value => Number.isFinite(value) ? 1 : 0);
  const sums = integral(finite, width, height), number = integral(counts, width, height);
  const relief = new Float32Array(width * height).fill(Number.NaN);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const i = x * height + y;
    if (!counts[i]) continue;
    const n = boxSum(number, height, x, y, reach, width);
    if (n >= 4) relief[i] = z[i]! - boxSum(sums, height, x, y, reach, width) / n;
  }
  return relief;
}

/** Dikena och fuktstråken ur reliefen. `wetAt` säger om en punkt är fuktig; `blockedAt` om den ligger i vatten. */
export function ditchLines(ground: GroundGrid, relief: Float32Array, settings: DitchSettings = DEFAULT_DITCHES,
  wetAt?: (x: number, y: number) => boolean, blockedAt?: (x: number, y: number) => boolean): { name: "dike" | "fuktstrak_terrang"; points: [number, number][] }[] {
  const { width, height, cell } = ground;
  const centre = (i: number): [number, number] => { const x = Math.floor(i / height), y = i - x * height; return [ground.minX + (x + 0.5) * cell, ground.minY + (y + 0.5) * cell]; };
  // En dikescell ligger under omgivningen och har högre mark på båda sidor, halva största bredden bort, i någon riktning
  // (en kant i en bred grop har bara den ena sidan högre).
  const side = Math.max(1, Math.ceil(settings.maxWidth / 2 / cell));
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? Number.NaN : ground.z[x * height + y]!;
  const mask = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const i = x * height + y, here = ground.z[i]!;
    if (!(relief[i]! < -settings.depth / 2)) continue;
    const valley = [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dx, dy]) =>
      Math.min(at(x + dx! * side, y + dy! * side), at(x - dx! * side, y - dy! * side)) > here + settings.depth);
    if (valley && !(blockedAt && blockedAt(...centre(i)))) mask[i] = 1;
  }
  // Breda sänkor: det som är kvar efter en erosion med halva bredden, växt tillbaka lika mycket.
  const half = Math.max(1, Math.ceil(settings.maxWidth / 2 / cell)), table = integral(mask, width, height);
  const eroded = new Uint8Array(mask.length);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const full = (Math.min(width, x + half + 1) - Math.max(0, x - half)) * (Math.min(height, y + half + 1) - Math.max(0, y - half));
    if (mask[x * height + y] && boxSum(table, height, x, y, half, width) === full) eroded[x * height + y] = 1;
  }
  const wide = integral(eroded, width, height);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) if (boxSum(wide, height, x, y, half, width) > 0) mask[x * height + y] = 0;
  const lines: { name: "dike" | "fuktstrak_terrang"; points: [number, number][] }[] = [];
  for (const path of paths(thin(mask, width, height), width, height, Math.max(3, Math.round(settings.minLength / cell / Math.SQRT2)))) {
    const points = path.map(centre);
    let length = 0;
    for (let k = 1; k < points.length; k += 1) length += Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1]);
    if (length < settings.minLength) continue;
    const chord = Math.hypot(points.at(-1)![0] - points[0]![0], points.at(-1)![1] - points[0]![1]);
    // Ägaren 2026-11-11 («vattendrag på konstiga ställen, som högst uppe på berg»): sprickor i hällar är också smala raka sänkor,
    // så både diken och fuktstråk måste vara fuktiga till minst hälften enligt fuktigheten; utan fuktigheten blir det inga.
    if (!wetAt || points.filter(point => wetAt(...point)).length * 2 < points.length) continue;
    lines.push({ name: chord / length >= settings.straight ? "dike" : "fuktstrak_terrang", points: simplify(points, cell * 0.75) });
  }
  return lines;
}

/** Reliefen som bild: ±1 m blir mörkt till ljust kring mellangrått, utan mark genomskinligt. Med världsfil. */
export function reliefImage(ground: GroundGrid, relief: Float32Array, maxSide = 6000): { png: Buffer; world: string } {
  const step = Math.max(1, Math.ceil(Math.max(ground.width, ground.height) / maxSide));
  const width = Math.floor(ground.width / step), height = Math.floor(ground.height / step), size = ground.cell * step;
  const png = encodePng(width, height, (column, line) => {
    const value = relief[column * step * ground.height + (height - 1 - line) * step]!;
    if (!Number.isFinite(value)) return [0, 0, 0, 0];
    const shade = Math.round(128 + 127 * Math.max(-1, Math.min(1, value)));
    return [shade, shade, Math.min(255, shade + 20), 255];
  });
  return { png, world: `${size}\n0\n0\n${-size}\n${ground.minX + size / 2}\n${ground.minY + (height - 0.5) * size}\n` };
}
