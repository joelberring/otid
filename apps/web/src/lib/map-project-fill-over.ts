import type { MapObject, MapSymbol, Point } from "@o-tid/map-file";
import { areaMinimum, fillOverCuts, isGroundArea, newKey, type Box, type EditKind, type MapNorm, type ObjectKey, type ObjectRef, type ObjectState,
  type FillOverTarget } from "@o-tid/map-revision";
import { fillObject } from "./map-project-fill-area";
import type { UnderChange } from "./map-project-fill-under";

/**
 * K8b V7 Fyll över (ägaren 2026-11-23): när den nya ytan läggs in klipps dess område bort ur alla synliga markytor som den
 * överlappar (`fillOverCuts` i `@o-tid/map-revision`). En yta som klipps i flera delar blir flera objekt (den första delen
 * ändrar objektet, resten läggs till), en yta som täcks helt tas bort, och restbitar under normens minsta yta för symbolen
 * eller under 1 m² tas bort. Hårda ytor (hus, vatten …) är gränser för rutan och klipps aldrig. Räknas i Workern.
 */
export const FILL_OVER_MIN_PIECE_M2 = 1;
/** Överlapp mindre än så (m²) är kanter som nästan sammanfaller, inte något att klippa. */
const MIN_OVERLAP_M2 = 0.1;

/** Det som förhandsvisningen visar: områdena som tas bort ur befintliga ytor, och vilka ytor (antal och nummer). */
export interface FillOverlay { readonly removed: Point[][][]; readonly count: number; readonly codes: readonly string[]; readonly keys: readonly ObjectKey[] }

export interface FillOverInput {
  readonly objects: readonly MapObject[]; readonly boxes: readonly Box[]; readonly keys: readonly ObjectKey[];
  readonly refs: ReadonlyMap<ObjectKey, ObjectRef>; readonly symbols: ReadonlyMap<string, MapSymbol>; readonly scale: number;
}

export function overChanges(input: FillOverInput, rings: readonly (readonly Point[])[], options: { readonly norm: MapNorm; readonly hidden: readonly string[];
  readonly symbol?: string | undefined }): { changes: UnderChange[]; overlay: FillOverlay; covered?: number | undefined } {
  const mm2PerM2 = (1000 / input.scale) ** 2, hidden = new Set(options.hidden);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of rings[0] ?? []) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  const indexes: number[] = [], targets: FillOverTarget[] = [];
  input.objects.forEach((object, index) => {
    if (object.kind !== "area") return;
    const box = input.boxes[index], symbol = input.symbols.get(object.symbol);
    if (!box || box.maxX < minX || box.minX > maxX || box.maxY < minY || box.minY > maxY) return;
    if (!symbol || symbol.hidden || hidden.has(symbol.id) || !isGroundArea(symbol.code.main, options.norm)) return;
    const minimum = Math.max(areaMinimum(symbol.code.text, input.scale) ?? 0, FILL_OVER_MIN_PIECE_M2 * mm2PerM2);
    indexes.push(index);
    targets.push({ object, minPieceMm2: minimum, cover: object.symbol === options.symbol });
  });
  const cuts = fillOverCuts(rings, targets, MIN_OVERLAP_M2 * mm2PerM2);
  const changes: UnderChange[] = [], removed: Point[][][] = [], codes = new Set<string>();
  let covered: number | undefined;
  for (const cut of cuts) {
    const index = indexes[cut.target]!, key = input.keys[index]!, object = input.objects[index]!;
    if (cut.covers) covered ??= index;
    changes.push({ key, ref: input.refs.get(key) ?? null, objects: cut.pieces.map(piece => { const plain = { ...piece } as MapObject & { source?: unknown }; delete plain.source; return plain; }) });
    removed.push(...cut.removed);
    codes.add(input.symbols.get(object.symbol)?.code.text ?? "");
  }
  return { changes, overlay: { removed, count: cuts.length, codes: [...codes].filter(Boolean).sort(), keys: changes.map(change => change.key) }, covered };
}

/** En ändring av kartan, som editorns `ObjectChange`. */
export interface FillChange {
  readonly key: ObjectKey; readonly ref: ObjectRef | null; readonly kind: EditKind; readonly after: ObjectState;
  readonly point?: Point | undefined; readonly group?: string | undefined;
}

/**
 * Den nya ytan och det som ändras under den, som en grupp (Ångra tar allt på en gång): den första delen ändrar objektet
 * (RESHAPE), inga delar tar bort det (DELETE) och fler delar läggs till (ADD). `id` ger nya nycklar och gruppens id.
 */
export function fillChangeList(symbol: string, rings: readonly (readonly Point[])[], under: readonly UnderChange[], id: () => string): FillChange[] {
  const area: FillChange = { key: newKey(id()), ref: null, kind: "ADD", after: { kind: "OBJECT", object: fillObject(symbol, rings) } };
  if (under.length === 0) return [area];
  const group = id(), point = rings[0]?.[0];
  const changes: FillChange[] = [{ ...area, group }];
  for (const change of under) {
    const [first, ...rest] = change.objects;
    changes.push(first ? { key: change.key, ref: change.ref, kind: "RESHAPE", after: { kind: "OBJECT", object: first }, group }
      : { key: change.key, ref: change.ref, kind: "DELETE", after: { kind: "DELETED" }, point, group });
    for (const object of rest) changes.push({ key: newKey(id()), ref: null, kind: "ADD", after: { kind: "OBJECT", object }, group });
  }
  return changes;
}

/** Fyll över och rensningen under bebyggt (`underChanges`) i en lista: ett objekt som båda klipper tas bara med en gång. */
export function joinUnder(over: readonly UnderChange[], under: readonly UnderChange[]): UnderChange[] {
  const keys = new Set(over.map(change => change.key));
  return [...over, ...under.filter(change => !keys.has(change.key))];
}
