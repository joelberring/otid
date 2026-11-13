import type { MapObject } from "@o-tid/map-file";
import { describe, expect, it } from "vitest";
import { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import type { EndMark } from "../../lib/map-project-cut-marks";
import type { MapProjectSession } from "../../lib/map-project-protocol";
import { clickTool } from "./map-project-click-tools";
import type { ObjectChange } from "./use-map-project-editor";

const road: MapObject = { kind: "line", symbol: "s", path: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 }] };
const KEY = "base:road" as never;

/** Saxen med en fejkad session som träffar `road` vid klicket. */
function cut(point: { x: number; y: number }, hits = true, accept = true) {
  const changes: ObjectChange[] = [];
  const flashes: string[] = [];
  const cuts: { parts: { key: string; object: MapObject }[]; marks: EndMark[] }[] = [];
  const session = { hit: (_p: unknown, _t: unknown, _h: unknown, done: (rows: unknown[]) => void) => done(hits ? [{ key: KEY, ref: null, object: road }] : []) } as unknown as MapProjectSession;
  const handled = clickTool({ tool: "cut", command: false, point, tolerance: 0.5, selected: undefined, session, hidden: [],
    commit: change => { changes.push(change); return accept; }, save: () => true, text: mapProjectKeysSv, setFlash: message => flashes.push(message),
    onEdited: () => undefined, onCut: (parts, marks) => cuts.push({ parts, marks }) });
  return { handled, changes, flashes, cuts };
}

describe("saxen i ritläget", () => {
  it("klipper linjen i två steg som hör ihop, och markerar båda delarna och de nya ändarna", () => {
    const { handled, changes, flashes, cuts } = cut({ x: 10, y: 0 });
    expect(handled).toBe(true);
    expect(changes.map(change => change.kind)).toEqual(["RESHAPE", "ADD"]);
    expect(changes[0]!.group).toBe(changes[1]!.group);
    expect(flashes).toEqual(["Linjen är klippt i två delar."]);
    expect(cuts).toHaveLength(1);
    const { parts, marks } = cuts[0]!;
    expect(parts.map(part => part.key)).toEqual([KEY, changes[1]!.key]);
    expect(parts.map(part => part.object.kind === "line" ? part.object.path.length : 0)).toEqual([2, 2]);
    expect(marks).toEqual([{ at: { x: 10, y: 0 }, toward: { x: 0, y: 0 } }, { at: { x: 10, y: 0 }, toward: { x: 10, y: 10 } }]);
  });

  it("klipp utanför linjen eller i en ändpunkt markerar ingenting och säger det", () => {
    const miss = cut({ x: 50, y: 50 });
    expect(miss.cuts).toEqual([]);
    expect(miss.changes).toEqual([]);
    expect(miss.flashes).toEqual([mapProjectKeysSv.noLineHere]);
    expect(cut({ x: 0, y: 0 }).cuts).toEqual([]);
    expect(cut({ x: 5, y: 0 }, false).flashes).toEqual([mapProjectKeysSv.noLineHere]);
  });

  it("om ändringen inte tas emot markeras ingenting", () => {
    const refused = cut({ x: 10, y: 0 }, true, false);
    expect(refused.cuts).toEqual([]);
    expect(refused.flashes).toEqual([mapProjectKeysSv.noLineHere]);
  });
});
