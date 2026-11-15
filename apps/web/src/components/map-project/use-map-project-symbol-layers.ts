"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { mapProjectSymbolLayersEn } from "../../i18n/map-project-more-en";
import { useTexts } from "../language-provider";
import { withSymbol, type EditKind, type ObjectKey, type ObjectRef } from "@o-tid/map-revision";
import type { MapObject } from "@o-tid/map-file";
import { mapProjectSymbolLayersSv } from "../../i18n/map-project-symbol-layers-sv";
import {
  EMPTY_LAYERS, layerSymbols, readLayerState, readLayerViews, saveLayerState, saveLayerViews, standardFor, standardSymbols, withGroupKey,
  type LayerState, type LayerView, type WorkLayer
} from "../../lib/map-project-layer-model";
import type { CatalogSymbol, MapProjectSession } from "../../lib/map-project-protocol";

type Change = { key: ObjectKey; ref: ObjectRef | null; kind: EditKind; after: { kind: "OBJECT"; object: MapObject } };
type CommitMany = (changes: readonly Change[]) => number;
/** Föra över: bara ett lagernamn ur DWG/DXF-importen, och hoppa över det som redan är ritat med målsymbolen. */
export interface MergeFilter { readonly layer?: string | undefined; readonly skipCovered?: boolean | undefined }
/** Avståndet i terrängen inom vilket ett underlag räknas som redan ritat med målsymbolen (grundkartan och kartan skiljer ofta 1–2 m). */
export const COVERED_TOLERANCE_M = 1.5;

/**
 * Ägaren 2026-11-09: lagren efter normen för editorn: valen (sparade i webbläsaren per projekt), symbolerna som är släckta,
 * låsta och nedtonade, och sammanslagningen (varje objekt blir en ändring av symbolen).
 */
export function useMapProjectSymbolLayers({ projectId, catalog, scale, session, commitMany, work }: {
  projectId: string; catalog: readonly CatalogSymbol[]; scale: number | undefined; session: MapProjectSession | undefined; commitMany: CommitMany;
  /** Lagren fas 2: projektets arbetslager. */
  work: readonly WorkLayer[];
}) {
  const text = useTexts(mapProjectSymbolLayersSv, mapProjectSymbolLayersEn);
  const [state, setState] = useState<LayerState>(EMPTY_LAYERS);
  useEffect(() => { setState(readLayerState(projectId)); }, [projectId]);
  const update = useCallback((next: LayerState) => { setState(next); saveLayerState(projectId, next); }, [projectId]);
  const standard = standardFor(scale);
  const symbols = useMemo(() => standardSymbols(standard), [standard]);
  const sets = useMemo(() => layerSymbols(catalog, symbols, state, work), [catalog, symbols, state, work]);
  const lockedSet = useMemo(() => new Set(sets.locked), [sets.locked]);
  const [merging, setMerging] = useState<string>();
  const [message, setMessage] = useState<string>();

  /**
   * Slå ihop eller för över: objekten med `from` (eventuellt bara ett lager ur DWG-importen, och utan det som redan är ritat
   * med `to`) får symbolen `to`, som en ändring som Ångra tar bort på en gång.
   */
  const merge = useCallback((from: CatalogSymbol, to: CatalogSymbol, filter: MergeFilter = {}) => {
    if (!session || from.kind !== to.kind) return;
    setMerging(text.merging(0, from.count)); setMessage(undefined);
    session.bySymbol(from.id, objects => {
      const done = commitMany(objects.map(row => ({ key: row.key, ref: row.ref, kind: "SYMBOL" as const,
        after: { kind: "OBJECT" as const, object: withSymbol(row.object, to.id) } })));
      setMerging(undefined);
      setMessage(text.merged(done, `${from.code} ${from.name}${filter.layer ? ` (${filter.layer})` : ""}`, `${to.code} ${to.name}`));
    }, { layer: filter.layer, ...(filter.skipCovered ? { skipCoveredBy: { symbol: to.id, toleranceMm: COVERED_TOLERANCE_M * 1000 / (scale || 4000) } } : {}) });
  }, [session, commitMany, scale]);

  const groupKey = useCallback((digit: number, solo: boolean) => setState(current => {
    const next = withGroupKey(current, catalog, symbols, digit, solo);
    saveLayerState(projectId, next);
    return next;
  }), [catalog, symbols, projectId]);
  // R3: sparade vyer.
  const [views, setViews] = useState<readonly LayerView[]>([]);
  useEffect(() => { setViews(readLayerViews(projectId)); }, [projectId]);
  const saveView = useCallback((name: string) => setViews(current => {
    const next = [...current.filter(view => view.name !== name), { name, state }];
    saveLayerViews(projectId, next);
    return next;
  }), [projectId, state]);
  const removeView = useCallback((name: string) => setViews(current => {
    const next = current.filter(view => view.name !== name);
    saveLayerViews(projectId, next);
    return next;
  }), [projectId]);

  return { state, update, groupKey, views, saveView, removeView, standard, standardSymbols: symbols, hidden: sets.hidden, locked: lockedSet, dimmed: sets.dimmed,
    shown: sets.shown, merge, merging, message };
}
