"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MapProjectLayerList, MapProjectLayerView, MapProjectView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { clubRequest, csrf } from "../../lib/club-archive-client";
import { cachedMapFile, mapFileCache } from "../../lib/map-file-cache";
import { mapProjectBase } from "../../lib/map-project-client";
import { savedMapProjectLayers, saveMapProjectLayers } from "../../lib/map-project-offline";
import { LayerFileError, prepareLayer, prepareRemoteLayer, type LayerFileProblem, type PreparedLayer } from "../../lib/map-project-layer-file";
import { layerToMap, type Affine } from "../../lib/map-project-layers";
import type { Bounds } from "../../lib/course-setting-viewport";

/** Ett underlag att rita: bilden och transformen från bildens pixlar till kartans mm. */
export interface DrawnLayer { readonly layerId: string; readonly image: ImageBitmap; readonly toMap: Affine; readonly opacity: number }
export type LayerProblem = LayerFileProblem | "quota" | number;

/**
 * ADR-0219 tillägget om underlagen (K4a): projektets egna underlag. Listan hämtas från servern; bilderna läses ur kartcachen
 * (per sha256, så att de finns kvar utan nät) eller hämtas. Vilka som syns väljer var och en själv; genomskinligheten är projektets.
 */
export function useMapProjectLayers(view: MapProjectView, georeference: MapGeoreference | undefined) {
  const base = mapProjectBase(view.projectId);
  const [layers, setLayers] = useState<readonly MapProjectLayerView[]>([]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [images, setImages] = useState<ReadonlyMap<string, ImageBitmap>>(new Map());
  const [busy, setBusy] = useState<"preparing" | "uploading">();
  const [problem, setProblem] = useState<LayerProblem>();

  const load = useCallback(async () => {
    try {
      const response = await clubRequest(`${base}/layers`);
      if (response.status === 200) {
        const list = (response.json as MapProjectLayerList).layers;
        setLayers(list);
        await saveMapProjectLayers(view.projectId, list).catch(error => console.error("Underlagen kunde inte sparas för offline", error));
      }
    } catch {
      // Utan nät: listan som sparades senast (bilderna finns i kartcachen).
      const saved = await savedMapProjectLayers(view.projectId).catch(() => undefined);
      if (saved) setLayers(current => current.length ? current : saved);
    }
  }, [base, view.projectId]);
  useEffect(() => { void load(); }, [load]);

  // Bilderna: en gång per underlag (sha256 ändras aldrig för ett underlag).
  useEffect(() => {
    let closed = false;
    for (const layer of layers) {
      if (images.has(layer.layerId)) continue;
      void (async () => {
        try {
          const file = await cachedMapFile(mapFileCache, layer.sha256, async () => {
            const response = await fetch(`${base}/layers/${encodeURIComponent(layer.layerId)}/image`, { credentials: "same-origin" });
            if (!response.ok) throw new Error(`Underlaget kunde inte hämtas (${response.status})`);
            return { bytes: await response.arrayBuffer(), fileName: `${layer.layerId}.${layer.mediaType === "image/png" ? "png" : "jpg"}` };
          });
          const bitmap = await createImageBitmap(new Blob([file.bytes], { type: layer.mediaType }));
          if (closed) { bitmap.close(); return; }
          setImages(current => current.has(layer.layerId) ? current : new Map(current).set(layer.layerId, bitmap));
        } catch { /* Visas inte; listan säger att det finns. */ }
      })();
    }
    return () => { closed = true; };
  }, [layers, images, base]);

  const drawn = useMemo((): DrawnLayer[] => {
    if (!georeference) return [];
    const result: DrawnLayer[] = [];
    for (const layer of [...layers].sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt))) {
      const image = images.get(layer.layerId);
      if (!image || hidden.has(layer.layerId)) continue;
      try { result.push({ layerId: layer.layerId, image, toMap: layerToMap(layer, georeference), opacity: layer.opacity }); } catch { /* Okänt system. */ }
    }
    return result;
  }, [layers, images, hidden, georeference]);

  /** Gör bilden klar (`prepare`) och lägger upp den som underlag. */
  const add = useCallback(async (prepare: () => Promise<PreparedLayer>, name: string, reload = true): Promise<boolean> => {
    setProblem(undefined);
    setBusy("preparing");
    try {
      const prepared = await prepare();
      setBusy("uploading");
      const token = csrf();
      if (!token) { setProblem(401); return false; }
      const response = await fetch(`${base}/layers`, { method: "POST", credentials: "same-origin", cache: "no-store", body: prepared.bytes,
        headers: { "content-type": "application/octet-stream", "x-otid-csrf": token, "x-otid-request-id": crypto.randomUUID(),
          "x-otid-name": encodeURIComponent((name.trim() || prepared.name).slice(0, 80)),
          "x-otid-layer": encodeURIComponent(JSON.stringify({ crs: prepared.crs, transform: prepared.transform })) } });
      if (response.status === 200 || response.status === 201) { if (reload) await load(); return true; }
      const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
      setProblem(body?.error === "STORAGE_QUOTA_EXCEEDED" ? "quota" : body?.error === "MAP_FILE_TOO_LARGE" ? "TOO_LARGE"
        : body?.error === "UNSUPPORTED_IMAGE" ? "UNREADABLE" : response.status);
      return false;
    } catch (error) {
      setProblem(error instanceof LayerFileError ? error.problem : 0);
      return false;
    } finally { setBusy(undefined); }
  }, [base, load]);
  const upload = useCallback((files: readonly File[], name: string, fallbackCrs: number | undefined) =>
    add(() => prepareLayer(files, fallbackCrs), name), [add]);
  /** K4c: en del av en bild på nätet (ortofoto genom serverns `asset`-anrop) för rutan (kartans mm). */
  const addRemote = useCallback((url: string, area: Bounds, name: string, reload: boolean) => georeference
    ? add(() => prepareRemoteLayer(url, area, georeference, name), name, reload) : Promise.resolve(false), [add, georeference]);

  /** Genomskinligheten ändras direkt på kartan; `save` skickar den (när reglaget släpps). */
  const setOpacity = useCallback(async (layerId: string, opacity: number, save: boolean) => {
    setLayers(current => current.map(layer => layer.layerId === layerId ? { ...layer, opacity } : layer));
    if (!save) return;
    const response = await clubRequest(`${base}/layers/${encodeURIComponent(layerId)}`, "PUT", { formatVersion: 1, opacity }).catch(() => undefined);
    if (response && response.status !== 200) setProblem(response.status);
  }, [base]);

  /** Ordningen: `up` = ritas ovanpå nästa. Ordningstalen görs om till 0, 1, 2 … och de som ändrats skickas. */
  const move = useCallback(async (layerId: string, up: boolean) => {
    const sorted = [...layers].sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));
    const at = sorted.findIndex(layer => layer.layerId === layerId);
    const to = up ? at + 1 : at - 1;
    if (at < 0 || to < 0 || to >= sorted.length) return;
    [sorted[at], sorted[to]] = [sorted[to]!, sorted[at]!];
    const changed = sorted.map((layer, sort) => ({ layer, sort })).filter(({ layer, sort }) => layer.sort !== sort);
    setLayers(sorted.map((layer, sort) => ({ ...layer, sort })));
    for (const { layer, sort } of changed) {
      const response = await clubRequest(`${base}/layers/${encodeURIComponent(layer.layerId)}`, "PUT", { formatVersion: 1, sort }).catch(() => undefined);
      if (response?.status !== 200) { setProblem(response?.status ?? 0); await load(); return; }
    }
  }, [layers, base, load]);

  const remove = useCallback(async (layerId: string) => {
    const response = await clubRequest(`${base}/layers/${encodeURIComponent(layerId)}`, "DELETE").catch(() => undefined);
    if (response?.status === 200) {
      setLayers(current => current.filter(layer => layer.layerId !== layerId));
      setImages(current => { const next = new Map(current); next.get(layerId)?.close(); next.delete(layerId); return next; });
    } else setProblem(response?.status ?? 0);
  }, [base]);

  const toggle = useCallback((layerId: string) => setHidden(current => {
    const next = new Set(current);
    if (next.has(layerId)) next.delete(layerId); else next.add(layerId);
    return next;
  }), []);

  // Listan visas med det översta först.
  const listed = useMemo(() => [...layers].sort((a, b) => b.sort - a.sort || b.createdAt.localeCompare(a.createdAt)), [layers]);
  return { layers: listed, hidden, toggle, drawn, upload, addRemote, reload: load, busy, problem, setProblem, setOpacity, remove, move,
    canAdd: view.viewer.canPropose, canReorder: view.viewer.canDecide, canManage: (layer: MapProjectLayerView) => layer.own || view.viewer.canDecide };
}
