import { describe, expect, it } from "vitest";
import { alignMoves, distributeMoves, snapMove, snapTargets } from "./course-setting-paper-snap";

const sheet = {
  paper: { widthMm: 210, heightMm: 297, landscape: false, marginMm: 7 },
  frames: [{ clip: { x: 7, y: 7, width: 196, height: 283 } }],
  paperItems: [{ id: "a", course: "1", rect: { x: 50, y: 50, width: 20, height: 10 } }, { id: "b", course: "1", rect: { x: 120, y: 100, width: 30, height: 8 } }]
} as never;

describe("fästning på papperet (ADR-0211 beslut 8)", () => {
  it("fäster vänsterkanten mot ramen och visar hjälplinjen", () => {
    const targets = snapTargets(sheet, new Set(["1:a"]));
    const result = snapMove({ x: 50, y: 50, width: 20, height: 10 }, -42, 0, targets);
    expect(result.dx).toBeCloseTo(-43, 6);
    expect(result.guides).toContainEqual({ axis: "x", value: 7, kind: "MARGIN" });
  });

  it("fäster mitten mot ett annat elements mitt", () => {
    const targets = snapTargets(sheet, new Set(["1:a"]));
    // a:s mitt (60, 55) flyttad nära b:s mitt (135, 104).
    const result = snapMove({ x: 50, y: 50, width: 20, height: 10 }, 74.6, 48.6, targets);
    expect(result.dx).toBeCloseTo(75, 6);
    expect(result.dy).toBeCloseTo(49, 6);
    expect(result.guides.map(guide => guide.kind)).toEqual(["ITEM", "ITEM"]);
  });

  it("utan fästlinje nära: rutnätet för övre vänstra hörnet, annars där den släpptes", () => {
    const targets = { x: [], y: [] };
    expect(snapMove({ x: 50, y: 50, width: 20, height: 10 }, 3.3, 2.2, targets, { gridMm: 5 })).toEqual({ dx: 5, dy: 0, guides: [] });
    expect(snapMove({ x: 50, y: 50, width: 20, height: 10 }, 3.3, 2.2, targets)).toEqual({ dx: 3.3, dy: 2.2, guides: [] });
  });

  it("ett element drar inte fast i sig självt", () => {
    const targets = snapTargets(sheet, new Set(["1:a"]));
    expect(targets.x.some(line => line.kind === "ITEM" && line.value === 50)).toBe(false);
    expect(targets.x.some(line => line.kind === "ITEM" && line.value === 120)).toBe(true);
  });
});

describe("justera och fördela", () => {
  const rects = [{ x: 10, y: 10, width: 20, height: 10 }, { x: 50, y: 30, width: 10, height: 10 }, { x: 100, y: 5, width: 30, height: 20 }];
  it("vänster, mitten och nederkant mot de markerades ruta", () => {
    expect(alignMoves(rects, "LEFT").map(move => move.dx)).toEqual([0, -40, -90]);
    expect(alignMoves(rects, "CENTER").map(move => move.dx)).toEqual([50, 15, -45]);
    expect(alignMoves(rects, "BOTTOM").map(move => move.dy)).toEqual([20, 0, 15]);
  });
  it("ett element justeras mot kartramen", () => {
    expect(alignMoves([rects[0]!], "RIGHT", { x: 7, y: 7, width: 196, height: 283 })).toEqual([{ dx: 173, dy: 0 }]);
  });
  it("fördelar mellanrummen lika", () => {
    const moves = distributeMoves(rects, "HORIZONTAL");
    // Totalt 120 mm, 60 mm element, två mellanrum à 30 mm: mitten börjar vid 60.
    expect(moves.map(move => move.dx)).toEqual([0, 10, 0]);
  });
});
