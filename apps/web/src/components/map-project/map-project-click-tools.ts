import type { MapObject, Point } from "@o-tid/map-file";
import { newKey, type EditKind, type ObjectKey, type ObjectRef, type VertexAddress } from "@o-tid/map-revision";
import type { mapProjectKeysSv } from "../../i18n/map-project-keys-sv";
import type { Texts } from "../../lib/language";
import { cutLineAt } from "../../lib/map-project-join";
import { editPointAt } from "../../lib/map-project-point-edit";
import type { MapProjectSession } from "../../lib/map-project-protocol";
import type { ObjectChange } from "./use-map-project-editor";

interface Target { readonly key: ObjectKey; readonly ref: ObjectRef | null; readonly object: MapObject }

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
}): boolean {
  const { tool, point, tolerance, selected, session, hidden, commit, save, text, setFlash } = input;
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
