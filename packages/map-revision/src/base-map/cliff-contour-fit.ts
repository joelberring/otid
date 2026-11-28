import type { SourceFeature } from "../index";
import type { HeightField } from "./clear-contours";

/**
 * Koppling mellan branter (201/202) och slutliga kurvor (101/102/103) efter kurvutjämning och generalisering:
 *
 * 1. **Kurvanpassad brantplacering**: när en brant (201/202) löper nästan parallellt (< 32°) inom 3 m från en flyttad
 *    höjdkurva (101/102) och korsar eller slingrar över den flyttas brantens punkter mjukt till ena sidan (i första hand
 *    krönsidan / uppför, ≥ 0,95–1,15 m fri från kurvan, högst 2,5 m från ursprungspunkten), utjämnat längs branten så inga
 *    hack uppstår och prövat mot höjdrastret så att nedförstaggarnas riktning aldrig vänds.
 * 2. **Dämpa hjälpkurvor (103) på opasserbara branter (201)**: hjälpkurvebitar inom 2,5 m från en 201-brant klipps bort,
 *    och kvarvarande stumpar under 6 m tas bort.
 * 3. **Hård nedförsinvariant**: varje slutlig 201/202-brant prövas mot höjdrastret (`z_vänster > z_höger` i projektions-
 *    koordinater med Y uppåt, eftersom ISOM/ISSprOM-taggarna alltid ritas åt höger); om någon brant ändå vetter uppför
 *    vänds den som sista garanti (0 upp-och-nedvända branter).
 *
 * Ren, deterministisk kod utan I/O. Koordinater i meter (SWEREF 99 TM).
 */

type Position = readonly [number, number];
type MutablePos = [number, number];

const CONTOUR_LAYER = /^(contour|depression)(_index|_hojd)?$|^(hojdkurva|stodkurva|indexkurva)$/i;
const FORMLINE_LAYER = /^(formline(_hojd|_grop)?|hjalpkurva)$/i;
const IMPASSABLE_CLIFF_LAYER = /^(brant_opasserbar|stup|cliff3|cliff4)$/i;
const PASSABLE_CLIFF_LAYER = /^(brant_passerbar(_taggar)?|brant|cliff2|cliff)$/i;

const isCliffLayer = (layer: string) => IMPASSABLE_CLIFF_LAYER.test(layer) || PASSABLE_CLIFF_LAYER.test(layer);

const GRID_CELL_M = 8;
const SEARCH_DIST_M = 3.0;
const MAX_SHIFT_M = 2.5;
const SAMPLE_STEP_M = 1.5;
const FORMLINE_CLIP_DIST_M = 2.5;
const FORMLINE_SAMPLE_STEP_M = 1.0;
const MIN_FORMLINE_STUB_M = 6.0;
const PARALLEL_COS = Math.cos(32 * Math.PI / 180);
const CONTACT_COS = Math.cos(35 * Math.PI / 180);
const CROSS_PARALLEL_COS = Math.cos(42 * Math.PI / 180);

interface IndexedSegment {
  readonly id: number;
  readonly featureId: number;
  readonly ax: number; readonly ay: number;
  readonly bx: number; readonly by: number;
  readonly len: number;
  readonly tx: number; readonly ty: number;
  readonly minX: number; readonly minY: number;
  readonly maxX: number; readonly maxY: number;
}

class SegmentGrid {
  readonly segments: IndexedSegment[] = [];
  private readonly cells = new Map<number, number[]>();
  private seen = new Int32Array(0);
  private stamp = 0;

  private cellKey(cx: number, cy: number): number {
    return (cx + 0x1000000) * 0x2000000 + (cy + 0x1000000);
  }

  addPolyline(featureId: number, points: readonly Position[], closed: boolean) {
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i += 1) {
      const a = points[i]!, b = points[(i + 1) % points.length]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len <= 1e-9) continue;
      const id = this.segments.length;
      const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]);
      const minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
      this.segments.push({
        id, featureId, ax: a[0], ay: a[1], bx: b[0], by: b[1], len,
        tx: dx / len, ty: dy / len, minX, minY, maxX, maxY
      });
      const x0 = Math.floor(minX / GRID_CELL_M), x1 = Math.floor(maxX / GRID_CELL_M);
      const y0 = Math.floor(minY / GRID_CELL_M), y1 = Math.floor(maxY / GRID_CELL_M);
      for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
        const key = this.cellKey(cx, cy);
        const list = this.cells.get(key);
        if (list) list.push(id); else this.cells.set(key, [id]);
      }
    }
  }

  queryBox(minX: number, minY: number, maxX: number, maxY: number, out: IndexedSegment[]): void {
    out.length = 0;
    if (this.segments.length === 0) return;
    if (this.seen.length < this.segments.length) this.seen = new Int32Array(this.segments.length);
    this.stamp += 1;
    if (this.stamp === 0x7fffffff) { this.seen.fill(0); this.stamp = 1; }
    const x0 = Math.floor(minX / GRID_CELL_M), x1 = Math.floor(maxX / GRID_CELL_M);
    const y0 = Math.floor(minY / GRID_CELL_M), y1 = Math.floor(maxY / GRID_CELL_M);
    for (let cx = x0; cx <= x1; cx += 1) for (let cy = y0; cy <= y1; cy += 1) {
      const list = this.cells.get(this.cellKey(cx, cy));
      if (!list) continue;
      for (let i = 0; i < list.length; i += 1) {
        const idx = list[i]!;
        if (this.seen[idx] === this.stamp) continue;
        this.seen[idx] = this.stamp;
        const seg = this.segments[idx]!;
        if (seg.maxX < minX || seg.minX > maxX || seg.maxY < minY || seg.minY > maxY) continue;
        out.push(seg);
      }
    }
  }

  minDistance(x: number, y: number, maxDist: number, scratch: IndexedSegment[]): number {
    this.queryBox(x - maxDist, y - maxDist, x + maxDist, y + maxDist, scratch);
    let bestSq = maxDist * maxDist + 1;
    for (let i = 0; i < scratch.length; i += 1) {
      const seg = scratch[i]!;
      const dSq = pointToSegmentDistSq(x, y, seg);
      if (dSq < bestSq) bestSq = dSq;
    }
    return bestSq <= maxDist * maxDist ? Math.sqrt(bestSq) : Infinity;
  }
}

function pointToSegment(x: number, y: number, seg: IndexedSegment): { cx: number; cy: number; distSq: number } {
  const dx = seg.bx - seg.ax, dy = seg.by - seg.ay;
  const t = Math.max(0, Math.min(1, ((x - seg.ax) * dx + (y - seg.ay) * dy) / (seg.len * seg.len)));
  const cx = seg.ax + t * dx, cy = seg.ay + t * dy;
  const ox = x - cx, oy = y - cy;
  return { cx, cy, distSq: ox * ox + oy * oy };
}

function pointToSegmentDistSq(x: number, y: number, seg: IndexedSegment): number {
  const dx = seg.bx - seg.ax, dy = seg.by - seg.ay;
  const t = Math.max(0, Math.min(1, ((x - seg.ax) * dx + (y - seg.ay) * dy) / (seg.len * seg.len)));
  const ox = x - (seg.ax + t * dx), oy = y - (seg.ay + t * dy);
  return ox * ox + oy * oy;
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx)) return false;
  if (Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) return false;
  const s1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const s2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  if ((s1 > 0 && s2 > 0) || (s1 < 0 && s2 < 0) || (s1 === 0 && s2 === 0)) return false;
  const s3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const s4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((s3 > 0 && s4 < 0) || (s3 < 0 && s4 > 0)) || (s3 === 0 && s4 !== 0) || (s4 === 0 && s3 !== 0);
}

function polylineLength(points: readonly Position[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    sum += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return sum;
}

function resampleLine(points: readonly Position[], step: number): MutablePos[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [[points[0]![0], points[0]![1]]];
  const out: MutablePos[] = [[points[0]![0], points[0]![1]]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!, b = points[i]!;
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (span <= 1e-9) continue;
    const count = Math.max(1, Math.ceil(span / step));
    for (let k = 1; k <= count; k += 1) {
      out.push([a[0] + (b[0] - a[0]) * k / count, a[1] + (b[1] - a[1]) * k / count]);
    }
  }
  return out.length >= 2 ? out : [[points[0]![0], points[0]![1]], [points[points.length - 1]![0], points[points.length - 1]![1]]];
}

function thinLine(points: readonly Position[], tolerance: number): MutablePos[] {
  if (points.length <= 2 || tolerance <= 0) return points.map(([x, y]) => [x, y]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    const a = points[from]!, b = points[to]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], span = Math.hypot(dx, dy);
    let worst = 0, at = -1;
    for (let i = from + 1; i < to; i += 1) {
      const p = points[i]!;
      const dist = span > 0 ? Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / span : Math.hypot(p[0] - a[0], p[1] - a[1]);
      if (dist > worst) { worst = dist; at = i; }
    }
    if (at >= 0 && worst > tolerance) { keep[at] = 1; stack.push([from, at], [at, to]); }
  }
  const out: MutablePos[] = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push([points[i]![0], points[i]![1]]);
  return out;
}

function polylineSelfCrosses(points: readonly Position[]): boolean {
  const segs = points.length - 1;
  if (segs < 3) return false;
  for (let i = 0; i < segs; i += 1) {
    const a = points[i]!, b = points[i + 1]!;
    for (let j = i + 2; j < segs; j += 1) {
      const c = points[j]!, d = points[j + 1]!;
      if (segmentsCross(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) return true;
    }
  }
  return false;
}

function bboxOf(points: readonly Position[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Mäter medianfallet (z_vänster − z_höger i meter) längs en riktad brant i projektionskoordinater (Y uppåt).
 * Positivt värde betyder att högersidan (där ISOM/ISSprOM-taggarna ritas) ligger nedför.
 */
function downhillDrop(points: readonly Position[], field: Pick<HeightField, "heightAt">): number | undefined {
  const probe = (reach: number): number[] => {
    const drops: number[] = [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!, b = points[i]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], seg = Math.hypot(dx, dy);
      if (seg <= 1e-9) continue;
      // Höger normal (nedför): (+dy, -dx) / seg; vänster normal (uppför): (-dy, +dx) / seg.
      const rx = dy / seg, ry = -dx / seg;
      const start = Math.min(0.5, seg / 2);
      for (let s = start; s < seg; s += 1) {
        const x = a[0] + dx * s / seg, y = a[1] + dy * s / seg;
        const left = field.heightAt(x - rx * reach, y - ry * reach);
        const right = field.heightAt(x + rx * reach, y + ry * reach);
        if (left !== undefined && right !== undefined) drops.push(left - right);
      }
    }
    return drops;
  };
  let drops = probe(3);
  if (drops.length === 0) drops = probe(2);
  if (drops.length === 0) drops = probe(1.5);
  if (drops.length === 0) return undefined;
  drops.sort((a, b) => a - b);
  const mid = drops.length >> 1;
  const med = drops.length % 2 === 1 ? drops[mid]! : (drops[mid - 1]! + drops[mid]!) / 2;
  if (med !== 0) return med;
  return drops.reduce((sum, v) => sum + v, 0) / drops.length;
}

function countContourCrossings(points: readonly Position[], grid: SegmentGrid, scratch: IndexedSegment[]): number {
  let crossings = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!, b = points[i + 1]!;
    grid.queryBox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), scratch);
    for (let k = 0; k < scratch.length; k += 1) {
      const seg = scratch[k]!;
      if (segmentsCross(a[0], a[1], b[0], b[1], seg.ax, seg.ay, seg.bx, seg.by)) crossings += 1;
    }
  }
  return crossings;
}

interface ContourContact {
  readonly sampleIndex: number;
  readonly dist: number;
  readonly signedDist: number;
  readonly cosAngle: number;
  readonly cnx: number;
  readonly cny: number;
  readonly atCrossing: boolean;
}

/**
 * Justerar en riktad brant (nedför till höger) mot närliggande höjdkurvor (101/102) när branten löper nästan parallellt
 * inom 3 m och korsar/slingrar över kurvan. Returnerar ny punktlista eller `undefined` om ingen justering behövs/är säker.
 */
function alignCliffPolyline(
  points: readonly Position[],
  contourGrid: SegmentGrid,
  targetClearance: number,
  field: Pick<HeightField, "heightAt"> | undefined,
  scratch: IndexedSegment[]
): MutablePos[] | undefined {
  if (points.length < 2 || contourGrid.segments.length === 0) return undefined;
  const box = bboxOf(points);
  contourGrid.queryBox(box.minX - SEARCH_DIST_M, box.minY - SEARCH_DIST_M, box.maxX + SEARCH_DIST_M, box.maxY + SEARCH_DIST_M, scratch);
  if (scratch.length === 0) return undefined;

  const dense = resampleLine(points, SAMPLE_STEP_M);
  const n = dense.length;
  if (n < 2) return undefined;

  // Tangent och uppförsnormal (vänster om färdriktningen) per punkt längs branten.
  const tx = new Float64Array(n), ty = new Float64Array(n);
  const lx = new Float64Array(n), ly = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const prev = dense[Math.max(0, i - 1)]!, next = dense[Math.min(n - 1, i + 1)]!;
    const dx = next[0] - prev[0], dy = next[1] - prev[1], len = Math.hypot(dx, dy) || 1;
    tx[i] = dx / len; ty[i] = dy / len;
    lx[i] = -ty[i]!; ly[i] = tx[i]!;
  }

  // Registrera vilka kurvor branten faktiskt korsar (och vid vilka provpunkter) med krossvinkel.
  const crossedContours = new Set<number>();
  const crossedAtSample = new Map<number, Set<number>>();
  const crossCosByContour = new Map<number, number>();
  for (let i = 0; i < n - 1; i += 1) {
    const a = dense[i]!, b = dense[i + 1]!;
    const sdx = b[0] - a[0], sdy = b[1] - a[1], slen = Math.hypot(sdx, sdy) || 1;
    const stx = sdx / slen, sty = sdy / slen;
    contourGrid.queryBox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), scratch);
    for (let k = 0; k < scratch.length; k += 1) {
      const seg = scratch[k]!;
      if (!segmentsCross(a[0], a[1], b[0], b[1], seg.ax, seg.ay, seg.bx, seg.by)) continue;
      const cosA = Math.abs(stx * seg.tx + sty * seg.ty);
      crossedContours.add(seg.featureId);
      const prevMax = crossCosByContour.get(seg.featureId) ?? 0;
      if (cosA > prevMax) crossCosByContour.set(seg.featureId, cosA);
      let set = crossedAtSample.get(seg.featureId);
      if (!set) { set = new Set<number>(); crossedAtSample.set(seg.featureId, set); }
      set.add(i); set.add(i + 1);
    }
  }

  // För varje provpunkt: hitta närmaste punkt på varje närliggande kurva inom SEARCH_DIST_M.
  const contactsByContour = new Map<number, ContourContact[]>();
  const nearestOthers: Map<number, { dist: number; signedDist: number; cnx: number; cny: number }>[] =
    Array.from({ length: n }, () => new Map<number, { dist: number; signedDist: number; cnx: number; cny: number }>());

  for (let i = 0; i < n; i += 1) {
    const [px, py] = dense[i]!;
    contourGrid.queryBox(px - (SEARCH_DIST_M + 1.5), py - (SEARCH_DIST_M + 1.5), px + (SEARCH_DIST_M + 1.5), py + (SEARCH_DIST_M + 1.5), scratch);
    if (scratch.length === 0) continue;
    const bestPerContour = new Map<number, { seg: IndexedSegment; cx: number; cy: number; distSq: number }>();
    for (let k = 0; k < scratch.length; k += 1) {
      const seg = scratch[k]!;
      const proj = pointToSegment(px, py, seg);
      const prev = bestPerContour.get(seg.featureId);
      if (!prev || proj.distSq < prev.distSq) bestPerContour.set(seg.featureId, { seg, ...proj });
    }
    for (const [cid, hit] of bestPerContour) {
      const dist = Math.sqrt(hit.distSq);
      if (dist > SEARCH_DIST_M + 1.5) continue;
      // Kurvans enhetsnormal riktad åt brantens uppförssida (vänster om branten).
      let cnx = -hit.seg.ty, cny = hit.seg.tx;
      if (cnx * lx[i]! + cny * ly[i]! < 0) { cnx = -cnx; cny = -cny; }
      const signedDist = (px - hit.cx) * cnx + (py - hit.cy) * cny;
      nearestOthers[i]!.set(cid, { dist, signedDist, cnx, cny });
      if (dist > SEARCH_DIST_M) continue;
      const cosAngle = Math.abs(tx[i]! * hit.seg.tx + ty[i]! * hit.seg.ty);
      const atCrossing = crossedAtSample.get(cid)?.has(i) === true;
      if (cosAngle >= CONTACT_COS || (atCrossing && (crossCosByContour.get(cid) ?? 0) >= CROSS_PARALLEL_COS)) {
        let list = contactsByContour.get(cid);
        if (!list) { list = []; contactsByContour.set(cid, list); }
        list.push({ sampleIndex: i, dist, signedDist, cosAngle, cnx, cny, atCrossing });
      }
    }
  }

  if (contactsByContour.size === 0) return undefined;

  // Välj sida (+1 uppför/krön, eller -1 nedför bara om branten redan ligger tydligt nedanför kurvan) och räkna råförskjutning.
  const rawDx = new Float64Array(n), rawDy = new Float64Array(n);
  const pinned = new Uint8Array(n);
  const activeContours = new Set<number>();
  let anyNeed = false;

  for (const [cid, contacts] of contactsByContour) {
    const crossesCid = crossedContours.has(cid);
    const hasParallelClose = contacts.some(c => c.dist < targetClearance && c.cosAngle >= PARALLEL_COS);
    const hasParallelCross = crossesCid && ((crossCosByContour.get(cid) ?? 0) >= CROSS_PARALLEL_COS || contacts.some(c => c.cosAngle >= PARALLEL_COS));
    if (!hasParallelClose && !hasParallelCross) continue;

    // Om branten inte korsar kurvan och redan håller målavståndet på ena sidan behövs ingen flytt.
    const sortedSigned = contacts.map(c => c.signedDist).sort((a, b) => a - b);
    const minSigned = sortedSigned[0]!;
    const maxSigned = sortedSigned[sortedSigned.length - 1]!;
    const medSigned = sortedSigned[sortedSigned.length >> 1]!;
    if (!crossesCid && (minSigned >= targetClearance || maxSigned <= -targetClearance)) continue;

    // I första hand krönsidan (+1); bara nedförssidan (-1) om branten i huvudsak ligger > 1 m nedanför kurvan.
    const side = medSigned < -1.0 && maxSigned <= 1.2 ? -1 : 1;
    activeContours.add(cid);

    for (const c of contacts) {
      const need = side === 1 ? targetClearance - c.signedDist : targetClearance + c.signedDist;
      if (need <= 0.02) continue;
      const push = Math.min(need, MAX_SHIFT_M);
      const pdx = c.cnx * side * push, pdy = c.cny * side * push;
      const i = c.sampleIndex;
      const curMag = Math.hypot(rawDx[i]!, rawDy[i]!);
      if (curMag <= 1e-9) {
        rawDx[i] = pdx; rawDy[i] = pdy; pinned[i] = 1; anyNeed = true;
      } else {
        const dot = (rawDx[i]! * pdx + rawDy[i]! * pdy) / (curMag * push);
        if (dot >= -0.25) {
          if (push > curMag) { rawDx[i] = pdx; rawDy[i] = pdy; pinned[i] = 1; }
        } else {
          // Klämd mellan två parallella motställda kurvor: centrera mellan dem.
          rawDx[i] = (rawDx[i]! + pdx) * 0.5;
          rawDy[i] = (rawDy[i]! + pdy) * 0.5;
          pinned[i] = 1;
        }
      }
    }
  }

  if (!anyNeed) return undefined;

  // Skydda mot att knuffa en provpunkt över en annan närliggande kurva i flyttriktningen (t.ex. täta 2,5 m sprintkurvor).
  for (let i = 0; i < n; i += 1) {
    const mag = Math.hypot(rawDx[i]!, rawDy[i]!);
    if (mag <= 1e-9) continue;
    const ux = rawDx[i]! / mag, uy = rawDy[i]! / mag;
    let limit = Math.min(mag, MAX_SHIFT_M);
    for (const [cid, info] of nearestOthers[i]!) {
      if (activeContours.has(cid)) continue;
      // Riktning från kurvan till punkten är info.signedDist längs (cnx, cny).
      // Rör vi oss NÄRMARE kurvan har (ux, uy) motsatt tecken mot signedDist*(cnx, cny).
      const sign = info.signedDist >= 0 ? 1 : -1;
      const towardOther = -(ux * info.cnx * sign + uy * info.cny * sign);
      if (towardOther > 0.3) {
        const distAlong = Math.abs(info.signedDist) / towardOther;
        // Lämna minst halva korridoren eller 0,55 m till den andra kurvan.
        const safe = Math.max(0, Math.min(distAlong - 0.55, distAlong * 0.5));
        if (safe < limit) limit = safe;
      }
    }
    if (limit < mag) {
      const scale = limit / mag;
      rawDx[i] = rawDx[i]! * scale;
      rawDy[i] = rawDy[i]! * scale;
    }
  }

  // Jämna ut förskjutningsfältet längs branten (3 pass 1-2-1 med fria ändar) samtidigt som aktiva kontaktpunkter behåller minsta fria avstånd.
  const dx = Float64Array.from(rawDx), dy = Float64Array.from(rawDy);
  const tmpX = new Float64Array(n), tmpY = new Float64Array(n);
  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 0; i < n; i += 1) {
      if (i === 0) {
        tmpX[i] = (2 * dx[0]! + dx[1]!) / 3;
        tmpY[i] = (2 * dy[0]! + dy[1]!) / 3;
      } else if (i === n - 1) {
        tmpX[i] = (dx[n - 2]! + 2 * dx[n - 1]!) / 3;
        tmpY[i] = (dy[n - 2]! + 2 * dy[n - 1]!) / 3;
      } else {
        tmpX[i] = (dx[i - 1]! + 2 * dx[i]! + dx[i + 1]!) / 4;
        tmpY[i] = (dy[i - 1]! + 2 * dy[i]! + dy[i + 1]!) / 4;
      }
      if (pinned[i]) {
        const needMag = Math.hypot(rawDx[i]!, rawDy[i]!);
        if (needMag > 1e-9) {
          const ux = rawDx[i]! / needMag, uy = rawDy[i]! / needMag;
          const proj = tmpX[i]! * ux + tmpY[i]! * uy;
          if (proj < needMag) {
            tmpX[i] = tmpX[i]! + ux * (needMag - proj);
            tmpY[i] = tmpY[i]! + uy * (needMag - proj);
          }
        }
      }
    }
    dx.set(tmpX); dy.set(tmpY);
  }

  // Klampa slutlig förflyttning till <= MAX_SHIFT_M per punkt.
  let maxDisp = 0;
  for (let i = 0; i < n; i += 1) {
    const mag = Math.hypot(dx[i]!, dy[i]!);
    if (mag > MAX_SHIFT_M) {
      const s = MAX_SHIFT_M / mag;
      dx[i] = dx[i]! * s; dy[i] = dy[i]! * s;
      maxDisp = MAX_SHIFT_M;
    } else if (mag > maxDisp) {
      maxDisp = mag;
    }
  }
  if (maxDisp < 0.05) return undefined;

  const beforeCross = countContourCrossings(points, contourGrid, scratch);
  const origDrop = field ? downhillDrop(points, field) : undefined;

  for (const alpha of [1, 0.75, 0.5] as const) {
    const moved: MutablePos[] = dense.map(([px, py], i) => [px + dx[i]! * alpha, py + dy[i]! * alpha]);
    // En lätt 1-2-1-utjämning på inre punkter för mjuka skarvar, klampad mot MAX_SHIFT_M.
    if (moved.length >= 3) {
      const smoothed: MutablePos[] = moved.map(([x, y]) => [x, y]);
      for (let i = 1; i < moved.length - 1; i += 1) {
        const sx = (moved[i - 1]![0] + 2 * moved[i]![0] + moved[i + 1]![0]) / 4;
        const sy = (moved[i - 1]![1] + 2 * moved[i]![1] + moved[i + 1]![1]) / 4;
        const ox = sx - dense[i]![0], oy = sy - dense[i]![1], d = Math.hypot(ox, oy);
        if (d <= MAX_SHIFT_M) smoothed[i] = [sx, sy];
        else smoothed[i] = [dense[i]![0] + ox * MAX_SHIFT_M / d, dense[i]![1] + oy * MAX_SHIFT_M / d];
      }
      for (let i = 1; i < moved.length - 1; i += 1) moved[i] = smoothed[i]!;
    }
    const afterCross = countContourCrossings(moved, contourGrid, scratch);
    if (afterCross > beforeCross) continue;
    if (polylineSelfCrosses(moved)) continue;
    if (field) {
      const nextDrop = downhillDrop(moved, field);
      if (nextDrop !== undefined && nextDrop < 0) continue;
      if (origDrop !== undefined && origDrop > 0.25 && nextDrop !== undefined && nextDrop < Math.min(0.2, origDrop * 0.25)) continue;
    }
    // Lätt förenkling utan att införa nya korsningar.
    const simplified = thinLine(moved, 0.3);
    if (simplified.length >= 2 && countContourCrossings(simplified, contourGrid, scratch) <= afterCross && !polylineSelfCrosses(simplified)) {
      if (!field || (downhillDrop(simplified, field) ?? 1) >= 0) return simplified;
    }
    return moved;
  }
  return undefined;
}

/** Klipper en hjälpkurva (103) där den ligger inom `FORMLINE_CLIP_DIST_M` från en 201-brant; stumpar under `MIN_FORMLINE_STUB_M` tas bort. */
function clipFormlineAgainst201(
  feature: SourceFeature,
  impassableGrid: SegmentGrid,
  scratch: IndexedSegment[]
): SourceFeature[] | undefined {
  const geom = feature.geometry;
  if (geom.kind !== "line" || geom.points.length < 2) return undefined;
  const box = bboxOf(geom.points);
  impassableGrid.queryBox(
    box.minX - FORMLINE_CLIP_DIST_M, box.minY - FORMLINE_CLIP_DIST_M,
    box.maxX + FORMLINE_CLIP_DIST_M, box.maxY + FORMLINE_CLIP_DIST_M,
    scratch
  );
  if (scratch.length === 0) return undefined;

  const isClosed = geom.closed;
  const rawPts = isClosed ? [...geom.points, geom.points[0]!] : geom.points;
  let samples = resampleLine(rawPts, FORMLINE_SAMPLE_STEP_M);
  if (samples.length < 2) return undefined;

  let blocked = new Uint8Array(samples.length);
  let anyBlocked = false;
  for (let i = 0; i < samples.length; i += 1) {
    const [x, y] = samples[i]!;
    if (impassableGrid.minDistance(x, y, FORMLINE_CLIP_DIST_M, scratch) <= FORMLINE_CLIP_DIST_M) {
      blocked[i] = 1;
      anyBlocked = true;
    }
  }
  if (!anyBlocked) return undefined;

  // För slutna hjälpkurvor som klipps: rotera starten till en blockerad punkt så en sammanhängande båge inte delas i onödan vid index 0.
  if (isClosed && !blocked[0] && samples.length > 2) {
    const ringSamples = samples.slice(0, -1);
    const ringBlocked = blocked.slice(0, -1);
    const firstBlocked = ringBlocked.indexOf(1);
    if (firstBlocked > 0) {
      const m = ringSamples.length;
      const rotatedSamples: MutablePos[] = [];
      const rotatedBlocked = new Uint8Array(m);
      for (let k = 0; k < m; k += 1) {
        const idx = (firstBlocked + k) % m;
        rotatedSamples.push(ringSamples[idx]!);
        rotatedBlocked[k] = ringBlocked[idx]!;
      }
      samples = rotatedSamples;
      blocked = rotatedBlocked;
    }
  }

  const pieces: SourceFeature[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    if (blocked[i]) continue;
    let j = i;
    while (j + 1 < samples.length && !blocked[j + 1]) j += 1;
    if (j > i) {
      const run = samples.slice(i, j + 1);
      if (polylineLength(run) >= MIN_FORMLINE_STUB_M) {
        const cleaned = thinLine(run, 0.25);
        if (cleaned.length >= 2) {
          pieces.push({ ...feature, geometry: { kind: "line", closed: false, points: cleaned } });
        }
      }
    }
    i = j;
  }
  return pieces;
}

/**
 * Passar in branter (201/202) mot slutliga höjdkurvor (101/102), dämpar hjälpkurvor (103) direkt på opasserbara
 * branter (201) och garanterar nedförsorientering (högerhandstaggar = nedför) mot höjdrastret.
 */
export function alignCliffsToContours(
  features: readonly SourceFeature[],
  field?: Pick<HeightField, "heightAt">,
  options: { readonly scale?: number | undefined } = {}
): {
  readonly features: SourceFeature[];
  readonly alignedCliffs: number;
  readonly reversedCliffs: number;
  readonly clippedFormlines: number;
} {
  let hasCliffs = false;
  for (const feature of features) {
    if (feature.geometry.kind === "line" && feature.geometry.points.length >= 2 && isCliffLayer(feature.layer)) {
      hasCliffs = true;
      break;
    }
  }
  if (!hasCliffs) return { features: [...features], alignedCliffs: 0, reversedCliffs: 0, clippedFormlines: 0 };

  const sprint = options.scale !== undefined && options.scale <= 5000;
  const targetClearance = sprint ? 0.95 : 1.15;

  // 1. Indexera alla slutliga höjdkurvor (101/102).
  const contourGrid = new SegmentGrid();
  let contourId = 0;
  for (const feature of features) {
    if (feature.geometry.kind !== "line" || feature.geometry.points.length < 2 || !CONTOUR_LAYER.test(feature.layer)) continue;
    contourGrid.addPolyline(contourId++, feature.geometry.points, feature.geometry.closed);
  }

  // 2. Rikta och anpassa 201/202-branter mot kurvorna, samt bygg index över slutliga 201-branter.
  const scratch: IndexedSegment[] = [];
  const impassableGrid = new SegmentGrid();
  let impassableId = 0;
  let alignedCliffs = 0, reversedCliffs = 0;

  const afterCliffs: SourceFeature[] = features.map(feature => {
    if (feature.geometry.kind !== "line" || feature.geometry.points.length < 2 || !isCliffLayer(feature.layer)) return feature;
    let pts: Position[] = feature.geometry.points.map(([x, y]): [number, number] => [x, y]);
    let changed = false;
    let flipped = false;

    // Förkontroll av nedförsorientering innan uppförsförskjutning räknas.
    if (field && !feature.geometry.closed) {
      const drop = downhillDrop(pts, field);
      if (drop !== undefined && drop < 0) {
        pts = pts.slice().reverse();
        flipped = true;
        changed = true;
      }
    }

    // Kurvanpassad placering längs närliggande flyttade 101/102-kurvor.
    if (!feature.geometry.closed && contourGrid.segments.length > 0) {
      const nudged = alignCliffPolyline(pts, contourGrid, targetClearance, field, scratch);
      if (nudged) {
        pts = nudged;
        alignedCliffs += 1;
        changed = true;
      }
    }

    // Hård slutinvariant: nedför måste ALLTID ligga till höger (z_left >= z_right).
    if (field && !feature.geometry.closed) {
      const finalDrop = downhillDrop(pts, field);
      if (finalDrop !== undefined && finalDrop < 0) {
        pts = pts.slice().reverse();
        flipped = !flipped;
        changed = true;
      }
    }

    if (flipped) reversedCliffs += 1;

    const resultFeature = changed
      ? { ...feature, geometry: { kind: "line" as const, closed: feature.geometry.closed, points: pts } }
      : feature;

    if (IMPASSABLE_CLIFF_LAYER.test(feature.layer)) {
      impassableGrid.addPolyline(impassableId++, pts, feature.geometry.closed);
    }
    return resultFeature;
  });

  // 3. Klipp/dämpa 103-hjälpkurvor inom 2,5 m från opasserbara branter (201).
  if (impassableGrid.segments.length === 0) {
    return { features: afterCliffs, alignedCliffs, reversedCliffs, clippedFormlines: 0 };
  }

  let clippedFormlines = 0;
  const finalFeatures: SourceFeature[] = [];
  for (const feature of afterCliffs) {
    if (feature.geometry.kind === "line" && FORMLINE_LAYER.test(feature.layer)) {
      const clipped = clipFormlineAgainst201(feature, impassableGrid, scratch);
      if (clipped !== undefined) {
        clippedFormlines += 1;
        for (const piece of clipped) finalFeatures.push(piece);
        continue;
      }
    }
    finalFeatures.push(feature);
  }

  return { features: finalFeatures, alignedCliffs, reversedCliffs, clippedFormlines };
}
