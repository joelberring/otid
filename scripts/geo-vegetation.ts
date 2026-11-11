/**
 * ADR-0219 K5c (del 3, ägaren 2026-11-08): vegetationen ur laserns returer, i geo-arbetaren. Karttapullautin räknar grönt
 * (träffar under trädkronorna), gult (öppen mark) och undervegetation ur returerna och sparar dem med `vege_bitmode=1` som
 * klassbilder per ruta (`<ruta>_vege_bit.png` och `<ruta>_undergrowth_bit.png`, 1 m, med världsfil). Här blir de ytor:
 * öppen mark (401), grönt i tre steg (406, 408, 410) och undervegetation (407, 409), som kandidater i en DXF.
 *
 * Klassbilden (Karttapullautin, vegetation.rs): 0 ingenting, 1 gult, 2 + n grönt i nyans n (n växer med tätheten,
 * `greenshades`). Undervegetationen: 1 löphindrande, 2 svårlöpt.
 *
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`).
 */
import { inflateSync } from "node:zlib";
import { blockedCells, cleanMask, encodePng, type Grid, maskRings, moistureDxf, ringArea, simplify, worldFile } from "./geo-moisture.ts";

export interface VegetationSettings { readonly minAreaM2: number }
export const DEFAULT_VEGETATION: VegetationSettings = { minAreaM2: 300 };
/** Grönt: lägsta nyans (Karttapullautins index, 0 ljusast) för 406, 408 och 410 med grundinställningens `greenshades`. */
export const GREEN_STEPS = { slow: 2, difficult: 4, fight: 5 } as const;
/** Cellen som ytorna räknas i (meter); klassbilderna är 1 m och slås ihop med flest röster. */
export const VEGETATION_CELL = 2;

export interface ClassImage { readonly width: number; readonly height: number; readonly data: Uint8Array }

/** En gråskale-PNG (8 bitar, med eller utan alfa; alfa tas bort) som en bild med rader norrifrån. */
export function decodeGrayPng(bytes: Uint8Array): ClassImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 33 || view.getUint32(0) !== 0x89504e47) throw new Error("Klassbilden är ingen PNG");
  let offset = 8, width = 0, height = 0, colorType = -1, bitDepth = 0, interlace = 0;
  const parts: Uint8Array[] = [];
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      bitDepth = bytes[offset + 16]!; colorType = bytes[offset + 17]!; interlace = bytes[offset + 20]!;
    } else if (type === "IDAT") parts.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || (colorType !== 0 && colorType !== 4) || interlace !== 0) throw new Error("Klassbilden har ett okänt format");
  if (width <= 0 || height <= 0 || width * height > 100_000_000) throw new Error("Klassbilden är för stor");
  const channels = colorType === 4 ? 2 : 1, stride = width * channels;
  const raw = inflateSync(Buffer.concat(parts));
  if (raw.byteLength < height * (stride + 1)) throw new Error("Klassbilden är avkortad");
  const rows = new Uint8Array(height * stride), out = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)]!, source = row * (stride + 1) + 1, target = row * stride;
    for (let i = 0; i < stride; i += 1) {
      const value = raw[source + i]!;
      const left = i >= channels ? rows[target + i - channels]! : 0, up = row > 0 ? rows[target - stride + i]! : 0;
      const corner = row > 0 && i >= channels ? rows[target - stride + i - channels]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      } else if (filter !== 0) throw new Error("Klassbilden har ett okänt filter");
      rows[target + i] = (value + predicted) & 0xff;
    }
    for (let column = 0; column < width; column += 1) out[row * width + column] = rows[target + column * channels]!;
  }
  return { width, height, data: out };
}

/** Världsfilen: pixelstorlek och mitten av pixeln uppe till vänster. */
export function readWorldFile(text: string): { size: number; left: number; top: number } {
  const values = text.trim().split(/\s+/).map(Number);
  if (values.length < 6 || values.some(value => !Number.isFinite(value)) || !(values[0]! > 0) || Math.abs(values[0]! + values[3]!) > 1e-6) {
    throw new Error("Världsfilen har ett okänt format");
  }
  return { size: values[0]!, left: values[4]!, top: values[5]! };
}

export interface VegetationTile { readonly vege: ClassImage; readonly undergrowth?: ClassImage; readonly world: { size: number; left: number; top: number } }

/**
 * Rutornas klassbilder i ett rutnät (VEGETATION_CELL m). Varje cell får den klass som flest pixlar har (ingenting om fler
 * än dubbelt så många pixlar saknar klass). Undervegetationen är glesa streck i klassbilden: en cell räknas när minst
 * tre av cellerna inom 5 × 5 har streck (det starkaste som finns där), i bit 4–5 (värde · 16).
 */
export function vegetationMosaic(tiles: readonly VegetationTile[], smallest = VEGETATION_CELL): { grid: Omit<Grid, "z">; classes: Uint8Array } {
  if (tiles.length === 0) throw new Error("Inga klassbilder");
  // Grövre klassbilder än cellen (inte Karttapullautins 1 m) ger cellen pixelns storlek, så att ingen cell blir tom.
  const cell = Math.max(smallest, ...tiles.map(tile => tile.world.size));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const tile of tiles) {
    const { size, left, top } = tile.world;
    minX = Math.min(minX, left - size / 2); maxX = Math.max(maxX, left - size / 2 + tile.vege.width * size);
    maxY = Math.max(maxY, top + size / 2); minY = Math.min(minY, top + size / 2 - tile.vege.height * size);
  }
  const width = Math.ceil((maxX - minX) / cell - 1e-9), height = Math.ceil((maxY - minY) / cell - 1e-9);
  if (width <= 0 || height <= 0 || width * height > 60_000_000) throw new Error("Området är för stort för vegetationen");
  const votes = new Uint16Array(width * height * 16), marks = new Uint8Array(width * height), classes = new Uint8Array(width * height);
  for (const tile of tiles) {
    const { size, left, top } = tile.world;
    for (let row = 0; row < tile.vege.height; row += 1) {
      const y = Math.floor((top - row * size - minY) / cell);
      if (y < 0 || y >= height) continue;
      for (let column = 0; column < tile.vege.width; column += 1) {
        const x = Math.floor((left + column * size - minX) / cell);
        if (x < 0 || x >= width) continue;
        const i = x * height + y;
        const vote = i * 16 + Math.min(15, tile.vege.data[row * tile.vege.width + column]!);
        votes[vote] = votes[vote]! + 1;
        const growth = tile.undergrowth && row < tile.undergrowth.height && column < tile.undergrowth.width
          ? tile.undergrowth.data[row * tile.undergrowth.width + column]! : 0;
        marks[i] = Math.max(marks[i]!, growth & 2 ? 2 : growth & 1 ? 1 : 0);
      }
    }
  }
  for (let i = 0; i < classes.length; i += 1) {
    let best = 0, bestVotes = 0;
    for (let value = 1; value < 16; value += 1) if (votes[i * 16 + value]! > bestVotes) { best = value; bestVotes = votes[i * 16 + value]!; }
    classes[i] = bestVotes * 2 >= votes[i * 16]! ? best : 0;
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let count = 0, strongest = 0;
      for (let dx = -2; dx <= 2; dx += 1) {
        for (let dy = -2; dy <= 2; dy += 1) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const mark = marks[nx * height + ny]!;
          if (mark) { count += 1; strongest = Math.max(strongest, mark); }
        }
      }
      if (count >= 3) classes[x * height + y] = classes[x * height + y]! | (strongest << 4);
    }
  }
  // Rutnätet med cellernas mitt i (minX + cell·x, minY + cell·y), som i fuktigheten.
  return { grid: { minX: minX + cell / 2, minY: minY + cell / 2, cell, width, height }, classes };
}

/** Ytorna per ISOM-symbol: kapslade (408 ligger inom 406 osv.), utan små öar och med hålen fyllda. */
export function vegetationFromTiles(tiles: readonly VegetationTile[], settings: VegetationSettings = DEFAULT_VEGETATION,
  water?: (x: number, y: number) => boolean,
  signals?: { readonly openAt: (x: number, y: number) => boolean | undefined; readonly denseAt: (x: number, y: number) => boolean | undefined }) {
  const { grid, classes } = vegetationMosaic(tiles);
  // Egna beräkningar ur punktmolnet (geo-points.ts, lärt av Högdalenkartan 2026-11-11) går före Karttapullautins klass för
  // öppet, och lägger till grönt där buskskiktet är tätt. Klassbilden får samma värden, så att reglagen ser dem.
  if (signals) for (let column = 0; column < grid.width; column += 1) for (let row = 0; row < grid.height; row += 1) {
    const x = grid.minX + column * grid.cell, y = grid.minY + row * grid.cell, i = column * grid.height + row;
    const open = signals.openAt(x, y);
    if (open === undefined) continue;
    const value = classes[i]!, low = value & 15;
    if (open) classes[i] = (value & 0xf0) | 1;
    else {
      const forest = low === 1 ? 2 : low;
      classes[i] = (value & 0xf0) | (signals.denseAt(x, y) && forest - 2 < GREEN_STEPS.slow ? GREEN_STEPS.slow + 2 : forest);
    }
  }
  // Vattnet (geo-water.ts) har ingen vegetation: utan det här blir sjön «öppen mark» (inga träd över vattnet).
  const blocked = blockedCells(grid, water);
  const dry = (mask: Uint8Array) => { if (blocked) for (let i = 0; i < mask.length; i += 1) if (blocked[i]) mask[i] = 0; return mask; };
  const area = grid.cell * grid.cell, minCells = Math.max(2, Math.round(settings.minAreaM2 / area));
  const shade = (value: number) => (value & 15) >= 2 ? (value & 15) - 2 : -1;
  const scattered = scatteredTrees(classes, grid.width, grid.height, shade, GREEN_STEPS.slow);
  const layers: { name: string; code: string; test: (value: number, i: number) => boolean }[] = [
    { name: "oppen_mark", code: "401", test: (value, i) => (value & 15) === 1 && scattered[i] !== 1 },
    { name: "oppen_mark_spridda_trad", code: "404", test: (_, i) => scattered[i] === 1 },
    { name: "gron_lattlopt", code: "406", test: value => shade(value) >= GREEN_STEPS.slow },
    { name: "gron_svarlopt", code: "408", test: value => shade(value) >= GREEN_STEPS.difficult },
    { name: "gron_mycket_svarlopt", code: "410", test: value => shade(value) >= GREEN_STEPS.fight },
    { name: "undervegetation_lattlopt", code: "407", test: value => value >> 4 >= 1 },
    { name: "undervegetation_svarlopt", code: "409", test: value => value >> 4 >= 2 }
  ];
  const full: Grid = { ...grid, z: new Float64Array(0) };
  const summary: Record<string, number> = {};
  const parts = layers.map(layer => {
    const mask = dry(cleanMask(dry(classes.map((value, i) => layer.test(value, i) ? 1 : 0)), grid.width, grid.height, minCells));
    const rings = maskRings(mask, full).filter(ring => !blocked || ringArea(ring) > 0).map(ring => simplify(ring, grid.cell * 0.75)).filter(ring => ring.length >= 4);
    summary[`ha${layer.code}`] = Math.round(mask.reduce((sum, value) => sum + value, 0) * area / 100) / 100;
    return { name: layer.name, closed: true, parts: rings };
  });
  // Om vegetationen är öppen i punkten (för berg i dagen ur lasern, geo-rock.ts).
  const openAt = (x: number, y: number) => {
    const column = Math.round((x - grid.minX) / grid.cell), row = Math.round((y - grid.minY) / grid.cell);
    return column >= 0 && row >= 0 && column < grid.width && row < grid.height && (classes[column * grid.height + row]! & 15) === 1;
  };
  // Vanlig skog utan grönt (ägaren 2026-11-11, Högdalen: hällarna ligger under tallarna), för berg i dagen under kronorna.
  const forestAt = (x: number, y: number) => {
    const column = Math.round((x - grid.minX) / grid.cell), row = Math.round((y - grid.minY) / grid.cell);
    if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) return false;
    const value = classes[column * grid.height + row]!;
    return (value & 15) !== 1 && shade(value) < GREEN_STEPS.slow;
  };
  // Ägaren 2026-11-11 («dra i» lagren): klasserna som bild, så att grönsstegen kan dras i webbläsaren utan en ny körning.
  // Röd kanal = klassen (låga fyra bitar Karttapullautins klass, höga undervegetationen); utan data eller i vatten genomskinligt.
  const classPng = encodePng(grid.width, grid.height, (column, line) => {
    const i = column * grid.height + (grid.height - 1 - line), value = classes[i]!;
    return value === 0 || blocked?.[i] ? [0, 0, 0, 0] : [value, 160, value, 255];
  });
  return { dxf: moistureDxf(parts), summary, openAt, forestAt, classPng, world: worldFile(full) };
}

/**
 * Ägaren 2026-11-11 («gula ytor som inte består av träd men inte är rent berg saknas»): en cell utan grönt där 20–75 %
 * av cellerna inom 8 m är öppna, blandat med träd (många gränser
 * mellan öppet och träd, nästan inget grönt; en rak skogskant räknas inte), är öppen mark med spridda träd (404). Öppna celler
 * i en sådan blandning räknas inte som öppen mark. Samma regel i webbläsaren (map-project-green-classes.ts).
 */
export function scatteredTrees(classes: Uint8Array, width: number, height: number, shade: (value: number) => number, slow: number): Uint8Array {
  // Summerade tabeller: öppna celler, gröna celler och gränser mellan öppet och inte öppet (åt höger och uppåt).
  const stride = height + 1, open = new Int32Array((width + 1) * stride), green = new Int32Array(open.length), edges = new Int32Array(open.length);
  const isOpen = (x: number, y: number) => x < width && y < height && (classes[x * height + y]! & 15) === 1;
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    const value = classes[x * height + y]!, here = isOpen(x, y);
    const edge = (x + 1 < width && isOpen(x + 1, y) !== here ? 1 : 0) + (y + 1 < height && isOpen(x, y + 1) !== here ? 1 : 0);
    const i = (x + 1) * stride + y + 1, left = x * stride + y + 1, below = (x + 1) * stride + y, corner = x * stride + y;
    open[i] = (here ? 1 : 0) + open[left]! + open[below]! - open[corner]!;
    green[i] = (shade(value) >= slow ? 1 : 0) + green[left]! + green[below]! - green[corner]!;
    edges[i] = edge + edges[left]! + edges[below]! - edges[corner]!;
  }
  const sum = (table: Int32Array, x0: number, y0: number, x1: number, y1: number) =>
    table[x1 * stride + y1]! - table[x0 * stride + y1]! - table[x1 * stride + y0]! + table[x0 * stride + y0]!;
  const r = 4, out = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
    if (shade(classes[x * height + y]!) >= slow) continue;
    const x0 = Math.max(0, x - r), x1 = Math.min(width, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(height, y + r + 1);
    const cells = (x1 - x0) * (y1 - y0), share = sum(open, x0, y0, x1, y1) / cells;
    // Blandat (inte en rak kant mot skogen): många gränser mellan öppet och träd, och nästan inget grönt.
    if (share >= 0.2 && share < 0.75 && sum(edges, x0, y0, x1, y1) >= 0.3 * cells && sum(green, x0, y0, x1, y1) < 0.2 * cells) out[x * height + y] = 1;
  }
  return out;
}
