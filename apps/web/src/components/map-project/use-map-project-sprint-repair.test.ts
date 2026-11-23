import { describe, expect, it } from "vitest";
import type { MapObject } from "@o-tid/map-file";
import { newKey, pathsInRoadsPlan, waterInBuiltPlan } from "@o-tid/map-revision";
import { cleanChanges } from "./use-map-project-sprint-repair";

const line = (symbol: string, ...points: [number, number][]): MapObject => ({ kind: "line", symbol, path: points.map(([x, y], i) => ({ type: i === 0 ? "M" as const : "L" as const, x, y })) });
const rect = (symbol: string, x: number, y: number, w: number, h: number): MapObject => ({ kind: "area", symbol, angle: 0,
  rings: [[{ type: "M", x, y }, { type: "L", x: x + w, y }, { type: "L", x: x + w, y: y + h }, { type: "L", x, y: y + h }]] });
const row = (id: string, object: MapObject) => ({ key: newKey(id), ref: null, object });

describe("Rätta efter sprintnormen, stegen 5–7", () => {
  it("kärr i bebyggt tas bort och ett dike klipps, som ett steg att ångra", () => {
    const marsh = row("karr", rect("s308", 6, 0, 3, 3)), ditch = row("dike", line("s306", [0, 10], [0, 40])), house = row("hus", rect("s521", 0, 0, 5, 5));
    const coded = (rows: readonly typeof marsh[], code: (symbol: string) => string) => rows.map(r => ({ key: r.key, code: code(r.object.symbol), object: r.object }));
    const code = (symbol: string) => symbol.slice(1);
    const plan = waterInBuiltPlan(coded([marsh, ditch], code), coded([house], code), 4000);
    const changes = cleanChanges(plan, [marsh, ditch]);
    expect(changes.map(change => [change.key, change.kind])).toEqual([[marsh.key, "DELETE"], [ditch.key, "RESHAPE"]]);
    expect(changes[1]!.after.kind).toBe("OBJECT");
  });

  it("en stig som korsar en hårdgjord yta blir två bitar: den ena ersätter stigen, den andra läggs till", () => {
    const path = row("stig", line("s505", [0, 10], [60, 10])), paved = row("yta", rect("s501", 20, -10, 20, 40));
    const coded = (r: typeof path) => ({ key: r.key, code: r.object.symbol.slice(1), object: r.object });
    const changes = cleanChanges(pathsInRoadsPlan([coded(path)], [coded(paved)], 4000), [path]);
    expect(changes.map(change => change.kind)).toEqual(["RESHAPE", "ADD"]);
    expect(changes[0]!.key).toBe(path.key);
  });
});
