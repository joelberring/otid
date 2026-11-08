"use client";

import type { PositionProblem } from "./use-map-project-position";
import { mapProjectNotesSv } from "../../i18n/map-project-notes-sv";
import { mapProjectReconSv } from "../../i18n/map-project-recon-sv";
import styles from "./map-project-editor.module.css";

const text = mapProjectReconSv;
const notesText = mapProjectNotesSv;
export type PositionMode = "off" | "on" | "follow";

/**
 * ADR-0219 tillägget om rekningen (K3): fältets knappar i kartans hörn, små och få så att kartan får skärmen (ägaren
 * 2026-11-08): positionen (ett tryck visar, ett andra följer, ett tredje stänger av), inspelningen av spår, punkten här och att
 * gå en linje med vald symbol. Knapparna är minst 44 px för fingrar och handskar.
 */
export function MapProjectFieldControls(props: {
  mode: PositionMode; onMode: (mode: PositionMode) => void; problem: PositionProblem | undefined;
  canRecord: boolean; recording: boolean; onRecord: () => void;
  /** K3: en notis vid positionen. */
  note?: (() => void) | undefined;
  /** Symbolen som är vald, om den kan sättas här (punkt) eller gås (linje), och om positionen finns. */
  point?: { code: string; onPlace: () => void } | undefined;
  walk?: { code: string; walking: number | undefined; onStart: () => void; onStop: () => void } | undefined;
}) {
  const { mode, onMode, problem, canRecord, recording, onRecord, point, walk, note } = props;
  const next: Record<PositionMode, PositionMode> = { off: "on", on: "follow", follow: "off" };
  return <div className={styles.fieldControls} data-testid="map-project-field">
    {problem && mode !== "off" && <p className={styles.fieldProblem} role="status">{text.problems[problem]}</p>}
    {walk && walk.walking !== undefined && <p className={styles.fieldProblem} role="status">{text.walking(walk.walking)}</p>}
    <div className={styles.fieldButtons}>
      {note && <button type="button" className={styles.fieldButton} onClick={note} data-testid="field-note-here">{notesText.here}</button>}
      {point && <button type="button" className={styles.fieldButton} onClick={point.onPlace} data-testid="field-point-here">{text.pointHere(point.code)}</button>}
      {walk && (walk.walking === undefined
        ? <button type="button" className={styles.fieldButton} onClick={walk.onStart} data-testid="field-walk">{text.walkLine(walk.code)}</button>
        : <button type="button" className={styles.fieldButton} data-active="" onClick={walk.onStop} data-testid="field-walk-stop">{text.walkStop}</button>)}
      {canRecord && <button type="button" className={styles.fieldRound} aria-pressed={recording} data-recording={recording ? "" : undefined}
        aria-label={recording ? text.stop : text.record} title={recording ? text.stop : text.record} onClick={onRecord} data-testid="field-record">
        <span aria-hidden="true">{recording ? "■" : "●"}</span></button>}
      <button type="button" className={styles.fieldRound} aria-pressed={mode !== "off"} data-mode={mode} aria-label={text.position[mode]}
        title={text.position[mode]} onClick={() => onMode(next[mode])} data-testid="field-position">
        <span aria-hidden="true">{mode === "follow" ? "◎" : "⌖"}</span></button>
    </div>
  </div>;
}
