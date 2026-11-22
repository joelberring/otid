import { describe, expect, it } from "vitest";
import { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import { mapProjectQuickSv } from "../../i18n/map-project-quick-sv";
import { DEFAULT_KEYS } from "../../lib/map-project-keys";
import { railTools, WHEEL_SLOTS, wheelDirection, wheelToolsOf, type RailState } from "./map-project-rail-tools";

const noop = () => undefined;
const state = (extra: Partial<RailState> = {}): RailState => ({
  keys: DEFAULT_KEYS, text: mapProjectKeysSv,
  labels: { panel: "Panel", select: "Markera", selectHelp: "", draw: "Rita", drawHelp: "", circle: "Cirkel", area: "Område", note: "Notis", undo: "Ångra", redo: "Gör om" },
  tool: "select", panelOpen: false, bare: false, canEdit: true, canDecide: false, canNote: true, canUndo: false, canRedo: false,
  unfilled: false, toggleUnfilled: noop, pick: noop, undo: noop, redo: noop, togglePanel: noop, toggleBare: noop, openWheel: noop, openKeys: noop, ...extra
});

describe("verktygsspalten (K8b V1)", () => {
  it("har bara verktyg, i grupperna Markera | Rita | Fyll | Forma | Granska, och hjulet, bara kartan och tangenterna längst ned", () => {
    const tools = railTools(state({ canDecide: true }));
    const top = tools.filter(tool => !tool.bottom && !tool.phoneOnly).map(tool => tool.id);
    expect(top).toEqual(["select", "draw", "rectangle", "circle", "text", "bucket", "addPoint", "removePoint", "cut", "note", "area", "unfilled"]);
    expect(tools.filter(tool => tool.group).map(tool => [tool.id, tool.group])).toEqual([["draw", "Rita"], ["bucket", "Fyll"], ["addPoint", "Forma"], ["note", "Granska"]]);
    expect(tools.filter(tool => tool.bottom).map(tool => tool.id)).toEqual(["wheel", "bare", "keys"]);
    // Inga åtgärder på det markerade i spalten.
    for (const id of ["switchSymbol", "join", "duplicate", "fill", "remove", "pick"]) expect(tools.some(tool => tool.id === id)).toBe(false);
  });

  it("visar de nya tangenterna och Ångra och Gör om bara i telefonens rad, fästa", () => {
    const tools = railTools(state());
    const key = (id: string) => tools.find(tool => tool.id === id)?.key;
    expect([key("select"), key("draw"), key("rectangle"), key("circle"), key("bucket"), key("note")]).toEqual(["Q", "W", "E", "⇧E", "F", "⇧T"]);
    expect(tools.filter(tool => tool.pin).map(tool => [tool.id, tool.pin, tool.phoneOnly])).toEqual([["undo", "first", true], ["redo", "second", true]]);
  });

  it("Granska utan notiser börjar med Område, och utan notis och område med Visa ofyllda rutor (⇧§, V5)", () => {
    expect(railTools(state({ canNote: false, canDecide: true })).find(tool => tool.id === "area")?.group).toBe("Granska");
    expect(railTools(state({ canNote: false })).filter(tool => tool.group === "Granska").map(tool => tool.id)).toEqual(["unfilled"]);
    expect(railTools(state({ unfilled: true })).find(tool => tool.id === "unfilled")).toMatchObject({ key: "⇧§", active: true });
    // Den som bara läser får bara bara kartan och tangenterna.
    expect(railTools(state({ canEdit: false })).map(tool => tool.id)).toEqual(["panel", "bare", "keys"]);
  });
});

describe("hjulets fasta platser (K8b V1)", () => {
  const wheel = (extra: Partial<Parameters<typeof wheelToolsOf>[0]> = {}) => wheelToolsOf({ keys: DEFAULT_KEYS, space: "Mellanslag", tool: "select", canNote: true,
    labels: mapProjectQuickSv.tools, repeat: undefined, pick: noop, onRepeat: noop, ...extra });

  it("N Markera, NO Rita, O Rektangel, SO Fyll, S Gör igen, SV Klipp, V Punkt, NV Notis", () => {
    expect(WHEEL_SLOTS).toEqual(["select", "draw", "rectangle", "bucket", "repeat", "cut", "point", "note"]);
    expect(wheel().map(tool => tool?.id)).toEqual(["select", "draw", "rectangle", "bucket", "repeat", "cut", "point", "note"]);
  });

  it("platserna flyttar inte: utan notiser är NV tom, och Gör igen är grå tills det finns något att göra igen", () => {
    const tools = wheel({ canNote: false });
    expect(tools).toHaveLength(8);
    expect(tools[7]).toBeUndefined();
    expect(tools[4]?.disabled).toBe(true);
    const again = wheel({ repeat: "Gör igen: Byt till 505.0" })[4];
    expect([again?.label, again?.disabled, again?.key]).toEqual(["Gör igen: Byt till 505.0", false, "⇧Mellanslag"]);
  });

  it("Punkt väljer Lägg till punkt, och Ta bort punkt när Lägg till redan är valt", () => {
    const picked: string[] = [];
    wheel({ pick: tool => picked.push(tool) })[6]?.onPick();
    wheel({ tool: "addPoint", pick: tool => picked.push(tool) })[6]?.onPick();
    expect(picked).toEqual(["addPoint", "removePoint"]);
    expect(wheel({ tool: "removePoint" })[6]?.active).toBe(true);
  });

  it("snärtens riktning ger platsen (skärmens y nedåt)", () => {
    expect(wheelDirection(0, -30)).toBe(0);
    expect(wheelDirection(30, -30)).toBe(1);
    expect(wheelDirection(30, 0)).toBe(2);
    expect(wheelDirection(30, 30)).toBe(3);
    expect(wheelDirection(0, 30)).toBe(4);
    expect(wheelDirection(-30, 30)).toBe(5);
    expect(wheelDirection(-30, 0)).toBe(6);
    expect(wheelDirection(-30, -30)).toBe(7);
    expect(wheelDirection(-30, -2)).toBe(6);
  });
});
