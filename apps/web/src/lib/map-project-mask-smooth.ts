/**
 * Ägaren 2026-11-12 («för upphackade ytor … måste generaliseras till enklare former»): samma utjämning som geo-arbetaren
 * (`smoothMask` i scripts/geo-generalize.ts), för ytorna som dras fram med reglagen i webbläsaren. Masken stängs med
 * `radius` celler och öppnas med `openRadius`, med en åttkant; kolumnvis: index = kolumn · rader + rad.
 */
export const SMOOTH_RADIUS_CELLS = 3;

function step(from: Uint8Array, to: Uint8Array, columns: number, rows: number, grow: boolean, diagonal: boolean): void {
  const want = grow ? 1 : 0;
  for (let x = 0; x < columns; x += 1) {
    const left = x > 0, right = x + 1 < columns;
    for (let y = 0; y < rows; y += 1) {
      const i = x * rows + y;
      if (from[i] === want) { to[i] = want; continue; }
      const down = y > 0, up = y + 1 < rows;
      let hit = (left && from[i - rows] === want) || (right && from[i + rows] === want) || (down && from[i - 1] === want) || (up && from[i + 1] === want);
      if (!hit && diagonal) {
        hit = (left && down && from[i - rows - 1] === want) || (left && up && from[i - rows + 1] === want)
          || (right && down && from[i + rows - 1] === want) || (right && up && from[i + rows + 1] === want);
      }
      to[i] = hit ? want : 1 - want;
    }
  }
}

export function smoothMask(mask: Uint8Array, columns: number, rows: number, radius = SMOOTH_RADIUS_CELLS, openRadius = radius): Uint8Array {
  if (radius <= 0) return mask;
  let a: Uint8Array = Uint8Array.from(mask), b: Uint8Array = new Uint8Array(mask.length);
  for (const [grow, cells] of [[true, radius], [false, radius], [false, openRadius], [true, openRadius]] as const) {
    for (let k = 0; k < cells; k += 1) { step(a, b, columns, rows, grow, k % 2 === 1); [a, b] = [b, a]; }
  }
  return a;
}
