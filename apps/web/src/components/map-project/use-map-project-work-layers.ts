"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapProjectSketchView, MapProjectView, MapProjectWorkLayerList, MapProjectWorkLayerView } from "@o-tid/contracts";
import type { Point } from "@o-tid/map-file";
import { clubRequest } from "../../lib/club-archive-client";
import { mapProjectBase } from "../../lib/map-project-client";
import { simplifyStroke } from "../../lib/map-project-sketch";

/** Förenklingen av en linje på fri hand (kartans mm). */
const STROKE_TOLERANCE_MM = 0.15;
const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * ADR-0219 (ägaren 2026-11-09, lagren fas 2): projektets arbetslager och skisslager från servern, och skissverktyget: dra för en
 * linje på fri hand, klicka för en punkt (eller en text om en text är skriven). Skisserna sparas direkt och syns för alla.
 */
export function useMapProjectWorkLayers(view: MapProjectView) {
  const base = mapProjectBase(view.projectId);
  const [layers, setLayers] = useState<readonly MapProjectWorkLayerView[]>([]);
  const [sketches, setSketches] = useState<readonly MapProjectSketchView[]>([]);
  const [problem, setProblem] = useState<number>();
  const [drawing, setDrawing] = useState<string>();
  const [label, setLabel] = useState("");
  const [stroke, setStroke] = useState<readonly Point[]>([]);
  const strokeRef = useRef<Point[] | undefined>(undefined);
  /** Skisserna man själv ritat medan sidan varit öppen (för Ångra). */
  const mine = useRef<string[]>([]);

  const load = useCallback(async () => {
    const response = await clubRequest(`${base}/work-layers`).catch(() => undefined);
    if (response?.status !== 200) return;
    const list = response.json as MapProjectWorkLayerList;
    setLayers(list.layers); setSketches(list.sketches);
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  const done = (status: number | undefined, ok: readonly number[]) => {
    if (status !== undefined && ok.includes(status)) return true;
    setProblem(status ?? 0);
    return false;
  };

  const createLayer = useCallback(async (kind: "SYMBOLS" | "SKETCH", name: string, codes: readonly string[], color?: string) => {
    setProblem(undefined);
    const response = await clubRequest(`${base}/work-layers`, "POST", { formatVersion: 1, layerId: crypto.randomUUID(), kind, name,
      ...(kind === "SYMBOLS" ? { codes } : {}), ...(color ? { color } : {}) }).catch(() => undefined);
    if (!done(response?.status, [200, 201])) return undefined;
    const layer = (response!.json as { layer: MapProjectWorkLayerView }).layer;
    setLayers(current => [...current.filter(row => row.layerId !== layer.layerId), layer]);
    return layer;
  }, [base]);

  const updateLayer = useCallback(async (layerId: string, patch: { name?: string; codes?: readonly string[]; color?: string }) => {
    setProblem(undefined);
    const response = await clubRequest(`${base}/work-layers/${layerId}`, "PUT", { formatVersion: 1, ...patch }).catch(() => undefined);
    if (!done(response?.status, [200])) return;
    const layer = (response!.json as { layer: MapProjectWorkLayerView }).layer;
    setLayers(current => current.map(row => row.layerId === layerId ? layer : row));
  }, [base]);

  const removeLayer = useCallback(async (layerId: string) => {
    setProblem(undefined);
    const response = await clubRequest(`${base}/work-layers/${layerId}`, "DELETE").catch(() => undefined);
    if (!done(response?.status, [200])) return;
    setLayers(current => current.filter(row => row.layerId !== layerId));
    setSketches(current => current.filter(row => row.layerId !== layerId));
    setDrawing(current => current === layerId ? undefined : current);
  }, [base]);

  const addSketch = useCallback(async (kind: "LINE" | "POINT" | "TEXT", points: readonly Point[], text?: string) => {
    if (!drawing) return;
    setProblem(undefined);
    const sketchId = crypto.randomUUID();
    const response = await clubRequest(`${base}/sketches`, "POST", { formatVersion: 1, sketchId, layerId: drawing, kind,
      points: points.map(point => [round(point.x), round(point.y)]), ...(text ? { text } : {}) }).catch(() => undefined);
    if (!done(response?.status, [200, 201])) return;
    const sketch = (response!.json as { sketch: MapProjectSketchView }).sketch;
    mine.current.push(sketch.sketchId);
    setSketches(current => [...current.filter(row => row.sketchId !== sketch.sketchId), sketch]);
  }, [base, drawing]);

  const removeSketch = useCallback(async (sketchId: string) => {
    const response = await clubRequest(`${base}/sketches/${sketchId}`, "DELETE").catch(() => undefined);
    if (!done(response?.status, [200])) return;
    setSketches(current => current.filter(row => row.sketchId !== sketchId));
  }, [base]);

  /** Ångra: tar bort den senaste skissen man ritat medan sidan varit öppen. */
  const undo = useCallback(() => { const last = mine.current.pop(); if (last) void removeSketch(last); }, [removeSketch]);

  // Skissverktyget (editorn skickar klick och dragningar hit när det är på).
  const tap = useCallback((point: Point) => {
    const text = label.trim();
    void addSketch(text ? "TEXT" : "POINT", [point], text || undefined);
  }, [label, addSketch]);
  const dragStart = useCallback((point: Point) => { strokeRef.current = [point]; setStroke([point]); return true; }, []);
  const dragMove = useCallback((point: Point) => {
    if (!strokeRef.current) return;
    strokeRef.current.push(point);
    setStroke([...strokeRef.current]);
  }, []);
  const dragEnd = useCallback(() => {
    const points = strokeRef.current;
    strokeRef.current = undefined; setStroke([]);
    if (!points) return;
    const simplified = simplifyStroke(points, STROKE_TOLERANCE_MM).slice(0, 2000);
    if (simplified.length >= 2) void addSketch("LINE", simplified);
  }, [addSketch]);

  const layer = layers.find(row => row.layerId === drawing);
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const sketch of sketches) out.set(sketch.layerId, (out.get(sketch.layerId) ?? 0) + 1);
    return out;
  }, [sketches]);

  return { layers, sketches, counts, problem, setProblem, reload: load, createLayer, updateLayer, removeLayer, removeSketch,
    drawing: layer ? drawing : undefined, drawingLayer: layer, start: setDrawing, stop: () => setDrawing(undefined), label, setLabel,
    stroke, dragging: stroke.length > 0, tap, dragStart, dragMove, dragEnd, undo, canUndo: mine.current.length > 0,
    canWrite: view.viewer.canPropose && view.status === "OPEN", canManage: (row: MapProjectWorkLayerView) => row.own || view.viewer.canDecide };
}
