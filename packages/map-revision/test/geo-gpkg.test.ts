import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildingLayer, featuresGeoJson, landCoverLayer, readGpkgFeatures, readGpkgGeometry, unzipFirst } from "../../../scripts/geo-gpkg";
import { fakeGpkg, zipOf } from "../../../tests/e2e/fake-gpkg";
import { importLayers, suggestSymbol } from "../src/vector-import";
import { parseGeoJson } from "../src/vector-parse";

/**
 * Grundkartan G8: Lantmäteriets Marktäcke (GeoPackage i en zip) läst till kandidater. Filen här är byggd som Lantmäteriets
 * (samma tabeller, `objekttyp` och geometri); den riktiga filen för Ekerö är provad för hand men ligger inte i repot.
 */
const squares = [
  { table: "mark", type: "Sjö", x: 664_800, y: 6_576_520, side: 40 }, { table: "mark", type: "Öppen mark", x: 664_900, y: 6_576_600, side: 30 },
  { table: "mark", type: "Åker", x: 664_950, y: 6_576_700, side: 50 }, { table: "mark", type: "Fruktodling", x: 665_000, y: 6_576_520, side: 20 },
  { table: "mark", type: "Barr- och blandskog", x: 664_800, y: 6_576_600, side: 90 }, { table: "mark", type: "Låg bebyggelse", x: 665_020, y: 6_576_600, side: 30 },
  { table: "mark", type: "Åker", x: 700_000, y: 6_600_000, side: 50 },
  { table: "sankmark", type: "Sankmark, våt", x: 664_850, y: 6_576_750, side: 20 }, { table: "sankmark", type: "Sankmark, fast", x: 664_880, y: 6_576_750, side: 20 }
] as const;
const BOX = { minX: 664_780, minY: 6_576_500, maxX: 665_080, maxY: 6_576_800 };

describe("Lantmäteriets marktäcke ur GeoPackage", () => {
  it("packar upp zip-filen (lagrad och packad) och hittar GeoPackage-filen", () => {
    const gpkg = fakeGpkg(squares);
    const stored = unzipFirst(new Uint8Array(zipOf("marktacke_kn0125.gpkg", gpkg)), /\.gpkg$/i);
    expect(stored?.name).toBe("marktacke_kn0125.gpkg");
    expect(Buffer.from(stored!.bytes).equals(gpkg)).toBe(true);
    // Samma arkiv med deflate: byt metoden och innehållet för hand.
    const packed = deflateRawSync(gpkg), zip = zipOf("a.gpkg", packed);
    zip.writeUInt16LE(8, 8); zip.writeUInt16LE(8, zip.length - 22 - 6 - 46 + 10);
    expect(Buffer.from(unzipFirst(new Uint8Array(zip), /\.gpkg$/i)!.bytes).equals(gpkg)).toBe(true);
    expect(unzipFirst(new Uint8Array(zipOf("lasmig.txt", Buffer.from("x"))), /\.gpkg$/i)).toBeUndefined();
    expect(() => unzipFirst(new Uint8Array(40), /x/)).toThrow();
  });

  it("läser objekten inom rutan och ger dem importens lager och symboler", async () => {
    const dir = mkdtempSync(join(tmpdir(), "otid-gpkg-test-"));
    try {
      writeFileSync(join(dir, "m.gpkg"), fakeGpkg(squares));
      const features = await readGpkgFeatures(join(dir, "m.gpkg"), BOX);
      // Åkern långt bort är inte med.
      expect(features).toHaveLength(8);
      const result = featuresGeoJson(features, landCoverLayer);
      expect(result.counts).toEqual({ vatten: 1, oppen_mark: 1, aker: 1, fruktodling: 1, bebyggelse_lag: 1, sankmark_vat: 1, sankmark_fast: 1 });
      const data = parseGeoJson(result.geojson);
      const symbols = ["301", "308", "310", "401", "412", "413", "521"].map(code => ({ id: `s${code}`, code, kind: "area" }));
      expect(Object.fromEntries(importLayers(data).map(layer => [layer.name, suggestSymbol(layer, symbols)]))).toEqual({ vatten: "s301", oppen_mark: "s401",
        aker: "s412", fruktodling: "s413", bebyggelse_lag: undefined, sankmark_vat: "s308", sankmark_fast: "s310" });
      // Vatten som lasern redan har kan väljas bort, och byggnader blir lagret byggnad.
      expect(featuresGeoJson(features, landCoverLayer, layer => layer !== "vatten").counts.vatten).toBeUndefined();
      expect(featuresGeoJson(features.slice(0, 2), buildingLayer).counts).toEqual({ byggnad: 2 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("tolkar geometrin med liten ände, flerdelade ytor och ruta i huvudet; skräp ger ingenting", () => {
    // Huvud med ruta (32 byte), sedan MultiPolygon med en yta, liten ände, utan Z.
    const blob = Buffer.alloc(8 + 32 + 9 + 9 + 4 + 4 * 16);
    blob.write("GP"); blob.writeUInt8(0x03, 3);
    let at = 40;
    blob.writeUInt8(1, at); blob.writeUInt32LE(6, at + 1); blob.writeUInt32LE(1, at + 5); at += 9;
    blob.writeUInt8(1, at); blob.writeUInt32LE(3, at + 1); blob.writeUInt32LE(1, at + 5); at += 9;
    blob.writeUInt32LE(4, at); at += 4;
    for (const [x, y] of [[0, 0], [10, 0], [10, 10], [0, 0]]) { blob.writeDoubleLE(x!, at); blob.writeDoubleLE(y!, at + 8); at += 16; }
    expect(readGpkgGeometry(new Uint8Array(blob))).toEqual([{ kind: "area", rings: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }]);
    expect(readGpkgGeometry(new Uint8Array([1, 2, 3]))).toEqual([]);
    expect(readGpkgGeometry(new Uint8Array(Buffer.from("GP\0\0\0\0\0\0\0\0\0\0\x63", "latin1")))).toEqual([]);
  });
});
