"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapObject, Point } from "@o-tid/map-file";
import {
  nearestSegment, objectParts, toggleDashPoint, toggleOrInsertDashPoint,
  type Box, type DashPointCounts, type DashPointOptions, type EditKind, type ObjectKey, type ObjectRef, type VertexAddress
} from "@o-tid/map-revision";
import { mapProjectDashEn } from "../../i18n/map-project-dash-en";
import { mapProjectDashSv } from "../../i18n/map-project-dash-sv";
import { toMap, type Viewport } from "../../lib/course-setting-viewport";
import { nearestVertex } from "../../lib/map-project-draw";
import { drawDashPreview } from "../../lib/map-project-overlay";
import type { CatalogSymbol, DashPointsResult, MapProjectSession } from "../../lib/map-project-protocol";
import { useTexts } from "../language-provider";
import type { Selected } from "./map-project-editor-types";
import type { ObjectChange } from "./use-map-project-editor";

export type DashScope = "selected" | "view" | "map";
export type DashPanelStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "problem"; readonly problem: "noSelection" | "noView" }
  | { readonly kind: "applied"; readonly counts: DashPointCounts };

/** Sant om objektet är en linje med streckad symbol (hjälpkurva, stig …). */
export function isDashedObject(object: MapObject | undefined, symbols: ReadonlyMap<string, CatalogSymbol>): boolean {
  return !!object && object.kind === "line" && symbols.get(object.symbol)?.dashed === true;
}

/** Sant om vald brytpunkt på en linje har styrpunktsflaggan (`dash: true`). */
export function isVertexDash(object: MapObject | undefined, address: VertexAddress | undefined): boolean {
  if (!object || object.kind !== "line" || !address) return false;
  return objectParts(object)[address.part]?.[address.index]?.dash === true;
}

/** Växlar `dash` på en brytpunkt i en linje (stöder flera delar) och ger ett nytt objekt. */
export function toggleLineVertexDash(object: MapObject, address: VertexAddress): MapObject | undefined {
  if (object.kind !== "line") return undefined;
  const parts = objectParts(object);
  const part = parts[address.part];
  if (!part || !part[address.index]) return undefined;
  parts[address.part] = toggleDashPoint(part, address.index);
  return { ...object, path: parts.flat() };
}

/**
 * Styrpunkter i kartprojektets editor: manuell växling av vald brytpunkt, klick-på-linje-läge ("Justera styrpunkter"),
 * 1-klicks auto-styrpunkter för markerade linjer, och batchpanel (markerade / utsnitt / hela kartan) med förhandsvisning.
 */
export function useMapProjectDashPoints(input: {
  session: MapProjectSession | undefined;
  canEdit: boolean;
  tool: string;
  selected: Selected | undefined;
  multi: readonly { readonly key: ObjectKey; readonly ref: ObjectRef | null; readonly object: MapObject }[];
  activeVertex: VertexAddress | undefined;
  symbols: ReadonlyMap<string, CatalogSymbol>;
  hidden: readonly string[];
  save: (key: ObjectKey, ref: ObjectRef | null, object: MapObject | undefined, kind: EditKind) => boolean;
  commitMany: (changes: readonly ObjectChange[]) => number;
  updateSelected: (next: Selected) => void;
  setFlash: (message: string) => void;
}) {
  const { session, canEdit, tool, selected, multi, activeVertex, symbols, hidden, save, commitMany, updateSelected, setFlash } = input;
  const text = useTexts(mapProjectDashSv, mapProjectDashEn);
  const [mode, setMode] = useState(false);
  const [scope, setScope] = useState<DashScope>("view");
  const [bends, setBends] = useState(true);
  const [slopeTags, setSlopeTags] = useState(true);
  const [junctions, setJunctions] = useState(true);
  const [keepExisting, setKeepExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<DashPointsResult>();
  const [status, setStatus] = useState<DashPanelStatus>({ kind: "idle" });
  const viewBox = useRef<Box | undefined>(undefined);

  const isSelectedDashed = tool === "select" && isDashedObject(selected?.object, symbols);
  const selectedDashKeys = useMemo<readonly ObjectKey[]>(() => {
    if (tool !== "select") return [];
    if (multi.length > 0) return multi.filter(item => isDashedObject(item.object, symbols)).map(item => item.key);
    return isSelectedDashed && selected ? [selected.key] : [];
  }, [tool, multi, selected, isSelectedDashed, symbols]);

  useEffect(() => {
    if (!isSelectedDashed && mode) setMode(false);
  }, [isSelectedDashed, mode]);

  const activeVertexDash = isSelectedDashed && isVertexDash(selected?.object, activeVertex);
  const options: DashPointOptions = useMemo(() => ({ bends, slopeTags, junctions, keepExisting }), [bends, slopeTags, junctions, keepExisting]);
  const previewPoints = useMemo<readonly Point[]>(() => plan?.entries.flatMap(entry => entry.points.map(point => point.at)) ?? [], [plan]);

  const applyEntries = useCallback((result: DashPointsResult) => {
    if (result.entries.length > 0) {
      const changes: ObjectChange[] = result.entries.map(entry => ({
        key: entry.key, ref: entry.ref, kind: "RESHAPE", after: { kind: "OBJECT", object: entry.after }
      }));
      commitMany(changes);
      if (selected) {
        const updated = result.entries.find(entry => entry.key === selected.key);
        if (updated) updateSelected({ key: selected.key, ref: selected.ref, object: updated.after });
      }
    }
    setPlan(undefined);
    setStatus({ kind: "applied", counts: result.counts });
    const { added, bends: b, slopeTags: s, junctions: j } = result.counts;
    setFlash(text.appliedSummary(added, b, s, j));
  }, [commitMany, selected, updateSelected, setFlash, text]);

  const toggleActiveVertex = useCallback(() => {
    if (!canEdit || !selected || !activeVertex || !isSelectedDashed) return;
    const wasDash = isVertexDash(selected.object, activeVertex);
    const next = toggleLineVertexDash(selected.object, activeVertex);
    if (!next) return;
    if (save(selected.key, selected.ref, next, "RESHAPE")) setFlash(wasDash ? text.vertexRemoved : text.vertexAdded);
  }, [canEdit, selected, activeVertex, isSelectedDashed, save, setFlash, text]);

  const tapLine = useCallback((point: Point, tolerance: number): boolean => {
    if (!mode || !canEdit || !selected || !isSelectedDashed || selected.object.kind !== "line") return false;
    const hit = nearestVertex(selected.object, point, tolerance) || nearestSegment(selected.object, point, tolerance);
    if (!hit) return false;
    const result = toggleOrInsertDashPoint(selected.object.path, point, tolerance);
    const next: MapObject = { ...selected.object, path: result.path };
    if (save(selected.key, selected.ref, next, "RESHAPE")) {
      setFlash(result.action === "removed" ? text.vertexRemoved : text.vertexAdded);
    }
    return true;
  }, [mode, canEdit, selected, isSelectedDashed, save, setFlash, text]);

  const escape = useCallback((): boolean => {
    if (!mode) return false;
    setMode(false);
    return true;
  }, [mode]);

  const applySelected = useCallback(() => {
    if (!session || !canEdit || selectedDashKeys.length === 0) return;
    setBusy(true);
    setStatus({ kind: "idle" });
    session.dashPoints({ keys: selectedDashKeys, options, hidden }, result => {
      setBusy(false);
      applyEntries(result);
    });
  }, [session, canEdit, selectedDashKeys, options, hidden, applyEntries]);

  const preview = useCallback(() => {
    if (!session || !canEdit) return;
    if (scope === "selected" && selectedDashKeys.length === 0) {
      setPlan(undefined);
      setStatus({ kind: "problem", problem: "noSelection" });
      return;
    }
    if (scope === "view" && !viewBox.current) {
      setPlan(undefined);
      setStatus({ kind: "problem", problem: "noView" });
      return;
    }
    setBusy(true);
    setStatus({ kind: "idle" });
    session.dashPoints({
      options, hidden,
      ...(scope === "selected" ? { keys: selectedDashKeys } : {}),
      ...(scope === "view" && viewBox.current ? { box: viewBox.current } : {})
    }, result => {
      setBusy(false);
      setPlan(result);
    });
  }, [session, canEdit, scope, selectedDashKeys, options, hidden]);

  const apply = useCallback(() => {
    if (!plan || !canEdit) return;
    applyEntries(plan);
  }, [plan, canEdit, applyEntries]);

  const clear = useCallback(() => {
    setPlan(undefined);
    setStatus({ kind: "idle" });
  }, []);

  const draw = useCallback((ctx: CanvasRenderingContext2D, current: Viewport) => {
    const a = toMap(current, { x: 0, y: 0 }), b = toMap(current, { x: current.width, y: current.height });
    viewBox.current = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    if (previewPoints.length > 0) drawDashPreview(ctx, current, previewPoints);
  }, [previewPoints]);

  return {
    canEdit, text, mode, setMode, toggleMode: () => setMode(value => !value),
    isSelectedDashed, selectedCount: selectedDashKeys.length, activeVertexDash,
    toggleActiveVertex, tapLine, escape, applySelected,
    scope, setScope, bends, setBends, slopeTags, setSlopeTags, junctions, setJunctions, keepExisting, setKeepExisting,
    busy, plan, previewPoints, status, preview, apply, clear, draw,
    hint: mode && isSelectedDashed ? text.modeHint : undefined
  };
}
