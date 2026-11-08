import { describe, expect, it } from "vitest";
import { MAP_PROJECT_NEW_SCALES } from "@o-tid/contracts";
import { SYMBOL_SETS } from "@o-tid/map-file";

describe("ADR-0219 K1: nya kartors normer", () => {
  it("API:ts skalor är symbolsetens", () => {
    expect(Object.keys(MAP_PROJECT_NEW_SCALES).sort()).toEqual(Object.keys(SYMBOL_SETS).sort());
    for (const [id, scales] of Object.entries(MAP_PROJECT_NEW_SCALES)) {
      expect([...scales]).toEqual(SYMBOL_SETS[id as keyof typeof SYMBOL_SETS].scales.map(entry => entry.scale));
    }
  });
});
