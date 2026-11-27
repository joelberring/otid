import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { mergeGroundGrids, readGroundGrid } from "../../../scripts/geo-cliffs.ts";
import { downsampleGroundTo2m, encodePng, moistureDxf, moistureFromHeightMaps, readHeightMap } from "../../../scripts/geo-moisture.ts";
import { POINT_BANDS } from "../../../scripts/geo-points.ts";
import { slimDxf } from "../../../scripts/geo-slim.ts";
import { waterFromGrids } from "../../../scripts/geo-water.ts";
import { iniWith, pngSize } from "../../../scripts/geo-worker.ts";
import {
  initialPngMergeScale, isAlreadySlimDxf, readPngSize, runPool,
  streamMergeGroundFiles, streamMergePointFiles, streamMergeWaterFiles
} from "../../../scripts/geo-worker-helpers.ts";

function writeHeader(buf: Buffer, minX: number, minY: number, cell: number, width: number, height: number): void {
  buf.writeDoubleLE(minX, 0);
  buf.writeDoubleLE(minY, 8);
  buf.writeDoubleLE(cell, 16);
  buf.writeBigUInt64LE(BigInt(width), 24);
  buf.writeBigUInt64LE(BigInt(height), 32);
}

describe("geo-arbetarens hjälpare (Etapp G2A)", () => {
  it("iniWith stöder tvåstegs output_dxf med bakåtkompatibelt förval", () => {
    const base = "output_dxf=1\nsavetempfolders=1\nbatch=0\n";
    expect(iniWith(base, {})).toContain("output_dxf=1");
    expect(iniWith(base, {}, false, true, 2, false)).toContain("output_dxf=0");
    expect(iniWith(base, {}, false, true, 2, false)).toContain("savetempfolders=0");
    expect(iniWith(base, {}, false, true, 2, true)).toContain("output_dxf=1");
  });

  it("readPngSize läser enbart PNG-huvudet ur fil", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otid-pngsize-"));
    try {
      const png = encodePng(37, 23, () => [10, 20, 30, 255]);
      const file = join(dir, "test.png");
      await writeFile(file, png);
      expect(await readPngSize(file, pngSize)).toEqual({ width: 37, height: 23 });
      const bad = join(dir, "bad.bin");
      await writeFile(bad, Buffer.from("inte en png"));
      expect(await readPngSize(bad, pngSize)).toBeUndefined();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("initialPngMergeScale väljer skala direkt ur klipprutans mått", () => {
    expect(initialPngMergeScale({ minX: 0, minY: 0, maxX: 2000, maxY: 2000 }, 6, 30_000)).toBe(1);
    expect(initialPngMergeScale({ minX: 0, minY: 0, maxX: 6000, maxY: 6000 }, 9, 30_000)).toBe(2);
    expect(initialPngMergeScale({ minX: 0, minY: 0, maxX: 15_000, maxY: 2000 }, 4, 30_000)).toBe(2);
    expect(initialPngMergeScale({ minX: 0, minY: 0, maxX: 30_000, maxY: 2000 }, 4, 30_000)).toBe(4);
    expect(initialPngMergeScale(null, 2, 30_000)).toBe(1);
    expect(initialPngMergeScale(null, 6, 30_000)).toBe(2);
  });

  it("isAlreadySlimDxf skiljer slimmade/egna DXF från råa Karttapullautin-DXF", () => {
    const rawPullauta = "  0\nSECTION\n  2\nENTITIES\n  0\nPOLYLINE\n  8\ncontour\n 66\n1\n 70\n0\n  0\nVERTEX\n 10\n664780.123456789\n 20\n6576500.987654321\n  0\nSEQEND\n  0\nENDSEC\n  0\nEOF\n";
    expect(isAlreadySlimDxf(rawPullauta)).toBe(false);
    expect(isAlreadySlimDxf(slimDxf(rawPullauta))).toBe(true);
    const own = moistureDxf([{ name: "dike", closed: false, parts: [[[664780.12, 6576500.34], [664790.5, 6576510.75]]] }]);
    expect(isAlreadySlimDxf(own)).toBe(true);
  });

  it("streamMergeGroundFiles slår ihop beskurna mark*.bin i SharedArrayBuffer och raderar indatafilerna", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otid-stream-g-"));
    try {
      // Två beskurna delrutor på samma 1 m-rutnät som överlappar i kolumn 2 (x = 1002).
      const mkTile = (minX: number, minY: number, w: number, h: number, fn: (x: number, y: number) => number) => {
        const buf = Buffer.alloc(40 + w * h * 4);
        writeHeader(buf, minX, minY, 1, w, h);
        for (let x = 0; x < w; x += 1) for (let y = 0; y < h; y += 1) buf.writeFloatLE(fn(x, y), 40 + (x * h + y) * 4);
        return buf;
      };
      await writeFile(join(dir, "mark0.bin"), mkTile(1000, 2000, 3, 2, (x) => 10 + x));
      await writeFile(join(dir, "mark1.bin"), mkTile(1002, 2000, 3, 2, (x) => 20 + x));
      const merged = await streamMergeGroundFiles(dir, ["mark0.bin", "mark1.bin"], 0);
      expect(merged).toBeDefined();
      expect(merged!.z.buffer).toBeInstanceOf(SharedArrayBuffer);
      expect([merged!.minX, merged!.minY, merged!.width, merged!.height]).toEqual([1000, 2000, 5, 2]);
      // x=0 -> 10, x=1 -> 11, x=2 -> medel(12, 20) = 16, x=3 -> 21, x=4 -> 22
      expect(Array.from({ length: 5 }, (_, x) => merged!.z[x * 2])).toEqual([10, 11, 16, 21, 22]);
      expect(await readdir(dir)).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("streamMergePointFiles slår ihop beskurna punkter*.bin och väger intensitet & spridning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otid-stream-p-"));
    try {
      const mkPts = (minX: number, minY: number, w: number, h: number, cells: number[][]) => {
        const buf = Buffer.alloc(40 + w * h * POINT_BANDS * 4);
        writeHeader(buf, minX, minY, 2, w, h);
        cells.forEach((cell, i) => cell.forEach((v, b) => buf.writeFloatLE(v, 40 + (i * POINT_BANDS + b) * 4)));
        return buf;
      };
      await writeFile(join(dir, "punkter0.bin"), mkPts(1000, 2000, 1, 1, [[12, 10, 4, 1, 2, 3, 3000, 0.1]]));
      await writeFile(join(dir, "punkter1.bin"), mkPts(1000, 2000, 2, 1, [[15, 10, 6, 0, 0, 4, 6000, 0.2], [5, 4, 4, 0, 0, 0, 1000, 0.05]]));
      const merged = await streamMergePointFiles(dir, ["punkter0.bin", "punkter1.bin"]);
      expect(merged).toMatchObject({ minX: 1000, minY: 2000, cell: 2, width: 2, height: 1 });
      expect([...merged!.values.subarray(0, 6)]).toEqual([15, 20, 10, 1, 2, 7]);
      expect(merged!.values[6]).toBeCloseTo(4800, 1);
      expect(merged!.values[7]).toBeCloseTo(Math.sqrt((4 * 0.01 + 6 * 0.04) / 10), 4);
      expect(merged!.values[POINT_BANDS]).toBe(5);
      expect(await readdir(dir)).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("streamMergeWaterFiles slår ihop beskurna vatten*.bin på globalt 2 m-rutnät och raderar dem", async () => {
    const dir = await mkdtemp(join(tmpdir(), "otid-stream-w-"));
    try {
      const mkWater = (minX: number, minY: number, w: number, h: number, fill: number) => {
        const buf = Buffer.alloc(40 + w * h, fill);
        writeHeader(buf, minX, minY, 2, w, h);
        return buf;
      };
      // Vänster halva: mark (bit 1); höger halva: 20×20 sjö med vattenpunkter (bit 2).
      await writeFile(join(dir, "vatten0.bin"), mkWater(1000, 2000, 10, 20, 1));
      await writeFile(join(dir, "vatten1.bin"), mkWater(1020, 2000, 20, 20, 2));
      const merged = await streamMergeWaterFiles(dir, ["vatten0.bin", "vatten1.bin"]);
      expect(merged).toMatchObject({ minX: 1000, minY: 2000, cell: 2, width: 30, height: 20 });
      const water = waterFromGrids([merged!]);
      expect(water.at(1005, 2010)).toBe(false);
      expect(water.at(1035, 2020)).toBe(true);
      expect(await readdir(dir)).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("downsampleGroundTo2m ger fukt-paritet mot Karttapullautins xyz2.hmap på Kungshatt", async () => {
    const fixture = join(import.meta.dirname, "../../../fixtures/laser/kungshatt-300m");
    const hmap = readHeightMap(new Uint8Array(gunzipSync(await readFile(join(fixture, "xyz2.hmap.gz")))));
    const ground = mergeGroundGrids([readGroundGrid(new Uint8Array(gunzipSync(await readFile(join(fixture, "mark.bin.gz")))))]);
    const ref = moistureFromHeightMaps([hmap]);
    const fromMark = moistureFromHeightMaps([downsampleGroundTo2m(ground)]);
    expect(fromMark.summary.wetAreas).toBe(ref.summary.wetAreas);
    expect(fromMark.summary.moistAreas).toBe(ref.summary.moistAreas);
    expect(fromMark.summary.channels).toBe(ref.summary.channels);
    expect(Math.abs(fromMark.summary.wetHa - ref.summary.wetHa)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(fromMark.summary.moistHa - ref.summary.moistHa)).toBeLessThanOrEqual(0.05);
  });

  it("runPool begränsar samtidigheten och slutför alla uppgifter", async () => {
    let active = 0, peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      active += 1;
      if (active > peak) peak = active;
      await new Promise(resolve => setTimeout(resolve, 10));
      seen.push(n);
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThanOrEqual(2);
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
