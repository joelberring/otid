import type { MapObject, PathCommand } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { joinLines, reversePath } from "./map-project-join";

const line = (symbol: string, ...points: [number, number][]): MapObject =>
  ({ kind: "line", symbol, path: points.map(([x, y], index) => ({ type: index === 0 ? "M" : "L", x, y })) as PathCommand[] });
const xs = (object: MapObject) => object.kind === "line" ? object.path.map(command => command.x) : [];

describe("slå ihop linjer", () => {
  it("två linjer som möts blir en, med den gemensamma punkten en gång", () => {
    const result = joinLines([line("s101", [0, 0], [10, 0]), line("s101", [10, 0], [20, 0])], 0.3);
    expect(result?.used).toEqual([0, 1]);
    expect(xs(result!.object)).toEqual([0, 10, 20]);
  });

  it("vänder linjen som ligger åt fel håll, också när den ansluter i början", () => {
    expect(xs(joinLines([line("s101", [0, 0], [10, 0]), line("s101", [20, 0], [10, 0.1])], 0.3)!.object)).toEqual([0, 10, 20]);
    expect(xs(joinLines([line("s101", [10, 0], [20, 0]), line("s101", [0, 0], [10, 0])], 0.3)!.object)).toEqual([0, 10, 20]);
    expect(xs(joinLines([line("s101", [10, 0], [20, 0]), line("s101", [10, 0], [0, 0])], 0.3)!.object)).toEqual([0, 10, 20]);
  });

  it("precis två markerade linjer binds ihop med en rak sträcka vid de närmaste ändarna", () => {
    const result = joinLines([line("s101", [0, 0], [10, 0]), line("s101", [30, 0], [14, 0])], 0.3);
    expect(xs(result!.object)).toEqual([0, 10, 14, 30]);
  });

  it("flera linjer kedjas bara där ändarna möts, och bara med samma symbol", () => {
    const objects = [line("s101", [0, 0], [10, 0]), line("s102", [10, 0], [20, 0]), line("s101", [20, 0], [10, 0]), line("s101", [50, 0], [60, 0]),
      { kind: "point", symbol: "s109", at: { x: 1, y: 1 }, angle: 0 } as MapObject];
    const result = joinLines(objects, 0.3);
    expect(result?.used).toEqual([0, 2]);
    expect(xs(result!.object)).toEqual([0, 10, 20]);
    expect(joinLines([line("s101", [0, 0], [10, 0]), line("s102", [10, 0], [20, 0])], 0.3)).toBeUndefined();
    expect(joinLines([line("s101", [0, 0], [10, 0]), line("s101", [40, 0], [50, 0]), line("s101", [80, 0], [90, 0])], 0.3)).toBeUndefined();
  });

  it("en kurva vänds med handtagen i omvänd ordning; hörnet följer punkten och luckan sträckan (vänster blir höger)", () => {
    const path: PathCommand[] = [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 0, corner: true }, { type: "L", x: 9, y: 0, gap: 2 }];
    expect(reversePath(path)).toEqual([{ type: "M", x: 9, y: 0 }, { type: "L", x: 5, y: 0, corner: true, gap: 4 }, { type: "C", x1: 3, y1: 4, x2: 1, y2: 2, x: 0, y: 0 }]);
  });
});
