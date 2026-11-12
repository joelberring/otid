/**
 * Grundkartan ur laser, G4 (ägaren 2026-11-10: «brantsymboler av olika typ vända åt rätt håll»). Karttapullautin ger branterna
 * som tusentals korta streck (2,94 m): varje streck ligger längs brantkanten mitt emellan en hög och en låg punkt, och den
 * låga sidan är till vänster om streckets riktning (`cliffs.rs`). Här blir strecken linjer:
 *
 * 1. strecken ritas i ett raster (1 m) och sluts (en cell), så att strecken längs samma brant hänger ihop,
 * 2. ytan tunnas till en mittlinje (Zhang–Suen),
 * 3. mittlinjen följs: den längsta vägen i varje del först, sedan grenarna som är långa nog,
 * 4. varje linje förenklas och vänds så att nedför är till höger om ritriktningen (där brantsymbolens taggar ritas).
 *
 * Opasserbara branter (Karttapullautins `c3g`) blir lagret `brant_opasserbar` (201), passerbara (`c2g`) `brant_passerbar`
 * (202); streck i `c2g` som ligger där det redan är opasserbart tas inte med två gånger.
 *
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`).
 */
import { encodePng, moistureDxf, simplify } from "./geo-moisture.ts";

export type Tick = readonly [x1: number, y1: number, x2: number, y2: number];
export interface CliffSettings {
  /** Kortare branter (m) tas inte med. */
  readonly minLengthM: number;
}
export const DEFAULT_CLIFFS: CliffSettings = { minLengthM: 6 };
const CELL = 1;

/** Strecken ur Karttapullautins DXF (POLYLINE med två VERTEX). */
export function readTicks(dxf: string): Tick[] {
  const lines = dxf.split(/\r?\n/), ticks: Tick[] = [];
  let points: number[] = [], inVertex = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!.trim(), value = lines[i + 1]!.trim();
    if (code === "0") {
      if (value === "SEQEND") { if (points.length >= 4) ticks.push([points[0]!, points[1]!, points[points.length - 2]!, points[points.length - 1]!]); points = []; }
      inVertex = value === "VERTEX";
    } else if (inVertex && (code === "10" || code === "20")) points.push(Number(value));
  }
  return ticks.filter(tick => tick.every(Number.isFinite));
}

interface Raster { readonly minX: number; readonly minY: number; readonly width: number; readonly height: number; readonly mask: Uint8Array;
  /** Streckens summerade riktning per cell. */
  readonly dx: Float32Array; readonly dy: Float32Array }

function rasterize(ticks: readonly Tick[]): Raster | undefined {
  if (ticks.length === 0) return undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x1, y1, x2, y2] of ticks) { minX = Math.min(minX, x1, x2); maxX = Math.max(maxX, x1, x2); minY = Math.min(minY, y1, y2); maxY = Math.max(maxY, y1, y2); }
  minX = Math.floor(minX) - 3; minY = Math.floor(minY) - 3;
  const width = Math.ceil(maxX - minX) + 4, height = Math.ceil(maxY - minY) + 4;
  if (width * height > 80_000_000) throw new Error("Området är för stort för branterna");
  const mask = new Uint8Array(width * height), dx = new Float32Array(width * height), dy = new Float32Array(width * height);
  for (const [x1, y1, x2, y2] of ticks) {
    const length = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / length, uy = (y2 - y1) / length;
    for (let step = 0; step <= length; step += 0.5) {
      const i = Math.floor((x1 + ux * step - minX) / CELL) * height + Math.floor((y1 + uy * step - minY) / CELL);
      mask[i] = 1; dx[i] = dx[i]! + ux; dy[i] = dy[i]! + uy;
    }
  }
  return { minX, minY, width, height, mask, dx, dy };
}

/** Slutning med en cell: luckor på en cell mellan streck fylls. */
function close(mask: Uint8Array, width: number, height: number): Uint8Array {
  const grown = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  for (let x = 1; x < width - 1; x += 1) for (let y = 1; y < height - 1; y += 1) {
    const i = x * height + y;
    if (mask[i] || mask[i - 1] || mask[i + 1] || mask[i - height] || mask[i + height]) grown[i] = 1;
  }
  for (let x = 1; x < width - 1; x += 1) for (let y = 1; y < height - 1; y += 1) {
    const i = x * height + y;
    if (grown[i] && grown[i - 1] && grown[i + 1] && grown[i - height] && grown[i + height]) out[i] = 1;
    else if (mask[i]) out[i] = 1;
  }
  return out;
}

/** Zhang–Suens tunning: ytan blir en mittlinje som är en cell bred. Bara cellerna i masken gås igenom. */
export function thin(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask);
  let active: number[] = [];
  for (let i = 0; i < out.length; i += 1) if (out[i]) active.push(i);
  // Grannarna P2…P9 medurs från norr (y uppåt): N, NO, O, SO, S, SV, V, NV.
  const offsets = [1, height + 1, height, height - 1, -1, -height - 1, -height, -height + 1];
  const at = (i: number) => (i >= 0 && i < out.length ? out[i]! : 0);
  for (let changed = true; changed;) {
    changed = false;
    for (const pass of [0, 1]) {
      const remove: number[] = [];
      for (const i of active) {
        const x = Math.floor(i / height), y = i - x * height;
        if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
        const p = offsets.map(offset => at(i + offset));
        const count = p.reduce((sum, value) => sum + value, 0);
        if (count < 2 || count > 6) continue;
        let transitions = 0;
        for (let k = 0; k < 8; k += 1) if (!p[k] && p[(k + 1) % 8]) transitions += 1;
        if (transitions !== 1) continue;
        const [n, , e, , s, , w] = p;
        if (pass === 0 ? (n! * e! * s! === 0 && e! * s! * w! === 0) : (n! * e! * w! === 0 && n! * s! * w! === 0)) remove.push(i);
      }
      if (remove.length) { changed = true; for (const i of remove) out[i] = 0; active = active.filter(i => out[i]); }
    }
  }
  return out;
}

/**
 * Mittlinjens vägar: i varje sammanhängande del den längsta vägen först, sedan det som blir kvar, så länge delarna är långa nog.
 * En del med fler än `maxCells` celler hoppas över: i bebyggelse hänger smala sänkor ihop i nät över hela området, och där
 * växer arbetet med kvadraten på nätets storlek (Djurgården 2026-11-11: steget blev aldrig klart).
 */
export function paths(skeleton: Uint8Array, width: number, height: number, minCells: number, maxCells = Number.POSITIVE_INFINITY): number[][] {
  const left = new Uint8Array(skeleton), out: number[][] = [];
  // Föregångaren per cell (−2 = inte besökt) och kön som fält i stället för Map och listor: sökningen görs många gånger.
  const from = new Int32Array(left.length).fill(-2), queue = new Int32Array(left.length);
  const neighbours = (i: number) => {
    const x = Math.floor(i / height), y = i - x * height, list: number[] = [];
    for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
      if ((ax || ay) && x + ax >= 0 && y + ay >= 0 && x + ax < width && y + ay < height && left[(x + ax) * height + y + ay]) list.push((x + ax) * height + y + ay);
    }
    return list;
  };
  /** Bredden först från `start`: den avlägsnaste cellen, vägen dit och antalet besökta celler (de ligger först i `queue`). */
  const farthest = (start: number) => {
    from[start] = -1; queue[0] = start;
    let head = 0, tail = 1;
    while (head < tail) {
      const i = queue[head]!; head += 1;
      for (const n of neighbours(i)) if (from[n] === -2) { from[n] = i; queue[tail] = n; tail += 1; }
    }
    const end = queue[tail - 1]!, path: number[] = [];
    for (let i = end; i >= 0; i = from[i]!) path.push(i);
    for (let k = 0; k < tail; k += 1) from[queue[k]!] = -2;
    return { end, path, seen: tail };
  };
  for (let start = 0; start < left.length; start += 1) {
    while (left[start]) {
      const first = farthest(start);
      if (first.seen > maxCells) { for (let k = 0; k < first.seen; k += 1) left[queue[k]!] = 0; break; }
      const longest = farthest(first.end);
      if (longest.path.length < minCells) { for (let k = 0; k < longest.seen; k += 1) left[queue[k]!] = 0; break; }
      out.push(longest.path);
      // Vägen och cellerna intill den tas bort, så att grenarna blir egna delar utan att följa vägen en gång till.
      for (const i of longest.path) { left[i] = 0; }
      for (const i of longest.path) for (const n of neighbours(i)) if (neighbours(n).length <= 1) left[n] = 0;
    }
  }
  return out;
}

/** Branternas linjer ur strecken, riktade så att nedför är till höger. */
export function cliffLines(ticks: readonly Tick[], settings: CliffSettings = DEFAULT_CLIFFS): [number, number][][] {
  const raster = rasterize(ticks);
  if (!raster) return [];
  const { minX, minY, width, height, dx, dy } = raster;
  const skeleton = thin(close(raster.mask, width, height), width, height);
  const lines: [number, number][][] = [];
  for (const path of paths(skeleton, width, height, Math.max(3, Math.round(settings.minLengthM / CELL / Math.SQRT2)))) {
    const points = path.map((i): [number, number] => { const x = Math.floor(i / height), y = i - x * height; return [minX + (x + 0.5) * CELL, minY + (y + 0.5) * CELL]; });
    let length = 0, along = 0;
    for (let k = 1; k < points.length; k += 1) {
      const tx = points[k]![0] - points[k - 1]![0], ty = points[k]![1] - points[k - 1]![1];
      length += Math.hypot(tx, ty);
      // Streckens riktning i cellen och grannarna (mittlinjen ligger inte alltid i en cell som ett streck gick genom).
      const x = Math.floor(path[k]! / height), y = path[k]! - x * height;
      for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
        const i = (x + ax) * height + y + ay;
        if (i >= 0 && i < dx.length) along += tx * dx[i]! + ty * dy[i]!;
      }
    }
    if (length < settings.minLengthM) continue;
    // Strecken har nedför till vänster: en linje som går med strecken vänds, så att nedför hamnar till höger.
    const line = simplify(along > 0 ? points.reverse() : points, 1.1);
    if (line.length >= 2) lines.push(line);
  }
  return lines;
}

/** Markens höjd i 1 m-celler från `lasclip` (cellen (x, y) täcker minX + x … +1, y uppåt; index x·height + y; NaN = ingen markpunkt). */
export interface GroundGrid { readonly minX: number; readonly minY: number; readonly cell: number; readonly width: number; readonly height: number; readonly z: Float32Array }

export function readGroundGrid(bytes: Uint8Array): GroundGrid {
  if (bytes.length < 40) throw new Error("Markrastret är för kort");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = Number(view.getBigUint64(24, true)), height = Number(view.getBigUint64(32, true));
  if (!(width > 0 && height > 0) || bytes.length !== 40 + width * height * 4) throw new Error("Markrastret har fel storlek");
  const z = new Float32Array(width * height);
  for (let i = 0; i < z.length; i += 1) z[i] = view.getFloat32(40 + i * 4, true);
  return { minX: view.getFloat64(0, true), minY: view.getFloat64(8, true), cell: view.getFloat64(16, true), width, height, z };
}

/** Rutornas raster över samma klippta område: medel där flera rutor har mark, och luckor fyllda från grannarna (högst `rounds` celler bort). */
export function mergeGroundGrids(grids: readonly GroundGrid[], rounds = 4): GroundGrid {
  const first = grids[0];
  if (!first) throw new Error("Inget markraster");
  const { width, height } = first, sum = new Float64Array(width * height), count = new Uint16Array(width * height);
  for (const grid of grids) {
    if (grid.width !== width || grid.height !== height) throw new Error("Markrastren täcker olika områden");
    for (let i = 0; i < sum.length; i += 1) if (Number.isFinite(grid.z[i]!)) { sum[i] = sum[i]! + grid.z[i]!; count[i] = count[i]! + 1; }
  }
  let z = Float32Array.from(sum, (value, i) => count[i] ? value / count[i] : NaN);
  for (let round = 0; round < rounds; round += 1) {
    const next = new Float32Array(z);
    let filled = 0;
    for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
      const i = x * height + y;
      if (Number.isFinite(z[i]!)) continue;
      let total = 0, n = 0;
      for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
        const nx = x + ax, ny = y + ay;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const value = z[nx * height + ny]!;
        if (Number.isFinite(value)) { total += value; n += 1; }
      }
      if (n >= 2) { next[i] = total / n; filled += 1; }
    }
    z = next;
    if (!filled) break;
  }
  return { ...first, z };
}

const heightAt = (grid: GroundGrid, x: number, y: number) => {
  const column = Math.floor((x - grid.minX) / grid.cell), row = Math.floor((y - grid.minY) / grid.cell);
  return column < 0 || row < 0 || column >= grid.width || row >= grid.height ? NaN : grid.z[column * grid.height + row]!;
};
const median = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]! : NaN;

export interface CliffRules {
  /** Minsta fall (m) över ±3 m för att linjen ska vara en brant alls. */
  readonly minDrop: number;
  /** Opasserbar: minst så stort fall över ±3 m och över ±6 m, och minst så lång (m). */
  readonly impassableDrop3: number; readonly impassableDrop6: number; readonly impassableLength: number;
}
/**
 * Minsta fallet är Kungshatt-kedjans (`s3c_brantkontroll.py`). Gränsen för opasserbar är lärd av Högdalenkartan 2026-11-12:
 * med Kungshatts 2,4 m blev tre till åtta gånger för mycket opasserbart när linjerna kommer ur markrastret; 4,5 m fall
 * över ±3 m och minst 20 m längd ger bäst träff (F 0,47–0,62), fortfarande med 1,6–3 gånger kartans längd.
 */
export const DEFAULT_CLIFF_RULES: CliffRules = { minDrop: 1.3, impassableDrop3: 4.5, impassableDrop6: 4.5, impassableLength: 20 };

/**
 * Brantens fall mätt i markrastret (ägaren 2026-11-10, som i Kungshatt-kedjan): varje meter längs linjen jämförs marken
 * 3 m (och 6 m) uppför med marken lika långt nedför (linjen har nedför till höger). Medianen avgör: ingen brant, brant
 * (202) eller opasserbar brant (201). Utan mätvärden (linjen ligger utanför rastret) behåller linjen sin sort.
 */
export function measureCliff(line: readonly (readonly [number, number])[], ground: GroundGrid): { drop3: number; drop6: number; length: number } {
  const drops3: number[] = [], drops6: number[] = [];
  let length = 0;
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = line[i - 1]!, [bx, by] = line[i]!, segment = Math.hypot(bx - ax, by - ay);
    if (segment === 0) continue;
    const rx = (by - ay) / segment, ry = -(bx - ax) / segment;
    for (let step = 0.5; step < segment; step += 1) {
      const x = ax + (bx - ax) * step / segment, y = ay + (by - ay) * step / segment;
      for (const [reach, into] of [[3, drops3], [6, drops6]] as const) {
        const up = heightAt(ground, x - rx * reach, y - ry * reach), down = heightAt(ground, x + rx * reach, y + ry * reach);
        if (Number.isFinite(up) && Number.isFinite(down)) into.push(up - down);
      }
    }
    length += segment;
  }
  return { drop3: median(drops3), drop6: median(drops6), length };
}

/**
 * Brantlinjen flyttas till överkanten (ISOM: linjen ritas i brantens överkant, taggarna nedför). För varje punkt läses
 * markens profil tvärs linjen, 4 m uppför till 2 m nedför i halvmetersteg, och överkanten är där profilen bryter nedåt mest
 * (minsta andraderivatan). Förflyttningen jämnas ut längs linjen (median av tre) och är högst 3 m; utan mark lämnas punkten.
 * Linjer ur markrastret ligger mitt i branten, som kan vara bred: för dem söks överkanten längre uppför (`up` 8,5 m, högst 7 m).
 */
export function toTopEdge(line: readonly (readonly [number, number])[], ground: GroundGrid, up = 4.5): [number, number][] {
  const normals = line.map((_, i) => {
    const [ax, ay] = line[Math.max(0, i - 1)]!, [bx, by] = line[Math.min(line.length - 1, i + 1)]!, length = Math.hypot(bx - ax, by - ay) || 1;
    // Nedför till höger om färdriktningen.
    return [(by - ay) / length, -(bx - ax) / length] as const;
  });
  const shifts = line.map(([x, y], i) => {
    const [rx, ry] = normals[i]!;
    const profile: number[] = [];
    for (let t = -up; t <= 2.5; t += 0.5) profile.push(heightAt(ground, x + rx * t, y + ry * t));
    let best = 0, bestCurve = Infinity;
    for (let k = 1; k < profile.length - 1; k += 1) {
      const t = -up + k * 0.5;
      if (t > 2) break;
      const curve = profile[k - 1]! - 2 * profile[k]! + profile[k + 1]!;
      if (Number.isFinite(curve) && curve < bestCurve) { bestCurve = curve; best = t; }
    }
    return Number.isFinite(bestCurve) && bestCurve < -0.1 ? Math.max(1.5 - up, Math.min(3, best)) : 0;
  });
  return line.map(([x, y], i) => {
    const near = [shifts[Math.max(0, i - 1)]!, shifts[i]!, shifts[Math.min(line.length - 1, i + 1)]!].sort((a, b) => a - b);
    const [rx, ry] = normals[i]!;
    return [x + rx * near[1]!, y + ry * near[1]!];
  });
}

/**
 * Lutningen som krävs för en brantlinje ur markrastret, och minsta längd. Lärt av Högdalenkartan 2026-11-12: Karttapullautins
 * streck gav en fjärdedel av kartans brantlinje (träff F 0,25–0,39); alla sammanhängande stråk brantare än 38° ger F 0,56–0,66
 * med 1,2–2,3 gånger kartans längd. Vid 35° blir det dubbelt så mycket linje, vid 40° tappas var femte brant.
 */
export const SLOPE_CLIFFS = { minDegrees: 38, minLengthM: 6 };

/**
 * Brantlinjer ur markrastret: celler brantare än `minDegrees` (på lätt utjämnad mark) tunnas till mittlinjer, riktade så att
 * nedför är till höger. Fallet och sorten avgörs sedan som för strecken (measureCliff).
 */
export function slopeLines(ground: GroundGrid, settings: { readonly minDegrees: number; readonly minLengthM: number } = SLOPE_CLIFFS): [number, number][][] {
  const { width, height, cell, z } = ground;
  // Utjämning 1-2-1 åt båda håll (ungefär en halv cells spridning), så att enstaka punkter inte ger branter.
  const smooth = new Float32Array(z.length).fill(NaN);
  for (let x = 1; x < width - 1; x += 1) for (let y = 1; y < height - 1; y += 1) {
    let sum = 0, weight = 0;
    for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) {
      const value = z[(x + ax) * height + y + ay]!;
      if (!Number.isFinite(value)) continue;
      const w = (ax ? 1 : 2) * (ay ? 1 : 2);
      sum += value * w; weight += w;
    }
    if (weight > 0 && Number.isFinite(z[x * height + y]!)) smooth[x * height + y] = sum / weight;
  }
  const limit = Math.tan(settings.minDegrees * Math.PI / 180), mask = new Uint8Array(z.length);
  const gx = new Float32Array(z.length), gy = new Float32Array(z.length);
  for (let x = 1; x < width - 1; x += 1) for (let y = 1; y < height - 1; y += 1) {
    const i = x * height + y, dx = (smooth[i + height]! - smooth[i - height]!) / (2 * cell), dy = (smooth[i + 1]! - smooth[i - 1]!) / (2 * cell);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
    gx[i] = dx; gy[i] = dy;
    if (Math.hypot(dx, dy) >= limit) mask[i] = 1;
  }
  const skeleton = thin(close(mask, width, height), width, height), lines: [number, number][][] = [];
  for (const path of paths(skeleton, width, height, Math.max(3, Math.round(settings.minLengthM / cell / Math.SQRT2)), 50_000)) {
    const points = path.map((i): [number, number] => { const x = Math.floor(i / height), y = i - x * height; return [ground.minX + (x + 0.5) * cell, ground.minY + (y + 0.5) * cell]; });
    let length = 0, right = 0;
    for (let k = 1; k < points.length; k += 1) {
      const tx = points[k]![0] - points[k - 1]![0], ty = points[k]![1] - points[k - 1]![1];
      length += Math.hypot(tx, ty);
      // Nedför (mot lutningen) ska ligga till höger om färdriktningen: högernormalen är (ty, −tx).
      right += ty * -gx[path[k]!]! + -tx * -gy[path[k]!]!;
    }
    if (length < settings.minLengthM) continue;
    const line = simplify(right < 0 ? points.reverse() : points, 1.1);
    if (line.length >= 2) lines.push(line);
  }
  return lines;
}

/**
 * Hela kedjan: opasserbara och passerbara branter som DXF, och en sammanfattning. Med markrastret (`ground`) görs linjerna av
 * alla streck tillsammans och sorten avgörs av det uppmätta fallet; utan det avgör Karttapullautins två filer. Med `tags`
 * heter de passerbara branternas lager «brant_passerbar_taggar», som föreslås som brant med streck (202.1).
 */
/**
 * Ägaren 2026-11-12 («branternas taggar ser konstiga ut»): linjen ur rastret går i trappsteg och varje punkt flyttas för sig
 * till överkanten, så den sicksackar och taggarna pekar åt olika håll. Här jämnas den ut (två varv 1-2-1 på de inre
 * punkterna; ändarna ligger kvar) och förenklas till 1,5 m.
 */
export function evenLine(line: readonly (readonly [number, number])[]): [number, number][] {
  let points = line.map(([x, y]) => [x, y] as [number, number]);
  if (points.length < 3) return points;
  for (let pass = 0; pass < 2; pass += 1) {
    points = points.map((point, i) => i === 0 || i === points.length - 1 ? point
      : [(points[i - 1]![0] + 2 * point[0] + points[i + 1]![0]) / 4, (points[i - 1]![1] + 2 * point[1] + points[i + 1]![1]) / 4] as [number, number]);
  }
  return simplify(points, 1.5);
}

export function cliffsFromTicks(impassable: readonly Tick[], passable: readonly Tick[], settings: CliffSettings = DEFAULT_CLIFFS, ground?: GroundGrid,
  rules: CliffRules = DEFAULT_CLIFF_RULES, tags = false) {
  const meters = (lines: [number, number][][]) => Math.round(lines.reduce((sum, line) => sum + line.reduce((part, point, i) =>
    i === 0 ? 0 : part + Math.hypot(point[0] - line[i - 1]![0], point[1] - line[i - 1]![1]), 0), 0));
  let high: [number, number][][], low: [number, number][][], dropped = 0;
  if (ground) {
    high = []; low = [];
    // Branterna ur markrastret först; Karttapullautins streck fyller bara på där rastret inte gav någon linje inom 6 m.
    const own = slopeLines(ground), taken = new Set<string>();
    for (const line of own) for (const [x, y] of line) {
      for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) taken.add(`${Math.floor(x / 6) + ax},${Math.floor(y / 6) + ay}`);
    }
    const extra = cliffLines([...impassable, ...passable], settings)
      .filter(line => line.filter(([x, y]) => taken.has(`${Math.floor(x / 6)},${Math.floor(y / 6)}`)).length * 2 < line.length);
    const fromGround = new Set(own);
    for (const line of [...own, ...extra]) {
      const { drop3, drop6, length } = measureCliff(line, ground);
      if (!Number.isFinite(drop3)) { low.push(line); continue; }
      if (drop3 < rules.minDrop) { dropped += 1; continue; }
      // Fallet mäts kring Karttapullautins läge (mitt i branten); linjen ritas sedan i överkanten.
      const top = evenLine(toTopEdge(line, ground, fromGround.has(line) ? 8.5 : 4.5));
      if (drop3 >= rules.impassableDrop3 && drop6 >= rules.impassableDrop6 && length >= rules.impassableLength) high.push(top); else low.push(top);
    }
  } else {
    // Passerbara streck där det redan är opasserbart (inom 2 m) hör till den opasserbara branten.
    const taken = new Set<string>();
    const key = (x: number, y: number) => `${Math.round(x / 2)},${Math.round(y / 2)}`;
    for (const [x1, y1, x2, y2] of impassable) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      for (let ax = -2; ax <= 2; ax += 2) for (let ay = -2; ay <= 2; ay += 2) taken.add(key(mx + ax, my + ay));
    }
    high = cliffLines(impassable, settings);
    low = cliffLines(passable.filter(([x1, y1, x2, y2]) => !taken.has(key((x1 + x2) / 2, (y1 + y2) / 2))), settings);
  }
  return { dxf: moistureDxf([{ name: "brant_opasserbar", closed: false, parts: high }, { name: tags ? "brant_passerbar_taggar" : "brant_passerbar", closed: false, parts: low }]),
    lines: { impassable: high, passable: low },
    summary: { cliffs201: high.length, cliffs202: low.length, cliffMeters201: meters(high), cliffMeters202: meters(low), ...(ground ? { cliffsDropped: dropped } : {}) } };
}

/**
 * Terrängskuggning ur markrastret (ägaren 2026-11-10: «terrängskuggning som man kan tona för att få en förståelse för
 * kurvbilden»): ljus från nordväst blandat med ljus rakt uppifrån (branter mörka åt alla håll), som en gråskalebild med
 * världsfil. Mycket stora raster glesas ut så att bilden blir högst `maxSide` punkter i sida.
 */
/** Skuggningens grå (0–255) för en cell i det utglesade rastret, eller inget där marken saknas. Rad 0 är längst i söder. */
export function shadeValue(ground: GroundGrid, step: number, column: number, row: number): number | undefined {
  const size = ground.cell * step;
  const z = (c: number, r: number) => {
    const x = Math.min(ground.width - 1, Math.max(0, c * step)), y = Math.min(ground.height - 1, Math.max(0, r * step));
    return ground.z[x * ground.height + y]!;
  };
  const here = z(column, row);
  if (!Number.isFinite(here)) return undefined;
  const value = (c: number, r: number) => { const v = z(c, r); return Number.isFinite(v) ? v : here; };
  const dx = (value(column + 1, row) - value(column - 1, row)) / (2 * size), dy = (value(column, row + 1) - value(column, row - 1)) / (2 * size);
  // Ljuset kommer från nordväst, 45° över horisonten.
  const lx = -0.5, ly = 0.5, lz = Math.SQRT1_2, length = Math.hypot(dx, dy, 1);
  const lit = Math.max(0, (-dx * lx - dy * ly + lz) / length);
  // Plan mark blir ljusgrå (0,8), sluttningar mot ljuset ljusare och bort från det mörkare; branter mörknar åt alla håll.
  return Math.round(255 * Math.min(1, Math.max(0, 0.8 * lit / lz * (0.7 + 0.3 / length))));
}

export function hillshade(ground: GroundGrid, maxSide = 6000): { png: Buffer; world: string; width: number; height: number } {
  const step = Math.max(1, Math.ceil(Math.max(ground.width, ground.height) / maxSide));
  const width = Math.floor(ground.width / step), height = Math.floor(ground.height / step), size = ground.cell * step;
  const png = encodePng(width, height, (column, line) => {
    const shade = shadeValue(ground, step, column, height - 1 - line);
    return shade === undefined ? [0, 0, 0, 0] : [shade, shade, shade, 255];
  });
  return { png, world: `${size}\n0\n0\n${-size}\n${ground.minX + size / 2}\n${ground.minY + (height - 0.5) * size}\n`, width, height };
}

/**
 * Markens höjd som bild (träningsdata, ägaren 2026-11-11): cm + 10 000 som 24 bitar (R·65536 + G·256 + B), en bildpunkt per
 * cell, genomskinligt utan data. Världsfilen som för terrängskuggningen.
 */
export function heightPng(ground: GroundGrid): { png: Buffer; world: string } {
  const { width, height, cell } = ground;
  const png = encodePng(width, height, (column, line) => {
    const z = ground.z[column * height + (height - 1 - line)]!;
    if (!Number.isFinite(z)) return [0, 0, 0, 0];
    const value = Math.max(0, Math.min(0xffffff, Math.round(z * 100) + 10_000));
    return [value >> 16, (value >> 8) & 255, value & 255, 255];
  });
  return { png, world: `${cell}\n0\n0\n${-cell}\n${ground.minX + cell / 2}\n${ground.minY + (height - 0.5) * cell}\n` };
}

/**
 * Om marken lutar mer än `degrees` i punkten (kartans koordinater), räknat över ±2 m i markrastret. Används för att spärra
 * grönt i stup och branta sluttningar, där lövlös laser ger falskt grönt.
 */
export function steepAt(ground: GroundGrid, degrees: number): (x: number, y: number) => boolean {
  const limit = Math.tan(degrees * Math.PI / 180), reach = Math.max(1, Math.round(2 / ground.cell));
  return (x, y) => {
    const column = Math.floor((x - ground.minX) / ground.cell), row = Math.floor((y - ground.minY) / ground.cell);
    const at = (c: number, r: number) => c < 0 || r < 0 || c >= ground.width || r >= ground.height ? NaN : ground.z[c * ground.height + r]!;
    const dx = (at(column + reach, row) - at(column - reach, row)) / (2 * reach * ground.cell);
    const dy = (at(column, row + reach) - at(column, row - reach)) / (2 * reach * ground.cell);
    return Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > limit;
  };
}
