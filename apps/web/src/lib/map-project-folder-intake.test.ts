import { describe, expect, it } from "vitest";
import { sortIntake, vectorSketches } from "./map-project-folder-intake";
import type { MapGeoreference } from "@o-tid/map-file";

const file = (path: string, content = path) => {
  const value = new File([content], path.split("/").pop()!);
  Object.defineProperty(value, "webkitRelativePath", { value: path });
  return value;
};

describe("mappen med äldre underlag (ägaren 2026-11-10)", () => {
  it("sorterar: vektorer blir skisslager, bilder underlag, resten slängs med skäl; delarna följer huvudfilen", async () => {
    const groups = await sortIntake([
      file("gammalt/stigar.shp"), file("gammalt/stigar.dbf"), file("gammalt/stigar.prj"),
      file("gammalt/orto.jpg"), file("gammalt/orto.jgw"),
      file("gammalt/kopia/orto.jpg", "gammalt/orto.jpg"),
      file("gammalt/gräns.geojson"), file("gammalt/karta.omap"), file("gammalt/ruta.laz"), file("gammalt/rekning.gpx"),
      file("gammalt/banor.pdf"), file("gammalt/ensam.pgw"), file("gammalt/.DS_Store")
    ]);
    const by = Object.fromEntries(groups.map(group => [group.name, [group.decision, group.reason ?? null, group.files.length]]));
    expect(by).toEqual({
      "gammalt/stigar.shp": ["SKETCH", null, 3],
      "gammalt/gräns.geojson": ["SKETCH", null, 1],
      "gammalt/orto.jpg": ["UNDERLAG", null, 2],
      "gammalt/kopia/orto.jpg": ["DISCARD", "DUPLICATE", 1],
      "gammalt/karta.omap": ["DISCARD", "MAP_FILE", 1],
      "gammalt/ruta.laz": ["DISCARD", "LASER", 1],
      "gammalt/rekning.gpx": ["DISCARD", "GPS", 1],
      "gammalt/banor.pdf": ["DISCARD", "OTHER", 1],
      "gammalt/ensam.pgw": ["DISCARD", "SIDECAR", 1],
      "gammalt/.DS_Store": ["DISCARD", "SYSTEM", 1]
    });
    // Det som läses in står först.
    expect(groups.slice(0, 3).map(group => group.decision)).toEqual(["SKETCH", "SKETCH", "UNDERLAG"]);
  });

  it("vektorerna blir skisser i kartans mm; utanför kartan och utan koordinatsystem säger varför", () => {
    const georeference: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 670000, northing: 6570000 },
      mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 0, combinedScaleFactor: 1 };
    const bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const data = { skipped: 0, crs: 3006, features: [
      { layer: "stig", geometry: { kind: "line" as const, points: [[670000, 6570000], [670100, 6570050], [670200, 6570000]] as [number, number][], closed: false } },
      { layer: "sten", geometry: { kind: "point" as const, at: [670010, 6570010] as [number, number] } }] };
    const result = vectorSketches(data, georeference, bounds, undefined);
    expect("sketches" in result && result.sketches.map(sketch => sketch.kind)).toEqual(["LINE", "POINT"]);
    expect("sketches" in result && result.sketches[1]!.points[0]).toEqual([1, 1]);
    const far = { ...data, features: [{ layer: "x", geometry: { kind: "point" as const, at: [700000, 6600000] as [number, number] } }] };
    expect(vectorSketches(far, georeference, bounds, undefined)).toEqual({ problem: "OUTSIDE" });
    expect(vectorSketches({ ...data, features: [] }, georeference, bounds, undefined)).toEqual({ problem: "EMPTY" });
  });
});
