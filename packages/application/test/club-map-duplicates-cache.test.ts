import { describe, expect, it, vi } from "vitest";
import { cachedDuplicateClusters } from "../src/club-map-duplicates";

type Found = Parameters<typeof cachedDuplicateClusters>[1];

const map = (mapId: string, name: string, entryIds: string[] = []): Found[number] => ({
  candidate: { mapId, name, fileNames: [`${name}.ocd`], fingerprints: [], entryIds }, trainings: entryIds.length, newest: 2024, name, fingerprint: null
});

describe("dubblettförslagen sparas per klubb (B5, ADR-0218)", () => {
  it("räknar inte om när underlaget är detsamma, men när en karta, en träning eller ett bortval ändras", () => {
    const compute = vi.fn(() => []);
    const found = [map("a", "Skogen"), map("b", "Skogen 2019")];
    cachedDuplicateClusters("klubb-1", found, new Set(), compute);
    cachedDuplicateClusters("klubb-1", [map("a", "Skogen"), map("b", "Skogen 2019")], new Set(), compute);
    expect(compute).toHaveBeenCalledTimes(1);
    cachedDuplicateClusters("klubb-1", [map("a", "Skogen"), map("b", "Skogen 2019", ["t1"])], new Set(), compute);
    expect(compute).toHaveBeenCalledTimes(2);
    cachedDuplicateClusters("klubb-1", [map("a", "Skogen"), map("b", "Skogen 2019", ["t1"])], new Set(["a|b"]), compute);
    expect(compute).toHaveBeenCalledTimes(3);
    cachedDuplicateClusters("klubb-1", [map("a", "Skogen")], new Set(["a|b"]), compute);
    expect(compute).toHaveBeenCalledTimes(4);
    // En annan klubb med samma kartor har sin egen post.
    cachedDuplicateClusters("klubb-2", [map("a", "Skogen")], new Set(["a|b"]), compute);
    expect(compute).toHaveBeenCalledTimes(5);
    cachedDuplicateClusters("klubb-1", [map("a", "Skogen")], new Set(["a|b"]), compute);
    expect(compute).toHaveBeenCalledTimes(5);
  });

  it("ger samma grupper som jämförelsen utan cache", () => {
    const found = [map("a", "Älvsjöskogen 2019"), map("b", "alvsjoskogen_ny"), map("c", "Solberga")];
    const first = cachedDuplicateClusters("klubb-3", found, new Set());
    expect(first.map(cluster => [...cluster.mapIds].sort())).toEqual([["a", "b"]]);
    expect(cachedDuplicateClusters("klubb-3", found, new Set())).toBe(first);
    expect(cachedDuplicateClusters("klubb-3", found, new Set(["a|b"]))).toEqual([]);
  });
});
