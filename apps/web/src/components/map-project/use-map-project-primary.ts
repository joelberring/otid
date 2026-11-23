"use client";

import { useCallback, useEffect, useState } from "react";
import type { MapProjectOsmOriginView, MapProjectPrimarySourceView, MapProjectView } from "@o-tid/contracts";
import type { MapGeoreference, MapObject } from "@o-tid/map-file";
import { objectBox } from "@o-tid/map-revision";
import { coverageArea, osmRemovals, primaryForMerge, primaryKindOfCode, primaryKinds, type PrimaryArea, type PrimaryForMerge, type PrimaryKind } from "@o-tid/map-revision/base-map";
import { clubRequest } from "../../lib/club-archive-client";
import type { Bounds } from "../../lib/course-setting-viewport";
import type { CatalogSymbol, MapProjectSession, SymbolObject } from "../../lib/map-project-protocol";
import type { ObjectChange } from "./use-map-project-editor";

/** Täckningens rutor i meter i terrängen (vidgade en ruta åt alla håll). */
const COVER_M = 30;

/** Frågan om OpenStreetMaps objekt inom en huvudkälla: objekten (markerade på kartan) och borttagningarna. */
export interface PrimaryQuestion { readonly name: string; readonly kinds: readonly PrimaryKind[]; readonly objects: readonly MapObject[];
  readonly changes: readonly ObjectChange[]; readonly kept: number }
export type PrimaryTold = { readonly kind: "saved" | "noKinds" | "failed"; readonly name: string }
  | { readonly kind: "removed" | "none"; readonly count: number; readonly kept: number };

/**
 * PLAN K4c Huvudkälla (ägaren 2026-11-23): projektets huvudkällor, markeringen när en vektorfil läggs in (eller lämnas som
 * förslag) och frågan om OpenStreetMaps orörda objekt inom området. Borttagningen går genom editorns `commitMany`, så att den
 * är ett steg som går att ångra och följer rollen (förslag för den som bara får föreslå).
 */
export function useMapProjectPrimary(input: { view: MapProjectView; base: string; georeference: MapGeoreference | undefined; bounds: Bounds | undefined;
  symbols: ReadonlyMap<string, CatalogSymbol>; sprint: boolean; session?: MapProjectSession | undefined;
  commitMany?: ((changes: readonly ObjectChange[]) => number) | undefined }) {
  const { view, base, georeference, bounds, symbols, sprint, session, commitMany } = input;
  const [sources, setSources] = useState<readonly MapProjectPrimarySourceView[]>([]);
  const [question, setQuestion] = useState<PrimaryQuestion>();
  const [searching, setSearching] = useState(false);
  const [told, setTold] = useState<PrimaryTold>();
  const load = useCallback(async () => {
    const response = await clubRequest(`${base}/primary-sources`, "GET").catch(() => undefined);
    if (response?.status === 200) setSources((response.json as { sources: MapProjectPrimarySourceView[] }).sources);
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  /** Kartans objekt av slagen (en symbol i taget ur Workern), med symbolens nummer. */
  const objectsOf = useCallback((kinds: readonly PrimaryKind[], done: (rows: { key: string; code: string; row: SymbolObject }[]) => void) => {
    const wanted = [...symbols.values()].filter(symbol => { const kind = primaryKindOfCode(symbol.code, sprint); return !!kind && kinds.includes(kind); });
    const rows: { key: string; code: string; row: SymbolObject }[] = [];
    const step = (index: number) => {
      const symbol = wanted[index];
      if (!symbol || !session) { done(rows); return; }
      session.bySymbol(symbol.id, objects => { rows.push(...objects.map(row => ({ key: row.key, code: symbol.code, row }))); step(index + 1); });
    };
    step(0);
  }, [symbols, sprint, session]);

  /** Letar efter OpenStreetMaps orörda objekt av slagen inom området; `exclude` är det som just lades in. */
  const ask = useCallback(async (name: string, kinds: readonly PrimaryKind[], area: PrimaryArea, exclude: ReadonlySet<string> = new Set()) => {
    if (!session || !commitMany || !view.viewer.canPropose) return;
    setSearching(true); setQuestion(undefined);
    const response = await clubRequest(`${base}/osm-origin`, "GET").catch(() => undefined);
    const origin = response?.status === 200 ? (response.json as MapProjectOsmOriginView).decisions : [];
    objectsOf(kinds, rows => {
      setSearching(false);
      const picked = osmRemovals({ objects: rows.map(row => ({ key: row.key, code: row.code, object: row.row.object })), origin, area, kinds, sprint, exclude });
      if (picked.remove.length === 0) { setTold({ kind: "none", count: 0, kept: picked.kept }); return; }
      const chosen = new Set(picked.remove), found = rows.filter(row => chosen.has(row.key));
      setQuestion({ name, kinds, kept: picked.kept, objects: found.map(row => row.row.object), changes: found.map(({ row }): ObjectChange => {
        const box = objectBox(row.object);
        return { key: row.key, ref: row.ref, kind: "DELETE", after: { kind: "DELETED" }, point: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } };
      }) });
    });
  }, [session, commitMany, view.viewer.canPropose, base, objectsOf, sprint]);

  /** Markerar filen som huvudkälla: området ur objekten som lades in (klippt mot kartan) och slagen ur deras symboler. */
  const mark = useCallback(async (name: string, objects: readonly MapObject[], exclude: ReadonlySet<string>) => {
    setTold(undefined);
    const kinds = primaryKinds(objects.map(object => symbols.get(object.symbol)?.code ?? ""), sprint);
    const scale = georeference?.scale ?? 15_000;
    const clip = view.area ?? (bounds ? [[{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY }]] : undefined);
    const area = kinds.length > 0 ? coverageArea(objects, { cellMm: COVER_M * 1000 / scale, clip }) : [];
    if (kinds.length === 0 || area.length === 0) { setTold({ kind: "noKinds", name }); return; }
    const response = await clubRequest(`${base}/primary-sources`, "POST", { formatVersion: 1, sourceId: crypto.randomUUID(), name: name.slice(0, 160), area, kinds })
      .catch(() => ({ status: 0, json: undefined }));
    if (response.status !== 200 && response.status !== 201) { setTold({ kind: "failed", name }); return; }
    setTold({ kind: "saved", name });
    await load();
    await ask(name, kinds, area, exclude);
  }, [symbols, sprint, georeference?.scale, view.area, bounds, base, load, ask]);

  const remove = useCallback(async (sourceId: string) => {
    const response = await clubRequest(`${base}/primary-sources/${sourceId}`, "DELETE").catch(() => ({ status: 0, json: undefined }));
    if (response.status === 200) setSources(current => current.filter(source => source.sourceId !== sourceId));
  }, [base]);

  const confirm = useCallback(() => {
    if (!question || !commitMany) return;
    const count = commitMany(question.changes);
    setTold({ kind: "removed", count, kept: question.kept }); setQuestion(undefined);
  }, [question, commitMany]);

  /** Huvudkällorna som grundkartan använder (SWEREF 99 TM). */
  const forBaseMap = useCallback((): PrimaryForMerge[] => georeference
    ? sources.flatMap(source => primaryForMerge(source, georeference) ?? []) : [], [sources, georeference]);

  return { sources, remove, mark, ask, question, searching, confirm, dismiss: () => setQuestion(undefined), told, clearTold: () => setTold(undefined), forBaseMap,
    canMark: view.viewer.canPropose };
}
