"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapProjectLayerList, MapProjectLayerView, MapProjectView } from "@o-tid/contracts";
import type { MapGeoreference } from "@o-tid/map-file";
import { clubRequest, csrf } from "../../lib/club-archive-client";
import { cachedMapFile, layerImageCache } from "../../lib/map-file-cache";
import { mapProjectBase } from "../../lib/map-project-client";
import { savedMapProjectLayers, saveMapProjectLayers } from "../../lib/map-project-offline";
import { LayerFileError, prepareLayer, prepareRemoteLayer, type LayerFileProblem, type Placement, type PreparedLayer } from "../../lib/map-project-layer-file";
import { layerToMap, safeLayerSize, type Affine } from "../../lib/map-project-layers";
import { hiddenLayers, LAYER_FETCHES, loadOrder, savedLayerChoices, saveLayerChoices, withChoices, type LayerChoices } from "../../lib/map-project-layer-visibility";
import { placeInBounds, worldFromMap } from "../../lib/map-project-control-points";
import type { Bounds } from "../../lib/course-setting-viewport";
import { inLanguage } from "../../lib/in-language";

/** Ett underlag att rita: bilden och transformen från bildens pixlar till kartans mm. */
export interface DrawnLayer { readonly layerId: string; readonly image: ImageBitmap; readonly toMap: Affine; readonly opacity: number; readonly size?: { readonly width: number; readonly height: number } | undefined }
export type LayerProblem = LayerFileProblem | "quota" | number;

/**
 * ADR-0219 tillägget om underlagen (K4a): projektets egna underlag. Listan hämtas från servern; bilderna läses ur underlagens
 * lager i webbläsaren (per sha256, så att de finns kvar utan nät och inte hämtas igen) eller hämtas. Vilka som syns väljer var
 * och en själv (sparat i webbläsaren, `map-project-layer-visibility.ts`); genomskinligheten är projektets.
 *
 * `start` (ägaren 2026-11-14): bilderna hämtas först när kartans objekt har kommit, så att kartan går att rita i medan
 * underlagen kommer.
 */
export function useMapProjectLayers(view: MapProjectView, georeference: MapGeoreference | undefined, start = true) {
  const base = mapProjectBase(view.projectId);
  const [layers, setLayers] = useState<readonly MapProjectLayerView[]>([]);
  // Listan är tom tills den hämtats i webbläsaren, så valen ur webbläsarens lagring ändrar inget i serverns första bild.
  const [choices, setChoices] = useState<LayerChoices>(() => typeof localStorage === "undefined" ? {} : savedLayerChoices(view.projectId));
  const hidden = useMemo((): ReadonlySet<string> => hiddenLayers(layers, choices), [layers, choices]);
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

  // Bilderna: en gång per underlag (sha256 ändras aldrig för ett underlag). De som visas hämtas först och bara några åt gången.
  const asked = useRef(new Set<string>()), fetching = useRef(0), closedRef = useRef(false);
  const [round, setRound] = useState(0);
  useEffect(() => { closedRef.current = false; return () => { closedRef.current = true; }; }, []);
  useEffect(() => {
    if (!start) return;
    while (fetching.current < LAYER_FETCHES) {
      const layer = loadOrder(layers, hidden).find(row => !asked.current.has(row.layerId));
      if (!layer) return;
      asked.current.add(layer.layerId);
      fetching.current += 1;
      void (async () => {
        try {
          const file = await cachedMapFile(layerImageCache, layer.sha256, async () => {
            const response = await fetch(`${base}/layers/${encodeURIComponent(layer.layerId)}/image`, { credentials: "same-origin" });
            if (!response.ok) throw new Error(inLanguage(`Underlaget kunde inte hämtas (${response.status})`, `The base layer could not be loaded (${response.status})`));
            return { bytes: await response.arrayBuffer(), fileName: `${layer.layerId}.${layer.mediaType === "image/png" ? "png" : layer.mediaType === "image/webp" ? "webp" : "jpg"}` };
          });
          const blob = new Blob([file.bytes], { type: layer.mediaType });
          // En bild som webbläsaren inte klarar i full storlek prövas nedskalad (ritas sedan i sin egen storlek).
          const bitmap = await createImageBitmap(blob).catch(() => {
            const size = safeLayerSize(layer.width, layer.height);
            return createImageBitmap(blob, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "medium" });
          });
          if (closedRef.current) { bitmap.close(); return; }
          setImages(current => current.has(layer.layerId) ? current : new Map(current).set(layer.layerId, bitmap));
        } catch { /* Visas inte; listan säger att det finns. */ }
        finally {
          fetching.current -= 1;
          // Nästa i kön.
          if (!closedRef.current) setRound(value => value + 1);
        }
      })();
    }
  }, [layers, hidden, base, start, round]);

  /** Alla inlästa underlag, också de släckta (ägaren 2026-11-12: reglagen ska inte kräva att underlaget är tänt). */
  const loaded = useMemo((): DrawnLayer[] => {
    if (!georeference) return [];
    const result: DrawnLayer[] = [];
    for (const layer of [...layers].sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt))) {
      const image = images.get(layer.layerId);
      if (!image) continue;
      try { result.push({ layerId: layer.layerId, image, toMap: layerToMap(layer, georeference), opacity: layer.opacity,
        ...(image.width !== layer.width ? { size: { width: layer.width, height: layer.height } } : {}) }); } catch { /* Okänt system. */ }
    }
    return result;
  }, [layers, images, georeference]);
  const drawn = useMemo(() => loaded.filter(layer => !hidden.has(layer.layerId)), [loaded, hidden]);

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
  /** K6b: en bild utan georeferens läggs mitt i `area` (kartans mm) i kartans koordinatsystem och rättas sedan med passpunkter. */
  const upload = useCallback((files: readonly File[], name: string, fallbackCrs: number | undefined, area?: Bounds) => {
    const mapCrs = georeference?.crs.kind === "EPSG" ? georeference.crs.code : undefined;
    const place: Placement | undefined = georeference && area && mapCrs !== undefined
      ? (width, height) => ({ crs: mapCrs, transform: worldFromMap(placeInBounds(width, height, area), width, height, georeference) }) : undefined;
    return add(() => prepareLayer(files, fallbackCrs, place), name);
  }, [add, georeference]);

  /** K6b: ny georeferens ur passpunkterna (bildens pixlar → kartans mm), sparad i kartans koordinatsystem. */
  const placeLayer = useCallback(async (layerId: string, toMapAffine: Affine): Promise<boolean> => {
    const layer = layers.find(row => row.layerId === layerId);
    if (!layer || !georeference || georeference.crs.kind !== "EPSG") return false;
    const crs = georeference.crs.code, transform = worldFromMap(toMapAffine, layer.width, layer.height, georeference);
    const response = await clubRequest(`${base}/layers/${encodeURIComponent(layerId)}`, "PUT", { formatVersion: 1, crs, transform }).catch(() => undefined);
    if (response?.status !== 200) { setProblem(response?.status ?? 0); return false; }
    setLayers(current => current.map(row => row.layerId === layerId ? { ...row, crs, transform } : row));
    return true;
  }, [layers, georeference, base]);
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
      asked.current.delete(layerId);
    } else setProblem(response?.status ?? 0);
  }, [base]);

  /** Visa eller dölj flera på en gång (ett underlag, en grupp av etapper, eller alla underlag); valet sparas i webbläsaren. */
  const setShown = useCallback((layerIds: readonly string[], shown: boolean) => {
    const next = withChoices(choices, layerIds, shown, layers.map(layer => layer.layerId));
    setChoices(next);
    saveLayerChoices(view.projectId, next);
  }, [choices, layers, view.projectId]);
  const toggle = useCallback((layerId: string) => setShown([layerId], hidden.has(layerId)), [setShown, hidden]);

  // Listan visas med det översta först.
  const listed = useMemo(() => [...layers].sort((a, b) => b.sort - a.sort || b.createdAt.localeCompare(a.createdAt)), [layers]);
  return { layers: listed, hidden, toggle, setShown, drawn, loaded, upload, addRemote, placeLayer, reload: load, busy, problem, setProblem, setOpacity, remove, move,
    canAdd: view.viewer.canPropose, canReorder: view.viewer.canDecide, canManage: (layer: MapProjectLayerView) => layer.own || view.viewer.canDecide };
}
