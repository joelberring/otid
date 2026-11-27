import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createGroundAccumulator, mergeGroundGrids, paths, readGroundGrid, thin, type GroundGrid } from "../../../scripts/geo-cliffs";

/** Referensimplementation av Zhang–Suens tunning (för bit-identisk LUT-kontroll). */
function naiveThin(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask);
  const offsets = [1, height + 1, height, height - 1, -1, -height - 1, -height, -height + 1];
  for (let changed = true; changed;) {
    changed = false;
    for (const pass of [0, 1]) {
      const remove: number[] = [];
      for (let x = 1; x < width - 1; x += 1) for (let y = 1; y < height - 1; y += 1) {
        const i = x * height + y;
        if (!out[i]) continue;
        const p = offsets.map(o => out[i + o]! ? 1 : 0);
        const count = p.reduce<number>((s, v) => s + v, 0);
        if (count < 2 || count > 6) continue;
        let trans = 0;
        for (let k = 0; k < 8; k += 1) if (!p[k] && p[(k + 1) % 8]) trans += 1;
        if (trans !== 1) continue;
        const [n, , e, , s, , w] = p;
        if (pass === 0 ? (n! * e! * s! === 0 && e! * s! * w! === 0) : (n! * e! * w! === 0 && n! * s! * w! === 0)) remove.push(i);
      }
      if (remove.length) { changed = true; for (const i of remove) out[i] = 0; }
    }
  }
  return out;
}

function encodeGroundBin(grid: GroundGrid): Uint8Array {
  const bytes = new Uint8Array(40 + grid.z.length * 4), view = new DataView(bytes.buffer);
  view.setFloat64(0, grid.minX, true); view.setFloat64(8, grid.minY, true); view.setFloat64(16, grid.cell, true);
  view.setBigUint64(24, BigInt(grid.width), true); view.setBigUint64(32, BigInt(grid.height), true);
  for (let i = 0; i < grid.z.length; i += 1) view.setFloat32(40 + i * 4, grid.z[i]!, true);
  return bytes;
}

describe("geo-cliffs optimeringar: LUT-thin, linjär paths och strömmande GroundAccumulator", () => {
  it("thin() med 256-bytes LUT är 100 % bit-identisk med referensen på slumpade former, korsningar och verklig terräng", () => {
    const width = 90, height = 80, mask = new Uint8Array(width * height);
    // Tjocka bågar, korsning och slumpade kluster.
    for (let x = 2; x < width - 2; x += 1) for (let y = 2; y < height - 2; y += 1) {
      const ring = Math.abs(Math.hypot(x - 30, y - 40) - 18) < 2.2;
      const bar = Math.abs(y - 40) <= 2 && x >= 10 && x <= 75;
      const diag = Math.abs((x - 45) - (y - 35)) <= 1.8 && x >= 45 && x <= 78;
      if (ring || bar || diag) mask[x * height + y] = 1;
    }
    expect(thin(mask, width, height)).toEqual(naiveThin(mask, width, height));

    // Verklig brantmask från kungshatt-300m.
    const mark = readFileSync(join(import.meta.dirname, "../../../fixtures/laser/kungshatt-300m/mark.bin.gz"));
    const ground = mergeGroundGrids([readGroundGrid(new Uint8Array(gunzipSync(mark)))]);
    const slopeMask = new Uint8Array(ground.width * ground.height);
    const limit = Math.tan(38 * Math.PI / 180);
    for (let x = 1; x < ground.width - 1; x += 1) for (let y = 1; y < ground.height - 1; y += 1) {
      const i = x * ground.height + y;
      const dx = (ground.z[i + ground.height]! - ground.z[i - ground.height]!) / 2, dy = (ground.z[i + 1]! - ground.z[i - 1]!) / 2;
      if (Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) >= limit) slopeMask[i] = 1;
    }
    expect(thin(slopeMask, ground.width, ground.height)).toEqual(naiveThin(slopeMask, ground.width, ground.height));
  });

  it("paths() spårar stora gatunät (35k+ celler) och stora grenade träd i linjär tid, längsta väg först", () => {
    // 600 × 600 gatunät med 20 m avstånd = 35 100 skelettceller.
    const w = 600, h = 600, net = new Uint8Array(w * h);
    for (let x = 0; x < w; x += 1) for (let y = 0; y < h; y += 1) if (x % 20 === 0 || y % 20 === 0) net[x * h + y] = 1;
    const t0 = performance.now();
    const found = paths(net, w, h, 15);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(found.length).toBeGreaterThan(100);
    // Längsta väg först inom komponenten.
    expect(found[0]!.length).toBeGreaterThanOrEqual(found[1]!.length);

    // Stort grenat träd (> 2 500 celler): 1 600 celler huvudstam + fyra 300-cellers grenar.
    // Diametern går via grenen vid x=300 (300 celler) + högra stammen 300..1650 (1 350 celler) = ~1 650,
    // följt av tre 300-cellers grenar och den kvarvarande vänstra stumpen 50..300 (250 celler).
    const tw = 1700, th = 700, tree = new Uint8Array(tw * th);
    for (let x = 50; x < 1650; x += 1) tree[x * th + 350] = 1;
    for (const bx of [300, 600, 900, 1200]) for (let y = 50; y < 350; y += 1) tree[bx * th + y] = 1;
    const treePaths = paths(tree, tw, th, 20);
    expect(treePaths.length).toBe(5);
    expect(treePaths[0]!.length).toBeGreaterThanOrEqual(1649);
    const tailLengths = treePaths.slice(1).map((p) => p.length).sort((a, b) => b - a);
    expect(tailLengths[0]).toBeGreaterThanOrEqual(299);
    expect(tailLengths[1]).toBeGreaterThanOrEqual(299);
    expect(tailLengths[2]).toBeGreaterThanOrEqual(299);
    expect(tailLengths[3]).toBeGreaterThanOrEqual(249);
  });

  it("readGroundGrid hanterar ojusterad byteOffset och GroundAccumulator/mergeGroundGrids stödjer beskurna delrutor och SharedArrayBuffer", () => {
    const a: GroundGrid = { minX: 100, minY: 200, cell: 1, width: 3, height: 2, z: Float32Array.from([10, 12, 14, 16, Number.NaN, 20]) };
    const b: GroundGrid = { minX: 102, minY: 200, cell: 1, width: 3, height: 2, z: Float32Array.from([18, 22, 24, 26, 28, 30]) };
    // Ojusterad buffer (byteOffset = 1).
    const rawA = encodeGroundBin(a), padded = new Uint8Array(rawA.length + 1);
    padded.set(rawA, 1);
    const parsedA = readGroundGrid(padded.subarray(1));
    expect(parsedA.minX).toBe(100);
    expect(parsedA.z[0]).toBe(10);
    expect(Number.isNaN(parsedA.z[4]!)).toBe(true);

    // Beskurna delrutor sammanslagna till union [100..105) × [200..202): kolumn 2 (x=102) överlappar.
    const merged = mergeGroundGrids([parsedA, b], 0);
    expect([merged.minX, merged.minY, merged.width, merged.height]).toEqual([100, 200, 5, 2]);
    // Överlapp vid x=102 (kolumn 2): y=0 bara b (18), y=1 medel av a (20) och b (22) = 21.
    expect(merged.z[2 * 2 + 0]).toBe(18);
    expect(merged.z[2 * 2 + 1]).toBe(21);
    expect(merged.z[4 * 2 + 1]).toBe(30);

    // Strömmande GroundAccumulator med shared = true ger SharedArrayBuffer-backad Float32Array.
    const acc = createGroundAccumulator({ minX: 100, minY: 200, cell: 1, width: 5, height: 2 });
    acc.add(parsedA);
    acc.add(b);
    const shared = acc.finish(0, true);
    expect(shared.z.buffer instanceof SharedArrayBuffer).toBe(true);
    expect([...shared.z]).toEqual([...merged.z]);
  });
});
