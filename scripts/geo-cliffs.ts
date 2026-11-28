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

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** 256-bytes bitmask-LUT för Zhang–Suens tunning (pass 0/1) och överflödiga 4-sammanhängande trappstegshörn i `paths`. */
const [THIN_LUT_0, THIN_LUT_1, CORNER_LUT] = (() => {
  const pass0 = new Uint8Array(256), pass1 = new Uint8Array(256), corner = new Uint8Array(256);
  const rx = [0, 1, 1, 1, 0, -1, -1, -1], ry = [1, 1, 0, -1, -1, -1, 0, 1];
  for (let m = 0; m < 256; m += 1) {
    let count = 0, trans = 0;
    for (let k = 0; k < 8; k += 1) { const a = (m >> k) & 1, b = (m >> ((k + 1) & 7)) & 1; count += a; if (!a && b) trans += 1; }
    const n = m & 1, ne = (m >> 1) & 1, e = (m >> 2) & 1, se = (m >> 3) & 1, s = (m >> 4) & 1, sw = (m >> 5) & 1, w = (m >> 6) & 1, nw = (m >> 7) & 1;
    if (count >= 2 && count <= 6 && trans === 1) {
      if (n * e * s === 0 && e * s * w === 0) pass0[m] = 1;
      if (n * e * w === 0 && n * s * w === 0) pass1[m] = 1;
    }
    if (count >= 2 && !(n && e && s && w) && ((n && e && !sw) || (e && s && !nw) || (s && w && !ne) || (w && n && !se))) {
      const bits: number[] = [];
      for (let k = 0; k < 8; k += 1) if ((m >> k) & 1) bits.push(k);
      const vis = new Uint8Array(8), q = [bits[0]!]; vis[bits[0]!] = 1;
      for (let h = 0; h < q.length; h += 1) for (const b of bits) if (!vis[b] && Math.abs(rx[q[h]!]! - rx[b]!) <= 1 && Math.abs(ry[q[h]!]! - ry[b]!) <= 1) { vis[b] = 1; q.push(b); }
      if (q.length === bits.length) corner[m] = 1;
    }
  }
  return [pass0, pass1, corner] as const;
})();

/** Zhang–Suens tunning: ytan blir en mittlinje som är en cell bred. Bara inre aktiva celler gås igenom, med 256-bytes LUT. */
export function thin(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  let interior = 0;
  for (let x = 0; x < width; x += 1) {
    const base = x * height, innerX = x > 0 && x < width - 1;
    for (let y = 0; y < height; y += 1) if (mask[base + y]) { out[base + y] = 1; if (innerX && y > 0 && y < height - 1) interior += 1; }
  }
  if (interior === 0) return out;
  const active = new Int32Array(interior), remove = new Int32Array(interior), h1 = height + 1, hm1 = height - 1;
  let activeCount = 0;
  for (let x = 1; x < width - 1; x += 1) for (let y = 1; y < height - 1; y += 1) if (out[x * height + y]) active[activeCount++] = x * height + y;
  for (let changed = true; changed && activeCount > 0;) {
    changed = false;
    for (let pass = 0; pass < 2; pass += 1) {
      const lut = pass === 0 ? THIN_LUT_0 : THIN_LUT_1;
      let rem = 0;
      for (let k = 0; k < activeCount; k += 1) {
        const i = active[k]!;
        const code = out[i + 1]! | (out[i + h1]! << 1) | (out[i + height]! << 2) | (out[i + hm1]! << 3)
          | (out[i - 1]! << 4) | (out[i - h1]! << 5) | (out[i - height]! << 6) | (out[i - hm1]! << 7);
        if (lut[code]) remove[rem++] = i;
      }
      if (rem > 0) {
        changed = true;
        for (let r = 0; r < rem; r += 1) out[remove[r]!] = 0;
        let kept = 0;
        for (let k = 0; k < activeCount; k += 1) if (out[active[k]!]) active[kept++] = active[k]!;
        activeCount = kept;
      }
    }
  }
  return out;
}

const DIR8_X = [-1, -1, -1, 0, 0, 1, 1, 1], DIR8_Y = [-1, 0, 1, -1, 1, -1, 0, 1];

/**
 * Mittlinjens vägar med linjär O(C) skelettgraf-spårning: i varje sammanhängande del den längsta vägen först, sedan
 * grenarna som är långa nog. Stora nät (> 2 000 celler) och träd spåras i O(C) via komprimerad skelettgraf.
 */
export function paths(skeleton: Uint8Array, width: number, height: number, minCells: number, maxCells = Number.POSITIVE_INFINITY): number[][] {
  const size = width * height, left = new Uint8Array(skeleton), out: number[][] = [];
  const from = new Int32Array(size).fill(-2), queue = new Int32Array(size), nodeId = new Int32Array(size).fill(-1), chainSeen = new Uint8Array(size);
  const h1 = height + 1, hm1 = height - 1;
  const for8 = (i: number, visit: (n: number) => void) => {
    const x = Math.floor(i / height), y = i - x * height;
    for (let d = 0; d < 8; d += 1) {
      const nx = x + DIR8_X[d]!, ny = y + DIR8_Y[d]!;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && left[nx * height + ny]) visit(nx * height + ny);
    }
  };
  const degNow = (i: number) => { let c = 0; for8(i, () => { c += 1; }); return c; };
  const pushEdge = (cells: readonly number[], rev: boolean, dst: number[]) => {
    if (!rev) for (let k = 0; k < cells.length; k += 1) dst.push(cells[k]!);
    else for (let k = cells.length - 1; k >= 0; k -= 1) dst.push(cells[k]!);
  };
  const bfsFarthest = (seed: number) => {
    from[seed] = -1; queue[0] = seed; let head = 0, tail = 1;
    while (head < tail) { const i = queue[head++]!; for8(i, n => { if (from[n] === -2) { from[n] = i; queue[tail++] = n; } }); }
    const end = queue[tail - 1]!, path: number[] = [];
    for (let i = end; i >= 0; i = from[i]!) path.push(i);
    for (let k = 0; k < tail; k += 1) from[queue[k]!] = -2;
    return { end, path, seen: tail };
  };
  const traceGraph = (comp: Int32Array, count: number, pruneCorners: boolean) => {
    if (pruneCorners) {
      for (let k = 0; k < count; k += 1) {
        const i = comp[k]!, x = Math.floor(i / height), y = i - x * height;
        if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1 || !left[i]) continue;
        const code = left[i + 1]! | (left[i + h1]! << 1) | (left[i + height]! << 2) | (left[i + hm1]! << 3)
          | (left[i - 1]! << 4) | (left[i - h1]! << 5) | (left[i - height]! << 6) | (left[i - hm1]! << 7);
        if (CORNER_LUT[code]) left[i] = 0;
      }
    }
    const nodePixel: number[] = [];
    for (let k = 0; k < count; k += 1) { const p = comp[k]!; if (left[p] && degNow(p) !== 2) { nodeId[p] = nodePixel.length; nodePixel.push(p); } }
    const edgeU: number[] = [], edgeV: number[] = [], edgeLen: number[] = [], edgeCells: number[][] = [];
    const adj: number[][] = Array.from({ length: nodePixel.length }, () => []);
    for (let v = 0; v < nodePixel.length; v += 1) {
      const p = nodePixel[v]!;
      for8(p, n => {
        const w = nodeId[n]!;
        if (w >= 0) {
          if (v < w) { const eid = edgeU.length; edgeU.push(v); edgeV.push(w); edgeLen.push(1); edgeCells.push([]); adj[v]!.push(eid); adj[w]!.push(eid); }
        } else if (!chainSeen[n]) {
          const cells: number[] = [];
          let prev = p, cur = n;
          while (nodeId[cur]! < 0) {
            chainSeen[cur] = 1; cells.push(cur);
            let nxt = -1; for8(cur, cand => { if (cand !== prev && nxt < 0) nxt = cand; });
            if (nxt < 0) break; prev = cur; cur = nxt;
          }
          const endW = nodeId[cur]!;
          if (endW >= 0) { const eid = edgeU.length; edgeU.push(v); edgeV.push(endW); edgeLen.push(cells.length + 1); edgeCells.push(cells); adj[v]!.push(eid); if (endW !== v) adj[endW]!.push(eid); }
        }
      });
    }
    const nv = nodePixel.length, ne = edgeU.length, compPaths: number[][] = [];
    if (nv > 0 && ne === nv - 1) {
      const treeBfs = (root: number) => {
        const dist = new Int32Array(nv).fill(-1), parN = new Int32Array(nv).fill(-1), parE = new Int32Array(nv).fill(-1), ord = new Int32Array(nv);
        let ordLen = 0, far = root, farD = 0; dist[root] = 0; ord[ordLen++] = root;
        for (let oh = 0; oh < ordLen; oh += 1) {
          const u = ord[oh]!, du = dist[u]!;
          if (du > farD) { farD = du; far = u; }
          for (const eid of adj[u]!) { const to = edgeU[eid] === u ? edgeV[eid]! : edgeU[eid]!; if (dist[to] === -1) { dist[to] = du + edgeLen[eid]!; parN[to] = u; parE[to] = eid; ord[ordLen++] = to; } }
        }
        return { far, parN, parE, ord, ordLen };
      };
      const root = treeBfs(0).far, tree = treeBfs(root);
      const children: number[][] = Array.from({ length: nv }, () => []), childEdge: number[][] = Array.from({ length: nv }, () => []);
      for (let k = 0; k < tree.ordLen; k += 1) { const u = tree.ord[k]!, par = tree.parN[u]!; if (par >= 0) { children[par]!.push(u); childEdge[par]!.push(tree.parE[u]!); } }
      const bestDown = new Int32Array(nv), bestC = new Int32Array(nv).fill(-1), bestE = new Int32Array(nv).fill(-1);
      for (let k = tree.ordLen - 1; k >= 0; k -= 1) {
        const u = tree.ord[k]!, ch = children[u]!, ce = childEdge[u]!;
        for (let j = 0; j < ch.length; j += 1) { const l = edgeLen[ce[j]!]! + bestDown[ch[j]!]!; if (l > bestDown[u]!) { bestDown[u] = l; bestC[u] = ch[j]!; bestE[u] = ce[j]!; } }
      }
      const pending: { node: number; from: number; edge: number }[] = [{ node: root, from: -1, edge: -1 }];
      for (let pi = 0; pi < pending.length; pi += 1) {
        const { node: r, from: fr, edge } = pending[pi]!, path: number[] = [];
        if (edge >= 0) pushEdge(edgeCells[edge]!, edgeU[edge] !== fr, path);
        path.push(nodePixel[r]!);
        for (let cur = r; ;) {
          const ch = children[cur]!, ce = childEdge[cur]!, bc = bestC[cur]!;
          for (let j = 0; j < ch.length; j += 1) if (ch[j] !== bc) pending.push({ node: ch[j]!, from: cur, edge: ce[j]! });
          if (bc < 0) break;
          const eid = bestE[cur]!; pushEdge(edgeCells[eid]!, edgeU[eid] !== cur, path); path.push(nodePixel[bc]!); cur = bc;
        }
        if (path.length >= minCells) compPaths.push(path);
      }
    } else if (ne > 0) {
      const order = Array.from({ length: ne }, (_, eid) => eid).sort((a, b) => edgeLen[b]! - edgeLen[a]!);
      const usedEdge = new Uint8Array(ne), usedNode = new Uint8Array(nv);
      const extend = (fromNode: number, dst: number[]) => {
        for (let cur = fromNode; !usedNode[cur];) {
          usedNode[cur] = 1;
          let bestEid = -1, bestL = -1;
          for (const eid of adj[cur]!) if (!usedEdge[eid] && edgeLen[eid]! > bestL) { bestL = edgeLen[eid]!; bestEid = eid; }
          if (bestEid < 0) break;
          usedEdge[bestEid] = 1;
          const nxt = edgeU[bestEid] === cur ? edgeV[bestEid]! : edgeU[bestEid]!;
          pushEdge(edgeCells[bestEid]!, edgeU[bestEid] !== cur, dst);
          if (!usedNode[nxt]) dst.push(nodePixel[nxt]!);
          cur = nxt;
        }
      };
      for (const eid of order) {
        if (usedEdge[eid]) continue;
        usedEdge[eid] = 1;
        const u = edgeU[eid]!, v = edgeV[eid]!, back: number[] = [], fwd: number[] = [];
        if (!usedNode[u]) { back.push(nodePixel[u]!); extend(u, back); }
        back.reverse(); pushEdge(edgeCells[eid]!, false, back);
        if (!usedNode[v]) { fwd.push(nodePixel[v]!); extend(v, fwd); }
        for (const p of fwd) back.push(p);
        if (back.length >= minCells) compPaths.push(back);
      }
    }
    compPaths.sort((a, b) => b.length - a.length);
    for (const p of compPaths) out.push(p);
    for (let k = 0; k < count; k += 1) { const p = comp[k]!; left[p] = 0; nodeId[p] = -1; chainSeen[p] = 0; }
  };
  for (let start = 0; start < size; start += 1) {
    if (!left[start]) continue;
    const first = bfsFarthest(start);
    if (first.seen > maxCells || first.seen < minCells) { for (let k = 0; k < first.seen; k += 1) left[queue[k]!] = 0; continue; }
    let maxDeg = 0, firstEnd = -1, degSum = 0;
    for (let k = 0; k < first.seen; k += 1) { const p = queue[k]!, d = degNow(p); degSum += d; if (d > maxDeg) maxDeg = d; if (d === 1 && firstEnd < 0) firstEnd = p; }
    if (maxDeg <= 2) {
      const seq: number[] = [];
      let cur = firstEnd >= 0 ? firstEnd : queue[0]!, prev = -1;
      for (let step = 0; step < first.seen; step += 1) {
        seq.push(cur);
        let nxt = -1; for8(cur, n => { if (n !== prev && !(step > 0 && n === seq[0]) && nxt < 0) nxt = n; });
        if (nxt < 0) break; prev = cur; cur = nxt;
      }
      if (firstEnd >= 0 || first.seen === 1) { if (seq.length >= minCells) out.push(seq); }
      else { const half = Math.floor(seq.length / 2); if (half + 1 >= minCells) out.push(seq.slice(0, half + 1)); if (seq.length - half - 1 >= minCells) out.push(seq.slice(half + 1)); }
      for (let k = 0; k < first.seen; k += 1) left[queue[k]!] = 0;
      continue;
    }
    if (degSum / 2 === first.seen - 1 || first.seen > 2000) { traceGraph(queue, first.seen, first.seen > 2000); continue; }
    let end = first.end;
    while (left[start]) {
      const longest = bfsFarthest(end);
      if (longest.path.length < minCells) { for (let k = 0; k < longest.seen; k += 1) left[queue[k]!] = 0; break; }
      out.push(longest.path);
      for (const i of longest.path) left[i] = 0;
      for (const i of longest.path) for8(i, n => { if (degNow(n) <= 1) left[n] = 0; });
      if (!left[start]) break;
      const again = bfsFarthest(start);
      if (again.seen < minCells) { for (let k = 0; k < again.seen; k += 1) left[queue[k]!] = 0; break; }
      end = again.end;
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
export interface GroundBounds { readonly minX: number; readonly minY: number; readonly cell: number; readonly width: number; readonly height: number }
export interface GroundAccumulator { add(grid: GroundGrid): void; finish(rounds?: number, shared?: boolean): GroundGrid }

export function readGroundGrid(bytes: Uint8Array): GroundGrid {
  if (bytes.length < 40) throw new Error("Markrastret är för kort");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = Number(view.getBigUint64(24, true)), height = Number(view.getBigUint64(32, true)), count = width * height;
  if (!(width > 0 && height > 0) || bytes.length !== 40 + count * 4) throw new Error("Markrastret har fel storlek");
  let z: Float32Array;
  if (LITTLE_ENDIAN) {
    const off = bytes.byteOffset + 40;
    if ((off & 3) === 0) z = new Float32Array(bytes.buffer, off, count).slice();
    else { const copy = new Uint8Array(count * 4); copy.set(bytes.subarray(40)); z = new Float32Array(copy.buffer); }
  } else {
    z = new Float32Array(count);
    for (let i = 0; i < count; i += 1) z[i] = view.getFloat32(40 + i * 4, true);
  }
  return { minX: view.getFloat64(0, true), minY: view.getFloat64(8, true), cell: view.getFloat64(16, true), width, height, z };
}

/** Strömmande ackumulator för beskurna eller helrutade `mark*.bin`-filer över samma globala rutnät. */
export function createGroundAccumulator(bounds: GroundBounds): GroundAccumulator {
  const { minX, minY, cell, width, height } = bounds, size = width * height;
  const sum = new Float64Array(size), count = new Uint16Array(size);
  return {
    add(grid: GroundGrid) {
      if (Math.abs(grid.cell - cell) > 1e-9) throw new Error("Markrastren har olika cellstorlek");
      const dx = Math.round((grid.minX - minX) / cell), dy = Math.round((grid.minY - minY) / cell);
      if (Math.abs(grid.minX - (minX + dx * cell)) > 1e-4 * cell || Math.abs(grid.minY - (minY + dy * cell)) > 1e-4 * cell) {
        throw new Error("Markrastren täcker olika områden");
      }
      const gz = grid.z, x0 = Math.max(0, -dx), x1 = Math.min(grid.width, width - dx), y0 = Math.max(0, -dy), y1 = Math.min(grid.height, height - dy);
      for (let x = x0; x < x1; x += 1) {
        const srcBase = x * grid.height, dstBase = (x + dx) * height + dy;
        for (let y = y0; y < y1; y += 1) {
          const v = gz[srcBase + y]!;
          if (Number.isFinite(v)) { const dst = dstBase + y; sum[dst] = sum[dst]! + v; count[dst] = count[dst]! + 1; }
        }
      }
    },
    finish(rounds = 4, shared = false): GroundGrid {
      const targetBuffer = shared ? new SharedArrayBuffer(size * 4) : undefined;
      let z: Float32Array = targetBuffer ? new Float32Array(targetBuffer) : new Float32Array(size), hasGap = false;
      for (let i = 0; i < size; i += 1) if (count[i]) z[i] = sum[i]! / count[i]!; else { z[i] = Number.NaN; hasGap = true; }
      if (hasGap && rounds > 0) {
        let next: Float32Array = new Float32Array(size);
        for (let round = 0; round < rounds; round += 1) {
          next.set(z);
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
          const tmp = z; z = next; next = tmp;
          if (!filled) break;
        }
        if (targetBuffer && z.buffer !== targetBuffer) { const sharedView = new Float32Array(targetBuffer); sharedView.set(z); z = sharedView; }
      }
      return { minX, minY, cell, width, height, z };
    }
  };
}

/** Rutornas raster över det klippta området (stödjer även beskurna delrutor på samma cellrutnät): medel och luckfyllning. */
export function mergeGroundGrids(grids: readonly GroundGrid[], rounds = 4): GroundGrid {
  const first = grids[0];
  if (!first) throw new Error("Inget markraster");
  const cell = first.cell;
  let minX = first.minX, minY = first.minY, maxX = first.minX + first.width * cell, maxY = first.minY + first.height * cell;
  for (let k = 1; k < grids.length; k += 1) {
    const g = grids[k]!;
    if (Math.abs(g.cell - cell) > 1e-9) throw new Error("Markrastren har olika cellstorlek");
    if (g.minX < minX) minX = g.minX;
    if (g.minY < minY) minY = g.minY;
    maxX = Math.max(maxX, g.minX + g.width * cell); maxY = Math.max(maxY, g.minY + g.height * cell);
  }
  const acc = createGroundAccumulator({ minX, minY, cell, width: Math.round((maxX - minX) / cell), height: Math.round((maxY - minY) / cell) });
  for (const grid of grids) acc.add(grid);
  return acc.finish(rounds);
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
  /** Valfria skalanpassade lutnings- och skärpegränser synkade med `cliff-choice.ts`. */
  readonly minSlope?: number | undefined;
  readonly impassableSlope?: number | undefined;
  readonly minSharpness?: number | undefined;
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

/** Punkter längs linjens segment med högst `stepM` meter mellan varandra (ursprungliga hörn bevaras). */
function sampleLine(line: readonly (readonly [number, number])[], stepM: number): [number, number][] {
  if (line.length === 0) return [];
  const out: [number, number][] = [[line[0]![0], line[0]![1]]];
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = line[i - 1]!, [bx, by] = line[i]!, length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(length / stepM));
    for (let k = 1; k <= steps; k += 1) out.push([ax + (bx - ax) * k / steps, ay + (by - ay) * k / steps]);
  }
  return out;
}

const lineLength = (line: readonly (readonly [number, number])[]): number => {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  return total;
};

/**
 * Delar och riktar en brantlinje lokalt efter tecknet i `scores` (positivt = nedför till höger): byter fallriktningen
 * ihållande över minst `minLengthM` (t.ex. över en sadel mellan två motställda branter) delas linjen i bitar som vänds var
 * för sig; annars vänds hela linjen bara om summan är negativ.
 */
function orientSegments(points: readonly (readonly [number, number])[], scores: readonly number[], minLengthM: number): [number, number][][] {
  const n = points.length;
  if (n < 2) return [];
  // Löpande medelvärde över ±3 punkter så enstaka cellsteg/brus inte orsakar delningar.
  const smooth = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    total += scores[i]!;
    let sum = 0, count = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(n - 1, i + 3); k += 1) { sum += scores[k]!; count += 1; }
    smooth[i] = count > 0 ? sum / count : 0;
  }
  // Dela upp i sammanhängande sträckor med samma lokala tecken.
  const runs: { from: number; to: number; sign: number; length: number; sum: number }[] = [];
  let start = 0, sign = 0;
  for (let i = 0; i < n; i += 1) {
    const s = Math.abs(smooth[i]!) > 1e-4 ? Math.sign(smooth[i]!) : sign;
    if (sign === 0) { sign = s; continue; }
    if (s !== 0 && s !== sign) {
      const piece = points.slice(start, i + 1);
      let sum = 0; for (let k = start; k <= i; k += 1) sum += scores[k]!;
      runs.push({ from: start, to: i, sign, length: lineLength(piece), sum });
      start = i; sign = s;
    }
  }
  {
    const piece = points.slice(start);
    let sum = 0; for (let k = start; k < n; k += 1) sum += scores[k]!;
    runs.push({ from: start, to: n - 1, sign: sign || (total < 0 ? -1 : 1), length: lineLength(piece), sum });
  }
  // Slå ihop korta övergångar med föregående/närmaste sträcka; dela bara när minst två sträckor når `minLengthM` åt olika håll.
  const significant = runs.filter(run => run.length >= minLengthM);
  const hasFlip = significant.some(run => run.sign > 0) && significant.some(run => run.sign < 0);
  if (!hasFlip) {
    const copy = points.map(([x, y]) => [x, y] as [number, number]);
    return [total < 0 ? copy.reverse() : copy];
  }
  const merged: typeof runs = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && (run.length < minLengthM || prev.sign === run.sign)) {
      prev.to = run.to; prev.length += run.length; prev.sum += run.sum;
    } else merged.push({ ...run });
  }
  if (merged.length > 1 && merged[0]!.length < minLengthM) {
    merged[1]!.from = merged[0]!.from; merged[1]!.length += merged[0]!.length; merged[1]!.sum += merged[0]!.sum;
    merged.shift();
  }
  const out: [number, number][][] = [];
  for (const run of merged) {
    const slice = points.slice(run.from, run.to + 1).map(([x, y]) => [x, y] as [number, number]);
    if (lineLength(slice) < minLengthM) continue;
    out.push(run.sum < 0 ? slice.reverse() : slice);
  }
  return out;
}

/**
 * Brantlinjen flyttas till överkanten (ISOM: linjen ritas i brantens överkant, taggarna nedför). Linjen samplas först tätt
 * (var 2 m) så förenklade långa segment ändå följer överkanten, och för varje punkt läses markens profil tvärs linjen, 4 m
 * uppför till 2 m nedför i halvmetersteg; överkanten är där profilen bryter nedåt mest (minsta andraderivatan). Förflyttningen
 * jämnas ut längs linjen (median av tre) och är högst 3 m; utan mark lämnas punkten. Linjer ur markrastret ligger mitt i
 * branten, som kan vara bred: för dem söks överkanten längre uppför (`up` 8,5 m, högst 7 m).
 */
export function toTopEdge(line: readonly (readonly [number, number])[], ground: GroundGrid, up = 4.5): [number, number][] {
  if (line.length < 2) return line.map(([x, y]) => [x, y]);
  const dense = sampleLine(line, 2);
  const normals = dense.map((_, i) => {
    const [ax, ay] = dense[Math.max(0, i - 1)]!, [bx, by] = dense[Math.min(dense.length - 1, i + 1)]!, length = Math.hypot(bx - ax, by - ay) || 1;
    // Nedför till höger om färdriktningen.
    return [(by - ay) / length, -(bx - ax) / length] as const;
  });
  const shifts = dense.map(([x, y], i) => {
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
  if (shifts.every(shift => shift === 0)) return line.map(([x, y]) => [x, y]);
  // Median över ±2 täta punkter (~8 m fönster) + 1-2-1-utjämning så närliggande 2 m-punkter inte hoppar i sidled.
  const med = shifts.map((_, i) => {
    const window: number[] = [];
    for (let k = Math.max(0, i - 2); k <= Math.min(shifts.length - 1, i + 2); k += 1) window.push(shifts[k]!);
    window.sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)]!;
  });
  const smoothShift = med.map((s, i) => i === 0 || i === med.length - 1 ? s : (med[i - 1]! + 2 * s + med[i + 1]!) / 4);
  return dense.map(([x, y], i) => {
    const [rx, ry] = normals[i]!;
    return [x + rx * smoothShift[i]!, y + ry * smoothShift[i]!];
  });
}

/**
 * Lutningen som krävs för en brantlinje ur markrastret, och minsta längd. Lärt av Högdalenkartan 2026-11-12: Karttapullautins
 * streck gav en fjärdedel av kartans brantlinje (träff F 0,25–0,39); alla sammanhängande stråk brantare än 38° ger F 0,56–0,66
 * med 1,2–2,3 gånger kartans längd. Vid 35° blir det dubbelt så mycket linje, vid 40° tappas var femte brant.
 */
export const SLOPE_CLIFFS = { minDegrees: 35, minLengthM: 4.5 };

/** 1-2-1-utjämnat markraster (delas mellan brantlinjer och mittlinjens lutningsmått). */
function smoothGround121(ground: GroundGrid): Float32Array {
  const { width, height, z } = ground;
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
  return smooth;
}

function measureCliffSlopeDeg(line: readonly (readonly [number, number])[], ground: GroundGrid, smooth: Float32Array): number {
  const { width, height, cell } = ground;
  if (width < 3 || height < 3) return NaN;
  const slopes: number[] = [];
  for (let i = 1; i < line.length; i += 1) {
    const [ax, ay] = line[i - 1]!, [bx, by] = line[i]!, segment = Math.hypot(bx - ax, by - ay);
    if (segment === 0) continue;
    for (let step = 0.5; step < segment; step += 1) {
      const x = ax + (bx - ax) * step / segment, y = ay + (by - ay) * step / segment;
      const gx = Math.floor((x - ground.minX) / cell), gy = Math.floor((y - ground.minY) / cell);
      if (gx >= 1 && gy >= 1 && gx < width - 1 && gy < height - 1) {
        const idx = gx * height + gy;
        const dx = (smooth[idx + height]! - smooth[idx - height]!) / (2 * cell);
        const dy = (smooth[idx + 1]! - smooth[idx - 1]!) / (2 * cell);
        if (Number.isFinite(dx) && Number.isFinite(dy)) slopes.push(Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI);
      }
    }
  }
  return median(slopes);
}

/**
 * Brantlinjer ur markrastret: celler brantare än `minDegrees` (på lätt utjämnad mark) tunnas till mittlinjer, riktade så att
 * nedför är till höger. Fallet och sorten avgörs sedan som för strecken (measureCliff).
 */
export function slopeLines(ground: GroundGrid, settings: { readonly minDegrees: number; readonly minLengthM: number } = SLOPE_CLIFFS, preSmoothed?: Float32Array): [number, number][][] {
  const { width, height, cell, z } = ground;
  // Utjämning 1-2-1 åt båda håll (ungefär en halv cells spridning), så att enstaka punkter inte ger branter.
  const smooth = preSmoothed ?? smoothGround121(ground);
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
    if (lineLength(points) < settings.minLengthM) continue;
    // Nedför (mot lutningen) ska ligga till höger om färdriktningen: lokalt längs linjen över ±2 steg.
    const scores = points.map((_, k) => {
      const a = points[Math.max(0, k - 2)]!, b = points[Math.min(points.length - 1, k + 2)]!;
      const tx = b[0] - a[0], ty = b[1] - a[1], len = Math.hypot(tx, ty) || 1;
      return (ty * -gx[path[k]!]! + -tx * -gy[path[k]!]!) / len;
    });
    for (const oriented of orientSegments(points, scores, settings.minLengthM)) {
      const line = simplify(oriented, 1.1);
      if (line.length >= 2) lines.push(line);
    }
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

/** En brant med sina mått: fallet inom 3 och 6 m (m), längden (m), mittlinjelutning (grader) och brantkantsskärpa (`drop3/drop6`). Linjen ligger i överkanten med nedför till höger. */
export interface CliffCandidate { readonly line: [number, number][]; readonly drop3: number; readonly drop6: number; readonly length: number;
  readonly slope?: number | undefined; readonly sharpness?: number | undefined }
/** Den lösa gränsen för `branter.geojson` (ägaren 2026-11-12: ändra utan ny körning): allt från 0,8 m fall sparas. */
export const CLIFF_LOOSE_DROP = 0.8;
/** Vad en brant blir med reglerna: opasserbar, passerbar eller ingen alls. Samma regel i webbläsaren. */
export function classifyCliff(
  cliff: { drop3: number; drop6: number; length: number; slope?: number | undefined; sharpness?: number | undefined },
  rules: CliffRules
): "impassable" | "passable" | undefined {
  if (!Number.isFinite(cliff.drop3) || cliff.drop3 < rules.minDrop) return undefined;
  if (rules.minSlope !== undefined && cliff.slope !== undefined && Number.isFinite(cliff.slope) && cliff.slope < rules.minSlope) return undefined;
  if (rules.minSharpness !== undefined && cliff.sharpness !== undefined && Number.isFinite(cliff.sharpness) && cliff.sharpness < rules.minSharpness) {
    if (!(cliff.slope !== undefined && Number.isFinite(cliff.slope) && cliff.slope >= 46)) return undefined;
  }
  const steepEnough = rules.impassableSlope === undefined || cliff.slope === undefined || !Number.isFinite(cliff.slope) || cliff.slope >= rules.impassableSlope;
  return cliff.drop3 >= rules.impassableDrop3 && Number.isFinite(cliff.drop6) && cliff.drop6 >= rules.impassableDrop6
    && cliff.length >= rules.impassableLength && steepEnough ? "impassable" : "passable";
}

/** Kontrollerar fallriktningen i markrastret längs en brantlinje och delar/vänder den om nedför ligger till vänster. */
function orientByGround(line: readonly (readonly [number, number])[], ground: GroundGrid, minLengthM: number): [number, number][][] {
  if (line.length < 2) return [];
  const dense = sampleLine(line, 2);
  let measured = 0;
  const scores = dense.map(([x, y], i) => {
    const [ax, ay] = dense[Math.max(0, i - 1)]!, [bx, by] = dense[Math.min(dense.length - 1, i + 1)]!, len = Math.hypot(bx - ax, by - ay) || 1;
    const rx = (by - ay) / len, ry = -(bx - ax) / len;
    const up = heightAt(ground, x - rx * 3, y - ry * 3), down = heightAt(ground, x + rx * 3, y + ry * 3);
    if (!Number.isFinite(up) || !Number.isFinite(down)) return 0;
    measured += 1;
    return up - down;
  });
  if (measured === 0) return [line.map(([x, y]) => [x, y])];
  return orientSegments(dense, scores, minLengthM);
}

export function cliffsFromTicks(impassable: readonly Tick[], passable: readonly Tick[], settings: CliffSettings = DEFAULT_CLIFFS, ground?: GroundGrid,
  rules: CliffRules = DEFAULT_CLIFF_RULES, tags = false) {
  const meters = (lines: [number, number][][]) => Math.round(lines.reduce((sum, line) => sum + line.reduce((part, point, i) =>
    i === 0 ? 0 : part + Math.hypot(point[0] - line[i - 1]![0], point[1] - line[i - 1]![1]), 0), 0));
  let high: [number, number][][], low: [number, number][][], dropped = 0;
  const candidates: CliffCandidate[] = [];
  if (ground) {
    high = []; low = [];
    // Branterna ur markrastret först; Karttapullautins streck fyller bara på där rastret inte gav någon linje inom 6 m.
    // Markera `taken` längs hela segmenten (var 3 m), inte bara förenklade hörn, så dubbla branter inte läggs ovanpå.
    const smooth = smoothGround121(ground);
    const own = slopeLines(ground, SLOPE_CLIFFS, smooth), taken = new Set<string>();
    for (const line of own) for (const [x, y] of sampleLine(line, 3)) {
      for (let ax = -1; ax <= 1; ax += 1) for (let ay = -1; ay <= 1; ay += 1) taken.add(`${Math.floor(x / 6) + ax},${Math.floor(y / 6) + ay}`);
    }
    const extra = cliffLines([...impassable, ...passable], settings).filter(line => {
      const samples = sampleLine(line, 3);
      return samples.filter(([x, y]) => taken.has(`${Math.floor(x / 6)},${Math.floor(y / 6)}`)).length * 2 < samples.length;
    });
    const entries: { line: [number, number][]; fromGround: boolean }[] = [
      ...own.map(line => ({ line, fromGround: true })),
      ...extra.flatMap(line => orientByGround(line, ground, settings.minLengthM).map(oriented => ({ line: oriented, fromGround: false })))
    ];
    for (const { line, fromGround } of entries) {
      const { drop3, drop6, length } = measureCliff(line, ground);
      if (!Number.isFinite(drop3)) { low.push(line); continue; }
      if (drop3 < Math.min(rules.minDrop, CLIFF_LOOSE_DROP)) { dropped += 1; continue; }
      const slope = measureCliffSlopeDeg(line, ground, smooth);
      const sharpness = Number.isFinite(drop6) && drop6 > 0.1 ? drop3 / drop6 : NaN;
      // Fallet mäts kring brantens mitt; linjen samplas tätt och ritas sedan i överkanten.
      const top = evenLine(toTopEdge(line, ground, fromGround ? 8.5 : 4.5));
      // Alla branter från den lösa gränsen sparas med sina mått, så att reglagen i webbläsaren väljer utan ny körning.
      candidates.push({ line: top, drop3, drop6, length, slope, sharpness });
      const kind = classifyCliff({ drop3, drop6, length, slope, sharpness }, rules);
      if (!kind) { dropped += 1; continue; }
      if (kind === "impassable") high.push(top); else low.push(top);
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
    lines: { impassable: high, passable: low }, candidates,
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
  const png = encodePng(width, height, (column, line, out, o) => {
    const shade = shadeValue(ground, step, column, height - 1 - line);
    if (shade === undefined) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; }
    else { out[o] = shade; out[o + 1] = shade; out[o + 2] = shade; out[o + 3] = 255; }
  });
  return { png, world: `${size}\n0\n0\n${-size}\n${ground.minX + size / 2}\n${ground.minY + (height - 0.5) * size}\n`, width, height };
}

/**
 * Markens höjd som bild (träningsdata, ägaren 2026-11-11): cm + 10 000 som 24 bitar (R·65536 + G·256 + B), en bildpunkt per
 * cell, genomskinligt utan data. Världsfilen som för terrängskuggningen.
 */
export function heightPng(ground: GroundGrid): { png: Buffer; world: string } {
  const { width, height, cell } = ground;
  const png = encodePng(width, height, (column, line, out, o) => {
    const z = ground.z[column * height + (height - 1 - line)]!;
    if (!Number.isFinite(z)) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; return; }
    const value = Math.max(0, Math.min(0xffffff, Math.round(z * 100) + 10_000));
    out[o] = value >> 16; out[o + 1] = (value >> 8) & 255; out[o + 2] = value & 255; out[o + 3] = 255;
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
