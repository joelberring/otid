"use client";

import { useEffect, useState } from "react";
import { GAP_STEPS_M } from "./use-map-project-modes";
import styles from "./map-project-bars.module.css";

/**
 * K8b V1 (ägaren 2026-11-21): statusradens brytare. Fäst (T) slås på och av (fästandet byggs i V3), Vinkel lyser medan
 * ⌘/Ctrl hålls (vinkellåset byggs i V5) och Glapp väljer hur stora glapp Magisk fyll får sluta ([ och ]).
 */
export function MapProjectModeSwitches({ snap, onSnap, snapKey, gapM, onGap, text }: {
  snap: boolean; onSnap: () => void; snapKey: string | undefined; gapM: number; onGap: (meters: number) => void;
  text: { readonly modes: string; readonly snap: string; readonly snapHelp: string; readonly angle: string; readonly angleHelp: string; readonly gap: string;
    readonly gapHelp: string; readonly gapOption: (meters: number) => string };
}) {
  const held = useCommandHeld();
  return <div className={styles.modes} role="group" aria-label={text.modes} data-testid="map-project-modes">
    <button type="button" className={styles.switch} aria-pressed={snap} title={text.snapHelp} onClick={onSnap} data-testid="map-project-snap">
      {text.snap}{snapKey && <kbd aria-hidden="true">{snapKey}</kbd>}</button>
    <span className={styles.switch} data-indicator data-held={held || undefined} title={text.angleHelp} data-testid="map-project-angle">
      {text.angle}<kbd aria-hidden="true">⌘/Ctrl</kbd></span>
    <label className={styles.gap} title={text.gapHelp}>{text.gap}
      <select value={gapM} onChange={event => onGap(Number(event.target.value))} data-testid="map-project-gap">
        {GAP_STEPS_M.map(step => <option key={step} value={step}>{text.gapOption(step)}</option>)}
      </select>
    </label>
  </div>;
}

/** ⌘ eller Ctrl hålls nere (Vinkels indikator). */
function useCommandHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const update = (event: KeyboardEvent) => setHeld(event.metaKey || event.ctrlKey);
    const release = () => setHeld(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", release);
    return () => { window.removeEventListener("keydown", update); window.removeEventListener("keyup", update); window.removeEventListener("blur", release); };
  }, []);
  return held;
}
