"use client";

import type { CourseSettingNoteKind } from "@o-tid/contracts";
import { notesSv } from "../../i18n/course-setting-notes-sv";
import {
  finishShape, setSketchOptions, SKETCH_COLORS, sketchFull, sketchPointCount, undoSketch, type SketchDraft, type SketchIntent, type SketchStyle
} from "../../lib/course-setting-sketch";
import { Button } from "../ui";
import styles from "./course-setting-notes.module.css";

const text = notesSv.sketch;
const INTENTS: readonly { key: "NONE" | "WRONG" | "RIGHT"; value: SketchIntent }[] = [{ key: "NONE", value: null }, { key: "WRONG", value: "WRONG" },
  { key: "RIGHT", value: "RIGHT" }];

/**
 * ADR-0181 beslut 8: ritlägets rad – färg (slag), form, betydelse, ångra, avsluta linjen, Klar och Avbryt. På telefonen
 * (`compact`) stora knappar och en kort hjälptext; kartan ovanför ritas med ett finger.
 */
export function SketchBar({ draft, kind, compact, onChange, onDone, onCancel }: { draft: SketchDraft; kind: CourseSettingNoteKind; compact: boolean;
  onChange: (next: SketchDraft) => void; onDone: () => void; onCancel: () => void }) {
  const points = sketchPointCount(draft);
  const clicking = draft.current?.input === "CLICKS";
  return <section className={`${styles.sketch} ${compact ? styles.compact : ""}`} aria-label={text.heading[kind]} data-testid="course-setting-sketch">
    <h3>{text.heading[kind]}</h3>
    <p className={styles.help}>{compact ? text.helpTouch : text.help}</p>
    <div className={styles.group} role="group" aria-label={text.style}><span>{text.style}</span>
      {(["MAP_ERROR", "MARKING", "GENERAL"] as const satisfies readonly SketchStyle[]).map(style => <Button key={style} variant="secondary"
        aria-pressed={draft.style === style} onClick={() => onChange(setSketchOptions(draft, { style }))}>
        <span aria-hidden="true" className={styles.swatch} style={{ background: SKETCH_COLORS[style] }} />{text.styles[style]}</Button>)}
    </div>
    <div className={styles.group} role="group" aria-label={text.shape}><span>{text.shape}</span>
      {(["LINE", "AREA"] as const).map(shape => <Button key={shape} variant="secondary" aria-pressed={draft.shape === shape}
        onClick={() => onChange(setSketchOptions(draft, { shape }))}>{text.shapes[shape]}</Button>)}
    </div>
    <div className={styles.group} role="group" aria-label={text.intent}><span>{text.intent}</span>
      {INTENTS.map(intent => <Button key={intent.key} variant="secondary" aria-pressed={draft.intent === intent.value}
        onClick={() => onChange(setSketchOptions(draft, { intent: intent.value }))}>{text.intents[intent.key]}</Button>)}
    </div>
    <p className={styles.help} role="status" data-testid="course-setting-sketch-count">
      {sketchFull(draft) ? text.full : text.count(draft.shapes.length + (draft.current ? 1 : 0), points)}</p>
    <div className={styles.actions}>
      <Button variant="secondary" disabled={points === 0} onClick={() => onChange(undoSketch(draft))}>{text.undo}</Button>
      {clicking && <Button variant="secondary" onClick={() => onChange(finishShape(draft))}>{text.finishShape}</Button>}
      <Button disabled={points === 0} onClick={onDone}>{text.done}</Button>
      <Button variant="quiet" onClick={onCancel}>{text.cancel}</Button>
    </div>
  </section>;
}
