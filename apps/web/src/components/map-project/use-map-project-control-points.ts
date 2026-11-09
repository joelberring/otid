"use client";

import { useCallback, useMemo, useState } from "react";
import type { Point } from "@o-tid/map-file";
import { fitControlPoints, pixelAt, type ControlPoint, type FitKind } from "../../lib/map-project-control-points";
import type { DrawnLayer, useMapProjectLayers } from "./use-map-project-layers";

type Layers = ReturnType<typeof useMapProjectLayers>;

/**
 * ADR-0219 K6b: passpunkter för ett underlag. Ett klick i bilden och ett klick där punkten ska ligga på kartan ger en passpunkt;
 * från två punkter flyttas bilden direkt (likformigt), från tre affint om inte likformig väljs. Avvikelserna visas per punkt.
 * Inget sparas förrän man sparar; då får underlaget en ny världsfil i kartans koordinatsystem för alla i projektet.
 */
export function useMapProjectControlPoints(layers: Layers) {
  const [layerId, setLayerId] = useState<string>();
  const [points, setPoints] = useState<readonly ControlPoint[]>([]);
  /** Pixeln som valts i bilden och väntar på sin plats på kartan. */
  const [pending, setPending] = useState<Point>();
  const [similarity, setSimilarity] = useState(false);
  const [saving, setSaving] = useState(false);

  const kind: FitKind = similarity || points.length < 3 ? "similarity" : "affine";
  const fit = useMemo(() => fitControlPoints(points, kind), [points, kind]);
  const original = layers.drawn.find(layer => layer.layerId === layerId);

  /** Underlagen att rita: det som rättas med passpunkternas transform. */
  const drawn = useMemo((): DrawnLayer[] => !layerId || !fit ? layers.drawn
    : layers.drawn.map(layer => layer.layerId === layerId ? { ...layer, toMap: fit.toMap } : layer), [layers.drawn, layerId, fit]);
  const shown = drawn.find(layer => layer.layerId === layerId);

  const start = useCallback((id: string) => { setLayerId(id); setPoints([]); setPending(undefined); setSimilarity(false); }, []);
  const cancel = useCallback(() => { setLayerId(undefined); setPoints([]); setPending(undefined); }, []);
  const undo = useCallback(() => { if (pending) setPending(undefined); else setPoints(current => current.slice(0, -1)); }, [pending]);
  const remove = useCallback((index: number) => setPoints(current => current.filter((_, at) => at !== index)), []);

  /** Ett klick på kartan: först i bilden (som den visas nu), sedan där punkten ska ligga. */
  const click = useCallback((at: Point) => {
    if (!shown) return;
    if (!pending) { setPending(pixelAt(shown.toMap, at)); return; }
    setPoints(current => [...current, { pixel: pending, map: at }]);
    setPending(undefined);
  }, [shown, pending]);

  const save = useCallback(async () => {
    if (!layerId || !fit) return false;
    setSaving(true);
    try {
      const ok = await layers.placeLayer(layerId, fit.toMap);
      if (ok) cancel();
      return ok;
    } finally { setSaving(false); }
  }, [layerId, fit, layers, cancel]);

  /** Punkterna att rita: var pixeln ligger med bildens nuvarande placering och var den ska ligga. */
  const markers = useMemo(() => {
    if (!shown) return [];
    const at = (pixel: Point) => ({ x: shown.toMap.a * pixel.x + shown.toMap.b * pixel.y + shown.toMap.c, y: shown.toMap.d * pixel.x + shown.toMap.e * pixel.y + shown.toMap.f });
    return [...points.map(point => ({ image: at(point.pixel), map: point.map as Point | undefined })), ...(pending ? [{ image: at(pending), map: undefined }] : [])];
  }, [shown, points, pending]);

  return { active: !!layerId && !!original, layerId, points, pending: !!pending, fit, kind, similarity, setSimilarity, drawn, markers,
    start, cancel, undo, remove, click, save, saving };
}
