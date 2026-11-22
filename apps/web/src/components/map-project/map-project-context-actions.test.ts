import { describe, expect, it } from "vitest";
import { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import { DEFAULT_KEYS } from "../../lib/map-project-keys";
import { contextActions, contextPlacement, type ContextInput } from "./map-project-context-actions";
import { stepGap } from "./use-map-project-modes";

const base: ContextInput = { keys: DEFAULT_KEYS, space: "Mellanslag", text: mapProjectKeysSv, quick: mapProjectQuickSv };
const line = { kind: "line" as const, switchTo: undefined, canPick: false, shapes: [], canFill: false, vertex: false };

describe("kontextraden (K8b V1)", () => {
  it("visar bara det som går, med Byt till först och tangenten på varje knapp", () => {
    const actions = contextActions({ ...base, single: { ...line, switchTo: "506.0", canPick: true, shapes: [{ id: "smooth", label: "Gör mjuk" }], canFill: true } });
    expect(actions.map(action => action.id)).toEqual(["switchSymbol", "pick", "duplicate", "parallel", "reverse", "fill", "smooth", "remove"]);
    expect(actions[0]).toMatchObject({ label: "Byt till 506.0", key: "C", testId: "map-project-rail-switch" });
    expect(actions.map(action => action.key)).toEqual(["C", "D", "⇧D", "⇧V", "V", "⇧F", "⇧A", "Del"]);
  });

  it("en punkt: ingen parallell, vänd eller form; samma symbol ger ingen Byt till och ingen pipett", () => {
    expect(contextActions({ ...base, single: { ...line, kind: "point" } }).map(action => action.id)).toEqual(["duplicate", "remove"]);
  });

  it("kollad syns för den som rekar, nedtryckt när objektet är kollat; kant bara med en kantsymbol", () => {
    const actions = contextActions({ ...base, single: { ...line, kind: "area" }, checked: true, edge: { areas: 1, codes: ["508.0"] } });
    expect(actions.map(action => action.id)).toEqual(["duplicate", "checked", "edge", "remove"]);
    expect(actions.find(action => action.id === "checked")).toMatchObject({ pressed: true, key: "R", testId: "recon-check" });
    expect(contextActions({ ...base, single: { ...line, kind: "area" }, edge: { areas: 1, codes: [] } }).some(action => action.id === "edge")).toBe(false);
  });

  it("en text (K8b V6): Redigera text, Byt textsymbol, Vrid, Ändra textsymbol, Duplicera och Ta bort", () => {
    const labels = { edit: "Redigera text", rotate: "Vrid", style: "Ändra textsymbol", switchTo: (code: string) => `Byt textsymbol till ${code}` };
    const actions = contextActions({ ...base, single: { ...line, kind: "text", switchTo: "999.1", text: labels } });
    expect(actions.map(action => action.id)).toEqual(["editText", "switchSymbol", "rotate", "textStyle", "duplicate", "remove"]);
    expect(actions[1]).toMatchObject({ label: "Byt textsymbol till 999.1", key: "C" });
    expect(contextActions({ ...base, single: { ...line, kind: "text", text: labels } }).map(action => action.id))
      .toEqual(["editText", "rotate", "textStyle", "duplicate", "remove"]);
  });

  it("en vald brytpunkt: Ta bort tar bort punkten", () => {
    expect(contextActions({ ...base, single: { ...line, vertex: true } }).at(-1)?.label).toBe("Ta bort punkt");
  });

  it("flera markerade: byt alla, slå ihop, förenkla, duplicera och ta bort", () => {
    const actions = contextActions({ ...base, multi: { count: 3, switchable: 3, symbolCode: "505.0", joinable: true, lines: 0, smooth: 0, simplify: 2 } });
    expect(actions.map(action => action.label)).toEqual(["Byt alla 3 till 505.0", "Slå ihop linjer eller ytor", "Förenkla 2", "Duplicera", "Ta bort 3 objekt"]);
    expect(actions.map(action => action.key)).toEqual(["C", "G", "⇧S", "⇧D", "Del"]);
    const few = contextActions({ ...base, multi: { count: 2, switchable: 0, symbolCode: "505.0", joinable: false, lines: 2, smooth: 0, simplify: 0 } });
    expect(few.map(action => action.id)).toEqual(["duplicate", "reverse", "remove"]);
  });

  it("inget markerat: ingen rad", () => {
    expect(contextActions(base)).toEqual([]);
  });

  it("står ovanför objektets ram, under den när det inte får plats, och inte alls när ramen är utanför", () => {
    const view = { centerX: 50, centerY: 50, pxPerMm: 10, width: 1000, height: 800 } as Parameters<typeof contextPlacement>[1];
    const row = { width: 200, height: 36 };
    // Ramen (40–60 mm i x, 40–60 i y) är på skärmen x 400–600, y 300–500.
    expect(contextPlacement({ minX: 40, minY: 40, maxX: 60, maxY: 60 }, view, row)).toEqual({ x: 400, y: 256 });
    // Nära överkanten: under ramen.
    expect(contextPlacement({ minX: 40, minY: 60, maxX: 60, maxY: 89.9 }, view, row)).toEqual({ x: 400, y: 308 });
    // Vid högerkanten hålls raden inne i rutan.
    expect(contextPlacement({ minX: 98, minY: 40, maxX: 99, maxY: 60 }, view, row)?.x).toBe(796);
    expect(contextPlacement({ minX: 200, minY: 40, maxX: 210, maxY: 60 }, view, row)).toBeUndefined();
  });
});

describe("Glapp", () => {
  it("[ och ] går ett steg i 2/4/8/15 m och stannar vid ändarna", () => {
    expect([stepGap(4, 1), stepGap(4, -1), stepGap(2, -1), stepGap(15, 1), stepGap(5, 1), stepGap(5, -1)]).toEqual([8, 2, 2, 15, 8, 4]);
  });
});
