import { describe, expect, it } from "vitest";
import { layoutForkingDiagram } from "./forking-diagram";

describe("banbilden för gafflingar (steg 49)", () => {
  const items = [{ kind: "CONTROL" as const, code: 31 }, { kind: "LOOP" as const, center: 50, loops: [[41, 42], [43]] },
    { kind: "FORK" as const, branches: [[61], [62, 63]] }, { kind: "CONTROL" as const, code: 33 }];

  it("ritar start, kontroller, fjärilens kronblad, gaffelns grenar och mål med bokstäverna", () => {
    const layout = layoutForkingDiagram(items, { letters: [null, ["A", "B"], ["C", "D"], null] });
    expect(layout.nodes.map(node => node.label)).toEqual(["Start", "31", "50", "41", "42", "43", "61", "62", "63", "33", "Mål"]);
    expect(layout.labels.filter(label => label.kind === "LETTER").map(label => label.text)).toEqual(["A", "B", "C", "D"]);
    // Kronbladen ligger ovanför och under linjen; grenarna på var sin sida.
    const y = (label: string) => layout.nodes.find(node => node.label === label)!.y;
    expect(y("41")).toBeLessThan(y("50"));
    expect(y("43")).toBeGreaterThan(y("50"));
    expect(y("61")).toBeLessThan(y("62"));
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.nodes.every(node => node.x >= 0 && node.y >= 0 && node.x <= layout.width && node.y <= layout.height)).toBe(true);
  });

  it("markerar löparens väg och slingornas ordning", () => {
    const layout = layoutForkingDiagram(items, { choices: [null, [1, 0], 1, null] });
    expect(layout.nodes.find(node => node.label === "61")!.active).toBe(false);
    expect(layout.nodes.find(node => node.label === "62")!.active).toBe(true);
    expect(layout.labels.filter(label => label.kind === "ORDER").map(label => label.text)).toEqual(["2", "1"]);
  });

  it("sträckorna mellan grundföljdens kontroller går att välja för att lägga till en gaffling", () => {
    const layout = layoutForkingDiagram(items);
    expect(layout.edges.filter(edge => edge.target?.kind === "LEG").map(edge => edge.target)).toEqual([
      { kind: "LEG", before: 0 }, { kind: "LEG", before: 1 }, { kind: "LEG", before: 4 }]);
    expect(layout.nodes.find(node => node.label === "50")!.target).toEqual({ kind: "CONTROL", item: 1 });
  });
});
