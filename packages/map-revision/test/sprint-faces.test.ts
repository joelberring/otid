/** Föreslå ytor på sprintkartor (ägaren 2026-11-13): reglerna ruta → förslag och objektens roller i rutans gräns. */
import { describe, expect, it } from "vitest";
import {
  FACE_UNCERTAIN_AREA_M2, PAVED_EDGE_SHARE, PAVED_MAX_MEAN_WIDTH_M, PLOT_BARRIER_SHARE, PLOT_MAX_AREA_M2, faceBoundaryRole, suggestFaceRole, type FaceFeatures
} from "../src";

/** En rektangel b × l m med gränsen fördelad på roller (andelar av omkretsen). */
const box = (width: number, length: number, shares: Partial<Record<"pavedEdge" | "paved" | "barrier" | "building" | "forbidden" | "other", number>>,
  extra: Partial<FaceFeatures> = {}): FaceFeatures => {
  const perimeterM = 2 * (width + length);
  return { areaM2: width * length, perimeterM, closures: 0, buildingsInside: 0,
    boundaryM: Object.fromEntries(Object.entries(shares).map(([role, share]) => [role, share * perimeterM])), ...extra };
};

describe("förslag på symbol för en ruta", () => {
  it("smal ruta mellan kanter på belagd yta: belagd yta", () => {
    expect(suggestFaceRole(box(4, 80, { pavedEdge: 1 }))).toEqual({ role: "paved", rule: "pavedNarrow" });
    // En infart 3 × 8 m, och en remsa längs en belagd yta som redan finns.
    expect(suggestFaceRole(box(3, 8, { pavedEdge: 0.7, barrier: 0.3 })).role).toBe("paved");
    expect(suggestFaceRole(box(3, 40, { pavedEdge: 0.3, paved: 0.4, other: 0.3 })).role).toBe("paved");
    // Medelbredden är 2 × yta / omkrets, för en lång remsa nästan dess bredd: 5,5 × 300 m ger 5,4 m (smal), 7 × 300 m ger 6,8 m.
    expect(2 * 5.5 * 300 / (2 * 305.5)).toBeLessThan(PAVED_MAX_MEAN_WIDTH_M);
    expect(suggestFaceRole(box(5.5, 300, { pavedEdge: 1 })).role).toBe("paved");
    expect(suggestFaceRole(box(7, 300, { pavedEdge: 1 }))).toEqual({ rule: "none" });
  });

  it("inget förslag: en bred ruta, för lite kant, eller hus i rutan", () => {
    // Ett kvarter 40 × 60 m med kantlinjer runt om är inte smalt.
    expect(suggestFaceRole(box(40, 60, { pavedEdge: 1 }))).toEqual({ rule: "none" });
    expect(suggestFaceRole(box(4, 80, { pavedEdge: PAVED_EDGE_SHARE - 0.05, other: 0.45 }))).toEqual({ rule: "none" });
    expect(suggestFaceRole(box(4, 80, { pavedEdge: 1 }, { buildingsInside: 1 }))).toEqual({ rule: "none" });
    expect(suggestFaceRole(box(4, 80, { other: 1 }))).toEqual({ rule: "none" });
  });

  it("inhägnad ruta med hus: tomtmark; utan staket, utan hus eller för stor: inget förslag", () => {
    const plot = { areaM2: 800, perimeterM: 160, closures: 0, buildingsInside: 1 };
    // 40 m husvägg (hålet) och 120 m tomtgräns: 60 m staket, 40 m infart och gata, 20 m annat.
    expect(suggestFaceRole({ ...plot, boundaryM: { building: 40, barrier: 60, pavedEdge: 40, other: 20 } })).toEqual({ role: "forbidden", rule: "plot" });
    // Huset i rutans kant (ett radhus mot gatan) räknas också.
    expect(suggestFaceRole({ ...plot, buildingsInside: 0, boundaryM: { building: 40, barrier: 60, pavedEdge: 40 } }).role).toBe("forbidden");
    // En gård som bara kantas av gator: för lite staket, mur och häck.
    expect(suggestFaceRole({ ...plot, boundaryM: { building: 40, barrier: 120 * PLOT_BARRIER_SHARE - 1, pavedEdge: 90 } })).toEqual({ rule: "none" });
    expect(suggestFaceRole({ ...plot, buildingsInside: 0, boundaryM: { barrier: 160 } })).toEqual({ rule: "none" });
    expect(suggestFaceRole({ ...plot, areaM2: PLOT_MAX_AREA_M2 + 1, boundaryM: { building: 40, barrier: 120 } })).toEqual({ rule: "none" });
    // För lite känd gräns över huvud taget.
    expect(suggestFaceRole({ ...plot, boundaryM: { building: 40, barrier: 40, other: 80 } })).toEqual({ rule: "none" });
  });

  it("rutan är en byggnad (gränsen är byggnadens kontur): inget förslag", () => {
    expect(suggestFaceRole(box(10, 12, { building: 1 }))).toEqual({ rule: "building" });
    expect(suggestFaceRole(box(3, 12, { building: 0.95, pavedEdge: 0.05 }))).toEqual({ rule: "building" });
  });

  it("osäkra rutor får aldrig förslag: större än 0,5 ha eller slutna genom glappslutning", () => {
    expect(suggestFaceRole(box(4, 80, { pavedEdge: 1 }, { closures: 1 }))).toEqual({ uncertain: "gaps", rule: "gaps" });
    expect(suggestFaceRole(box(5, 1100, { pavedEdge: 1 }))).toEqual({ uncertain: "large", rule: "large" });
    expect(5 * 1100).toBeGreaterThan(FACE_UNCERTAIN_AREA_M2);
    expect(suggestFaceRole({ areaM2: 800, perimeterM: 160, closures: 2, buildingsInside: 1, boundaryM: { building: 40, barrier: 120 } }).role).toBeUndefined();
  });

  it("en urartad ruta ger inget förslag", () => {
    expect(suggestFaceRole({ areaM2: 0, perimeterM: 0, closures: 0, buildingsInside: 0, boundaryM: {} })).toEqual({ rule: "none" });
  });
});

describe("objektens roller i en rutas gräns", () => {
  it("ISSprOM 2019-2: numren i O-Tids mall och i en OCAD-uppsättning", () => {
    const role = (code: string, kind: "line" | "area") => faceBoundaryRole(code, kind, "ISSPROM");
    expect([role("501.1", "line"), role("501.100", "line"), role("501", "area"), role("501.0", "area")]).toEqual(["pavedEdge", "pavedEdge", "paved", "paved"]);
    expect([role("513", "line"), role("515.0", "line"), role("516", "line"), role("518", "line"), role("411.1", "line"), role("408.2", "line")])
      .toEqual(["barrier", "barrier", "barrier", "barrier", "barrier", "barrier"]);
    expect([role("521", "area"), role("521.2", "line"), role("520", "area"), role("522", "area"), role("411", "area"), role("532", "line"), role("101", "line")])
      .toEqual(["building", "building", "forbidden", "other", "other", "other", "other"]);
  });

  it("den äldre sprintnormen har andra nummer", () => {
    const role = (code: string, kind: "line" | "area") => faceBoundaryRole(code, kind, "ISSOM");
    expect([role("529.1", "line"), role("529.0", "area"), role("526.1", "area"), role("527.1", "area"), role("522.0", "line"), role("524.0", "line"),
      role("519.1", "line"), role("521.1", "line"), role("421.1", "line"), role("516.0", "line"), role("501", "area")])
      .toEqual(["pavedEdge", "paved", "building", "forbidden", "barrier", "barrier", "barrier", "barrier", "barrier", "other", "other"]);
  });
});
