import { describe, expect, it } from "vitest";
import { DEFAULT_SOIL_URL, soilFromFeatureCollection, soilRuntimeFromEnvironment } from "../src/map-project-soil";

const ring = [[0, 0], [10, 0], [10, 10], [0, 0]];
const feature = (geometry: unknown, jg2: unknown, jg2_tx: unknown) => ({ type: "Feature", geometry, properties: { jg2, jg2_tx } });

describe("SGU:s jordarter", () => {
  it("läser Polygon och MultiPolygon med klass, kod och text", () => {
    const read = soilFromFeatureCollection({ type: "FeatureCollection", features: [
      feature({ type: "Polygon", coordinates: [ring] }, 31, "Postglacial sand"),
      feature({ type: "MultiPolygon", coordinates: [[ring], [ring, ring]] }, 5, "Kärrtorv"),
      feature({ type: "Polygon", coordinates: [ring] }, 100, "Morän"),
      feature({ type: "Polygon", coordinates: [ring] }, "888", "Berg"),
      feature({ type: "Polygon", coordinates: [ring] }, 55, null)] });
    expect(read.areas.map(area => [area.cls, area.code, area.text, area.rings.length])).toEqual([
      ["dry", 31, "Postglacial sand", 1], ["wet", 5, "Kärrtorv", 1], ["wet", 5, "Kärrtorv", 2], ["other", 100, "Morän", 1], ["other", 888, "Berg", 1], ["dry", 55, "", 1]]);
    expect(read.next).toBeNull();
  });
  it("hoppar över trasig geometri och punkter utan tal", () => {
    const read = soilFromFeatureCollection({ features: [feature({ type: "Polygon", coordinates: [[[0, 0], [1, 1]]] }, 31, "Postglacial sand"),
      feature({ type: "Point", coordinates: [1, 2] }, 31, "Postglacial sand"), feature(null, 31, "x"),
      feature({ type: "Polygon", coordinates: [[["a", 0], [1, 0], [1, 1], [0, 0]]] }, 31, "Postglacial sand")] });
    expect(read.areas).toEqual([]);
  });
  it("följer länken next och ger fel för ett svar som inte är GeoJSON", () => {
    const read = soilFromFeatureCollection({ features: [], links: [{ rel: "self", href: "https://a/self" }, { rel: "next", href: "https://a/items?offset=1000" }] });
    expect(read.next).toBe("https://a/items?offset=1000");
    expect(() => soilFromFeatureCollection({})).toThrow();
    expect(() => soilFromFeatureCollection(null)).toThrow();
    expect(() => soilFromFeatureCollection({ features: "nej" })).toThrow();
  });
  it("adressen kommer från miljön, annars SGU:s öppna tjänst", () => {
    expect(soilRuntimeFromEnvironment({}).url).toBe(DEFAULT_SOIL_URL);
    expect(soilRuntimeFromEnvironment({ OTID_SGU_JORDARTER_URL: "  " }).url).toBe(DEFAULT_SOIL_URL);
    expect(soilRuntimeFromEnvironment({ OTID_SGU_JORDARTER_URL: "http://falsk.test/items" }).url).toBe("http://falsk.test/items");
  });
});
