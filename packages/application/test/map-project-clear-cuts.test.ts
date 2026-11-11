import { describe, expect, it } from "vitest";
import { clearCutsFromGeoJson } from "../src/map-project-clear-cuts";

describe("Skogsstyrelsens utförda avverkningar", () => {
  it("läser ytorna med datum (millisekunder) och typ, också multipolygoner", () => {
    const ring = [[0, 0], [10, 0], [10, 10], [0, 0]];
    const cuts = clearCutsFromGeoJson({ type: "FeatureCollection", features: [
      { type: "Feature", properties: { Avvdatum: Date.UTC(2024, 4, 3), Avverktyp: "Slutavverkning" }, geometry: { type: "Polygon", coordinates: [ring] } },
      { type: "Feature", properties: { Avvdatum: null }, geometry: { type: "MultiPolygon", coordinates: [[ring], [ring]] } },
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 1]]] } }] });
    expect(cuts).toEqual([{ rings: [ring], date: "2024-05-03", kind: "Slutavverkning" }, { rings: [ring], date: null, kind: null }, { rings: [ring], date: null, kind: null }]);
    expect(() => clearCutsFromGeoJson({})).toThrow();
  });
});
