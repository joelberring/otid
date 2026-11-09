"use client";

import type { CourseSettingNoteKind } from "@o-tid/contracts";
import { notesEn } from "../../i18n/course-setting-notes-en";
import { useTexts } from "../language-provider";
import { notesSv } from "../../i18n/course-setting-notes-sv";
import {
  finishShape, setSketchOptions, SKETCH_COLORS, sketchFull, sketchPointCount, undoSketch, type SketchDraft, type SketchIntent, type SketchStyle
} from "../../lib/course-setting-sketch";
import { Button } from "../ui";
import styles from "./course-setting-notes.module.css";

const STYLES = ["MAP_ERROR", "MARKING", "GENERAL"] as const satisfies readonly SketchStyle[];
const INTENTS: readonly { key: "NONE" | "WRONG" | "RIGHT"; value: SketchIntent }[] = [{ key: "NONE", value: null }, { key: "WRONG", value: "WRONG" },
  { key: "RIGHT", value: "RIGHT" }];

/**
 * ADR-0181 beslut 8: ritlägets rad – färg (slag), form, betydelse, ångra, avsluta linjen, Klar och Avbryt. På telefonen
 * (`compact`) så liten som möjligt så att kartan syns: färgerna som knappar, form och betydelse som val på en rad, och
 * stora knappar för Ångra, Klar och Avbryt.
 */
export function SketchBar({ draft, kind, compact, onChange, onDone, onCancel }: { draft: SketchDraft; kind: CourseSettingNoteKind; compact: boolean;
  onChange: (next: SketchDraft) => void; onDone: () => void; onCancel: () => void }) {
  const text = useTexts(notesSv.sketch, notesEn.sketch);
  const points = sketchPointCount(draft);
  const clicking = draft.current?.input === "CLICKS";
  const intentKey = INTENTS.find(row => row.value === draft.intent)?.key ?? "NONE";
  const swatch = (style: SketchStyle) => <span aria-hidden="true" className={styles.swatch} style={{ background: SKETCH_COLORS[style] }} />;
  const colors = <div className={styles.group} role="group" aria-label={text.style}>{!compact && <span>{text.style}</span>}
    {STYLES.map(style => <Button key={style} variant="secondary" aria-pressed={draft.style === style}
      onClick={() => onChange(setSketchOptions(draft, { style }))}>{swatch(style)}{compact ? text.short[style] : text.styles[style]}</Button>)}
  </div>;
  const count = <p className={styles.help} role="status" data-testid="course-setting-sketch-count">
    {sketchFull(draft) ? text.full : text.count(draft.shapes.length + (draft.current ? 1 : 0), points)}</p>;
  const actions = <div className={styles.actions}>
    <Button variant="secondary" disabled={points === 0} onClick={() => onChange(undoSketch(draft))}>{text.undo}</Button>
    {clicking && <Button variant="secondary" onClick={() => onChange(finishShape(draft))}>{text.finishShape}</Button>}
    <Button disabled={points === 0} onClick={onDone}>{text.done}</Button>
    <Button variant="quiet" onClick={onCancel}>{text.cancel}</Button>
  </div>;
  if (compact) {
    return <section className={`${styles.sketch} ${styles.compact}`} aria-label={text.heading[kind]} data-testid="course-setting-sketch">
      <p className={styles.help}><strong>{text.heading[kind]}.</strong> {text.helpTouch}</p>
      {colors}
      <div className={styles.group}>
        <label className={styles.select}><span className={styles.srOnly}>{text.shape}</span>
          <select value={draft.shape} onChange={event => onChange(setSketchOptions(draft, { shape: event.target.value === "AREA" ? "AREA" : "LINE" }))}>
            {(["LINE", "AREA"] as const).map(shape => <option key={shape} value={shape}>{text.shapes[shape]}</option>)}
          </select></label>
        <label className={styles.select}><span className={styles.srOnly}>{text.intent}</span>
          <select value={intentKey} onChange={event => onChange(setSketchOptions(draft,
            { intent: INTENTS.find(row => row.key === event.target.value)?.value ?? null }))}>
            {INTENTS.map(intent => <option key={intent.key} value={intent.key}>{text.intents[intent.key]}</option>)}
          </select></label>
        {count}
      </div>
      {actions}
    </section>;
  }
  return <section className={styles.sketch} aria-label={text.heading[kind]} data-testid="course-setting-sketch">
    <h3>{text.heading[kind]}</h3>
    <p className={styles.help}>{text.help}</p>
    {colors}
    <div className={styles.group} role="group" aria-label={text.shape}><span>{text.shape}</span>
      {(["LINE", "AREA"] as const).map(shape => <Button key={shape} variant="secondary" aria-pressed={draft.shape === shape}
        onClick={() => onChange(setSketchOptions(draft, { shape }))}>{text.shapes[shape]}</Button>)}
    </div>
    <div className={styles.group} role="group" aria-label={text.intent}><span>{text.intent}</span>
      {INTENTS.map(intent => <Button key={intent.key} variant="secondary" aria-pressed={draft.intent === intent.value}
        onClick={() => onChange(setSketchOptions(draft, { intent: intent.value }))}>{text.intents[intent.key]}</Button>)}
    </div>
    {count}
    {actions}
  </section>;
}
