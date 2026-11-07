"use client";

import { useEffect, useState } from "react";
import {
  courseControlIds, courseLegKeys, findPrintLayout, layoutAdjustments, MAIN_LAYOUT, type CourseSettingDocument, type CourseSettingEdit
} from "@o-tid/course-setting";
import { layoutSv as text } from "../../i18n/course-setting-layout-sv";
import { scaleText } from "../../lib/course-setting-layouts";
import { Button } from "../ui";
import styles from "./course-setting-layout.module.css";

/**
 * ADR-0217 beslut 4: "Justera för 1:7 500". Antalet justeringar, de justerade numren ("Som i banläggningen"), ringavbrotten per
 * kontroll och sträckavbrotten per sträcka i layouten, och "Ta bort justeringar". Numren dras på arket.
 */
export function AdjustPanel({ document, layout, course, scale, canEdit, save }: { document: CourseSettingDocument; layout: string; course: string;
  scale: number | undefined; canEdit: boolean; save: (edits: CourseSettingEdit[]) => Promise<boolean> }) {
  const found = findPrintLayout(document, layout);
  if (layout === MAIN_LAYOUT || course === "ALL_CONTROLS" || !found) {
    return <section className={styles.panel} data-testid="layout-adjust"><h3>{text.sheet.adjust(scale ? scaleText(scale) : "")}</h3>
      <p className={styles.muted}>{text.sheet.adjustMain}</p></section>;
  }
  const adjustments = layoutAdjustments(document, layout, course);
  const count = adjustments.numbers.length + adjustments.circleGaps.length + adjustments.legGaps.length;
  const ids = courseControlIds(document, course);
  const codeOf = (control: string) => document.controls[control]?.code ?? (document.controls[control]?.kind === "START" ? "S" : document.controls[control]?.kind === "FINISH" ? "M" : control);
  const controls = [...new Set([...ids].map(id => document.courseControls[id]!.control))].map(id => document.controls[id]!)
    .filter(control => control.kind === "NORMAL" || control.kind === "FINISH").sort((a, b) => Number(a.code ?? 999) - Number(b.code ?? 999));
  const legs = courseLegKeys(document, course);
  return <section className={styles.panel} aria-labelledby="layout-adjust" data-testid="layout-adjust" data-count={count}>
    <h3 id="layout-adjust">{text.sheet.adjust(scaleText(found.scale))}</h3>
    <p className={styles.muted}>{text.sheet.adjustHelp}</p>
    <p data-testid="layout-adjust-count">{text.sheet.adjustments(count)}</p>
    {adjustments.numbers.length > 0 && <ul className={styles.list}>{adjustments.numbers.map(cc => {
      const code = codeOf(document.courseControls[cc]!.control);
      return <li key={cc}>{text.sheet.numberLabel(code)} <Button variant="quiet" disabled={!canEdit}
        onClick={() => void save([{ type: "MOVE_NUMBER", course, courseControl: cc, at: null, printLayout: layout }])}>{text.sheet.numberReset}</Button></li>;
    })}</ul>}
    <details open={adjustments.circleGaps.length > 0 || undefined}>
      <summary>{text.sheet.gaps}</summary>
      <div className={styles.stack}>{controls.map(control => <GapRow key={control.id} label={control.code ?? control.id} testId={`layout-gaps-${control.code ?? control.id}`}
        value={found.circleGaps?.[control.id]?.map(arc => [arc.startDegrees, arc.endDegrees] as const)} disabled={!canEdit}
        onSave={pairs => void save([{ type: "SET_LAYOUT_CIRCLE_GAPS", layout, control: control.id,
          gaps: pairs && pairs.map(([startDegrees, endDegrees]) => ({ startDegrees, endDegrees })) }])} />)}</div>
    </details>
    <details open={adjustments.legGaps.length > 0 || undefined}>
      <summary>{text.sheet.legGaps}</summary>
      <div className={styles.stack}>{legs.map(key => {
        const [from, to] = key.split("-") as [string, string];
        const label = `${codeOf(from)}–${codeOf(to)}`;
        return <GapRow key={key} label={label} testId={`layout-leg-gaps-${label}`} value={found.legGaps?.[key]?.map(gap => [gap.start, gap.length] as const)}
          disabled={!canEdit} onSave={pairs => void save([{ type: "SET_LAYOUT_LEG_GAPS", layout, from, to,
            gaps: pairs && pairs.map(([start, length]) => ({ start, length })) }])} />;
      })}</div>
    </details>
    {count > 0 && <div><Button variant="secondary" disabled={!canEdit} data-testid="layout-adjust-clear"
      onClick={() => void save([{ type: "CLEAR_LAYOUT_ADJUSTMENTS", layout, course }])}>{text.sheet.clear}</Button></div>}
  </section>;
}

/** Ett fält med par "a-b, c-d" (ringavbrott i grader eller sträckavbrott start-längd i mm); tomt = inga avbrott. */
function GapRow({ label, testId, value, disabled, onSave }: { label: string; testId: string; value: readonly (readonly [number, number])[] | undefined;
  disabled: boolean; onSave: (pairs: [number, number][] | null) => void }) {
  const shown = value ? value.map(([a, b]) => `${a}-${b}`).join(", ") : "";
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const parsed = draft.trim() === "" ? [] : draft.split(",").map(part => part.trim().replace(/(\d),(\d)/g, "$1.$2").split("-").map(Number));
  const valid = parsed.every(pair => pair.length === 2 && pair.every(Number.isFinite));
  return <div className={styles.row}>
    <label className={styles.field}>{label}<input value={draft} disabled={disabled} placeholder={text.sheet.gapsFollow} data-testid={testId}
      onChange={event => setDraft(event.target.value)} /></label>
    <Button variant="secondary" disabled={disabled || !valid || draft === shown}
      onClick={() => onSave(parsed.map(([a, b]) => [a!, b!]))}>{text.sheet.gapsSave}</Button>
    {value && <Button variant="quiet" disabled={disabled} onClick={() => onSave(null)}>{text.sheet.gapsReset}</Button>}
  </div>;
}
