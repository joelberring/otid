import type { MapObject } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { cutMarks, lineEnds } from "./map-project-cut-marks";
import { cutLineAt } from "./map-project-join";

const line = (path: Extract<MapObject, { kind: "line" }>["path"]): MapObject => ({ kind: "line", symbol: "s", path });
const road = line([{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 }]);

describe("ändpunkter på en linje", () => {
  it("en öppen linje har två, med riktning in i linjen", () => {
    expect(lineEnds(road)).toEqual([{ at: { x: 0, y: 0 }, toward: { x: 10, y: 0 } }, { at: { x: 10, y: 10 }, toward: { x: 10, y: 0 } }]);
  });

  it("en sluten linje och allt som inte är en linje har inga", () => {
    expect(lineEnds(line([{ type: "M", x: 0, y: 0 }, { type: "L", x: 4, y: 0 }, { type: "L", x: 4, y: 4 }, { type: "L", x: 0, y: 0 }]))).toEqual([]);
    expect(lineEnds({ kind: "point", symbol: "p", at: { x: 1, y: 1 }, angle: 0 } as MapObject)).toEqual([]);
  });

  it("varje del får sina ändar", () => {
    const two = line([{ type: "M", x: 0, y: 0 }, { type: "L", x: 1, y: 0 }, { type: "M", x: 5, y: 5 }, { type: "L", x: 6, y: 5 }]);
    expect(lineEnds(two).map(mark => mark.at)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: 5 }, { x: 6, y: 5 }]);
  });

  it("en kurva riktas efter sin styrpunkt, och en styrpunkt i själva ändpunkten hoppas över", () => {
    const curve = line([{ type: "M", x: 0, y: 0 }, { type: "C", x1: 0, y1: 0, x2: 3, y2: 4, x: 6, y: 0 }]);
    expect(lineEnds(curve)).toEqual([{ at: { x: 0, y: 0 }, toward: { x: 3, y: 4 } }, { at: { x: 6, y: 0 }, toward: { x: 3, y: 4 } }]);
  });
});

describe("nya ändar efter ett klipp", () => {
  it("båda delarna får en ände i klippet, var och en riktad in i sin del", () => {
    const parts = cutLineAt(road, { x: 10, y: 0 }, 0.5);
    expect(parts).toBeDefined();
    const marks = cutMarks(parts!);
    expect(marks).toEqual([{ at: { x: 10, y: 0 }, toward: { x: 0, y: 0 } }, { at: { x: 10, y: 0 }, toward: { x: 10, y: 10 } }]);
  });

  it("ett klipp mitt på en sträcka lägger klippet där man klickade", () => {
    const parts = cutLineAt(road, { x: 4, y: 0.1 }, 0.5)!;
    const marks = cutMarks(parts);
    expect(marks).toHaveLength(2);
    expect(marks[0]!.at).toEqual(marks[1]!.at);
    expect(marks[0]!.at.x).toBeCloseTo(4, 5);
    expect(marks[0]!.toward).toEqual({ x: 0, y: 0 });
    expect(marks[1]!.toward).toEqual({ x: 10, y: 0 });
  });

  it("delar som inte är linjer ger inga ändar", () => {
    const point = { kind: "point", symbol: "p", at: { x: 0, y: 0 }, angle: 0 } as MapObject;
    expect(cutMarks([point, road])).toEqual([]);
  });
});
