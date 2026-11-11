import type { MapObject, Point } from "@o-tid/map-file";
import { newKey, type EditKind, type ObjectKey, type ObjectRef, type VertexAddress } from "@o-tid/map-revision";
import type { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import type { Texts } from "../../lib/language";
import { translateObject } from "../../lib/map-project-draw";
import { fillOrBorder, parallelLine } from "../../lib/map-project-shape-tools";
import { cutLineAt } from "../../lib/map-project-join";
import { editPointAt } from "../../lib/map-project-point-edit";
import type { MapProjectSession } from "../../lib/map-project-protocol";
import type { ObjectChange } from "./use-map-project-editor";

interface Target { readonly key: ObjectKey; readonly ref: ObjectRef | null; readonly object: MapObject }

/** Rektangeln: `a`–`b` är ena sidan, `c` ger bredden vinkelrätt mot den (räta vinklar i valfri riktning). */
export function rectangleCorners(a: Point, b: Point, c: Point): Point[] | undefined {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return undefined;
  const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length, width = (c.x - a.x) * nx + (c.y - a.y) * ny;
  if (Math.abs(width) < 0.05) return undefined;
  return [a, b, { x: b.x + nx * width, y: b.y + ny * width }, { x: a.x + nx * width, y: a.y + ny * width }];
}

/**
 * Ritlägets klickverktyg (utbrutet ur `map-project-editor.tsx`, ägaren 2026-11-10): saxen, Lägg till punkt, Ta bort punkt och
 * Cmd/Ctrl+klick i Redigera (punkt = ta bort, sträcka = ny punkt). Sant när klicket hörde till ett av verktygen.
 */
export function clickTool(input: {
  tool: string; command: boolean | undefined; point: Point; tolerance: number; selected: Target | undefined; session: MapProjectSession | undefined;
  hidden: readonly string[]; commit: (change: ObjectChange) => boolean;
  save: (key: ObjectKey, ref: ObjectRef | null, object: MapObject | undefined, kind: EditKind) => boolean;
  text: Texts<typeof mapProjectKeysSv>; setFlash: (message: string) => void;
  onEdited: (target: Target, address: VertexAddress | undefined) => void;
  /** Rektangelns hörn hittills och den valda symbolen. */
  rectangle?: { readonly corners: Point[]; readonly symbol: { readonly id: string; readonly kind: string } | undefined } | undefined;
}): boolean {
  const { tool, point, tolerance, selected, session, hidden, commit, save, text, setFlash } = input;
  // Rektangeln (ägaren 2026-11-10, jämförelsen med Mapper och OCAD): tre klick, en ändring.
  if (tool === "rectangle" && input.rectangle) {
    const { corners, symbol } = input.rectangle;
    if (!symbol || (symbol.kind !== "line" && symbol.kind !== "area")) { setFlash(text.rectangleNeedsShape); return true; }
    corners.push(point);
    if (corners.length < 3) { setFlash(text.rectangleHint(corners.length)); return true; }
    const shape = rectangleCorners(corners[0]!, corners[1]!, corners[2]!);
    corners.length = 0;
    if (!shape) { setFlash(text.rectangleHint(0)); return true; }
    const path = [...shape, shape[0]!].map((at, index) => ({ type: index === 0 ? "M" as const : "L" as const, x: at.x, y: at.y }));
    const object: MapObject = symbol.kind === "area" ? { kind: "area", symbol: symbol.id, rings: [path], angle: 0 } : { kind: "line", symbol: symbol.id, path };
    commit({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD", after: { kind: "OBJECT", object } });
    setFlash(text.rectangleHint(0));
    return true;
  }
  // Saxen: linjen under pekaren delas i två (den första delen behåller objektet, den andra blir ett nytt), ett steg att ångra.
  if (tool === "cut") {
    session?.hit(point, tolerance, hidden, hits => {
      const group = crypto.randomUUID();
      const done = hits.some(hit => {
        const parts = cutLineAt(hit.object, point, tolerance);
        return !!parts && commit({ key: hit.key, ref: hit.ref, kind: "RESHAPE", after: { kind: "OBJECT", object: parts[0] }, group })
          && commit({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD", after: { kind: "OBJECT", object: parts[1] }, group });
      });
      setFlash(done ? text.wasCut : text.noLineHere);
    });
    return true;
  }
  if (tool !== "addPoint" && tool !== "removePoint" && !(tool === "select" && input.command)) return false;
  const edit = (target: Target): boolean => {
    const result = editPointAt(target.object, point, tolerance, tool === "addPoint" ? "ADD" : tool === "removePoint" ? "REMOVE" : "EITHER");
    if (!result) return false;
    save(target.key, target.ref, result.object, "RESHAPE");
    input.onEdited({ ...target, object: result.object }, result.address);
    return true;
  };
  if (selected && edit(selected)) return true;
  session?.hit(point, tolerance, hidden, hits => {
    if (!hits.some(hit => edit({ key: hit.key, ref: hit.ref, object: hit.object }))) setFlash(tool === "removePoint" ? text.noPointHere : text.noSegmentHere);
  });
  return true;
}

/** Duplicera (ägaren 2026-11-10): kopiorna en halv millimeter snett nedanför, ett steg att ångra. Ger antalet kopior. */
export function duplicateObjects(items: readonly { readonly object: MapObject }[], commit: (change: ObjectChange) => boolean): number {
  const group = crypto.randomUUID();
  return items.filter(item => commit({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD",
    after: { kind: "OBJECT", object: translateObject(item.object, { x: 0.5, y: -0.5 }) }, group })).length;
}

/** Fyll yta eller gör kant (G) och parallell linje (P) för det markerade, ett steg att ångra. Ger beskedet. */
export function shapeCommand(command: "fill" | "parallel", object: MapObject, symbol: { readonly id: string; readonly kind: string } | undefined,
  commit: (change: ObjectChange) => boolean, text: Texts<typeof mapProjectKeysSv>): string {
  const made = command === "parallel" ? [parallelLine(object, 1)].filter((item): item is MapObject => !!item) : symbol ? fillOrBorder(object, symbol) ?? [] : [];
  if (!made.length) return command === "parallel" ? text.needLine : text.notFillable;
  const group = crypto.randomUUID();
  const count = made.filter(item => commit({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD", after: { kind: "OBJECT", object: item }, group })).length;
  return command === "parallel" ? text.paralleled : text.filled(count);
}
