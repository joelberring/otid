import type { MapFileFormat, MapObject, ParsedMap } from "@o-tid/map-file";
import { objectRefAt, type MapRevisionChange, type MapRevisionChangeSet, type ObjectRef } from "./contract";
import { baseKey, isNewKey, type ObjectKey, type ObjectState } from "./state";

/**
 * ADR-0208: revideringens objekt ovanpå grundfilen. Kartan ritas med samma ritare som annars (`drawMap`) på en lista där
 * ändrade objekt är bytta, borttagna saknas och nya ligger sist. Grundfilen ändras aldrig; skrivaren får samma ändringar som
 * kontraktets `MapRevisionChangeSet`.
 */
export interface KeyedState { readonly ref: ObjectRef | null; readonly state: ObjectState }

/** Nycklarna för grundfilens objekt, i läsarens ordning. */
export function baseKeys(map: ParsedMap): ObjectKey[] {
  return map.objects.map((_object, index) => baseKey(objectRefAt(map, index)));
}

/**
 * Kartans objekt med ändringarna: grundfilens i sin ordning (ändrade bytta, borttagna borta) och de nya sist i nyckelordning.
 * `keys[i]` är nyckeln för `objects[i]` (träffarna på kartan).
 */
export function editedObjects(map: ParsedMap, states: ReadonlyMap<ObjectKey, KeyedState>, keys: readonly ObjectKey[] = baseKeys(map))
  : { objects: MapObject[]; keys: ObjectKey[] } {
  const objects: MapObject[] = [], out: ObjectKey[] = [];
  map.objects.forEach((object, index) => {
    const key = keys[index]!;
    const state = states.get(key)?.state;
    if (state?.kind === "DELETED") return;
    objects.push(state?.kind === "OBJECT" ? state.object : object);
    out.push(key);
  });
  for (const [key, value] of [...states].filter(([key]) => isNewKey(key)).sort(([a], [b]) => a.localeCompare(b))) {
    if (value.state.kind !== "OBJECT") continue;
    objects.push(value.state.object);
    out.push(key);
  }
  return { objects, keys: out };
}

/** En ändring per objekt som inte är som i grundfilen, i nyckelordning (samma lägen ger alltid samma lista). */
export function changeList(states: Iterable<readonly [ObjectKey, KeyedState]>): MapRevisionChange[] {
  const changes: { key: string; change: MapRevisionChange }[] = [];
  for (const [key, { ref, state }] of states) {
    if (isNewKey(key)) {
      if (state.kind === "OBJECT") changes.push({ key, change: { kind: "ADD", object: state.object } });
      continue;
    }
    if (!ref) continue;
    if (state.kind === "OBJECT") changes.push({ key, change: { kind: "MODIFY", ref, object: state.object } });
    else if (state.kind === "DELETED") changes.push({ key, change: { kind: "DELETE", ref } });
  }
  return changes.sort((a, b) => a.key.localeCompare(b.key)).map(row => row.change);
}

export function changeSet(baseSha256: string, format: MapFileFormat, states: Iterable<readonly [ObjectKey, KeyedState]>): MapRevisionChangeSet {
  return { baseSha256, format, changes: changeList(states) };
}

/** Antalet ändringar av varje slag (granskningen och anteckningen på den nya versionen). */
export function changeCounts(changes: readonly MapRevisionChange[]): { added: number; modified: number; deleted: number; total: number } {
  const added = changes.filter(change => change.kind === "ADD").length;
  const deleted = changes.filter(change => change.kind === "DELETE").length;
  return { added, deleted, modified: changes.length - added - deleted, total: changes.length };
}
