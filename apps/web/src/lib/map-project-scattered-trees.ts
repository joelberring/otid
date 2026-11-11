/**
 * Ägaren 2026-11-11 («gula ytor som inte består av träd men inte är rent berg saknas»): en cell utan grönt där 20–75 %
 * av cellerna inom 8 m (fyra celler à 2 m) är öppna, blandat med träd (många gränser
 * mellan öppet och träd, nästan inget grönt; en rak skogskant räknas inte), är öppen mark med spridda träd (404). Öppna celler
 * i en sådan blandning räknas inte som öppen mark. Samma regel som geo-arbetaren
 * (`scatteredTrees` i scripts/geo-vegetation.ts). Klasserna kolumnvis: index = kolumn · rader + rad.
 */
export function scatteredTrees(classes: Uint8Array, columns: number, rows: number, shade: (value: number) => number, slow: number): Uint8Array {
  // Summerade tabeller: öppna celler, gröna celler och gränser mellan öppet och inte öppet (åt höger och uppåt).
  const stride = rows + 1, open = new Int32Array((columns + 1) * stride), green = new Int32Array(open.length), edges = new Int32Array(open.length);
  const isOpen = (x: number, y: number) => x < columns && y < rows && (classes[x * rows + y]! & 15) === 1;
  for (let x = 0; x < columns; x += 1) for (let y = 0; y < rows; y += 1) {
    const value = classes[x * rows + y]!, here = isOpen(x, y);
    const edge = (x + 1 < columns && isOpen(x + 1, y) !== here ? 1 : 0) + (y + 1 < rows && isOpen(x, y + 1) !== here ? 1 : 0);
    const i = (x + 1) * stride + y + 1, left = x * stride + y + 1, below = (x + 1) * stride + y, corner = x * stride + y;
    open[i] = (here ? 1 : 0) + open[left]! + open[below]! - open[corner]!;
    green[i] = (shade(value) >= slow ? 1 : 0) + green[left]! + green[below]! - green[corner]!;
    edges[i] = edge + edges[left]! + edges[below]! - edges[corner]!;
  }
  const sum = (table: Int32Array, x0: number, y0: number, x1: number, y1: number) =>
    table[x1 * stride + y1]! - table[x0 * stride + y1]! - table[x1 * stride + y0]! + table[x0 * stride + y0]!;
  const r = 4, out = new Uint8Array(columns * rows);
  for (let x = 0; x < columns; x += 1) for (let y = 0; y < rows; y += 1) {
    if (shade(classes[x * rows + y]!) >= slow) continue;
    const x0 = Math.max(0, x - r), x1 = Math.min(columns, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(rows, y + r + 1);
    const cells = (x1 - x0) * (y1 - y0), share = sum(open, x0, y0, x1, y1) / cells;
    // Blandat (inte en rak kant mot skogen): många gränser mellan öppet och träd, och nästan inget grönt.
    if (share >= 0.2 && share < 0.75 && sum(edges, x0, y0, x1, y1) >= 0.3 * cells && sum(green, x0, y0, x1, y1) < 0.2 * cells) out[x * rows + y] = 1;
  }
  return out;
}
