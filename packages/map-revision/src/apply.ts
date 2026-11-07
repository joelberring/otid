import type { MapObject, ParsedMap } from "@o-tid/map-file";
import { locatorKey, type ObjectChange, type ObjectRef } from "./contract";
import { isNewKey, type ObjectKey, type ObjectState } from "./state";

/**
 * ADR-0219: revideringens objekt ovanpå grundfilen. Kartan ritas med samma ritare som annars (`drawMap`) på en lista där
 * ändrade objekt är bytta, borttagna saknas och nya ligger sist. Grundfilen ändras aldrig; skrivaren får samma ändringar som
 * kontraktets ändringssats (`toChangeSet`).
 */
export interface KeyedState {
  readonly ref: ObjectRef | null;
  readonly state: ObjectState;
  /** Vem som gjorde objektets senaste ändring och när (skrivarens `ChangeMeta`); tomt i klientens förhandsvisning. */
  readonly author?: string | undefined;
  readonly at?: string | undefined;
}

/**
 * Nycklarna för grundfilens objekt, i läsarens ordning (`b:` + platsen). Grundfilen ska vara läst med `sources`; ett objekt
 * utan källa får en nyckel som inget annat har och kan inte ändras.
 */
export function baseKeys(map: ParsedMap): ObjectKey[] {
  return map.objects.map((object, index) => (object.source ? `b:${locatorKey(object.source.locator)}` : `x:${index}`));
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
export function changeList(states: Iterable<readonly [ObjectKey, KeyedState]>): ObjectChange[] {
  const changes: { key: string; change: ObjectChange }[] = [];
  for (const [key, { ref, state, author, at }] of states) {
    const meta = { author: author ?? "", at: at ?? "" };
    if (isNewKey(key)) {
      if (state.kind === "OBJECT") changes.push({ key, change: { kind: "ADD", id: key.slice(2), object: state.object, ...meta } });
      continue;
    }
    if (!ref) continue;
    if (state.kind === "OBJECT") changes.push({ key, change: { kind: "MODIFY", ref, object: state.object, ...meta } });
    else if (state.kind === "DELETED") changes.push({ key, change: { kind: "DELETE", ref, ...meta } });
  }
  return changes.sort((a, b) => a.key.localeCompare(b.key)).map(row => row.change);
}

/** Antalet ändringar av varje slag (granskningen och anteckningen på den nya versionen). */
export function changeCounts(changes: readonly ObjectChange[]): { added: number; modified: number; deleted: number; total: number } {
  const added = changes.filter(change => change.kind === "ADD").length;
  const deleted = changes.filter(change => change.kind === "DELETE").length;
  return { added, deleted, modified: changes.length - added - deleted, total: changes.length };
}
