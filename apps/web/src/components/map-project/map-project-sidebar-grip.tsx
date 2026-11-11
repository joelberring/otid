"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./map-project-editor.module.css";

const KEY = "otid.mapProject.sidebarWidth";
const MIN = 240, MAX = 720, DEFAULT = 300;
const clamp = (width: number) => Math.round(Math.min(MAX, Math.max(MIN, width)));

/**
 * Ägaren 2026-11-11 («dra i högerspaltens bredd, nu syns inte all text»): ett handtag i högerspaltens vänsterkant. Bredden
 * sätts som `--sidebar-width` på arbetsytan och sparas i webbläsaren. Piltangenterna flyttar 16 px.
 */
export function MapProjectSidebarGrip({ label }: { label: string }) {
  const grip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT);
  useEffect(() => {
    try { const saved = Number(window.localStorage.getItem(KEY)); if (saved) setWidth(clamp(saved)); } catch { /* ingen lagring */ }
  }, []);
  useEffect(() => {
    grip.current?.parentElement?.style.setProperty("--sidebar-width", `${width}px`);
  }, [width]);
  const save = (next: number) => { setWidth(next); try { window.localStorage.setItem(KEY, String(next)); } catch { /* ingen lagring */ } };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    const start = event.clientX, from = width, target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (next: globalThis.PointerEvent) => setWidth(clamp(from + start - next.clientX));
    const up = (next: globalThis.PointerEvent) => {
      target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up);
      save(clamp(from + start - next.clientX));
    };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", up);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); save(clamp(width + 16)); }
    if (event.key === "ArrowRight") { event.preventDefault(); save(clamp(width - 16)); }
  };
  return <div ref={grip} className={styles.sidebarGrip} role="separator" aria-orientation="vertical" aria-label={label} tabIndex={0}
    aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={width} data-testid="map-project-sidebar-grip" onPointerDown={down} onKeyDown={key}
    onDoubleClick={() => save(DEFAULT)} />;
}
