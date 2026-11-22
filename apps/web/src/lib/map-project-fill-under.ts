import type { MapObject, MapSymbol, Point } from "@o-tid/map-file";
import type { Box, ObjectKey, ObjectRef } from "@o-tid/map-revision";
import { BUILT_MAINS, maskBuilt } from "@o-tid/map-revision/base-map";

/**
 * Ägaren 2026-11-22 («berg hamnar ovanpå kvartersmark»): grundkartans inläsning lämnar redan markens detaljer och vegetationen
 * utanför det som är ritat som tomtmark, hårdgjord yta eller byggnad (`maskBuilt`, ADR-0219-tillägget 2026-11-12). Den som
 * fyller eller ritar en sådan yta i efterhand får samma regel: berg i dagen, grönt, kärr, stenar och små landformer under den
 * nya ytan tas bort eller klipps (en yta kan bli flera), i samma ångringsbara grupp som ytan. Kurvor, branter, vatten, vägar
 * och byggnader står kvar.
 */
export interface UnderChange {
  readonly key: ObjectKey; readonly ref: ObjectRef | null;
  /** Det som blir kvar av objektet: tomt = tas bort, en = ändras, fler = ändras och resten läggs till. */
  readonly objects: readonly MapObject[];
}

/** Rensar under nya ytor med de här symbolerna (huvudnummer): 501, 520, 521, 522. */
export function clearsUnder(symbol: MapSymbol | undefined): boolean {
  return !!symbol && BUILT_MAINS.has(symbol.code.main);
}

export function underChanges(input: { readonly objects: readonly MapObject[]; readonly boxes: readonly Box[]; readonly keys: readonly ObjectKey[];
  readonly refs: ReadonlyMap<ObjectKey, ObjectRef>; readonly symbols: ReadonlyMap<string, MapSymbol> }, rings: readonly (readonly Point[])[]): UnderChange[] {
  const polygon = rings.map(ring => {
    const points = ring.map(point => [point.x, point.y] as [number, number]);
    if (points.length && (points[0]![0] !== points[points.length - 1]![0] || points[0]![1] !== points[points.length - 1]![1])) points.push([...points[0]!]);
    return points;
  }).filter(ring => ring.length >= 4);
  if (polygon.length === 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon[0]!) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const mainOf = (symbol: string) => input.symbols.get(symbol)?.code.main;
  const changes: UnderChange[] = [];
  input.objects.forEach((object, index) => {
    const box = input.boxes[index];
    if (!box || box.maxX < minX || box.minX > maxX || box.maxY < minY || box.minY > maxY) return;
    const kept = maskBuilt([object], [polygon], mainOf).objects;
    if (kept.length === 1 && kept[0] === object) return;
    const key = input.keys[index]!;
    changes.push({ key, ref: input.refs.get(key) ?? null, objects: kept.map(piece => { const plain = { ...piece } as MapObject & { source?: unknown }; delete plain.source; return plain; }) });
  });
  return changes;
}
