"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Point } from "@o-tid/map-file";
import type { Box } from "@o-tid/map-revision";
import { toMap, toScreen, type Viewport } from "../../lib/course-setting-viewport";
import type { MapProjectSession } from "../../lib/map-project-protocol";
import { UNFILLED_MAX_M, type UnfilledCell, type UnfilledResult } from "../../lib/map-project-unfilled";

/** Så länge (ms) kartan och vyn ska stå still innan rutorna räknas om. */
const DELAY_MS = 500;
const HATCH = "rgba(200, 30, 30, 0.55)";
const TINT = "rgba(220, 40, 40, 0.14)";

export type UnfilledState = { readonly kind: "off" } | { readonly kind: "busy" } | { readonly kind: "zoomIn" } | { readonly kind: "done"; readonly count: number };

/**
 * K8b V5 (ägaren 2026-11-21): Visa ofyllda rutor (⇧§ eller knappen under Granska). Workern räknar rutorna i det synliga
 * utsnittet (högst `UNFILLED_MAX_M` åt varje håll) med samma ytmotor som Magisk fyll, en stund efter att kartan eller vyn
 * ändrats; de ritas med röd skraffering och räknas i statusraden. Ett klick på räknaren går till nästa ruta.
 */
export function useMapProjectUnfilled(input: { session: MapProjectSession | undefined; renderKey: number; hidden: readonly string[];
  area: readonly (readonly Point[])[] | undefined; scale: number | undefined; focus: (point: Point) => void }) {
  const { session, renderKey, hidden, area, scale } = input;
  const [on, setOn] = useState(false);
  const [result, setResult] = useState<UnfilledResult>();
  const [busy, setBusy] = useState(false);
  const asked = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Rundan som räknaren går igenom (rutorna när den först klickades) och var man är. */
  const tour = useRef<{ cells: readonly UnfilledCell[]; at: number } | undefined>(undefined);
  const pattern = useRef<CanvasPattern | null | undefined>(undefined);
  const focus = useRef(input.focus);
  focus.current = input.focus;

  const ask = useCallback((box: Box, key: string) => {
    if (!session) return;
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    timer.current = setTimeout(() => {
      asked.current = key;
      session.unfilled({ box, hidden, area }, next => { setResult(next); setBusy(false); });
    }, DELAY_MS);
  }, [session, hidden, area]);

  useEffect(() => {
    if (on) return;
    if (timer.current) clearTimeout(timer.current);
    asked.current = undefined; tour.current = undefined; setResult(undefined); setBusy(false);
  }, [on]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** Ritas ovanpå kartan; beställer också rutorna för utsnittet när det ändrats. */
  function draw(ctx: CanvasRenderingContext2D, current: Viewport) {
    if (!on) return;
    const a = toMap(current, { x: 0, y: 0 }), b = toMap(current, { x: current.width, y: current.height });
    const box = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    const tooLarge = !!scale && Math.max(box.maxX - box.minX, box.maxY - box.minY) > UNFILLED_MAX_M * 1000 / scale;
    // Ny fråga när kartan, de släckta lagren eller utsnittet ändrats.
    const key = tooLarge ? `zoom:${renderKey}` : `${renderKey}:${hidden.join(",")}:${box.minX.toFixed(1)}:${box.minY.toFixed(1)}:${box.maxX.toFixed(1)}:${box.maxY.toFixed(1)}`;
    if (asked.current !== key) {
      if (tooLarge) { asked.current = key; if (timer.current) clearTimeout(timer.current); setBusy(false); setResult({ status: "zoomIn" }); }
      else ask(box, key);
    }
    if (result?.status !== "done" || result.cells.length === 0) return;
    if (pattern.current === undefined) pattern.current = hatchPattern(ctx);
    ctx.save();
    ctx.beginPath();
    for (const cell of result.cells) for (const ring of cell.rings) ring.forEach((point, index) => {
      const at = toScreen(current, point);
      if (index === 0) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y);
      if (index === ring.length - 1) ctx.closePath();
    });
    ctx.fillStyle = TINT; ctx.fill("evenodd");
    if (pattern.current) { ctx.fillStyle = pattern.current; ctx.fill("evenodd"); }
    ctx.restore();
  }

  /** Nästa ofyllda ruta (i läsordning): kartan går dit. */
  function next() {
    if (result?.status !== "done" || result.count === 0) return;
    if (!tour.current || tour.current.at >= tour.current.cells.length - 1) tour.current = { cells: result.cells, at: -1 };
    tour.current.at += 1;
    const cell = tour.current.cells[tour.current.at];
    if (cell) focus.current(cell.at);
  }

  const state: UnfilledState = !on ? { kind: "off" } : busy || !result ? { kind: "busy" } : result.status === "zoomIn" ? { kind: "zoomIn" }
    : { kind: "done", count: result.count };
  return { on, setOn, toggle: () => setOn(value => !value), state, draw, next, result };
}

/** Röda snedstreck (skärmens pixlar). */
function hatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (typeof document === "undefined") return null;
  const tile = document.createElement("canvas");
  tile.width = 8; tile.height = 8;
  const t = tile.getContext("2d");
  if (!t) return null;
  t.strokeStyle = HATCH; t.lineWidth = 1.5;
  t.beginPath(); t.moveTo(-2, 10); t.lineTo(10, -2); t.moveTo(-2, 2); t.lineTo(2, -2); t.moveTo(6, 10); t.lineTo(10, 6); t.stroke();
  return ctx.createPattern(tile, "repeat");
}
