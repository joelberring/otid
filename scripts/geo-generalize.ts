/**
 * Ägaren 2026-11-12 («för upphackade ytor mellan gult och grönt, de där hacken går inte att orientera sig efter i fart»,
 * «små skogsytor finns inte i praktiken», «jämna ut ojämnheter och ta bort vitt i mitten»): vegetationens ytor generaliseras
 * som en kartritare gör, innan de blir linjer.
 *
 * `smoothMask` stänger och öppnar masken med en åttkant på `radius` celler: vikar och hål smalare än ungefär två radier
 * fylls, och flikar och öar smalare än så tas bort. Mätt på lärkartorna (Högdalen, Djurgården, Lida, Gömmaren, Nåttarö) med
 * 6 m: det gröna får 35–45 % mindre kant per yta och träffarna mot kartorna är oförändrade.
 *
 * `fillSmallForest` ger små vita ytor (vanlig skog) mellan gult och grönt till den närmaste av dem, men bara där gult och
 * grönt täcker minst 60 % inom 20 m. Utan det villkoret växte det gröna 25–45 % på lärkartorna (det är redan för stort);
 * med det 5–10 %, med oförändrade träffar. Masker kolumnvis: index = kolumn · höjd + rad.
 */
export const SMOOTH_RADIUS_CELLS = 3;

/** Ett steg: en cell blir 1 om den eller en granne är 1 (`grow`) eller 0 om den eller en granne är 0. Åtta grannar när `diagonal`. */
function step(from: Uint8Array, to: Uint8Array, width: number, height: number, grow: boolean, diagonal: boolean): void {
  const want = grow ? 1 : 0;
  for (let x = 0; x < width; x += 1) {
    const left = x > 0, right = x + 1 < width;
    for (let y = 0; y < height; y += 1) {
      const i = x * height + y;
      if (from[i] === want) { to[i] = want; continue; }
      const down = y > 0, up = y + 1 < height;
      // Utanför bilden räknas inte: en yta varken krymper eller växer från bildens kant.
      let hit = (left ? from[i - height] === want : false) || (right ? from[i + height] === want : false) || (down ? from[i - 1] === want : false) || (up ? from[i + 1] === want : false);
      if (!hit && diagonal) {
        hit = (left && down ? from[i - height - 1] === want : false) || (left && up ? from[i - height + 1] === want : false)
          || (right && down ? from[i + height - 1] === want : false) || (right && up ? from[i + height + 1] === want : false);
      }
      to[i] = hit ? want : 1 - want;
    }
  }
}

/** `radius` steg, omväxlande fyra och åtta grannar (en åttkant). Resultatet ligger i den returnerade bufferten. */
function morph(mask: Uint8Array, spare: Uint8Array, width: number, height: number, radius: number, grow: boolean): [Uint8Array, Uint8Array] {
  let from = mask, to = spare;
  for (let k = 0; k < radius; k += 1) { step(from, to, width, height, grow, k % 2 === 1); [from, to] = [to, from]; }
  return [from, to];
}

/** Masken stängd med `radius` celler och sedan öppnad med `openRadius` (smala ytor som ska finnas kvar får en mindre öppning). `keep` (om den finns) är celler masken aldrig får växa in i. */
export function smoothMask(mask: Uint8Array, width: number, height: number, radius = SMOOTH_RADIUS_CELLS, keep?: Uint8Array, openRadius = radius): Uint8Array {
  if (radius <= 0) return mask;
  let a: Uint8Array = Uint8Array.from(mask), b: Uint8Array = new Uint8Array(mask.length);
  for (const [grow, cells] of [[true, radius], [false, radius], [false, openRadius], [true, openRadius]] as const) [a, b] = morph(a, b, width, height, cells, grow);
  if (keep) for (let i = 0; i < a.length; i += 1) if (keep[i]) a[i] = 0;
  return a;
}

/** Masken öppnad med `cells` steg (krympt och sedan vuxen): det som är smalare än så försvinner, resten behåller sin form. */
export function openMask(mask: Uint8Array, width: number, height: number, cells = 1): Uint8Array {
  let a: Uint8Array = Uint8Array.from(mask), b: Uint8Array = new Uint8Array(mask.length);
  for (const grow of [false, true]) [a, b] = morph(a, b, width, height, cells, grow);
  return a;
}

/** Masken sluten ett steg med åtta grannar (3 × 3: vuxen och sedan krympt): hål och vikar på en cell fylls. */
export function closeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const grown = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  step(mask, grown, width, height, true, true);
  step(grown, out, width, height, false, true);
  return out;
}

/**
 * Små vita ytor: celler som varken är `open`, `green` eller `blocked` och som hänger ihop i färre än `minCells` celler ges
 * till den av gult och grönt som ligger närmast (bredden först, högst `reach` steg). Ändrar `open` och `green` på plats och
 * ger antalet celler som bytte.
 */
export function fillSmallForest(open: Uint8Array, green: Uint8Array, blocked: Uint8Array | undefined, width: number, height: number, minCells: number, reach = 6,
  dominance = 0.6, window = 10): number {
  const size = open.length, state = new Uint8Array(size), queue = new Int32Array(size);
  // state: 0 = inte vit, 1 = vit och osedd, 2 = stor vit yta (lämnas), 3 = liten vit yta (ska fyllas).
  for (let i = 0; i < size; i += 1) state[i] = open[i] || green[i] || blocked?.[i] ? 0 : 1;
  // Summerad tabell över gult och grönt, för andelen inom `window` celler från en cell.
  const stride = height + 1, table = new Int32Array((width + 1) * stride);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const i = x * height + y;
    table[(x + 1) * stride + y + 1] = (open[i] || green[i] ? 1 : 0) + table[x * stride + y + 1]! + table[(x + 1) * stride + y]! - table[x * stride + y]!;
  }
  const around = (i: number) => {
    const x = Math.floor(i / height), y = i - x * height;
    const x0 = Math.max(0, x - window), x1 = Math.min(width, x + window + 1), y0 = Math.max(0, y - window), y1 = Math.min(height, y + window + 1);
    return (table[x1 * stride + y1]! - table[x0 * stride + y1]! - table[x1 * stride + y0]! + table[x0 * stride + y0]!) / ((x1 - x0) * (y1 - y0));
  };
  const neighbours = (i: number, visit: (n: number) => void) => {
    const x = Math.floor(i / height), y = i - x * height;
    if (x > 0) visit(i - height);
    if (x + 1 < width) visit(i + height);
    if (y > 0) visit(i - 1);
    if (y + 1 < height) visit(i + 1);
  };
  for (let start = 0; start < size; start += 1) {
    if (state[start] !== 1) continue;
    let head = 0, tail = 1, edge = false;
    queue[0] = start; state[start] = 2;
    while (head < tail) {
      const i = queue[head]!; head += 1;
      const x = Math.floor(i / height), y = i - x * height;
      // En vit yta som når bildens kant fortsätter utanför och räknas som stor.
      if (x === 0 || y === 0 || x + 1 === width || y + 1 === height) edge = true;
      neighbours(i, n => { if (state[n] === 1) { state[n] = 2; queue[tail] = n; tail += 1; } });
    }
    if (tail >= minCells || edge) continue;
    // Bara där gult och grönt dominerar omkring: i en mosaik med mest vitt är det de färgade fläckarna som är små.
    let coloured = 0;
    for (let k = 0; k < tail; k += 1) coloured += around(queue[k]!);
    if (coloured / tail >= dominance) for (let k = 0; k < tail; k += 1) state[queue[k]!] = 3;
  }
  // Fyll utifrån och in: varje liten vit cell tar klassen hos grannen som nådde den först.
  let head = 0, tail = 0, changed = 0;
  const depth = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    if (state[i] !== 3) continue;
    let near = false;
    neighbours(i, n => { if (open[n] || green[n]) near = true; });
    if (near) { queue[tail] = i; tail += 1; depth[i] = 1; }
  }
  while (head < tail) {
    const i = queue[head]!; head += 1;
    if (state[i] !== 3) continue;
    let opens = 0, greens = 0;
    neighbours(i, n => { if (open[n]) opens += 1; else if (green[n]) greens += 1; });
    if (opens + greens === 0) continue;
    if (opens >= greens) open[i] = 1; else green[i] = 1;
    state[i] = 0; changed += 1;
    if (depth[i]! >= reach) continue;
    neighbours(i, n => { if (state[n] === 3 && !depth[n]) { depth[n] = depth[i]! + 1; queue[tail] = n; tail += 1; } });
  }
  return changed;
}
