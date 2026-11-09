import { describe, expect, it } from "vitest";
import { bulgeSegment, dwgFeatures, dwgObjects } from "../../../scripts/geo-dwg";

/** ADR-0219 K6b: DWG-ritningar ur LibreDWG:s JSON (scripts/geo-dwg.ts) i geo-arbetaren. */
async function* chunks(text: string, size: number) { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }
async function read(objects: unknown[], size = 7) {
  const text = JSON.stringify({ created_by: "test \"}{[", HEADER: { x: "]" }, OBJECTS: objects, THUMBNAILIMAGE: {} }, null, 2);
  return dwgFeatures(dwgObjects(chunks(text, size)));
}
const model = { object: "BLOCK_HEADER", handle: [0, 1, 31], name: "*Model_Space" };
const block = { object: "BLOCK_HEADER", handle: [0, 1, 90], name: "Trad" };
const layer = (handle: number, name: string) => ({ object: "LAYER", handle: [0, 1, handle], name });

describe("DWG ur LibreDWG:s JSON", () => {
  it("läser objekten ett i taget oavsett hur strömmen delas, med klamrar och citat i strängar", async () => {
    const objects = [{ object: "LAYER", handle: [0, 1, 5], name: "a{b}\"c\"" }, { entity: "LINE", handle: [0, 1, 6], note: "]" }];
    for (const size of [1, 3, 64, 100_000]) {
      const out = [];
      for await (const object of dwgObjects(chunks(JSON.stringify({ OBJECTS: objects }), size))) out.push(object);
      expect(out, String(size)).toEqual(objects);
    }
  });

  it("ger modellrymdens linjer, ytor och punkter med lagrets namn, men inte blockens innehåll eller texter", async () => {
    const result = await read([
      model, block, layer(40, "VAG"), layer(41, "HUS"), layer(42, "TRAD"),
      { entity: "LINE", handle: [0, 1, 50], entmode: 2, layer: [5, 1, 40, 40], start: [10, 20, 0], end: [30, 20, 0] },
      { entity: "LWPOLYLINE", handle: [0, 1, 51], entmode: 2, layer: [5, 1, 40, 40], flag: 512, points: [[0, 0], [4, 0], [4, 4]], bulges: [] },
      { entity: "HATCH", handle: [0, 1, 52], entmode: 2, layer: [5, 1, 41, 41], paths: [
        { flag: 1, polyline_paths: [{ point: [0, 0], bulge: 0 }, { point: [10, 0], bulge: 0 }, { point: [10, 10], bulge: 0 }, { point: [0, 10], bulge: 0 }] },
        { flag: 0, segs: [{ curve_type: 1, first_endpoint: [2, 2], second_endpoint: [4, 2] }, { curve_type: 1, first_endpoint: [4, 2], second_endpoint: [4, 4] },
          { curve_type: 1, first_endpoint: [4, 4], second_endpoint: [2, 2] }] }] },
      { entity: "INSERT", handle: [0, 1, 53], entmode: 2, layer: [5, 1, 42, 42], ins_pt: [7, 8, 0], block_header: [5, 1, 90, 90] },
      { entity: "POLYLINE_2D", handle: [0, 1, 54], entmode: 0, ownerhandle: [4, 1, 31, 31], layer: [5, 1, 40, 40], flag: 1 },
      { entity: "VERTEX_2D", handle: [0, 1, 55], entmode: 0, ownerhandle: [4, 1, 54, 54], point: [0, 0, 0], bulge: 0 },
      { entity: "VERTEX_2D", handle: [0, 1, 56], entmode: 0, ownerhandle: [4, 1, 54, 54], point: [5, 0, 0], bulge: 0 },
      { entity: "VERTEX_2D", handle: [0, 1, 57], entmode: 0, ownerhandle: [4, 1, 54, 54], point: [5, 5, 0], bulge: 0 },
      // Ett blocks innehåll och en text hoppas över.
      { entity: "LINE", handle: [0, 1, 58], entmode: 0, ownerhandle: [4, 1, 90, 90], layer: [5, 1, 40, 40], start: [0, 0, 0], end: [1, 1, 0] },
      { entity: "TEXT", handle: [0, 1, 59], entmode: 2, layer: [5, 1, 40, 40] },
      { entity: "CIRCLE", handle: [0, 1, 60], entmode: 2, layer: [5, 1, 99, 99], center: [0, 0, 0], radius: 1 }
    ]);
    expect(result.features.map(feature => [feature.properties.layer, feature.geometry.type])).toEqual([["VAG", "LineString"], ["VAG", "LineString"],
      ["HUS", "Polygon"], ["TRAD", "Point"], ["VAG", "LineString"], ["0", "Polygon"]]);
    expect(result.features[1]!.geometry.coordinates).toEqual([[0, 0], [4, 0], [4, 4], [0, 0]]);
    const hatch = result.features[2]!.geometry;
    expect(hatch.type === "Polygon" && hatch.coordinates.map(ring => ring.length)).toEqual([5, 4]);
    expect(result.features[3]!.properties).toEqual({ layer: "TRAD", block: "Trad" });
    expect(result.features[4]!.geometry.coordinates).toEqual([[0, 0], [5, 0], [5, 5], [0, 0]]);
    expect(result.skipped).toBe(2);
  });

  it("ritar bågar i polylinjer: en halvcirkel moturs och medurs", () => {
    const left = bulgeSegment([0, 0], [2, 0], 1), right = bulgeSegment([0, 0], [2, 0], -1);
    expect(left.at(-1)).toEqual([2, 0]);
    // Moturs från (0,0) till (2,0) går bågen under linjen, medurs över.
    expect(Math.min(...left.map(point => point[1]))).toBeCloseTo(-1, 1);
    expect(Math.max(...right.map(point => point[1]))).toBeCloseTo(1, 1);
    expect(bulgeSegment([0, 0], [2, 0], 0)).toEqual([[2, 0]]);
  });
});
