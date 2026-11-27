import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { heightPng, mergeGroundGrids, readGroundGrid } from "../../../scripts/geo-cliffs";
import { decodePng } from "../../../scripts/geo-merge";
import {
  cleanMask, downsampleGroundTo2m, encodePng, fillDepressions, flowAccumulation, flowDirections, heightAboveDrainage, maskRings,
  moistureFromHeightMaps, mosaic, readHeightMap, ringArea, worldFile, type Grid
} from "../../../scripts/geo-moisture";
import { rockImage } from "../../../scripts/geo-rock";
import { nestRings } from "../src/ring-nesting";
import { parseDxf } from "../src/vector-parse";

/** ADR-0219 K5c del 2: fuktigheten ur Karttapullautins höjdraster i geo-arbetaren (scripts/geo-moisture.ts). */
function grid(width: number, height: number, f: (x: number, y: number) => number, minX = 675_000, minY = 6_580_000): Grid {
  const z = new Float64Array(width * height);
  for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) z[x * height + y] = f(x, y);
  return { minX, minY, cell: 2, width, height, z };
}
function hmap(g: Grid): Uint8Array {
  const bytes = new Uint8Array(40 + g.z.length * 8), view = new DataView(bytes.buffer);
  view.setFloat64(0, g.minX, true); view.setFloat64(8, g.minY, true); view.setFloat64(16, g.cell, true);
  view.setBigUint64(24, BigInt(g.width), true); view.setBigUint64(32, BigInt(g.height), true);
  g.z.forEach((value, i) => view.setFloat64(40 + i * 8, value, true));
  return bytes;
}
/** En dal som lutar söderut med en bäck i mitten och en sänka (blöt) i nordväst. */
const valley = (x: number, y: number) => 20 + Math.abs(x - 50) * 0.3 + y * 0.05 - (Math.hypot(x - 20, y - 80) < 6 ? 5 : 0);
/** En flack dal (under 3°): bara där blir det blött (ägaren 2026-11-11). */
const gentle = (x: number, y: number) => 20 + Math.abs(x - 50) * 0.05 + y * 0.02;

describe("fuktigheten ur höjdrastret", () => {
  it("läser Karttapullautins höjdraster och slår ihop rutor", () => {
    const a = grid(10, 10, (x, y) => x + y), b = grid(10, 10, (x, y) => 100 + x + y, 675_018, 6_580_000);
    const read = readHeightMap(hmap(a));
    expect(read).toMatchObject({ minX: 675_000, cell: 2, width: 10, height: 10 });
    expect(read.z[3 * 10 + 4]).toBe(7);
    const both = mosaic([read, readHeightMap(hmap(b))]);
    expect(both).toMatchObject({ width: 19, height: 10 });
    expect(both.z[9 * 10 + 0]).toBe(9);
    expect(both.z[18 * 10 + 0]).toBe(109);
    expect(worldFile(both)).toBe("2\n0\n0\n-2\n675000\n6580018\n");
    expect(() => readHeightMap(new Uint8Array(10))).toThrow();
  });

  it("fyller sänkor, flödet når kanten och stråket, och höjden över stråket", () => {
    const g = grid(101, 101, valley);
    const filled = fillDepressions(g);
    // Sänkan fylls till sin kant (och lite till för lutningen).
    expect(filled[20 * 101 + 80]! - g.z[20 * 101 + 80]!).toBeGreaterThan(1);
    const down = flowDirections(g, filled);
    const { accumulation, order } = flowAccumulation(down, filled);
    expect(order.length).toBe(101 * 101);
    // Allt rinner ut: dalens botten nere i söder har nästan hela ytan uppströms.
    expect(Math.max(...accumulation)).toBeGreaterThan(101 * 101 * 0.5);
    const hand = heightAboveDrainage(g, down, accumulation, order, 2500);
    expect(hand[50 * 101 + 10]).toBeCloseTo(0, 5);
    expect(hand[90 * 101 + 50]!).toBeGreaterThan(8);
  });

  it("masken utan små öar och med hålen fyllda blir enkla ringar", () => {
    const width = 12, height = 12, mask = new Uint8Array(width * height);
    for (let x = 2; x < 9; x += 1) for (let y = 2; y < 9; y += 1) mask[x * height + y] = 1;
    mask[5 * height + 5] = 0; // ett hål
    mask[11 * height + 11] = 1; // en ö på en cell
    // Två ytor som bara möts i ett hörn.
    const clean = cleanMask(mask, width, height, 4);
    expect(clean[5 * height + 5]).toBe(1);
    expect(clean[11 * height + 11]).toBe(0);
    const rings = maskRings(clean, { minX: 0, minY: 0, cell: 2, width, height, z: new Float64Array(0) });
    expect(rings).toHaveLength(1);
    const xs = rings[0]!.map(p => p[0]), ys = rings[0]!.map(p => p[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([3, 17, 3, 17]);
    const diagonal = new Uint8Array(16);
    diagonal[0 * 4 + 0] = 1; diagonal[1 * 4 + 1] = 1;
    expect(maskRings(diagonal, { minX: 0, minY: 0, cell: 1, width: 4, height: 4, z: new Float64Array(0) })).toHaveLength(2);
  });

  it("hela kedjan ger bild, världsfil och DXF med blöta ytor och fuktstråk", () => {
    const result = moistureFromHeightMaps([grid(101, 101, gentle)], { channelHa: 1, wetMeters: 0.5, moistMeters: 1, channelLineHa: 1 });
    // Lärt av Högdalenkartan (2026-11-11): på öppen mark (de flesta laserträffar når marken) blir det inget kärr.
    const open = moistureFromHeightMaps([grid(101, 101, gentle)], { channelHa: 1, wetMeters: 0.5, moistMeters: 1, channelLineHa: 1 }, undefined, () => 0.95);
    expect(open.summary).toMatchObject({ wetAreas: 0, moistAreas: 0 });
    // Ägaren 2026-11-12 (strandkärr): öppen blöt mark inom 30 m från vatten räknas ändå.
    const shore = moistureFromHeightMaps([grid(101, 101, gentle)], { channelHa: 1, wetMeters: 0.5, moistMeters: 1, channelLineHa: 1 }, (_x, y) => y < 6_580_020, () => 0.95);
    expect(shore.summary.moistHa).toBeGreaterThan(0);
    const wooded = moistureFromHeightMaps([grid(101, 101, gentle)], { channelHa: 1, wetMeters: 0.5, moistMeters: 1, channelLineHa: 1 }, undefined, () => 0.4);
    expect(wooded.summary.wetHa).toBe(result.summary.wetHa);
    // Den branta dalen har stråket men ingen blöt mark.
    expect(moistureFromHeightMaps([grid(101, 101, valley)], { channelHa: 1, wetMeters: 0.5, moistMeters: 1 }).summary.wetAreas).toBe(0);
    expect([...result.png.subarray(1, 4)].map(code => String.fromCharCode(code)).join("")).toBe("PNG");
    expect(result.dxf).toContain("\nblott\n");
    expect(result.dxf).toContain("\nfuktstrak\n");
    expect(result.summary.channels).toBeGreaterThan(0);
    expect(result.summary.wetAreas).toBeGreaterThan(0);
    expect(result.summary.moistHa).toBeGreaterThanOrEqual(result.summary.wetHa);
  });

  it("cleanMask fyller bara små hål men bevarar en torr kulle mitt i ett kärr, och vatten lämnar giltiga hålringar", () => {
    // 20 × 20 kärr med ett litet 2-cellshål (< minCells = 6) och en torr kulle på 3 × 3 = 9 celler (>= minCells).
    const width = 20, height = 20, mask = new Uint8Array(width * height);
    for (let x = 1; x < 19; x += 1) for (let y = 1; y < 19; y += 1) mask[x * height + y] = 1;
    mask[4 * height + 4] = 0; mask[4 * height + 5] = 0; // litet hål (2 celler)
    for (let x = 10; x < 13; x += 1) for (let y = 10; y < 13; y += 1) mask[x * height + y] = 0; // torr kulle (9 celler)
    const clean = cleanMask(mask, width, height, 6);
    expect(clean[4 * height + 4]).toBe(1);
    expect(clean[4 * height + 5]).toBe(1);
    expect(clean[11 * height + 11]).toBe(0);
    const rings = maskRings(clean, { minX: 0, minY: 0, cell: 2, width, height, z: new Float64Array(0) });
    expect(rings).toHaveLength(2);
    expect(rings.map(r => Math.sign(ringArea(r))).sort()).toEqual([-1, 1]);

    // En sjö mitt i en flack dal ger en giltig hålring i DXF:en som `nestRings` kapslar i kärret.
    const lake = (x: number, y: number) => Math.hypot(x - 675_100, y - 6_580_080) < 12;
    const withLake = moistureFromHeightMaps([grid(101, 101, gentle)], { channelHa: 1, wetMeters: 0.8, moistMeters: 1.2, channelLineHa: 1 }, lake);
    const wetFeatures = parseDxf(withLake.dxf).features.filter(feature => feature.layer === "blott");
    const wetRings = wetFeatures.map(feature => (feature.geometry.kind === "line" ? feature.geometry.points : []));
    expect(wetRings.some(ring => ringArea(ring) > 0)).toBe(true);
    expect(wetRings.some(ring => ringArea(ring) < 0)).toBe(true);
    const nested = nestRings(wetRings.map(ring => ring.map(([x, y]) => ({ x, y }))));
    expect(nested.some(polygon => polygon.length >= 2)).toBe(true);
  });

  it("fillDepressions med Barnes (2014) FIFO-gropkö ger exakt samma fyllda höjder som ren min-heap (inkl. dubbla utlopp)", () => {
    // Referens-Priority-Flood (ren min-heap utan FIFO-kö).
    const pureHeapFill = (g: Grid, eps = 1e-4): Float64Array => {
      const { width, height, z } = g, filled = new Float64Array(z.length).fill(Number.NaN), done = new Uint8Array(z.length);
      const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
      const items: number[] = [], keys: number[] = [];
      const push = (item: number, key: number) => {
        let i = items.length; items.push(item); keys.push(key);
        while (i > 0) { const p = (i - 1) >> 1; if (keys[p]! <= key) break; items[i] = items[p]!; keys[i] = keys[p]!; i = p; }
        items[i] = item; keys[i] = key;
      };
      const pop = () => {
        const top = items[0]!, item = items.pop()!, key = keys.pop()!;
        if (items.length) {
          let i = 0;
          for (;;) {
            let c = i * 2 + 1; if (c >= items.length) break;
            if (c + 1 < items.length && keys[c + 1]! < keys[c]!) c += 1;
            if (keys[c]! >= key) break;
            items[i] = items[c]!; keys[i] = keys[c]!; i = c;
          }
          items[i] = item; keys[i] = key;
        }
        return top;
      };
      for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
        const i = x * height + y;
        if (Number.isNaN(z[i]!)) { done[i] = 1; continue; }
        let edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        for (let k = 0; !edge && k < 8; k += 1) edge = Number.isNaN(z[(x + DX[k]!) * height + y + DY[k]!]!);
        if (edge) { filled[i] = z[i]!; done[i] = 1; push(i, z[i]!); }
      }
      while (items.length) {
        const i = pop(), x = Math.floor(i / height), y = i - x * height;
        for (let k = 0; k < 8; k += 1) {
          const nx = x + DX[k]!, ny = y + DY[k]!;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = nx * height + ny;
          if (done[n]) continue;
          done[n] = 1; const v = Math.max(z[n]!, filled[i]! + eps); filled[n] = v; push(n, v);
        }
      }
      return filled;
    };
    // Stor sänka med två trösklar på nästan samma höjd (testar att FIFO-kön jämförs mot heap-toppen).
    const basin = grid(60, 40, (x, y) => {
      if (x === 0 && y === 20) return 10;
      if (x === 59 && y === 20) return 10.001;
      if (x === 0 || y === 0 || x === 59 || y === 39) return 20;
      return 5 + 0.01 * Math.sin(x * 0.4) * Math.cos(y * 0.3);
    });
    const hmapReal = readHeightMap(new Uint8Array(gunzipSync(readFileSync(join(import.meta.dirname, "../../../fixtures/laser/kungshatt-300m/xyz2.hmap.gz")))));
    for (const sample of [grid(50, 50, valley), basin, hmapReal]) {
      const fast = fillDepressions(sample), ref = pureHeapFill(sample);
      expect(fast.length).toBe(ref.length);
      for (let i = 0; i < ref.length; i += 1) {
        if (Number.isNaN(ref[i]!)) expect(Number.isNaN(fast[i]!)).toBe(true);
        else expect(Math.abs(fast[i]! - ref[i]!)).toBeLessThan(1e-9);
      }
    }
  });

  it("encodePng med Sub-filter (typ 1) rundreser exakt i decodePng och krymper hojd.png och berg.png kraftigt mot filter 0", () => {
    const w = 64, h = 48;
    const rawPixels = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      rawPixels[o] = (x * 3 + y) & 255; rawPixels[o + 1] = (y * 5 + 17) & 255; rawPixels[o + 2] = (x + y * 2) & 255; rawPixels[o + 3] = (x + y) % 7 === 0 ? 0 : 255;
    }
    for (const filter of [0, 1, 2] as const) {
      const png = encodePng(w, h, (c, r, out, o) => {
        const s = (r * w + c) * 4;
        out[o] = rawPixels[s]!; out[o + 1] = rawPixels[s + 1]!; out[o + 2] = rawPixels[s + 2]!; out[o + 3] = rawPixels[s + 3]!;
      }, filter);
      const decoded = decodePng(png);
      expect(decoded.width).toBe(w);
      expect(decoded.height).toBe(h);
      expect(decoded.colorType).toBe(6);
      expect(decoded.data).toEqual(rawPixels);
    }
    // Verifiera att standardfiltret är typ 1 (Sub) och krymper kontinuerliga raster (`hojd.png` och `berg.png`) på kungshatt-300m.
    const mark = mergeGroundGrids([readGroundGrid(new Uint8Array(gunzipSync(readFileSync(join(import.meta.dirname, "../../../fixtures/laser/kungshatt-300m/mark.bin.gz")))))]);
    const hojdSub = heightPng(mark).png;
    const hojdNone = encodePng(mark.width, mark.height, (c, r, out, o) => {
      const z = mark.z[c * mark.height + (mark.height - 1 - r)]!;
      if (!Number.isFinite(z)) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; return; }
      const v = Math.max(0, Math.min(0xffffff, Math.round(z * 100) + 10_000));
      out[o] = v >> 16; out[o + 1] = (v >> 8) & 255; out[o + 2] = v & 255; out[o + 3] = 255;
    }, 0);
    // Kontrollera filterbyte 1 i IDAT på hojdSub.
    const idatPos = hojdSub.indexOf("IDAT"), idatLen = hojdSub.readUInt32BE(idatPos - 4);
    expect(inflateSync(hojdSub.subarray(idatPos + 4, idatPos + 4 + idatLen))[0]).toBe(1);
    expect(decodePng(hojdSub).data).toEqual(decodePng(hojdNone).data);
    expect(hojdSub.byteLength).toBeLessThan(hojdNone.byteLength * 0.85);

    const open = new Uint8Array(mark.width * mark.height).fill(1);
    const bergSub = rockImage(mark, open, undefined).png;
    const bergDecoded = decodePng(bergSub);
    const bergNone = encodePng(mark.width, mark.height, (c, r, out, o) => {
      const s = (r * mark.width + c) * 4;
      out[o] = bergDecoded.data[s]!; out[o + 1] = bergDecoded.data[s + 1]!; out[o + 2] = bergDecoded.data[s + 2]!; out[o + 3] = bergDecoded.data[s + 3]!;
    }, 0);
    expect(bergSub.byteLength).toBeLessThan(bergNone.byteLength * 0.92);

    // Kontinuerlig höjdmodell (256 × 256) krymper > 50 % med Sub-filter + Z_FILTERED mot ofiltrerad filter 0.
    const sw = 256, sh = 256;
    const smoothSub = encodePng(sw, sh, (c, r, out, o) => {
      const v = Math.round((30 + 8 * Math.sin(c * 0.03) + 6 * Math.cos(r * 0.03)) * 100) + 10_000;
      out[o] = v >> 16; out[o + 1] = (v >> 8) & 255; out[o + 2] = v & 255; out[o + 3] = 255;
    }, 1);
    const smoothNone = encodePng(sw, sh, (c, r, out, o) => {
      const v = Math.round((30 + 8 * Math.sin(c * 0.03) + 6 * Math.cos(r * 0.03)) * 100) + 10_000;
      out[o] = v >> 16; out[o + 1] = (v >> 8) & 255; out[o + 2] = v & 255; out[o + 3] = 255;
    }, 0);
    expect(decodePng(smoothSub).data).toEqual(decodePng(smoothNone).data);
    expect(smoothSub.byteLength).toBeLessThan(smoothNone.byteLength * 0.5);
  }, 15_000);

  it("downsampleGroundTo2m ger 2 m Grid med fuktighet i paritet med xyz2.hmap på kungshatt-300m", () => {
    const dir = join(import.meta.dirname, "../../../fixtures/laser/kungshatt-300m");
    const mark = mergeGroundGrids([readGroundGrid(new Uint8Array(gunzipSync(readFileSync(join(dir, "mark.bin.gz")))))]);
    const down = downsampleGroundTo2m(mark);
    expect(down).toMatchObject({ cell: 2, width: 150, height: 150, minX: 664_781, minY: 6_576_501 });
    const fromMark = moistureFromHeightMaps([down]);
    const fromHmap = moistureFromHeightMaps([readHeightMap(new Uint8Array(gunzipSync(readFileSync(join(dir, "xyz2.hmap.gz")))))]);
    expect(Math.abs(fromMark.summary.wetHa - fromHmap.summary.wetHa)).toBeLessThan(0.15);
    expect(Math.abs(fromMark.summary.moistHa - fromHmap.summary.moistHa)).toBeLessThan(0.15);
  });
});
