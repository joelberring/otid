import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import {
  acknowledge, addEdit, areaPolygonProblem, editPoints, editProblem, editRoute, effectiveState, emptyClientState, keepOpenProposals, newKey,
  pointInPolygon, type EditRole, type MapProjectMode, type ObjectState, type RevisionClientState, type WorkArea
} from "../src";

/** K1: arbetssätten, delområdena och förslagen (ADR-0219 tillägget om arbetssätt). */
const square = (x0: number, y0: number, size: number) => [[{ x: x0, y: y0 }, { x: x0 + size, y: y0 }, { x: x0 + size, y: y0 + size },
  { x: x0, y: y0 + size }]];
const point = (x: number, y: number): ObjectState => ({ kind: "OBJECT", object: { kind: "point", symbol: "7", at: { x, y }, angle: 0 } });
const line = (...points: [number, number][]): ObjectState => ({ kind: "OBJECT", object: { kind: "line", symbol: "5",
  path: points.map(([x, y], index) => ({ type: index === 0 ? "M" : "L", x, y })) } as MapObject });
const ME = "me", OTHER = "other";
// Mitt område 0–100, den andras 200–300, ett inte utdelat 400–500.
const AREAS: WorkArea[] = [{ polygon: square(0, 0, 100), assigneeId: ME }, { polygon: square(200, 0, 100), assigneeId: OTHER },
  { polygon: square(400, 0, 100), assigneeId: null }];
const route = (role: EditRole, mode: MapProjectMode, state: ObjectState, current?: ObjectState, at?: { x: number; y: number }) =>
  editRoute({ role, mode, accountId: ME, areas: AREAS, points: editPoints(state, current, at) });

describe("delområden", () => {
  it("punkt i polygon med hål", () => {
    const withHole = [square(0, 0, 100)[0]!, square(25, 25, 50)[0]!];
    expect(pointInPolygon({ x: 10, y: 10 }, withHole)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 50 }, withHole)).toBe(false);
    expect(pointInPolygon({ x: 150, y: 50 }, withHole)).toBe(false);
  });

  it("prövar polygonens form", () => {
    expect(areaPolygonProblem(square(0, 0, 10))).toBeUndefined();
    expect(areaPolygonProblem([])).toBe("rings");
    expect(areaPolygonProblem([[{ x: 0, y: 0 }, { x: 1, y: 1 }]])).toBe("ring");
    expect(areaPolygonProblem([[{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: Number.NaN, y: 0 }]])).toBe("point");
    expect(areaPolygonProblem(Array.from({ length: 21 }, () => square(0, 0, 1)[0]))).toBe("rings");
    expect(areaPolygonProblem([Array.from({ length: 2001 }, (_, x) => ({ x, y: 0 }))])).toBe("ring");
  });
});

describe("direkt eller förslag (editRoute)", () => {
  it("ägaren alltid direkt, Föreslå aldrig", () => {
    for (const mode of ["SHARED", "LEAD"] as const) {
      expect(route("OWNER", mode, point(250, 50))).toBe("APPLY");
      expect(route("SUGGEST", mode, point(50, 50))).toBe("PROPOSE");
    }
  });

  it("Gemensamt: Ändra direkt utom i någon annans område", () => {
    expect(route("EDIT", "SHARED", point(50, 50))).toBe("APPLY");
    expect(route("EDIT", "SHARED", point(150, 50))).toBe("APPLY");
    expect(route("EDIT", "SHARED", point(450, 50))).toBe("APPLY");
    expect(route("EDIT", "SHARED", point(250, 50))).toBe("PROPOSE");
    // En brytpunkt i den andras område räcker.
    expect(route("EDIT", "SHARED", line([50, 50], [150, 50], [210, 10]))).toBe("PROPOSE");
    // Att flytta ut ett objekt ur den andras område är också ett förslag.
    expect(route("EDIT", "SHARED", point(150, 50), point(250, 50))).toBe("PROPOSE");
  });

  it("Huvudkartritare: Ändra direkt bara i eget område", () => {
    expect(route("EDIT", "LEAD", point(50, 50))).toBe("APPLY");
    expect(route("EDIT", "LEAD", line([50, 50], [150, 50]))).toBe("APPLY");
    expect(route("EDIT", "LEAD", point(150, 50))).toBe("PROPOSE");
    expect(route("EDIT", "LEAD", point(450, 50))).toBe("PROPOSE");
    expect(route("EDIT", "LEAD", line([50, 50], [250, 50]))).toBe("PROPOSE");
  });

  it("borttagning: serverns läge, annars ändringens punkt, annars utanför alla områden", () => {
    const deleted: ObjectState = { kind: "DELETED" };
    expect(route("EDIT", "SHARED", deleted, point(250, 50))).toBe("PROPOSE");
    expect(route("EDIT", "SHARED", deleted, undefined, { x: 250, y: 50 })).toBe("PROPOSE");
    expect(route("EDIT", "SHARED", deleted)).toBe("APPLY");
    expect(route("EDIT", "LEAD", deleted, undefined, { x: 50, y: 50 })).toBe("APPLY");
    expect(route("EDIT", "LEAD", deleted)).toBe("PROPOSE");
  });

  it("ändringens punkt prövas i editProblem", () => {
    const base = { editId: "00000000-0000-4000-8000-000000000001", key: newKey("00000000-0000-4000-8000-000000000002"), ref: null, base: null,
      state: point(1, 1), kind: "ADD", at: "2026-11-07T10:00:00Z" };
    expect(editProblem({ ...base, point: { x: 1, y: 2 } })).toBeUndefined();
    expect(editProblem({ ...base, point: { x: 1 } })).toBe("point");
    expect(editProblem({ ...base, point: { x: 1, y: 2, z: 3 } })).toBe("point");
  });
});

describe("klienten och förslagen", () => {
  it("PROPOSED tas ur kön, ligger i proposed och räknas inte som gällande; avgjorda förslag tas bort", () => {
    const key = newKey("00000000-0000-4000-8000-0000000000aa");
    const added = addEdit(emptyClientState(), { editId: "00000000-0000-4000-8000-0000000000ab", key, ref: null, state: point(250, 50), kind: "ADD",
      at: "2026-11-07T10:00:00Z" })!;
    const outcome = acknowledge(added.state, [{ editId: added.edit.editId, status: "PROPOSED", proposalId: "p1" }]);
    expect(outcome.proposed).toEqual([key]);
    expect(outcome.state.pending).toEqual([]);
    expect(outcome.state.proposed).toEqual({ [key]: { proposalId: "p1", state: point(250, 50), ref: null } });
    expect(effectiveState(outcome.state, key)).toEqual({ kind: "DELETED" });
    expect(keepOpenProposals(outcome.state, ["p1"])).toBe(outcome.state);
    expect(keepOpenProposals(outcome.state, []).proposed).toEqual({});
  });

  it("ett lagrat läge från före K1 (utan proposed) går att använda", () => {
    const old = { seq: 0, server: {}, pending: [], conflicts: {} } as RevisionClientState;
    expect(keepOpenProposals(old, []).proposed).toEqual({});
    expect(acknowledge(old, []).state.proposed).toEqual({});
  });
});
