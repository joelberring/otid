import type { MapObject } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { editPointAt } from "./map-project-point-edit";

const line: MapObject = { kind: "line", symbol: "s", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 20, y: 0 }] };
const count = (object: MapObject | undefined) => object?.kind === "line" ? object.path.length : 0;

describe("klick som ändrar punkter", () => {
  it("Ta bort punkt tar bort brytpunkten under pekaren, och gör inget på en sträcka", () => {
    expect(count(editPointAt(line, { x: 10, y: 0.1 }, 0.5, "REMOVE")?.object)).toBe(2);
    expect(editPointAt(line, { x: 5, y: 0 }, 0.5, "REMOVE")).toBeUndefined();
  });

  it("Lägg till punkt lägger en punkt på sträckan, även nära en befintlig punkt", () => {
    const added = editPointAt(line, { x: 5, y: 0.1 }, 0.5, "ADD");
    expect(count(added?.object)).toBe(4);
    expect(added?.address).toEqual({ part: 0, index: 1 });
    expect(editPointAt(line, { x: 5, y: 3 }, 0.5, "ADD")).toBeUndefined();
  });

  it("Cmd/Ctrl+klick tar bort på en punkt och lägger till på en sträcka", () => {
    expect(count(editPointAt(line, { x: 10, y: 0 }, 0.5, "EITHER")?.object)).toBe(2);
    expect(count(editPointAt(line, { x: 15, y: 0 }, 0.5, "EITHER")?.object)).toBe(4);
  });

  it("punktsymboler och text har inga punkter att ändra", () => {
    expect(editPointAt({ kind: "point", symbol: "s", at: { x: 0, y: 0 }, angle: 0 }, { x: 0, y: 0 }, 0.5, "EITHER")).toBeUndefined();
  });
});
