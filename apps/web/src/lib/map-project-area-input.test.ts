import { describe, expect, it } from "vitest";
import { areaFromCenter, areaFromGeoJson, parseLatLon } from "./map-project-area-input";

describe("ADR-0219 K1: kartans område till en ny karta", () => {
  it("GeoJSON: största polygonen med hål, utan upprepad slutpunkt; SWEREF 99 TM känns igen", () => {
    const small = [[[17.0, 59.0], [17.01, 59.0], [17.01, 59.01], [17.0, 59.0]]];
    const big = [[[17.7, 59.3], [17.8, 59.3], [17.8, 59.32], [17.7, 59.32], [17.7, 59.3]], [[17.75, 59.31], [17.76, 59.31], [17.76, 59.315], [17.75, 59.31]]];
    const area = areaFromGeoJson(JSON.stringify({ type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Polygon", coordinates: small } },
      { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [big] } }] }));
    expect(area?.crs).toBe("WGS84");
    expect(area?.rings).toHaveLength(2);
    expect(area?.rings[0]).toHaveLength(4);
    expect(areaFromGeoJson(JSON.stringify({ type: "Polygon", coordinates: [[[671000, 6573000], [671800, 6573000], [671800, 6573800]]] }))?.crs)
      .toBe("SWEREF99TM");
    expect(areaFromGeoJson("inte json")).toBeUndefined();
    expect(areaFromGeoJson(JSON.stringify({ type: "LineString", coordinates: [[0, 0], [1, 1]] }))).toBeUndefined();
  });

  it("mittpunkten i olika skrivsätt och rektangeln runt den", () => {
    expect(parseLatLon("59.3075, 17.79")).toEqual({ latitude: 59.3075, longitude: 17.79 });
    expect(parseLatLon("59.3075,17.79")).toEqual({ latitude: 59.3075, longitude: 17.79 });
    expect(parseLatLon("59,3075 17,79")).toEqual({ latitude: 59.3075, longitude: 17.79 });
    expect(parseLatLon("59.3075; 17.79")).toEqual({ latitude: 59.3075, longitude: 17.79 });
    expect(parseLatLon("Kungshatt")).toBeUndefined();
    expect(parseLatLon("95, 17")).toBeUndefined();
    const area = areaFromCenter({ latitude: 60, longitude: 18 }, 2000, 1000);
    const [sw, se, ne] = area.rings[0]!;
    // Vid 60° är en längdgrad hälften så lång som en breddgrad.
    expect((se![0] - sw![0]) / (ne![1] - se![1])).toBeCloseTo(4, 2);
  });
});
