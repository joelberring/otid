/**
 * Steg 60: rutnätsvägen rätas ut till en polylinje. Ett rutnät med 16 grannar mäter avstånd i en månghörning (upp till
 * ~3 % för långt i vissa riktningar) och har många lika långa sicksackvägar. Därför ersätts delar av vägen med raka
 * sträckor när den raka sträckan inte kostar mer än rutnätsvägen (räknad exakt cell för cell längs linjen). Runt
 * hinder, längs stigar och genom spärrar går det inte att räta ut, så vägen ligger kvar där. Samma linjeintegral
 * används för att räkna om färdiga vägar med andra farter (osäkerheten).
 */
import { stepCost, type SearchGrid } from "./search";

export interface LineCost { cost: number; climbUnits: number; meters: number }

/**
 * Kostnaden för en rak linje mellan två punkter i cellkoordinater (cellens mitt = i + 0,5). Alla celler som linjen
 * passerar (även genom hörn) måste vara passerbara.
 */
export function segmentCost(grid: SearchGrid, pace: Float32Array, ax: number, ay: number, bx: number, by: number): LineCost {
  const w = grid.width, h = grid.height;
  const dx = bx - ax, dy = by - ay;
  const length = Math.hypot(dx, dy);
  let col = Math.floor(ax), row = Math.floor(ay);
  const endCol = Math.floor(bx), endRow = Math.floor(by);
  if (col < 0 || row < 0 || col >= w || row >= h || endCol < 0 || endRow < 0 || endCol >= w || endRow >= h) {
    return { cost: Infinity, climbUnits: 0, meters: length * grid.cellMeters };
  }
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity, tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? col + 1 - ax : ax - col) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? row + 1 - ay : ay - row) * tDeltaY : Infinity;
  let index = row * w + col;
  let t = 0, cost = 0, climbUnits = 0;
  const contour = grid.contour;
  for (let guard = Math.abs(endCol - col) + Math.abs(endRow - row) + 2; guard > 0; guard -= 1) {
    const p = pace[index]!;
    if (p === Infinity) return { cost: Infinity, climbUnits, meters: length * grid.cellMeters };
    const next = Math.min(tMaxX, tMaxY, 1);
    cost += (next - t) * length * p;
    t = next;
    if (col === endCol && row === endRow) break;
    if (tMaxX <= tMaxY) { col += stepX; tMaxX += tDeltaX; } else { row += stepY; tMaxY += tDeltaY; }
    if (col < 0 || row < 0 || col >= w || row >= h) break;
    const nextIndex = row * w + col;
    climbUnits += Math.abs(contour[nextIndex]! - contour[index]!);
    index = nextIndex;
  }
  return { cost: cost * grid.cellMeters + climbUnits * grid.climbCostPerUnit, climbUnits, meters: length * grid.cellMeters };
}

function center(grid: SearchGrid, index: number): [number, number] {
  const col = index % grid.width;
  return [col + 0.5, (index - col) / grid.width + 0.5];
}

/** Kostnaden mellan två celler längs en rak linje mellan cellmitterna. */
export function cellSegmentCost(grid: SearchGrid, pace: Float32Array, from: number, to: number): LineCost {
  const [ax, ay] = center(grid, from), [bx, by] = center(grid, to);
  return segmentCost(grid, pace, ax, ay, bx, by);
}

/**
 * Rätar ut rutnätsvägen (cellindex) girigt: från varje hörn så långt fram som möjligt där den raka linjen inte kostar
 * mer än rutnätsvägen. Ger hörnens cellindex.
 */
export function straighten(grid: SearchGrid, pace: Float32Array, cells: readonly number[]): number[] {
  const n = cells.length;
  if (n <= 2) return [...cells];
  const prefix = new Float64Array(n);
  for (let index = 1; index < n; index += 1) prefix[index] = prefix[index - 1]! + stepCost(grid, pace, cells[index - 1]!, cells[index]!).cost;
  const ok = (i: number, j: number) => j === i + 1 || cellSegmentCost(grid, pace, cells[i]!, cells[j]!).cost <= prefix[j]! - prefix[i]! + 1e-9;
  const out = [cells[0]!];
  let i = 0;
  while (i < n - 1) {
    let j: number;
    if (ok(i, n - 1)) j = n - 1;
    else {
      // Galopp: dubbla steget så länge det går, sedan binärsökning mellan sista godkända och första underkända.
      let good = i + 1, step = 1;
      while (good + step < n - 1 && ok(i, good + step)) { good += step; step *= 2; }
      let bad = Math.min(n - 1, good + step);
      while (bad - good > 1) {
        const mid = (good + bad) >> 1;
        if (ok(i, mid)) good = mid; else bad = mid;
      }
      j = good;
    }
    out.push(cells[j]!);
    i = j;
  }
  return out;
}

/** Polylinjens kostnad (hörn som cellindex) med farterna. */
export function polylineCost(grid: SearchGrid, pace: Float32Array, corners: readonly number[]): LineCost {
  let cost = 0, climbUnits = 0, meters = 0;
  for (let index = 1; index < corners.length; index += 1) {
    const part = cellSegmentCost(grid, pace, corners[index - 1]!, corners[index]!);
    cost += part.cost;
    climbUnits += part.climbUnits;
    meters += part.meters;
  }
  return { cost, climbUnits, meters };
}
