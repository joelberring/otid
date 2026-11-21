"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { wheelDirection } from "./map-project-rail-tools";

/** Så långt (px) högerknappen ska dras för en snärt, och så länge (ms) den hålls still innan hjulet visas. */
export const FLICK_PX = 24;
export const WHEEL_HOLD_MS = 250;

interface Gesture { x: number; y: number; down: boolean; flicked: number | undefined; elapsed: boolean; shown: boolean; pending: (() => void) | undefined;
  timer: ReturnType<typeof setTimeout> | undefined }

/**
 * K8b V1 (ägaren 2026-11-21): snärt med högerknappen. Hålls knappen och dras mer än ~24 px åt ett håll väljs verktyget på
 * hjulets plats i den riktningen när den släpps, utan att hjulet visas; hålls den still visas hjulet efter ~250 ms (släpps den
 * då över en plats väljs den). Ett kort högerklick öppnar hjulet som förut. `gate` tar emot hjulets öppning från kartans
 * högerklick (som kommer när knappen trycks eller släpps beroende på system) och kör den, väntar med den eller släpper den.
 */
export function useMapProjectFlick(area: RefObject<HTMLElement | null>, onFlick: (slot: number) => void) {
  const gesture = useRef<Gesture | undefined>(undefined);
  /** En snärt just gjord: högerklicket som kommer efter knappen släppts (Windows) öppnar inget hjul. */
  const suppress = useRef(0);
  const latest = useRef(onFlick);
  latest.current = onFlick;
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const run = (current: Gesture) => { const open = current.pending; current.pending = undefined; if (open) { current.shown = true; open(); } };
    const onMove = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current?.down || current.shown || current.flicked !== undefined) return;
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      if (Math.hypot(dx, dy) > FLICK_PX) { current.flicked = wheelDirection(dx, dy); current.pending = undefined; clearTimeout(current.timer); }
    };
    const onUp = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current?.down || event.button !== 2) return;
      current.down = false;
      clearTimeout(current.timer);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      if (current.flicked !== undefined) { suppress.current = Date.now(); gesture.current = undefined; latest.current(current.flicked); return; }
      if (current.shown) {
        // Hjulet visades medan knappen hölls: släppt över en plats väljs den.
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>("[data-testid='map-project-wheel'] button");
        if (target && !target.disabled) target.click();
        gesture.current = undefined;
        return;
      }
      run(current);
      gesture.current = undefined;
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 2) return;
      const current: Gesture = { x: event.clientX, y: event.clientY, down: true, flicked: undefined, elapsed: false, shown: false, pending: undefined, timer: undefined };
      current.timer = setTimeout(() => { current.elapsed = true; if (current.down && current.flicked === undefined) run(current); }, WHEEL_HOLD_MS);
      gesture.current = current;
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
    };
    element.addEventListener("pointerdown", onDown, true);
    return () => {
      element.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      clearTimeout(gesture.current?.timer);
    };
  }, [area]);
  return useCallback((open: () => void) => {
    const current = gesture.current;
    if (current?.down && current.flicked === undefined) {
      if (current.elapsed) { current.shown = true; open(); } else current.pending = open;
      return;
    }
    if (current?.flicked !== undefined || Date.now() - suppress.current < 600) { suppress.current = 0; return; }
    open();
  }, []);
}
