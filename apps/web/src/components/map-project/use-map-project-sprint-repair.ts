"use client";

import { useCallback, useMemo, useState } from "react";
import { apartmentYardKeys, codeParts, newKey, objectBox, stairObjectsPlan, stairWidthOfName, type ObjectKey } from "@o-tid/map-revision";
import type { CatalogSymbol, MapProjectSession, SymbolObject } from "../../lib/map-project-protocol";
import type { ObjectChange } from "./use-map-project-editor";

/** Objekten med symbolerna, en symbol i taget ur Workern (Workern svarar på den senaste frågan, därför i tur och ordning). */
export function symbolObjects(session: MapProjectSession, ids: readonly string[]): Promise<SymbolObject[]> {
  return new Promise(resolve => {
    const rows: SymbolObject[] = [];
    const step = (index: number) => {
      const id = ids[index];
      if (id === undefined) { resolve(rows); return; }
      session.bySymbol(id, objects => { rows.push(...objects); step(index + 1); });
    };
    step(0);
  });
}

/** En borttagning av ett objekt i kartan (med platsen, för delområdena). */
export const deleteChange = (row: SymbolObject): ObjectChange => {
  const box = objectBox(row.object);
  return { key: row.key, ref: row.ref, kind: "DELETE", after: { kind: "DELETED" }, point: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } };
};

const ofCode = (catalog: readonly CatalogSymbol[], kind: CatalogSymbol["kind"], main: number, sub?: number) =>
  catalog.filter(row => row.kind === kind && codeParts(row.code).main === main && (sub === undefined || codeParts(row.code).sub === sub));

export interface RepairFound {
  /** Trappor ur trappsteg som egna linjer: ändringarna och antalen. */
  readonly stairs: { readonly changes: readonly ObjectChange[]; readonly stairs: number; readonly steps: number };
  /** 520-ytor kring flerbostadshus. */
  readonly yards: readonly SymbolObject[];
}

/**
 * Ägaren 2026-11-23 («måste jag köra om filen eller kan jag läsa in rätt symbolbibliotek med en knapp?»): stegen i «Rätta efter
 * sprintnormen» som gäller objekten i en befintlig karta: «Förenkla trappor» (trappsteg som egna 532-linjer blir trappor,
 * `stairObjectsPlan`) och 520-ytorna kring flerbostadshus (`apartmentYardKeys`), som kan markeras på kartan innan de tas bort.
 * Allt går genom editorns `commitMany` (ett steg att ångra, förslag för den som bara får föreslå).
 */
export function useMapProjectSprintRepair(input: { session: MapProjectSession | undefined; catalog: readonly CatalogSymbol[]; scale: number | undefined;
  commitMany: (changes: readonly ObjectChange[]) => number; canEdit: boolean }) {
  const { session, catalog, scale, commitMany, canEdit } = input;
  const symbols = useMemo(() => {
    const stairs = ofCode(catalog, "line", 532);
    return { stairs, stair: stairs.find(row => codeParts(row.code).sub === 0) ?? stairs[0], yards: ofCode(catalog, "area", 520, 0), houses: ofCode(catalog, "area", 521, 0) };
  }, [catalog]);
  const [found, setFound] = useState<RepairFound>();
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (only?: ReadonlySet<ObjectKey>): Promise<RepairFound | undefined> => {
    if (!session || !scale) return undefined;
    setSearching(true);
    const stairRows = (await symbolObjects(session, symbols.stairs.map(row => row.id))).filter(row => !only || only.has(row.key));
    const plan = symbols.stair ? stairObjectsPlan(stairRows, scale, symbols.stairs.map(row => ({ id: row.id, widthMm: stairWidthOfName(row.name) })), symbols.stair.id)
      : { remove: [], add: [], stairs: 0 };
    const byKey = new Map(stairRows.map(row => [row.key, row]));
    const changes = [...plan.remove.flatMap(key => { const row = byKey.get(key); return row ? [deleteChange(row)] : []; }),
      ...plan.add.map((object): ObjectChange => ({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD", after: { kind: "OBJECT", object } }))];
    const yardRows = await symbolObjects(session, symbols.yards.map(row => row.id));
    const houseRows = yardRows.length ? await symbolObjects(session, symbols.houses.map(row => row.id)) : [];
    const keys = new Set(apartmentYardKeys(yardRows, houseRows, scale));
    const next: RepairFound = { stairs: { changes, stairs: plan.stairs, steps: plan.remove.length }, yards: yardRows.filter(row => keys.has(row.key)) };
    setFound(next);
    setSearching(false);
    return next;
  }, [session, scale, symbols]);

  /** Förenkla trappor: för de markerade 532-linjerna (`only`) eller alla i kartan. Antalet trappor. */
  const simplifyStairs = useCallback(async (only?: ReadonlySet<ObjectKey>): Promise<number> => {
    if (!canEdit) return 0;
    const result = only ? await search(only) : found ?? await search();
    if (!result || result.stairs.changes.length === 0) return 0;
    commitMany(result.stairs.changes);
    setFound(current => current && { ...current, stairs: { changes: [], stairs: 0, steps: 0 } });
    return result.stairs.stairs;
  }, [canEdit, found, search, commitMany]);

  /** Ta bort 520-ytorna kring flerbostadshusen (de som hittades). */
  const removeYards = useCallback((): number => {
    if (!canEdit || !found?.yards.length) return 0;
    const count = commitMany(found.yards.map(deleteChange));
    setFound(current => current && { ...current, yards: [] });
    return count;
  }, [canEdit, found, commitMany]);

  return { found, searching, search, simplifyStairs, removeYards, stairSymbols: symbols.stairs.map(row => row.id), canEdit };
}
