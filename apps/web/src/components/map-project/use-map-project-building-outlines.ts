"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { autoBuildingEdgeOf, buildingOutlines, codeParts, newKey, type ObjectKey } from "@o-tid/map-revision";
import { mapProjectSymbolNormEn } from "../../i18n/map-project-symbol-norm-en";
import { mapProjectSymbolNormSv } from "../../i18n/map-project-symbol-norm-sv";
import type { CatalogSymbol, MapProjectSession } from "../../lib/map-project-protocol";
import { useTexts } from "../language-provider";
import type { ObjectChange } from "./use-map-project-editor";
import { deleteChange, symbolObjects } from "./use-map-project-sprint-repair";

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

  /** Planen: kantlinjerna att lägga till och de gamla att ersätta (räknas, ändrar inget). */
  const plan = useCallback(async (only?: ReadonlySet<ObjectKey>): Promise<{ changes: ObjectChange[]; outcome: OutlineOutcome } | undefined> => {
    if (!edge || !session || houses.length === 0) return undefined;
    const houseRows = await symbolObjects(session, houses), edgeRows = await symbolObjects(session, [edge]);
    const result = buildingOutlines(houseRows.map(row => ({ key: row.key, object: row.object })), edgeRows.map(row => ({ key: row.key, object: row.object })), edge, only);
    const byKey = new Map(edgeRows.map(row => [row.key, row]));
    const removals = result.remove.flatMap(key => { const row = byKey.get(key); return row ? [deleteChange(row)] : []; });
    const adds = result.add.map((object): ObjectChange => ({ key: newKey(crypto.randomUUID()), ref: null, kind: "ADD", after: { kind: "OBJECT", object } }));
    return { changes: [...removals, ...adds], outcome: { added: adds.length, removed: removals.length, houses: result.houses } };
  }, [edge, session, houses]);

  /** Lägg (eller förnya) kanten runt husen; `only` = bara grupperna med de husen. */
  const run = useCallback((only?: ReadonlySet<ObjectKey>, quiet = false) => {
    if (!canEdit) return;
    if (!quiet) { setBusy(true); setOutcome(undefined); }
    void plan(only).then(result => {
      if (result && result.changes.length > 0) commitMany(result.changes);
      if (!quiet) { setBusy(false); setOutcome(result?.outcome); }
    });
  }, [canEdit, plan, commitMany]);

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

  return { available: !!edge && houses.length > 0 && canEdit, houseSymbols: houses, label: text.outlines, plan, run, afterAdd, busy, outcome, clear: () => setOutcome(undefined) };
}
