import { describe, expect, it } from "vitest";
import { layoutForkingDiagram } from "./forking-diagram";

describe("banbilden för gafflingar (steg 49)", () => {
  const items = [{ kind: "CONTROL" as const, code: 31 }, { kind: "LOOP" as const, center: 50, loops: [[41, 42], [43]] },
    { kind: "FORK" as const, branches: [[61], [62, 63]] }, { kind: "CONTROL" as const, code: 33 }];

  it("ritar start, kontroller, fjärilens kronblad, gaffelns grenar och mål med bokstäverna", () => {
    const layout = layoutForkingDiagram(items, { letters: [null, ["A", "B"], ["C", "D"], null] });
    expect(layout.nodes.filter(node => node.kind !== "SPLIT").map(node => node.label)).toEqual(["Start", "31", "50", "41", "42", "43", "61", "62", "63", "33", "Mål"]);
    // En gaffling direkt efter fjärilen delar sig från en synlig punkt.
    expect(layout.nodes.filter(node => node.kind === "SPLIT")).toHaveLength(1);
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

  // Steg 49: etiketterna får aldrig täcka varandra, kontroller eller sträckor.
  const boxes = (layout: ReturnType<typeof layoutForkingDiagram>) =>
    layout.labels.map(label => ({ key: label.key, x: label.x - label.width / 2, y: label.y - label.height / 2, w: label.width, h: label.height }));
  const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  /** Punkter längs ritade sträckor ur SVG-vägarna (M/L/C), för att se att ingen etikett ligger på en linje. */
  function pathPoints(d: string): { x: number; y: number }[] {
    const numbers = [...d.matchAll(/[MLC]([^MLC]+)/g)].map(match => ({ op: match[0][0], values: match[1]!.trim().split(/[\s,]+/).map(Number) }));
    const result: { x: number; y: number }[] = [];
    let current = { x: 0, y: 0 };
    for (const { op, values } of numbers) {
      if (op === "M") current = { x: values[0]!, y: values[1]! };
      if (op === "L") {
        const next = { x: values[0]!, y: values[1]! };
        for (let t = 0; t <= 1; t += 0.02) result.push({ x: current.x + (next.x - current.x) * t, y: current.y + (next.y - current.y) * t });
        current = next;
      }
      if (op === "C") {
        const [x1, y1, x2, y2, x3, y3] = values as [number, number, number, number, number, number];
        for (let t = 0; t <= 1; t += 0.02) {
          const u = 1 - t;
          result.push({ x: u ** 3 * current.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3,
            y: u ** 3 * current.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3 });
        }
        current = { x: x3, y: y3 };
      }
    }
    return result;
  }
  function expectClear(layout: ReturnType<typeof layoutForkingDiagram>) {
    const labels = boxes(layout);
    for (const [index, label] of labels.entries()) {
      for (const other of labels.slice(index + 1)) expect(hit(label, other), `${label.key} täcker ${other.key}`).toBe(false);
      for (const node of layout.nodes) {
        const box = { x: node.x - layout.radius, y: node.y - layout.radius, w: 2 * layout.radius, h: 2 * layout.radius };
        expect(hit(label, box), `${label.key} täcker kontroll ${node.label}`).toBe(false);
      }
      for (const edge of layout.edges) for (const point of pathPoints(edge.d)) {
        expect(point.x > label.x && point.x < label.x + label.w && point.y > label.y && point.y < label.y + label.h,
          `${label.key} ligger på sträckan ${edge.key}`).toBe(false);
      }
      expect(label.x >= 0 && label.y >= 0 && label.x + label.w <= layout.width && label.y + label.h <= layout.height).toBe(true);
    }
  }
  /** Varje bokstav sitter intill sin grens första kontroll (högst 40 px från kontrollens mitt till etikettens ruta). */
  function expectNearFirst(layout: ReturnType<typeof layoutForkingDiagram>) {
    for (const label of layout.labels.filter(row => row.kind === "LETTER")) {
      const target = label.target;
      const node = layout.nodes.find(row => row.first && row.target?.kind === "BRANCH" && target?.kind === "BRANCH" &&
        row.target.item === target.item && row.target.branch === target.branch)!;
      const dx = Math.max(0, Math.abs(node.x - label.x) - label.width / 2), dy = Math.max(0, Math.abs(node.y - label.y) - label.height / 2);
      expect(Math.hypot(dx, dy), `${label.text} långt från ${node.label}`).toBeLessThanOrEqual(40);
    }
  }
  const count = () => ({ text: "12/10", description: "12 anmälda, 10 avlästa" });

  it("etiketterna täcker inget: två fjärilar i följd och gafflingar med tre och fyra alternativ", () => {
    const structures = [
      [{ kind: "CONTROL" as const, code: 31 }, { kind: "LOOP" as const, center: 50, loops: [[41, 42], [43]] },
        { kind: "LOOP" as const, center: 60, loops: [[61], [62, 63], [64]] }, { kind: "CONTROL" as const, code: 33 }],
      [{ kind: "CONTROL" as const, code: 31 }, { kind: "FORK" as const, branches: [[41], [42, 43], [44]] },
        { kind: "CONTROL" as const, code: 32 }, { kind: "FORK" as const, branches: [[51], [52], [53, 54], [55]] }, { kind: "CONTROL" as const, code: 33 }],
      [{ kind: "CONTROL" as const, code: 31 }, { kind: "LOOP" as const, center: 50, loops: [[41, 42], [43, 44], [45], [46, 47, 48]] },
        { kind: "LOOP" as const, center: 60, loops: [[61], [62]] }, { kind: "FORK" as const, branches: [[71], [72], [73, 74], [75]] },
        { kind: "CONTROL" as const, code: 33 }]
    ];
    for (const items of structures) {
      const letters = (() => { let next = 0; return items.map(item => item.kind === "CONTROL" ? null
        : (item.kind === "FORK" ? item.branches : item.loops).map(() => "ABCDEFGHIJKLMNOP"[next++]!)); })();
      const full = layoutForkingDiagram(items, { letters, count });
      expectClear(full);
      expectNearFirst(full);
      expect(full.labels.filter(label => label.kind === "LETTER").every(label => label.detail === "12/10")).toBe(true);
      expectClear(layoutForkingDiagram(items, { letters, compact: true, choices: items.map(item => item.kind === "LOOP"
        ? item.loops.map((_loop, index) => item.loops.length - 1 - index) : item.kind === "FORK" ? 1 : null) }));
    }
  });
});
