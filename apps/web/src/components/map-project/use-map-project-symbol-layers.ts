"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { withSymbol, type EditKind, type ObjectKey, type ObjectRef } from "@o-tid/map-revision";
import type { MapObject } from "@o-tid/map-file";
import { mapProjectSymbolLayersSv as text } from "../../i18n/map-project-symbol-layers-sv";
import {
  EMPTY_LAYERS, layerSymbols, readLayerState, saveLayerState, standardFor, standardSymbols, type LayerState
} from "../../lib/map-project-layer-model";
import type { CatalogSymbol, MapProjectSession } from "../../lib/map-project-protocol";

type Commit = (change: { key: ObjectKey; ref: ObjectRef | null; kind: EditKind; after: { kind: "OBJECT"; object: MapObject } }) => boolean;

/**
 * Ägaren 2026-11-09: lagren efter normen för editorn: valen (sparade i webbläsaren per projekt), symbolerna som är släckta,
 * låsta och nedtonade, och sammanslagningen (varje objekt blir en ändring av symbolen).
 */
export function useMapProjectSymbolLayers({ projectId, catalog, scale, session, commit }: {
  projectId: string; catalog: readonly CatalogSymbol[]; scale: number | undefined; session: MapProjectSession | undefined; commit: Commit;
}) {
  const [state, setState] = useState<LayerState>(EMPTY_LAYERS);
  useEffect(() => { setState(readLayerState(projectId)); }, [projectId]);
  const update = useCallback((next: LayerState) => { setState(next); saveLayerState(projectId, next); }, [projectId]);
  const standard = standardFor(scale);
  const symbols = useMemo(() => standardSymbols(standard), [standard]);
  const sets = useMemo(() => layerSymbols(catalog, symbols, state), [catalog, symbols, state]);
  const lockedSet = useMemo(() => new Set(sets.locked), [sets.locked]);
  const [merging, setMerging] = useState<string>();
  const [message, setMessage] = useState<string>();

  const merge = useCallback((from: CatalogSymbol, to: CatalogSymbol) => {
    if (!session || from.kind !== to.kind) return;
    setMerging(text.merging(0, from.count)); setMessage(undefined);
    session.bySymbol(from.id, objects => {
      let done = 0;
      for (const row of objects) if (commit({ key: row.key, ref: row.ref, kind: "SYMBOL", after: { kind: "OBJECT", object: withSymbol(row.object, to.id) } })) done += 1;
      setMerging(undefined);
      setMessage(text.merged(done, `${from.code} ${from.name}`, `${to.code} ${to.name}`));
    });
  }, [session, commit]);

  return { state, update, standard, standardSymbols: symbols, hidden: sets.hidden, locked: lockedSet, dimmed: sets.dimmed, merge, merging, message };
}
