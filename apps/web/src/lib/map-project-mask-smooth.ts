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

/** Avståndet (i tredjedels celler, 3 rakt och 4 snett) från varje cell till närmaste cell med värdet `to`; två svep över bilden. */
function distance(mask: Uint8Array, columns: number, rows: number, to: 0 | 1): Uint16Array {
  const FAR = 60_000, out = new Uint16Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) out[i] = mask[i] === to ? 0 : FAR;
  for (let x = 0; x < columns; x += 1) for (let y = 0; y < rows; y += 1) {
    const i = x * rows + y;
    let best = out[i]!;
    if (best === 0) continue;
    if (y > 0) best = Math.min(best, out[i - 1]! + 3);
    if (x > 0) {
      best = Math.min(best, out[i - rows]! + 3);
      if (y > 0) best = Math.min(best, out[i - rows - 1]! + 4);
      if (y + 1 < rows) best = Math.min(best, out[i - rows + 1]! + 4);
    }
    out[i] = Math.min(best, FAR);
  }
  for (let x = columns - 1; x >= 0; x -= 1) for (let y = rows - 1; y >= 0; y -= 1) {
    const i = x * rows + y;
    let best = out[i]!;
    if (best === 0) continue;
    if (y + 1 < rows) best = Math.min(best, out[i + 1]! + 3);
    if (x + 1 < columns) {
      best = Math.min(best, out[i + rows]! + 3);
      if (y + 1 < rows) best = Math.min(best, out[i + rows + 1]! + 4);
      if (y > 0) best = Math.min(best, out[i + rows - 1]! + 4);
    }
    out[i] = best;
  }
  return out;
}

/**
 * Samma som `smoothMask` (stäng med `radius`, öppna med `openRadius`) men med avstånd i stället för ett steg i taget, så att
 * tiden inte växer med radien. Formen är en åttkant här också, men inte cell för cell densamma som `smoothMask`; den används
 * därför bara där radien är stor (förenklingen av grönt). Bildens kant räknas inte som utanför.
 */
export function smoothMaskWide(mask: Uint8Array, columns: number, rows: number, radius: number, openRadius = radius): Uint8Array {
  let current = mask;
  // Växa = nära en etta; krympa = inte nära en nolla.
  for (const [grow, cells] of [[true, radius], [false, radius], [false, openRadius], [true, openRadius]] as const) {
    if (cells <= 0) continue;
    const far = distance(current, columns, rows, grow ? 1 : 0), next = new Uint8Array(mask.length), limit = cells * 3;
    for (let i = 0; i < next.length; i += 1) next[i] = (far[i]! <= limit) === grow ? 1 : 0;
    current = next;
  }
  return current;
}

/**
 * Ägaren 2026-11-14 («ett reglage som generaliserar gröna ytor mer, så att en sån här form blir enklare redovisad»): hål i
 * masken som är högst `maxCells` celler fylls igen (sammanhängande över sidor; det som når bildens kant är inget hål).
 */
export function fillHoles(mask: Uint8Array, columns: number, rows: number, maxCells: number): Uint8Array {
  if (maxCells <= 0) return mask;
  const out = Uint8Array.from(mask), seen = new Uint8Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || seen[start]) continue;
    const cells = [start];
    seen[start] = 1;
    let open = false;
    for (let k = 0; k < cells.length; k += 1) {
      const x = Math.floor(cells[k]! / rows), y = cells[k]! - x * rows;
      if (x === 0 || y === 0 || x + 1 === columns || y + 1 === rows) open = true;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        const i = nx * rows + ny;
        if (!mask[i] && !seen[i]) { seen[i] = 1; cells.push(i); }
      }
    }
    if (!open && cells.length <= maxCells) for (const cell of cells) out[cell] = 1;
  }
  return out;
}

/** Hur mycket en yta förenklas på skalan 0–10 (0 = bara den vanliga utjämningen), för celler om `cellMeters`. */
export interface Simplification { readonly close: number; readonly open: number; readonly holeCells: number; readonly areaFactor: number; readonly tolerance: number }
export function simplification(level: number, cellMeters: number): Simplification {
  const step = Math.max(0, Math.min(10, level));
  // Meter i terrängen, så att samma läge ger samma form oavsett cellstorlek: vikar upp till 5 m per steg sluts (radien är
  // hälften), armar smalare än 3 m per steg tas bort, och hål upp till 250 m² per steg fylls.
  const cells = (meters: number) => Math.round(meters / cellMeters);
  return { close: SMOOTH_RADIUS_CELLS + cells(step * 2.5), open: SMOOTH_RADIUS_CELLS + cells(step * 1.5), holeCells: Math.round(step * 250 / (cellMeters * cellMeters)),
    areaFactor: 1 + step / 2, tolerance: 0.75 + step * 0.2 };
}
