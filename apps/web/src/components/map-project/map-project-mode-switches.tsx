"use client";

import { GAP_STEPS_M } from "./use-map-project-modes";
import type { UnfilledState } from "./use-map-project-unfilled";
import styles from "./map-project-bars.module.css";

/**
 * K8b V1 (ägaren 2026-11-21): statusradens brytare. Fäst (T) slås på och av (med vad det fäster mot just nu, V3), Vinkel lyser när
 * vinkellåset används (håll ⌘/Ctrl, V5) och Glapp väljer hur stora glapp Magisk fyll får sluta ([ och ]). V5: räknaren för Visa
 * ofyllda rutor (ett klick går till nästa ruta).
 */
export function MapProjectModeSwitches({ snap, onSnap, snapKey, snapState, angle, unfilled, gapM, onGap, text }: {
  snap: boolean; onSnap: () => void; snapKey: string | undefined; snapState?: string | undefined; angle: boolean;
  unfilled?: { readonly state: UnfilledState; readonly onNext: () => void } | undefined; gapM: number; onGap: (meters: number) => void;
  text: { readonly modes: string; readonly snap: string; readonly snapHelp: string; readonly angle: string; readonly angleHelp: string; readonly gap: string;
    readonly gapHelp: string; readonly gapOption: (meters: number) => string; readonly unfilledCount: (count: number) => string; readonly unfilledBusy: string;
    readonly unfilledZoom: string; readonly unfilledNext: string };
}) {
  const shown = unfilled?.state.kind === "done" ? unfilled.state : undefined;
  return <div className={styles.modes} role="group" aria-label={text.modes} data-testid="map-project-modes">
    <button type="button" className={styles.switch} aria-pressed={snap} title={text.snapHelp} onClick={onSnap} data-testid="map-project-snap">
      {text.snap}{snapKey && <kbd aria-hidden="true">{snapKey}</kbd>}</button>
    {snapState && <span className={styles.snapState} data-testid="map-project-snap-state">{snapState}</span>}
    <span className={styles.switch} data-indicator data-held={angle || undefined} title={text.angleHelp} data-testid="map-project-angle">
      {text.angle}<kbd aria-hidden="true">⌘/Ctrl</kbd></span>
    {unfilled && unfilled.state.kind !== "off" && <button type="button" className={styles.switch} disabled={!shown?.count} title={text.unfilledNext}
      onClick={unfilled.onNext} data-testid="map-project-unfilled-count">
      {shown ? text.unfilledCount(shown.count) : unfilled.state.kind === "zoomIn" ? text.unfilledZoom : text.unfilledBusy}</button>}
    <label className={styles.gap} title={text.gapHelp}>{text.gap}
      <select value={gapM} onChange={event => onGap(Number(event.target.value))} data-testid="map-project-gap">
        {GAP_STEPS_M.map(step => <option key={step} value={step}>{text.gapOption(step)}</option>)}
      </select>
    </label>
  </div>;
}

