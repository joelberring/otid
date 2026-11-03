"use client";

import { useState, type ReactNode } from "react";
import type { CourseSettingDocument, CourseSummary } from "@o-tid/course-setting";
import type { LegAnalysis } from "@o-tid/route-choice";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { courseSettingUxSv as ux } from "../../i18n/course-setting-ux-sv";
import { coursePropertiesSv as props } from "../../i18n/course-setting-properties-sv";
import { routeChoiceSv } from "../../i18n/route-choice-sv";
import { warningText } from "../../lib/route-choice-view";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import type { EditorState } from "../../lib/course-setting-editor";
import { controlLabel, minutes } from "../../lib/course-setting-text";
import { Button } from "../ui";
import styles from "./course-setting.module.css";

/** Steg 62: banläggningens spalt – banlistan, verktygen, det valda, kontrollerna och vald sträckas vägval. Tunna vyer. */
export function CourseList({ document, summaries, view, readOnly = false, onView, onAdd, onRename, onClasses, onRemove, onDuplicate, onMove }: {
  document: CourseSettingDocument; summaries: readonly CourseSummary[]; view: string; readOnly?: boolean;
  onView: (view: string, variant?: string) => void; onAdd: (name: string) => void; onRename: (course: string, name: string) => void;
  onClasses: (course: string, classes: string) => void;
  /** ADR-0180 beslut 14: borttagningen frågar om kontrollerna som blir oanvända; kopian heter "<namn> (kopia)". */
  onRemove: (course: string) => void; onDuplicate: (course: string) => void;
  /** ADR-0190: flytta banan till plats `position` (1 = först) i listan. */
  onMove: (course: string, position: number) => void;
}) {
  const [renaming, setRenaming] = useState<string>();
  const [dragging, setDragging] = useState<string>();
  const [dropAt, setDropAt] = useState<number>();
  const [name, setName] = useState("");
  const [classes, setClasses] = useState("");
  const courses = [...document.courses].sort((left, right) => left.order - right.order);
  const summary = new Map(summaries.map(row => [row.course, row]));
  const selected = courses.find(course => course.id === view);
  return <section className={styles.panel} aria-labelledby="course-setting-courses">
    <h2 id="course-setting-courses">{text.courses.heading}</h2>
    <ul className={styles.courses}>
      <li><button type="button" className={styles.course} aria-pressed={view === ALL_CONTROLS} onClick={() => onView(ALL_CONTROLS)}>
        <strong>{text.courses.all}</strong><span>{text.courses.allSummary(Object.keys(document.controls).length)}</span></button></li>
      {courses.map((course, index) => {
        const row = summary.get(course.id);
        // En poängbana utan fast längd har ingen längd att visa (inte "0,0 km").
        const length = course.kind === "SCORE" && course.lengthOverrideMeters === undefined ? "–" : row ? text.courses.length(row.lengthRangeMeters?.min ?? row.lengthMeters, row.lengthRangeMeters?.max ?? row.lengthMeters) : "–";
        // Dra en bana till en annan plats (datorn); upp och ned för vald bana (tangentbord och telefon).
        return <li key={course.id} className={styles.courseRow} draggable={!readOnly} data-dragging={dragging === course.id || undefined}
          data-drop={dragging !== undefined && dropAt === index + 1 && dragging !== course.id || undefined}
          onDragStart={event => { setDragging(course.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", course.name); }}
          onDragOver={event => { if (dragging === undefined) return; event.preventDefault(); setDropAt(index + 1); }}
          onDrop={event => {
            event.preventDefault();
            const from = courses.findIndex(item => item.id === dragging);
            if (dragging !== undefined && from >= 0) onMove(dragging, from < index ? index : index + 1);
            setDragging(undefined); setDropAt(undefined);
          }}
          onDragEnd={() => { setDragging(undefined); setDropAt(undefined); }}>
          <button type="button" className={styles.course} aria-pressed={view === course.id}
            data-testid="course-setting-course" onClick={() => onView(course.id)}>
            <strong>{course.name}</strong><span>{text.courses.summary(length, row?.controlCount ?? 0, row?.variants.length ?? 1)}
              {course.kind === "SCORE" ? ` · ${props.kinds.SCORE.toLowerCase()}` : ""}</span>
          </button>
          {!readOnly && view === course.id && <span className={styles.orderButtons}>
            <Button variant="quiet" disabled={index === 0} aria-label={props.order.upLabel(course.name)} title={props.order.up}
              onClick={() => onMove(course.id, index)}>↑</Button>
            <Button variant="quiet" disabled={index === courses.length - 1} aria-label={props.order.downLabel(course.name)} title={props.order.down}
              onClick={() => onMove(course.id, index + 2)}>↓</Button>
          </span>}
        </li>;
      })}
    </ul>
    {!readOnly && courses.length > 1 && <p className={styles.muted}>{props.order.drag}</p>}
    {selected && !readOnly && renaming !== selected.id && <div className={styles.row}>
      <Button variant="secondary" onClick={() => { setRenaming(selected.id); setName(selected.name); setClasses(selected.secondaryTitle ?? ""); }}>
        {text.courses.rename}</Button>
      <Button variant="secondary" onClick={() => onDuplicate(selected.id)}>{ux.courses.duplicate}</Button>
      <Button variant="quiet" onClick={() => onRemove(selected.id)}>{text.courses.remove}</Button>
    </div>}
    {selected && renaming === selected.id && <form className={styles.row} onSubmit={event => {
      event.preventDefault();
      if (name.trim() && name.trim() !== selected.name) onRename(selected.id, name.trim());
      if (classes.trim() !== (selected.secondaryTitle ?? "")) onClasses(selected.id, classes.trim());
      setRenaming(undefined);
    }}>
      <label>{text.courses.renameLabel(selected.name)}<input type="text" value={name} onChange={event => setName(event.target.value)} maxLength={120} /></label>
      <label>{text.courses.classes}<input type="text" value={classes} onChange={event => setClasses(event.target.value)} maxLength={200} /></label>
      <Button type="submit">{text.courses.save}</Button>
      <Button variant="quiet" onClick={() => setRenaming(undefined)}>{text.courses.cancel}</Button>
    </form>}
    {!readOnly && <form className={styles.row} onSubmit={event => {
      event.preventDefault();
      const value = (new FormData(event.currentTarget).get("name") as string | null)?.trim() || text.courses.newName(courses.length + 1);
      onAdd(value);
      event.currentTarget.reset();
    }}>
      <label>{text.courses.addName}<input type="text" name="name" maxLength={120} placeholder={text.courses.newName(courses.length + 1)} /></label>
      <Button type="submit" variant="secondary">{text.courses.add}</Button>
    </form>}
  </section>;
}

/** Steg 66: vald kontroll eller sträcka i en liten ruta på kartan, med de vanligaste åtgärderna. */
export function SelectionCard({ state, described, readOnly, onCode, onRemoveFromCourse, onDelete, onDescription, onMore, onClose, extra }: {
  state: EditorState; described?: string | undefined; readOnly: boolean; onCode: (control: string, code: string) => void;
  onRemoveFromCourse: () => void; onDelete: () => void; onDescription: () => void; onMore: () => void; onClose: () => void;
  /** ADR-0180 beslut 14: passagens vinkel. */
  extra?: ReactNode;
}) {
  const { selection, document } = state;
  if (!selection || selection.kind === "special") return null;
  const control = selection.kind === "control" ? document.controls[selection.control] : undefined;
  const inCourse = selection.kind === "control" && selection.courseControl !== undefined && state.view !== ALL_CONTROLS;
  return <section className={styles.card} aria-label={text.selected.heading} data-testid="course-setting-card">
    <div className={styles.cardHead}>
      <strong data-testid="course-setting-selected">{control ? text.selected.control(controlLabel(document, control.id))
        : selection.kind === "leg" ? text.selected.leg(controlLabel(document, selection.from), controlLabel(document, selection.to)) : ""}</strong>
      <Button variant="quiet" aria-label={text.selected.deselect} title={text.selected.deselect} onClick={onClose}>×</Button>
    </div>
    {described && <p className={styles.describe} data-testid="course-setting-described" title={text.selected.described}>{described}</p>}
    {control && <div className={styles.row}>
      {control.kind === "NORMAL" && !readOnly && <form key={control.id} className={styles.row} onSubmit={event => {
        event.preventDefault();
        const code = (new FormData(event.currentTarget).get("code") as string | null)?.trim() ?? "";
        if (code && code !== control.code) onCode(control.id, code);
      }}>
        <label className={styles.inline}>{text.selected.code}<input type="text" name="code" defaultValue={control.code ?? ""} inputMode="numeric"
          maxLength={8} size={4} /></label>
        <Button type="submit" variant="secondary">{text.selected.saveCode}</Button>
      </form>}
      {inCourse && !readOnly && <Button variant="secondary" onClick={onRemoveFromCourse}>{text.tools.removeFromCourse}</Button>}
      {!readOnly && <Button variant="quiet" onClick={onDelete}>{text.tools.deleteControl}</Button>}
      <Button variant="quiet" onClick={onDescription}>{text.selected.description}</Button>
      <Button variant="quiet" onClick={onMore}>{text.selected.more}</Button>
    </div>}
    {extra}
    {selection.kind === "leg" && <div className={styles.row}><Button variant="quiet" onClick={onMore}>{text.selected.more}</Button></div>}
  </section>;
}

export function SelectedPanel({ state, described, readOnly = false, onCode, onRemoveFromCourse, onDelete, onSplit, onRemoveSplit, onResetNumber,
  onStraighten, extra }: {
  state: EditorState; described?: string | undefined; readOnly?: boolean; onCode: (control: string, code: string) => void; onRemoveFromCourse: () => void; onDelete: () => void;
  onSplit: (kind: "FORK" | "LOOP", branches: number) => void; onRemoveSplit: () => void; onResetNumber: () => void; onStraighten: () => void;
  /** ADR-0180 beslut 14: vinkeln för en passage. */
  extra?: ReactNode;
}) {
  const [branches, setBranches] = useState(2);
  const { selection, document } = state;
  const control = selection?.kind === "control" ? document.controls[selection.control] : undefined;
  const courseControl = selection?.kind === "control" && selection.courseControl ? document.courseControls[selection.courseControl] : undefined;
  return <section className={styles.panel} aria-labelledby="course-setting-selected">
    <h2 id="course-setting-selected">{text.selected.heading}</h2>
    {!selection && <p className={styles.muted}>{text.selected.none}</p>}
    {control && <>
      <p>{text.selected.control(controlLabel(document, control.id))}</p>
      {described && <p className={styles.describe} title={text.selected.described}>{described}</p>}
      {control.kind === "NORMAL" && !readOnly && <form key={control.id} className={styles.row} onSubmit={event => {
        event.preventDefault();
        const code = (new FormData(event.currentTarget).get("code") as string | null)?.trim() ?? "";
        if (code && code !== control.code) onCode(control.id, code);
      }}>
        <label>{text.selected.code}<input type="text" name="code" defaultValue={control.code ?? ""} inputMode="numeric" maxLength={8} size={6} /></label>
        <Button type="submit" variant="secondary">{text.selected.saveCode}</Button>
      </form>}
      {extra}
      {!readOnly && <div className={styles.row}>
        {courseControl && <Button variant="secondary" onClick={onRemoveFromCourse}>{text.tools.removeFromCourse}</Button>}
        <Button variant="quiet" onClick={onDelete}>{text.tools.deleteControl}</Button>
      </div>}
      {courseControl && !readOnly && <div className={styles.row}>
        <label>{text.tools.branches}<select value={branches} onChange={event => setBranches(Number(event.target.value))}>
          {[2, 3, 4, 5, 6].map(count => <option key={count} value={count}>{count}</option>)}</select></label>
        <Button variant="secondary" onClick={() => onSplit("FORK", branches)}>{text.tools.fork}</Button>
        <Button variant="secondary" onClick={() => onSplit("LOOP", branches)}>{text.tools.loop}</Button>
        {courseControl.split && <Button variant="quiet" onClick={onRemoveSplit}>{text.tools.removeSplit}</Button>}
        {courseControl.numberAt && <Button variant="quiet" onClick={onResetNumber}>{text.tools.resetNumber}</Button>}
      </div>}
    </>}
    {selection?.kind === "leg" && <>
      <p>{text.selected.leg(controlLabel(document, selection.from), controlLabel(document, selection.to))}</p>
      {!readOnly && (document.legs[`${selection.from}-${selection.to}`]?.bends.length ?? 0) > 0 &&
        <div className={styles.row}><Button variant="secondary" onClick={onStraighten}>{text.tools.straighten}</Button></div>}
    </>}
  </section>;
}

/**
 * Vald sträckas vägval. Steg 66 (ägaren): bästa vägen och alternativen i en lista (längd, stigning, tid relativt bästa,
 * t.ex. "+8 %"); ett klick på en rad markerar linjen på kartan.
 */
export function LegPanel({ legKey, analysis, status, highlighted, onHighlight, notice }: { legKey: string | undefined; analysis: LegAnalysis | undefined;
  status: "idle" | "waiting" | "analysing" | "failed" | "done"; highlighted?: number | undefined; onHighlight?: (index: number | undefined) => void;
  /** ADR-0199: fågelvägen korsar ett förbjudet område (vägvalet går runt, eller ingen laglig väg). */
  notice?: string | undefined }) {
  const rows = analysis?.best ? [{ ...analysis.best, timeRatio: 1 }, ...analysis.alternatives] : [];
  return <section className={styles.panel} aria-labelledby="course-setting-leg" data-testid="course-setting-leg">
    <h2 id="course-setting-leg">{text.leg.heading}</h2>
    {!legKey && <p className={styles.muted}>{text.leg.help}</p>}
    {legKey && status === "waiting" && <p className={styles.muted}>{text.leg.waitingForMap}</p>}
    {legKey && status === "analysing" && <p role="status" className={styles.muted}>{text.leg.analysing}</p>}
    {legKey && status === "failed" && <p role="alert" className={styles.muted}>{text.leg.failed}</p>}
    {legKey && analysis && status === "done" && <div role="status">
      <p className={styles.verdict} data-verdict={analysis.verdict}>{routeChoiceSv.verdicts[analysis.verdict]}</p>
      <p>{text.leg.straight(analysis.straightMeters)}</p>
      {analysis.best ? <p>{text.leg.best(analysis.best.meters, analysis.best.climbMeters, minutes(analysis.best.seconds))}</p> : <p>{text.leg.noRoute}</p>}
      {notice && <p className={styles.muted} data-testid="course-setting-leg-forbidden">{notice}</p>}
      {analysis.best && <p>{text.leg.choices(1 + analysis.alternatives.length)}</p>}
      {rows.length > 1 && <ol className={styles.routes} aria-label={text.leg.routes}>
        {rows.map((row, index) => <li key={index}><button type="button" aria-pressed={highlighted === index}
          onClick={() => onHighlight?.(highlighted === index ? undefined : index)}>
          <strong>{index === 0 ? text.leg.bestRow : text.leg.alternative(index)}</strong>
          <span>{text.leg.row(row.meters, row.climbMeters, minutes(row.seconds))}</span>
          <span>{index === 0 ? "" : text.leg.slower(row.timeRatio)}</span>
        </button></li>)}
      </ol>}
      {analysis.warnings.length > 0 && <ul className={styles.warnings}>
        {analysis.warnings.map((warning, index) => <li key={index}>{warningText(legKey, warning)}</li>)}</ul>}
      <p className={styles.muted}>{text.leg.legend}</p>
    </div>}
  </section>;
}
