"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Point } from "@o-tid/map-file";
import type { ObjectKey } from "@o-tid/map-revision";
import { toScreen, type Viewport } from "../../lib/course-setting-viewport";
import type { MapProjectSession } from "../../lib/map-project-protocol";
import { snapAt, snapReachMm, type SnapExtra, type SnapHit, type SnapIndex } from "../../lib/map-project-snap";

/** Pekaren: typ (mus, finger, penna), vyns skala och om Alt hölls. */
export interface SnapPointer { readonly pointerType: string; readonly pxPerMm: number; readonly alt?: boolean | undefined }
export interface SnapOptions { readonly exclude?: ObjectKey | undefined; readonly extra?: SnapExtra | undefined }

const MARK_PX = 5;
const MARK_COLOR = "#1a5fd0";

/**
 * K8b V3: Fäst på sidan. Workern bygger indexet när kartans objekt ändras (`renderKey`) och Fäst är på; frågorna går direkt
 * i pekarens händelser (`at`). Alt nedtryckt stänger av fästet tillfälligt. Markören vid fästpunkten är ihålig: fyrkant =
 * punkt, kryss = skärning, ring = på linje (`draw`).
 */
export function useMapProjectSnap(input: { session: MapProjectSession | undefined; renderKey: number; on: boolean; hidden: readonly string[];
  /** Verktyget: markören tas bort när det byts. */
  tool: string }) {
  const { session, renderKey, on, tool } = input;
  const index = useRef<SnapIndex | undefined>(undefined);
  const alt = useRef(false);
  const [mark, setMark] = useState<SnapHit>();
  const markRef = useRef<SnapHit | undefined>(undefined);
  const hidden = useMemo(() => new Set(input.hidden), [input.hidden]);
  useEffect(() => {
    if (!on || !session) { index.current = undefined; return; }
    session.snapIndex(next => { index.current = next ?? undefined; });
  }, [session, renderKey, on]);
  useEffect(() => {
    const update = (event: KeyboardEvent) => { alt.current = event.altKey; };
    const release = () => { alt.current = false; };
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", release);
    return () => { window.removeEventListener("keydown", update); window.removeEventListener("keyup", update); window.removeEventListener("blur", release); };
  }, []);
  useEffect(() => { markRef.current = undefined; setMark(undefined); }, [on, tool]);

  function show(hit: SnapHit | undefined) {
    const previous = markRef.current;
    if (previous === hit || (previous && hit && previous.kind === hit.kind && previous.at.x === hit.at.x && previous.at.y === hit.at.y)) return;
    markRef.current = hit;
    setMark(hit);
  }

  /** Fästpunkten för `point` (och markören där), eller inget när inget finns inom räckvidden eller fästet är av. */
  function hit(point: Point, pointer: SnapPointer, options: SnapOptions = {}): SnapHit | undefined {
    if (!on || pointer.alt || alt.current) { show(undefined); return undefined; }
    const found = snapAt(index.current, { point, reachMm: snapReachMm(pointer.pointerType, pointer.pxPerMm), hidden,
      exclude: options.exclude ? new Set([options.exclude]) : undefined, extra: options.extra });
    show(found);
    return found;
  }

  /** Den ihåliga markören (1,5 px med vit kontur bakom). */
  function draw(ctx: CanvasRenderingContext2D, view: Viewport) {
    const hit = markRef.current;
    if (!hit) return;
    const { x, y } = toScreen(view, hit.at), r = MARK_PX;
    ctx.save();
    ctx.beginPath();
    if (hit.kind === "vertex") ctx.rect(x - r, y - r, r * 2, r * 2);
    else if (hit.kind === "edge") ctx.arc(x, y, r, 0, Math.PI * 2);
    else { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); }
    ctx.lineWidth = 3.5; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = MARK_COLOR; ctx.stroke();
    ctx.restore();
  }

  return { hit, at: (point: Point, pointer: SnapPointer, options?: SnapOptions): Point => hit(point, pointer, options)?.at ?? point,
    clear: () => show(undefined), draw, mark };
}
