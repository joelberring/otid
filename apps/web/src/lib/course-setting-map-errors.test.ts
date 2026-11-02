import { describe, expect, it } from "vitest";
import type { CourseSettingNote } from "@o-tid/contracts";
import { mapPointToProjected, type MapGeoreference } from "@o-tid/map-file";
import { cropFor, mapErrorGeometry, mapErrorNotes, mapErrorsGeoJson, nearControlMeters, type ExportedMapError } from "./course-setting-map-errors";
import { testDocument } from "./course-setting-test-document";

/** ADR-0181 beslut 8: kartfelen till kartritaren – vilka som är kartfel, GeoJSON med och utan georeferens, närhet och utsnitt. */
const actor = { accountId: "10000000-0000-4000-8000-000000000001", displayName: "Anna Banläggare" };
function note(id: string, target: CourseSettingNote["target"], kind: CourseSettingNote["kind"] = "MAP_ERROR"): CourseSettingNote {
  return { id, target, kind, at: { x: 1, y: 1 }, course: null, text: `Text ${id}`, status: "OPEN", createdAt: "2026-11-02T08:00:00.000Z",
    createdBy: actor, resolvedAt: null, resolvedBy: null, photo: null, replies: [] };
}
const line = { kind: "LINE" as const, style: "MAP_ERROR" as const, intent: "WRONG" as const, points: [{ x: 10, y: 20 }, { x: 14, y: 22 }] };
const area = { kind: "AREA" as const, style: "MARKING" as const, intent: null, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 3 }] };
const georeference: MapGeoreference = { scale: 10000, crs: { kind: "EPSG", code: 3006 }, refPoint: { easting: 675000, northing: 6580000 },
  mapRefPoint: { x: 0, y: 0 }, grivationDegrees: 2.5, combinedScaleFactor: 1 };

describe("kartfelen till kartritaren", () => {
  it("bara slaget kartfel på en punkt eller en ritning", () => {
    const notes = [note("a", { kind: "SKETCH", shapes: [line] }), note("b", { kind: "POINT", at: { x: 3, y: 4 } }),
      note("c", { kind: "SKETCH", shapes: [line] }, "COURSE_SETTING"), note("d", { kind: "CONTROL", control: "x" })];
    expect(mapErrorNotes(notes).map(row => row.id)).toEqual(["a", "b"]);
  });

  it("GeoJSON med georeferens: kartans projicerade koordinater (SWEREF 99 TM med crs), linjer, ytor och punkter", () => {
    const items: ExportedMapError[] = [{ number: 1, text: "Stigen går söder om kullen", status: "OPEN", geometry: { shapes: [line, area] } },
      { number: 2, text: "Sten saknas", status: "DONE", geometry: { shapes: [], point: { x: 3, y: 4 } } }];
    const json = mapErrorsGeoJson(items, georeference) as { crs: unknown; features: { properties: Record<string, unknown>;
      geometry: { type: string; coordinates: unknown } }[] };
    expect(json.crs).toEqual({ type: "name", properties: { name: "urn:ogc:def:crs:EPSG::3006" } });
    expect(json.features.map(row => row.geometry.type)).toEqual(["LineString", "Polygon", "Point"]);
    const expected = mapPointToProjected(georeference, { x: 10, y: 20 });
    const [first] = json.features[0]!.geometry.coordinates as [number, number][];
    expect(first![0]).toBeCloseTo(expected.easting, 1);
    expect(first![1]).toBeCloseTo(expected.northing, 1);
    // 1 mm på kartan i 1:10 000 är 10 m.
    const [a, b] = json.features[0]!.geometry.coordinates as [number, number][];
    expect(Math.hypot(b![0] - a![0], b![1] - a![1])).toBeCloseTo(Math.hypot(4, 2) * 10, 1);
    // Ytan är stängd.
    const ring = (json.features[1]!.geometry.coordinates as [number, number][][])[0]!;
    expect(ring).toHaveLength(4);
    expect(ring[3]).toEqual(ring[0]);
    expect(json.features[0]!.properties).toEqual({ nr: 1, text: "Stigen går söder om kullen", status: "OPEN", part: 1, form: "LINE",
      style: "MAP_ERROR", intent: "WRONG" });
    expect(json.features[2]!.properties).toMatchObject({ nr: 2, form: "POINT", status: "DONE" });
  });

  it("GeoJSON utan georeferens: kartans mm, ingen crs; okänt koordinatsystem: projicerade meter utan namn", () => {
    const items: ExportedMapError[] = [{ number: 1, text: "x", status: "OPEN", geometry: { shapes: [line] } }];
    const plain = mapErrorsGeoJson(items, null) as { crs?: unknown; features: { geometry: { coordinates: unknown } }[] };
    expect(plain.crs).toBeUndefined();
    expect(plain.features[0]!.geometry.coordinates).toEqual([[10, 20], [14, 22]]);
    const unknown = mapErrorsGeoJson(items, { ...georeference, crs: { kind: "UNKNOWN", description: "Lokalt" } }) as { crs?: unknown;
      features: { geometry: { coordinates: [number, number][] } }[] };
    expect(unknown.crs).toBeUndefined();
    expect(unknown.features[0]!.geometry.coordinates[0]![0]).toBeGreaterThan(600000);
  });

  it("exporten bär inget om banorna eller vem som skrev: bara nummer, text, status, form, färg och betydelse", () => {
    const document = testDocument();
    const id = "5b1f0c2a-0000-4000-8000-00000000abcd";
    const exported = mapErrorNotes([note(id, { kind: "SKETCH", shapes: [line] })]).map((row, index) => ({ number: index + 1, text: "Stigen saknas",
      status: row.status, geometry: mapErrorGeometry(row) }));
    const text = JSON.stringify(mapErrorsGeoJson(exported, georeference));
    for (const forbidden of ["Anna", "2026-11-02", id, ...document.courses.map(course => course.name),
      ...Object.values(document.controls).flatMap(control => control.code ? [`"${control.code}"`] : [])]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("nära en kontroll: inom 50 m (eller ringen) ger avståndet i meter, annars inget", () => {
    const document = testDocument();
    const control = Object.values(document.controls)[0]!;
    const perMm = 10;
    const near = { shapes: [{ ...line, points: [{ x: control.at.x + 2, y: control.at.y }, { x: control.at.x + 8, y: control.at.y }] }] };
    expect(nearControlMeters(near, document, perMm)).toBe(20);
    const far = { shapes: [], point: { x: control.at.x + 400, y: control.at.y + 400 } };
    expect(nearControlMeters(far, document, perMm)).toBeUndefined();
  });

  it("utsnittet rymmer kartfelet med marginal men har inte kartfelet i mitten", () => {
    let seed = 1;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let round = 0; round < 50; round += 1) {
      const crop = cropFor({ shapes: [], point: { x: 100, y: 100 } }, random);
      expect(crop.maxX - crop.minX).toBeCloseTo(80);
      expect(crop.minX).toBeLessThanOrEqual(92); expect(crop.maxX).toBeGreaterThanOrEqual(108);
      expect(crop.minY).toBeLessThanOrEqual(92); expect(crop.maxY).toBeGreaterThanOrEqual(108);
      const offset = Math.hypot((crop.minX + crop.maxX) / 2 - 100, (crop.minY + crop.maxY) / 2 - 100);
      expect(offset).toBeGreaterThan(5);
    }
    const big = cropFor({ shapes: [{ ...line, points: [{ x: 0, y: 0 }, { x: 200, y: 10 }] }] }, () => 0.5);
    expect(big.maxX - big.minX).toBeGreaterThanOrEqual(216);
    expect((big.maxX - big.minX) / (big.maxY - big.minY)).toBeCloseTo(80 / 55);
  });
});
