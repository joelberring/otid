"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { autoBuildingEdgeOf, buildingOutlines, codeParts, newKey, objectBox, type ObjectKey } from "@o-tid/map-revision";
import { mapProjectSymbolNormEn } from "../../i18n/map-project-symbol-norm-en";
import { mapProjectSymbolNormSv } from "../../i18n/map-project-symbol-norm-sv";
import type { CatalogSymbol, MapProjectSession, SymbolObject } from "../../lib/map-project-protocol";
import { useTexts } from "../language-provider";
import type { ObjectChange } from "./use-map-project-editor";

/** Utfallet av den senaste körningen: nya och ersatta kantlinjer och husen i grupperna. */
export interface OutlineOutcome { readonly added: number; readonly removed: number; readonly houses: number }

/**
 * Ägaren 2026-11-23 («husen blev helt svarta … borde programmet göra en kant runt»): «Lägg kant runt husen». När kartans
 * byggnad (521) är en yta utan egen kant och kartan har en kantsymbol (521.1) ritas kantlinjer runt sammanhängande hus
 * (`buildingOutlines`): för de markerade husen (kontextraden) eller alla (lagerpanelen och Granska). Gamla kantlinjer längs husen
 * ersätts, de som redan stämmer står kvar. Allt går genom editorns `commitMany`: ett steg att ångra, förslag för den som bara
 * får föreslå. `afterAdd` gör samma sak för ett hus som just lagts in (Fyll, Rita), som ett eget steg.
 */
export function useMapProjectBuildingOutlines(input: { session: MapProjectSession | undefined; catalog: readonly CatalogSymbol[];
  commitMany: (changes: readonly ObjectChange[]) => number; canEdit: boolean }) {
  const { session, catalog, commitMany, canEdit } = input;
  const edge = useMemo(() => autoBuildingEdgeOf(catalog), [catalog]);
  const houses = useMemo(() => catalog.filter(row => row.kind === "area" && codeParts(row.code).main === 521 && codeParts(row.code).sub === 0).map(row => row.id),
    [catalog]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<OutlineOutcome>();
  const text = useTexts(mapProjectSymbolNormSv, mapProjectSymbolNormEn);
  const pending = useRef(new Set<ObjectKey>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Objekten med symbolerna, en symbol i taget ur Workern. */
  const objectsOf = useCallback((ids: readonly string[], done: (rows: SymbolObject[]) => void) => {
    const rows: SymbolObject[] = [];
    const step = (index: number) => {
      const id = ids[index];
      if (id === undefined || !session) { done(rows); return; }
      session.bySymbol(id, objects => { rows.push(...objects); step(index + 1); });
    };
    step(0);
  }, [session]);

  /** Lägg (eller förnya) kanten runt husen; `only` = bara grupperna med de husen. */
  const run = useCallback((only?: ReadonlySet<ObjectKey>, quiet = false) => {
    if (!edge || !session || !canEdit || houses.length === 0) return;
    if (!quiet) { setBusy(true); setOutcome(undefined); }
    objectsOf(houses, houseRows => objectsOf([edge], edgeRows => {
      const plan = buildingOutlines(houseRows.map(row => ({ key: row.key, object: row.object })), edgeRows.map(row => ({ key: row.key, object: row.object })), edge, only);
      const byKey = new Map(edgeRows.map(row => [row.key, row]));
      const removals = plan.remove.flatMap((key): ObjectChange[] => {
        const row = byKey.get(key);
        if (!row) return [];
        const box = objectBox(row.object);
        return [{ key: row.key, ref: row.ref, kind: "DELETE", after: { kind: "DELETED" }, point: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } }];
      });
      const adds = plan.add.map((object): ObjectChange => ({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD", after: { kind: "OBJECT", object } }));
      if (removals.length + adds.length > 0) commitMany([...removals, ...adds]);
      if (!quiet) { setBusy(false); setOutcome({ added: adds.length, removed: removals.length, houses: plan.houses }); }
    }));
  }, [edge, session, canEdit, houses, objectsOf, commitMany]);

  /** Nya hus (Fyll) får kanten direkt, ihop med husen de rör, i en körning för flera hus i rad. */
  const afterAdd = useCallback((changes: readonly ObjectChange[]) => {
    for (const change of changes) {
      if (edge && change.kind === "ADD" && change.after.kind === "OBJECT" && change.after.object.kind === "area" && houses.includes(change.after.object.symbol)) pending.current.add(change.key);
    }
    if (pending.current.size === 0) return;
    // Workern får de nya husen med nästa läge; vänta en stund så att de finns med.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { const keys = new Set(pending.current); pending.current.clear(); run(keys, true); }, 400);
  }, [edge, houses, run]);

  return { available: !!edge && houses.length > 0 && canEdit, houseSymbols: houses, label: text.outlines, run, afterAdd, busy, outcome, clear: () => setOutcome(undefined) };
}
