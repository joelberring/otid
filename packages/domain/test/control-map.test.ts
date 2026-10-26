import { describe, expect, it } from "vitest";
import { controlLoads, deriveRasterGeoreference, layoutControlMap, runnerControlMarks } from "../src";

describe("steg 52: kontrollkartans lägen", () => {
  it("lägger lägena i meter runt mittpunkten med norr uppåt när kartbild saknas", () => {
    const layout = layoutControlMap({ places: [
      { key: "a", geo: { latitude: 59.3, longitude: 18.0 } },
      { key: "b", geo: { latitude: 59.301, longitude: 18.0 } },
      { key: "c", geo: { latitude: 59.3, longitude: 18.002 } }
    ] });
    expect(layout.frame).toBe("GEO");
    expect(layout.metersPerUnit).toBe(1);
    const a = layout.points.get("a")!, b = layout.points.get("b")!, c = layout.points.get("c")!;
    // 0,001° nord ≈ 111 m, uppåt (mindre y); 0,002° öst på 59,3° ≈ 114 m åt höger.
    expect(a.y - b.y).toBeCloseTo(111.2, 0);
    expect(c.x - a.x).toBeCloseTo(113.6, 0);
  });

  it("använder kartbildens pixlar när kartan är georefererad och räknar skalan", () => {
    const { transform } = deriveRasterGeoreference({ imageWidth: 1001, imageHeight: 1001, tiePoints: [
      { pixelX: 0, pixelY: 0, latitude: 59.31, longitude: 18.0 },
      { pixelX: 1000, pixelY: 0, latitude: 59.31, longitude: 18.02 },
      { pixelX: 0, pixelY: 1000, latitude: 59.30, longitude: 18.0 }
    ] });
    const layout = layoutControlMap({ places: [{ key: "a", geo: { latitude: 59.305, longitude: 18.01 } }],
      map: { transform, width: 1000, height: 1000 } });
    expect(layout.frame).toBe("MAP");
    expect(layout.points.get("a")).toEqual({ x: 500, y: 500 });
    // 0,02° öst på 59,305° ≈ 1136 m över 1000 px.
    expect(layout.metersPerUnit).toBeCloseTo(1.136, 2);
  });

  it("använder kartlägena (mm, y uppåt) med kartans skala när WGS 84 saknas", () => {
    const layout = layoutControlMap({ places: [{ key: "a", paper: { x: 10, y: 20 } }, { key: "b", paper: { x: 30, y: -10 } }], scale: 10000 });
    expect(layout.frame).toBe("PAPER");
    expect(layout.points.get("a")).toEqual({ x: 100, y: -200 });
    expect(layout.points.get("b")).toEqual({ x: 300, y: 100 });
    expect(layoutControlMap({ places: [{ key: "a", paper: { x: 1, y: 1 } }] }).metersPerUnit).toBeNull();
  });

  it("placerar en kontroll med bara kartläge i WGS 84-ramen efter punkter som har båda", () => {
    const layout = layoutControlMap({ places: [
      { key: "a", geo: { latitude: 59.3, longitude: 18.0 }, paper: { x: 0, y: 0 } },
      { key: "b", geo: { latitude: 59.301, longitude: 18.0 }, paper: { x: 0, y: 11.12 } },
      { key: "c", paper: { x: 0, y: 5.56 } }
    ], scale: 10000 });
    const a = layout.points.get("a")!, b = layout.points.get("b")!, c = layout.points.get("c")!;
    expect(c.x).toBeCloseTo(a.x, 0);
    expect(c.y).toBeCloseTo((a.y + b.y) / 2, 0);
  });

  it("ger ingen ram utan lägen", () => {
    expect(layoutControlMap({ places: [{ key: "a" }] })).toMatchObject({ frame: "NONE", bounds: null });
  });
});

describe("steg 52: belastning per kontroll", () => {
  it("räknar banor, varianter, planerade löpare och stämplingar", () => {
    const loads = controlLoads([
      { courseId: "lang", variants: [{ code: "A", controlCodes: [31, 41, 33] }, { code: "B", controlCodes: [31, 42, 33] }] },
      { courseId: "kort", variants: [{ code: null, controlCodes: [31, 35] }] }
    ], [
      { courseId: "lang", variantCode: "A" }, { courseId: "lang", variantCode: "B" }, { courseId: "lang", variantCode: null },
      { courseId: "kort", variantCode: null }
    ], [[31, 41, 33], [31, 31, 35]]);
    expect(loads.find(load => load.code === 31)).toEqual({ code: 31, courses: 2, variants: 3, planned: 4, punched: 2 });
    // Utan variant räknas löparen bara på kontroller som alla varianter har.
    expect(loads.find(load => load.code === 41)).toEqual({ code: 41, courses: 1, variants: 1, planned: 1, punched: 1 });
    expect(loads.find(load => load.code === 33)).toMatchObject({ planned: 3 });
    expect(loads.map(load => load.code)).toEqual([31, 33, 35, 41, 42]);
  });
});

describe("steg 52: löparens stämplingar på kartan", () => {
  it("märker stämplade, saknade och i fel ordning med grannarna", () => {
    const marks = runnerControlMarks([45, 46, 47, 48, 49], [{ controlCode: 45, occurrence: 1 }, { controlCode: 46, occurrence: 1 },
      { controlCode: 48, occurrence: 1 }], [49]);
    expect(marks.map(row => row.mark)).toEqual(["OK", "OK", "MISSING", "OK", "WRONG_ORDER"]);
    expect(marks[2]).toEqual({ code: 47, position: 3, mark: "MISSING", previous: 46, next: 48 });
    expect(marks[0]!.previous).toBe("S");
    expect(marks[4]!.next).toBe("M");
  });

  it("räknar en återkommande kontroll per förekomst och en kontroll ur funktion som frivillig", () => {
    const marks = runnerControlMarks([50, 41, 50, 42, 50], [{ controlCode: 50, occurrence: 1 }, { controlCode: 41, occurrence: 1 },
      { controlCode: 50, occurrence: 2 }], [], new Set([42]));
    expect(marks.map(row => row.mark)).toEqual(["OK", "OK", "OK", "NEUTRAL", "MISSING"]);
  });
});
