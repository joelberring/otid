import { describe, expect, it } from "vitest";
import { applyEdit, checkDocument, layoutCoursePage, layoutOverprint } from "@o-tid/course-setting";
import { checkRows, legInput } from "./course-setting-text";
import { withRouteBarriers } from "./route-choice-view";
import { applySteps, cancelTool, createEditor, removeSelected, select, setTool, undo } from "./course-setting-editor";
import { hitTest } from "./course-setting-hit";
import { mapRenderRequest, pageNodes, pageStyles } from "./course-setting-print";
import { clickSpecial, finishDrawing, moveSpecialEdit, nearestHandle, paperToMap, SPECIAL_TOOL_KINDS } from "./course-setting-specials";
import { symbolLookup } from "./course-setting-description-draw";
import { testDocument } from "./course-setting-test-document";

const drawingTool = (kind: Parameters<typeof setTool>[2]) => setTool(createEditor(testDocument(), "k"), "SPECIAL", kind);

describe("specialobjekten i editorn (steg 64)", () => {
  it("ritar ett förbjudet område med ett klick per hörn och avslutar på första punkten", () => {
    let state = drawingTool("out-of-bounds");
    for (const point of [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]) state = clickSpecial(state, point, applyEdit, 1);
    expect(state.drawing).toHaveLength(3);
    expect(state.document.specialObjects).toEqual([]);
    state = clickSpecial(state, { x: 0.3, y: 0.2 }, applyEdit, 1);
    expect(state.drawing).toBeUndefined();
    expect(state.document.specialObjects).toHaveLength(1);
    expect(state.document.specialObjects[0]).toMatchObject({ kind: "out-of-bounds", courses: [] });
    expect(state.selection).toEqual({ kind: "special", special: state.document.specialObjects[0]!.id });
    // Ett steg i historiken och en åtgärd att spara.
    expect(state.log.map(entry => entry.edit.type)).toEqual(["ADD_SPECIAL"]);
    expect(state.log[0]!.created.specialObjects).toEqual([state.document.specialObjects[0]!.id]);
    expect(undo(state).document.specialObjects).toEqual([]);
  });

  it("Enter avslutar en linje, Escape släpper den", () => {
    let state = drawingTool("boundary");
    state = clickSpecial(state, { x: 0, y: 0 }, applyEdit, 1);
    expect(finishDrawing(state, applyEdit).document.specialObjects).toEqual([]);
    state = clickSpecial(state, { x: 5, y: 5 }, applyEdit, 1);
    expect(finishDrawing(state, applyEdit).document.specialObjects[0]!.points).toHaveLength(2);
    expect(cancelTool(state).drawing).toBeUndefined();
  });

  it("text och valfri passage med ett klick; kontrollbeskrivningen är inget kartobjekt (den hör till utskriften)", () => {
    let state = clickSpecial(drawingTool("text"), { x: 1, y: 2 }, applyEdit, 1);
    expect(state.document.specialObjects[0]).toMatchObject({ kind: "text", text: "Text", font: { height: paperToMap(state.document, "k", 4) } });
    state = clickSpecial(setTool(state, "SPECIAL", "optional-crossing-point"), { x: 3, y: 3 }, applyEdit, 1);
    expect(state.document.specialObjects[1]).toMatchObject({ kind: "optional-crossing-point", orientation: 0 });
    expect(SPECIAL_TOOL_KINDS).not.toContain("descriptions");
    // En beskrivning ur en .ppen-fil ritas inte i editorn.
    state = applySteps(state, [{ type: "ADD_SPECIAL", special: { kind: "descriptions", points: [{ x: 30, y: 30 }, { x: 36, y: 30 }], courses: ["k"] } }], applyEdit);
    expect(layoutOverprint(state.document, { course: "k" }).some(figure => figure.kind === "description")).toBe(false);
  });

  it("väljs med ett klick inuti ytan, flyttas hela eller i ett hörn och tas bort", () => {
    let state = createEditor(testDocument(), "k");
    state = applySteps(state, [{ type: "ADD_SPECIAL", special: { kind: "white-out", points: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }] } }], applyEdit);
    const primitives = layoutOverprint(state.document, { course: "k" });
    const target = hitTest(state.document, "k", primitives, { x: 50, y: 50 }, 0.5);
    expect(target).toEqual({ kind: "special", special: "1" });
    // En kontroll går före ytan.
    expect(hitTest(state.document, "k", primitives, { x: 10, y: 0 }, 0.5)?.kind).toBe("control");
    state = select(state, target);
    const special = state.document.specialObjects[0]!;
    expect(nearestHandle(special, { x: 60.2, y: 59.9 }, 0.5)).toBe(2);
    expect(moveSpecialEdit(special, { index: 2, at: { x: 70, y: 70 } })).toEqual({ type: "MOVE_SPECIAL", special: "1",
      points: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 70, y: 70 }, { x: 40, y: 60 }] });
    expect(moveSpecialEdit(special, { dx: 1, dy: -1 })).toMatchObject({ points: [{ x: 41, y: 39 }, { x: 61, y: 39 }, { x: 61, y: 59 }, { x: 41, y: 59 }] });
    expect(removeSelected(state, applyEdit).document.specialObjects).toEqual([]);
  });
});

describe("spärrarna till vägvalen och varningen (steg 64)", () => {
  it("vald sträcka får banans förbjudna områden och ny nyckel när de ändras; varningen i klartext", () => {
    const base = testDocument();
    const before = legInput(base, "a", "b", ["c1", "c2", "c3", "c4"], "k")!;
    expect(before.barriers).toBeUndefined();
    const added = applyEdit(base, { type: "ADD_SPECIAL", special: { kind: "out-of-bounds", points: [{ x: 13, y: 3 }, { x: 17, y: 3 }, { x: 15, y: 8 }] } });
    const after = legInput(added.document, "a", "b", ["c1", "c2", "c3", "c4"], "k")!;
    expect(after.barriers?.areas).toHaveLength(1);
    expect(after.key).not.toBe(before.key);
    const moved = applyEdit(added.document, { type: "MOVE_SPECIAL", special: added.created!, points: [{ x: 13, y: 4 }, { x: 17, y: 4 }, { x: 15, y: 8 }] });
    expect(legInput(moved.document, "a", "b", ["c1", "c2", "c3", "c4"], "k")!.key).not.toBe(after.key);
    const rows = checkRows(added.document, checkDocument(added.document)).filter(row => row.key.startsWith("LEG_THROUGH_FORBIDDEN"));
    expect(rows.map(row => row.text)).toEqual(["Lång: sträckan kontroll 31–kontroll 32 går genom ett förbjudet område."]);
    const planned = withRouteBarriers([{ key: "S-31.1", input: { key: "S-31.1", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } } }, { key: "31.1-F" }],
      after.barriers);
    expect(planned[0]!.input!.barriers?.areas).toHaveLength(1);
    expect(planned[1]!.input).toBeUndefined();
    expect(withRouteBarriers(planned, { areas: [] })[0]).toBe(planned[0]);
  });
});

describe("utskriftssidan som SVG (steg 64)", () => {
  it("ringar, linjer, ytor och text i papperets mm; kartbilden i rätt upplösning", () => {
    const document = applyEdit(testDocument(), { type: "ADD_SPECIAL", special: { kind: "white-out", points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] } }).document;
    const page = layoutCoursePage(document, { course: "k", printArea: { automatic: false, restrictToPageSize: false, rect: { minX: -10, minY: -10, maxX: 30, maxY: 20 },
      page: { width: 827, height: 1169, margins: 0, landscape: false } } })[0]!;
    const nodes = pageNodes(page, symbolLookup([]));
    expect(nodes[0]).toMatchObject({ tag: "path", fill: "#fff", role: "SPECIAL" });
    const ring = nodes.find(node => node.tag === "path" && node.role === "CONTROL")!;
    expect(ring.tag === "path" && ring.d).toMatch(/^M[\d.]+ [\d.]+ A/);
    const number = nodes.find(node => node.tag === "text")!;
    expect(number.tag === "text" && number.text).toBe("1");
    const request = mapRenderRequest(page);
    expect(request.width).toBe(Math.round(40 * 300 / 25.4));
    expect(request.pxPerMm).toBeCloseTo(300 / 25.4, 9);
    expect(request.origin).toEqual({ x: -10, y: 20 });
    expect(pageStyles([page, page])).toBe("@page otid-210x297 { size: 210.058mm 296.926mm; margin: 0; }");
  });
});
