/**
 * Grundkartan ur laser (ägaren 2026-11-10: «vårmarker» över hela sjön): var vattnet är. Karttapullautin gör höjdmodell av
 * både mark- och vattenpunkter och säger inte var vattnet ligger, så sjön blev «blöt mark» i fuktigheten och «öppen mark» i
 * vegetationen. `lasclip` skriver därför ett raster (2 m) över det klippta området med vilka celler som har markpunkter
 * (klass 2) och vattenpunkter (klass 9).
 *
 * Vatten släcker lasern, så en sjö är mest celler utan punkter alls med vattenpunkter här och var. Vattnet är därför
 * sammanhängande ytor utan markpunkter som har vattenpunkter i sig; luckor i marken under tät skog eller hus har inga
 * vattenpunkter och räknas inte. Resultatet: en mask som fuktigheten och vegetationen undantar, och ytorna (med öar som
 * hål) som GeoJSON i lagret `vatten`, kandidater för 301.
 *
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`).
 */
import { maskRings, ringArea, simplify } from "./geo-moisture.ts";

const GROUND = 1, WATER = 2;

/** Rutnätet från `lasclip`: cellen (x, y) täcker minX + cell·x … +cell, y uppåt. Index x·height + y. */
export interface WaterGrid { readonly minX: number; readonly minY: number; readonly cell: number; readonly width: number; readonly height: number;
  readonly cells: Uint8Array }
export interface WaterSettings {
  /** Minsta vattenyta (m²). */
  readonly minAreaM2: number;
  /** Minsta andel av ytans celler som har vattenpunkter. */
  readonly minShare: number;
  /** Öar och stenar mindre än så (m²) räknas som vatten. */
  readonly minIslandM2: number;
}
export const DEFAULT_WATER: WaterSettings = { minAreaM2: 400, minShare: 0.005, minIslandM2: 60 };

export function readWaterGrid(bytes: Uint8Array): WaterGrid {
  if (bytes.length < 40) throw new Error("Vattenrastret är för kort");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = Number(view.getBigUint64(24, true)), height = Number(view.getBigUint64(32, true));
  if (!(width > 0 && height > 0) || bytes.length !== 40 + width * height) throw new Error("Vattenrastret har fel storlek");
  return { minX: view.getFloat64(0, true), minY: view.getFloat64(8, true), cell: view.getFloat64(16, true), width, height, cells: bytes.subarray(40) };
}

/** Rutornas raster över samma klippta område läggs ihop (en cell har mark om någon ruta har mark där). */
export function mergeWaterGrids(grids: readonly WaterGrid[]): WaterGrid {
  const first = grids[0];
  if (!first) throw new Error("Inget vattenraster");
  const cells = new Uint8Array(first.cells);
  for (const grid of grids.slice(1)) {
    if (grid.width !== first.width || grid.height !== first.height || grid.minX !== first.minX || grid.minY !== first.minY) throw new Error("Vattenrastren täcker olika områden");
    for (let i = 0; i < cells.length; i += 1) cells[i] = cells[i]! | grid.cells[i]!;
  }
  return { ...first, cells };
}

function components(mask: Uint8Array, width: number, height: number, each: (cells: number[], touchesEdge: boolean) => void): void {
  const seen = new Uint8Array(mask.length), stack: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const cells: number[] = [];
    let edge = false;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!; cells.push(i);
      const x = Math.floor(i / height), y = i - x * height;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = nx * height + ny;
        if (mask[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    each(cells, edge);
  }
}

/** Vattnets celler (1 = vatten). */
export function waterMask(grid: WaterGrid, settings: WaterSettings = DEFAULT_WATER): Uint8Array {
  const { width, height, cells } = grid, area = grid.cell * grid.cell;
  const open = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height || (cells[x * height + y]! & GROUND) === 0;
  // Smala luckor (en cell breda, t.ex. under en trädrad vid stranden) binder inte ihop skogens luckor med sjön.
  const core = new Uint8Array(cells.length);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (open(x, y) && open(x + 1, y) && open(x - 1, y) && open(x, y + 1) && open(x, y - 1)) core[x * height + y] = 1;
    }
  }
  const candidate = new Uint8Array(cells.length);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (!open(x, y)) continue;
      const near = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < width && ny < height && core[nx * height + ny] === 1;
      if (near(x, y) || near(x + 1, y) || near(x - 1, y) || near(x, y + 1) || near(x, y - 1)) candidate[x * height + y] = 1;
    }
  }
  const mask = new Uint8Array(cells.length);
  components(candidate, width, height, part => {
    if (part.length * area < settings.minAreaM2) return;
    let water = 0;
    for (const i of part) if (cells[i]! & WATER) water += 1;
    if (water < 3 || water < part.length * settings.minShare) return;
    for (const i of part) mask[i] = 1;
  });
  // Små öar (stenar, bryggor, båtar) blir vatten; riktiga öar och det som når kanten står kvar.
  const land = mask.map(value => value ? 0 : 1);
  components(land, width, height, (part, edge) => {
    if (!edge && part.length * area < settings.minIslandM2) for (const i of part) mask[i] = 1;
  });
  return mask;
}

/** Om punkten (kartans koordinater) ligger i vatten. */
export function waterAt(grid: WaterGrid, mask: Uint8Array): (x: number, y: number) => boolean {
  return (x, y) => {
    const column = Math.floor((x - grid.minX) / grid.cell), row = Math.floor((y - grid.minY) / grid.cell);
    return column >= 0 && row >= 0 && column < grid.width && row < grid.height && mask[column * grid.height + row] === 1;
  };
}

type Ring = [number, number][];
function inside(ring: Ring, [px, py]: readonly [number, number]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [x1, y1] = ring[i]!, [x2, y2] = ring[j]!;
    if ((y1 > py) !== (y2 > py) && px < (x2 - x1) * (py - y1) / (y2 - y1) + x1) hit = !hit;
  }
  return hit;
}

/** Ringarna (ytterkanter moturs, hål medurs, som `maskRings` ger dem) ordnade som ytor med sina hål. */
export function polygonsOf(rings: readonly Ring[]): Ring[][] {
  const outers = rings.filter(ring => ringArea(ring) > 0).map(ring => ({ ring, area: ringArea(ring), holes: [] as Ring[] }));
  for (const hole of rings.filter(ring => ringArea(ring) < 0)) {
    // Den minsta ytterkanten som innehåller hålet.
    const owner = outers.filter(outer => inside(outer.ring, hole[0]!)).sort((a, b) => a.area - b.area)[0];
    owner?.holes.push(hole);
  }
  return outers.map(outer => [outer.ring, ...outer.holes]);
}

/** Hela kedjan: masken, uppslaget och ytorna som GeoJSON. */
export function waterFromGrids(grids: readonly WaterGrid[], settings: WaterSettings = DEFAULT_WATER) {
  const grid = mergeWaterGrids(grids), mask = waterMask(grid, settings);
  // maskRings räknar med cellernas mitt i (minX + cell·x): här är minX cellens kant.
  const centered = { minX: grid.minX + grid.cell / 2, minY: grid.minY + grid.cell / 2, cell: grid.cell, width: grid.width, height: grid.height, z: new Float64Array(0) };
  const rings = maskRings(mask, centered).map(ring => simplify(ring, grid.cell * 0.75)).filter(ring => ring.length >= 4);
  const polygons = polygonsOf(rings);
  const round = (value: number) => Math.round(value * 100) / 100;
  const geojson = JSON.stringify({ type: "FeatureCollection", features: polygons.map(polygon => ({ type: "Feature", properties: { layer: "vatten" },
    geometry: { type: "Polygon", coordinates: polygon.map(ring => ring.map(([x, y]) => [round(x), round(y)])) } })) });
  const count = mask.reduce((sum, value) => sum + value, 0);
  return { grid, mask, at: waterAt(grid, mask), geojson, summary: { waterHa: Math.round(count * grid.cell * grid.cell / 100) / 100, waterAreas: polygons.length } };
}
