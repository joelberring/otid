import { describe, expect, it, vi } from "vitest";
import {
  clusterDuplicates, extentIoU, extentOverlap, findDuplicatePairs, nameSimilarity, normalizeMapName, scoreDuplicatePair,
  symbolSetHash, type DuplicateCandidate, type MapFingerprint
} from "../src/map-duplicates";

/** ADR-0210: dubbletter bland klubbarkivets kartor. Namnen och ytorna är påhittade. */
const fingerprint = (extent: [number, number, number, number] | null, options: Partial<MapFingerprint> = {}): MapFingerprint => {
  const symbols = options.symbols ?? ["101.0", "201.0", "301.0", "401.0", "406.0"];
  return {
    scale: 10000, bounds: { minX: 0, minY: 0, maxX: 120, maxY: 80 }, symbols, symbolHash: symbolSetHash(symbols), objectCount: 100,
    projected: extent ? { epsg: 3006, extent: { minX: extent[0], minY: extent[1], maxX: extent[2], maxY: extent[3] } } : null, ...options
  };
};
const candidate = (mapId: string, name: string, extra: Partial<DuplicateCandidate> = {}): DuplicateCandidate =>
  ({ mapId, name, fileNames: [], fingerprints: [], entryIds: [], ...extra });

describe("normalizeMapName", () => {
  it("tar bort accenter, filändelse, år, datum och ord som inte säger något om området", () => {
    expect(normalizeMapName("Älvsjöskogen 2019.ocd")).toEqual(["alvsjoskogen"]);
    expect(normalizeMapName("alvsjoskogen_ny.ocd")).toEqual(["alvsjoskogen"]);
    expect(normalizeMapName("Älvsjöskogen rev 2021.omap")).toEqual(["alvsjoskogen"]);
    expect(normalizeMapName("Älvsjöskogen 2018-08-12 V11.ocd")).toEqual(["alvsjoskogen"]);
    expect(normalizeMapName("ÅRSTA KARTA reviderad v2 final - Kopia (2).xmap")).toEqual(["arsta"]);
    expect(normalizeMapName("Örby version 3 OCAD 20190512.ocd")).toEqual(["orby"]);
    expect(normalizeMapName("C:\\Kartor\\2019\\Sätra skog 05-12.ocd")).toEqual(["satra", "skog"]);
  });

  it("behåller ord som är en del av namnet", () => {
    expect(normalizeMapName("Gamla skogen.ocd")).toEqual(["gamla", "skogen"]);
    expect(normalizeMapName("Solberga sprint.omap")).toEqual(["solberga", "sprint"]);
    expect(normalizeMapName("2019.ocd")).toEqual([]);
    expect(normalizeMapName("Øvre Strasse Ålund.ocd")).toEqual(normalizeMapName("øvre straße alund.ocd"));
  });
});

describe("nameSimilarity", () => {
  it("ger 1 för samma namn efter normalisering och högt för hopskrivet eller stavfel", () => {
    expect(nameSimilarity("Älvsjöskogen 2019.ocd", "alvsjoskogen_ny.ocd")).toBe(1);
    expect(nameSimilarity("Älvsjö skogen", "Älvsjöskogen")).toBeGreaterThan(0.85);
    expect(nameSimilarity("Alvsjöskogen", "Älvsjöskog")).toBeGreaterThan(0.75);
  });

  it("ger lågt för olika områden och 0 utan ord", () => {
    expect(nameSimilarity("Älvsjöskogen", "Solberga")).toBeLessThan(0.3);
    expect(nameSimilarity("Älvsjöskogen norra", "Älvsjöskogen södra")).toBeLessThan(0.75);
    expect(nameSimilarity("karta.ocd", "karta.ocd")).toBe(0);
  });
});

describe("extentIoU", () => {
  it("räknar skärning genom union och den mindre ytans andel", () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(extentIoU(a, a)).toBe(1);
    expect(extentIoU(a, { minX: 5, minY: 0, maxX: 15, maxY: 10 })).toBeCloseTo(50 / 150);
    expect(extentIoU(a, { minX: 20, minY: 20, maxX: 30, maxY: 30 })).toBe(0);
    expect(extentOverlap(a, { minX: -10, minY: -10, maxX: 20, maxY: 20 })).toEqual({ iou: 100 / 900, contained: 1 });
    expect(extentIoU(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(0);
  });
});

describe("scoreDuplicatePair", () => {
  it("samma område och namn är troligen samma karta, med skälen", () => {
    const pair = scoreDuplicatePair(
      candidate("a", "Älvsjöskogen 2019", { fingerprints: [fingerprint([0, 0, 1000, 800])] }),
      candidate("b", "alvsjoskogen_ny", { fingerprints: [fingerprint([100, 0, 1000, 800])] }));
    expect(pair?.level).toBe("HIGH");
    expect(pair?.reasons).toContainEqual({ kind: "AREA", overlap: 0.9, contained: 1 });
    expect(pair?.reasons.map(reason => reason.kind)).toEqual(["AREA", "SAME_NAME", "SAME_SYMBOLS", "SAME_SCALE"]);
  });

  it("olika namn men samma område och innehåll räcker; olika områden aldrig", () => {
    const area = candidate("a", "Skogen", { fingerprints: [fingerprint([0, 0, 1000, 800])] });
    expect(scoreDuplicatePair(area, candidate("b", "Träningskarta", { fingerprints: [fingerprint([0, 0, 1000, 800])] }))?.level).toBe("HIGH");
    expect(scoreDuplicatePair(area, candidate("c", "Skogen", { fingerprints: [fingerprint([5000, 5000, 6000, 5800])] }))).toBeNull();
  });

  it("bara namnet är kanske samma; olika namn utan något annat är ingenting", () => {
    expect(scoreDuplicatePair(candidate("a", "Älvsjöskogen"), candidate("b", "Älvsjöskogen rev 2021"))?.level).toBe("MEDIUM");
    expect(scoreDuplicatePair(candidate("a", "Älvsjöskogen"), candidate("b", "Solberga"))).toBeNull();
  });

  it("utan georeferens räknas kartytan i mm med samma skala, och gemensamma träningar väger in", () => {
    const flat = (name: string, id: string, entries: string[]) => candidate(id, name, { fingerprints: [fingerprint(null)], entryIds: entries });
    const pair = scoreDuplicatePair(flat("Skogen", "a", ["t1", "t2"]), flat("Skogen v2", "b", ["t2"]));
    expect(pair?.level).toBe("HIGH");
    expect(pair?.reasons).toContainEqual({ kind: "SAME_EXTENT" });
    expect(pair?.reasons).toContainEqual({ kind: "SHARED_TRAININGS", count: 1 });
    // Filnamnen jämförs också.
    expect(scoreDuplicatePair(candidate("a", "Karta 1", { fileNames: ["Älvsjöskogen.ocd"] }), candidate("b", "Älvsjöskogen"))?.level).toBe("MEDIUM");
  });

  it("utan georeferens: samma pappersyta, symboler och skala räcker inte utan namnlikhet eller gemensam träning", () => {
    const flat = (id: string, name: string, entries: string[] = []) => candidate(id, name, { fingerprints: [fingerprint(null)], entryIds: entries });
    expect(scoreDuplicatePair(flat("a", "Solberga"), flat("b", "Hammarbyskogen"))).toBeNull();
    // Med en gemensam träning räknas ytan (som förut).
    expect(scoreDuplicatePair(flat("a", "Solberga", ["t1"]), flat("b", "Hammarbyskogen", ["t1"]))?.reasons).toContainEqual({ kind: "SAME_EXTENT" });
  });

  it("parets ordning är densamma åt båda hållen", () => {
    const left = candidate("b", "Skogen");
    const right = candidate("a", "Skogen 2020");
    expect(scoreDuplicatePair(left, right)).toEqual(scoreDuplicatePair(right, left));
    expect(scoreDuplicatePair(left, right)).toMatchObject({ a: "a", b: "b" });
  });
});

describe("clusterDuplicates", () => {
  const area = (id: string, name: string, x: number) => candidate(id, name, { fingerprints: [fingerprint([x, 0, x + 1000, 800])] });

  it("tre filer av samma karta blir en grupp; en annan karta och bortvalda par är utanför", () => {
    const maps = [area("a", "Älvsjöskogen 2019", 0), area("b", "alvsjoskogen_ny", 50), area("c", "Älvsjöskogen rev 2021", 100), area("d", "Solberga", 9000)];
    const clusters = clusterDuplicates(findDuplicatePairs(maps));
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ mapIds: ["a", "b", "c"], level: "HIGH" });
    expect(clusters[0]!.reasons[0]).toMatchObject({ kind: "AREA", overlap: 0.82 });
    const dismissed = new Set(["a|b", "a|c", "b|c"]);
    expect(clusterDuplicates(findDuplicatePairs(maps, dismissed))).toEqual([]);
  });

  it("en grupp med ett osäkert led är kanske samma, och säkrast först", () => {
    const maps = [area("a", "Skogen", 0), area("b", "Skogen ny", 0), candidate("c", "Skogen rev 2"), candidate("x", "Berget"), candidate("y", "Berget 2020")];
    const clusters = clusterDuplicates(findDuplicatePairs(maps));
    expect(clusters.map(cluster => [cluster.mapIds.join(""), cluster.level])).toEqual([["abc", "MEDIUM"], ["xy", "MEDIUM"]]);
  });

  it("delar en för stor grupp i de säkra grupperna och de osäkra paren", () => {
    const maps = Array.from({ length: 5 }, (_, index) => candidate(`m${index}`, `Skogen ${2010 + index}`));
    const clusters = clusterDuplicates(findDuplicatePairs(maps), 3);
    expect(clusters.every(cluster => cluster.mapIds.length === 2 && cluster.level === "MEDIUM")).toBe(true);
    expect(clusters).toHaveLength(10);
  });
});

describe("symbolSetHash", () => {
  it("beror inte på ordningen eller dubbletter", () => {
    expect(symbolSetHash(["101.0", "201.0"])).toBe(symbolSetHash(["201.0", "101.0", "101.0"]));
    expect(symbolSetHash(["101.0"])).not.toBe(symbolSetHash(["102.0"]));
    expect(symbolSetHash([])).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("findDuplicatePairs med många kartor (B5)", () => {
  it("normaliserar varje namn en gång, inte en gång per par", () => {
    const words = ["Älvsjö", "skogen", "Solberga", "Kungshatt", "norra", "södra"];
    const candidates = Array.from({ length: 60 }, (_, i) => ({ mapId: `m${String(i).padStart(3, "0")}`, name: `${words[i % 6]} ${words[(i * 5) % 6]} ${i}`,
      fileNames: [`${words[(i + 1) % 6]}_2019 rev ${i}.ocd`], fingerprints: [], entryIds: [] }));
    const expected = JSON.stringify(candidates.flatMap((a, i) => candidates.slice(i + 1).flatMap(b => scoreDuplicatePair(a, b) ?? [])));
    const normalize = vi.spyOn(String.prototype, "normalize");
    try {
      const pairs = findDuplicatePairs(candidates);
      // Två normaliseringar per namn (NFC och NFD); förut fyra per namnpar i varje par (ca 28 000).
      expect(normalize.mock.calls.length).toBeLessThanOrEqual(2 * 120);
      normalize.mockRestore();
      expect(JSON.stringify(pairs)).toBe(expected);
    } finally { normalize.mockRestore(); }
  });
});
