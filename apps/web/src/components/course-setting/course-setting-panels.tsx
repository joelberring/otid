"use client";

import { useState } from "react";
import type { CourseSettingDocument, CourseSummary } from "@o-tid/course-setting";
import type { LegAnalysis } from "@o-tid/route-choice";
import { courseSettingSv as text } from "../../i18n/course-setting-sv";
import { routeChoiceSv } from "../../i18n/route-choice-sv";
import { warningText } from "../../lib/route-choice-view";
import { ALL_CONTROLS } from "../../lib/course-setting-hit";
import type { EditorState, Tool } from "../../lib/course-setting-editor";
import { controlLabel, minutes, type CheckRow } from "../../lib/course-setting-text";
import { Button } from "../ui";
import styles from "./course-setting.module.css";

/** Steg 62: banläggningens spalt – banlistan, verktygen, det valda, kontrollerna och vald sträckas vägval. Tunna vyer. */
export function CourseList({ document, summaries, view, variant, onView, onAdd, onRename, onClasses, onRemove }: {
  document: CourseSettingDocument; summaries: readonly CourseSummary[]; view: string; variant: string | undefined;
  onView: (view: string, variant?: string) => void; onAdd: (name: string) => void; onRename: (course: string, name: string) => void;
  onClasses: (course: string, classes: string) => void; onRemove: (course: string) => void;
}) {
  const [renaming, setRenaming] = useState<string>();
  const [name, setName] = useState("");
  const [classes, setClasses] = useState("");
  const courses = [...document.courses].sort((left, right) => left.order - right.order);
  const summary = new Map(summaries.map(row => [row.course, row]));
  const selected = courses.find(course => course.id === view);
  const variants = selected ? summary.get(selected.id)?.variants ?? [] : [];
  return <section className={styles.panel} aria-labelledby="course-setting-courses">
    <h2 id="course-setting-courses">{text.courses.heading}</h2>
    <ul className={styles.courses}>
      <li><button type="button" className={styles.course} aria-pressed={view === ALL_CONTROLS} onClick={() => onView(ALL_CONTROLS)}>
        <strong>{text.courses.all}</strong><span>{text.courses.allSummary(Object.keys(document.controls).length)}</span></button></li>
      {courses.map(course => {
        const row = summary.get(course.id);
        const length = row ? text.courses.length(row.lengthRangeMeters?.min ?? row.lengthMeters, row.lengthRangeMeters?.max ?? row.lengthMeters) : "–";
        return <li key={course.id}><button type="button" className={styles.course} aria-pressed={view === course.id}
          data-testid="course-setting-course" onClick={() => onView(course.id)}>
          <strong>{course.name}</strong><span>{text.courses.summary(length, row?.controlCount ?? 0, row?.variants.length ?? 1)}</span>
        </button></li>;
      })}
    </ul>
    {selected && variants.length > 1 && <label className={styles.row}>{text.courses.variant}
      <select value={variant ?? ""} onChange={event => onView(selected.id, event.target.value || undefined)}>
        <option value="">{text.courses.allVariants}</option>
        {variants.map(row => <option key={row.code} value={row.code}>{row.code}</option>)}
      </select></label>}
    {selected && renaming !== selected.id && <div className={styles.row}>
      <Button variant="secondary" onClick={() => { setRenaming(selected.id); setName(selected.name); setClasses(selected.secondaryTitle ?? ""); }}>
        {text.courses.rename}</Button>
      <Button variant="quiet" onClick={() => { if (window.confirm(text.courses.removeConfirm(selected.name))) onRemove(selected.id); }}>
        {text.courses.remove}</Button>
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
    <form className={styles.row} onSubmit={event => {
      event.preventDefault();
      const value = (new FormData(event.currentTarget).get("name") as string | null)?.trim() || text.courses.newName(courses.length + 1);
      onAdd(value);
      event.currentTarget.reset();
    }}>
      <label>{text.courses.addName}<input type="text" name="name" maxLength={120} placeholder={text.courses.newName(courses.length + 1)} /></label>
      <Button type="submit" variant="secondary">{text.courses.add}</Button>
    </form>
  </section>;
}

const TOOLS: readonly Tool[] = ["SELECT", "ADD_CONTROL", "ADD_START", "ADD_FINISH", "ADD_CROSSING", "INSERT_EXISTING", "ADD_BEND"];

export function ToolPanel({ state, onTool, onUndo, onRedo }: { state: EditorState; onTool: (tool: Tool) => void; onUndo: () => void; onRedo: () => void }) {
  const inCourse = state.view !== ALL_CONTROLS;
  return <section className={styles.panel} aria-labelledby="course-setting-tools">
    <h2 id="course-setting-tools">{text.tools.heading}</h2>
    <div className={styles.tools} role="group" aria-label={text.tools.heading}>
      {TOOLS.map(tool => <Button key={tool} variant="secondary" aria-pressed={state.tool === tool} onClick={() => onTool(tool)}
        disabled={(tool === "INSERT_EXISTING" || tool === "ADD_BEND") && !inCourse}>{text.tools[tool]}</Button>)}
    </div>
    <p className={styles.muted}>{text.tools.help[state.tool]}</p>
    <div className={styles.row}>
      <Button variant="secondary" onClick={onUndo} disabled={state.past.length === 0}>{text.tools.undo}</Button>
      <Button variant="secondary" onClick={onRedo} disabled={state.future.length === 0}>{text.tools.redo}</Button>
    </div>
    <p className={styles.muted}>{text.tools.keys}</p>
    {state.error && <p role="alert" className={styles.muted}>{state.error}</p>}
  </section>;
}

export function SelectedPanel({ state, described, onCode, onRemoveFromCourse, onDelete, onSplit, onRemoveSplit, onResetNumber, onStraighten }: {
  state: EditorState; described?: string | undefined; onCode: (control: string, code: string) => void; onRemoveFromCourse: () => void; onDelete: () => void;
  onSplit: (kind: "FORK" | "LOOP", branches: number) => void; onRemoveSplit: () => void; onResetNumber: () => void; onStraighten: () => void;
}) {
  const [branches, setBranches] = useState(2);
  const { selection, document } = state;
  const control = selection?.kind === "control" ? document.controls[selection.control] : undefined;
  const courseControl = selection?.kind === "control" && selection.courseControl ? document.courseControls[selection.courseControl] : undefined;
  return <section className={styles.panel} aria-labelledby="course-setting-selected">
    <h2 id="course-setting-selected">{text.selected.heading}</h2>
    {!selection && <p className={styles.muted}>{text.selected.none}</p>}
    {control && <>
      <p data-testid="course-setting-selected">{text.selected.control(controlLabel(document, control.id))}</p>
      {described && <p className={styles.describe} data-testid="course-setting-described" title={text.selected.described}>{described}</p>}
      {control.kind === "NORMAL" && <form key={control.id} className={styles.row} onSubmit={event => {
        event.preventDefault();
        const code = (new FormData(event.currentTarget).get("code") as string | null)?.trim() ?? "";
        if (code && code !== control.code) onCode(control.id, code);
      }}>
        <label>{text.selected.code}<input type="text" name="code" defaultValue={control.code ?? ""} inputMode="numeric" maxLength={8} size={6} /></label>
        <Button type="submit" variant="secondary">{text.selected.saveCode}</Button>
      </form>}
      <div className={styles.row}>
        {courseControl && <Button variant="secondary" onClick={onRemoveFromCourse}>{text.tools.removeFromCourse}</Button>}
        <Button variant="quiet" onClick={onDelete}>{text.tools.deleteControl}</Button>
      </div>
      {courseControl && <div className={styles.row}>
        <label>{text.tools.branches}<select value={branches} onChange={event => setBranches(Number(event.target.value))}>
          {[2, 3, 4, 5, 6].map(count => <option key={count} value={count}>{count}</option>)}</select></label>
        <Button variant="secondary" onClick={() => onSplit("FORK", branches)}>{text.tools.fork}</Button>
        <Button variant="secondary" onClick={() => onSplit("LOOP", branches)}>{text.tools.loop}</Button>
        {courseControl.split && <Button variant="quiet" onClick={onRemoveSplit}>{text.tools.removeSplit}</Button>}
        {courseControl.numberAt && <Button variant="quiet" onClick={onResetNumber}>{text.tools.resetNumber}</Button>}
      </div>}
    </>}
    {selection?.kind === "leg" && <>
      <p data-testid="course-setting-selected">{text.selected.leg(controlLabel(document, selection.from), controlLabel(document, selection.to))}</p>
      {(document.legs[`${selection.from}-${selection.to}`]?.bends.length ?? 0) > 0 &&
        <div className={styles.row}><Button variant="secondary" onClick={onStraighten}>{text.tools.straighten}</Button></div>}
    </>}
  </section>;
}

export function ChecksPanel({ rows, onShow }: { rows: readonly CheckRow[]; onShow: (row: CheckRow) => void }) {
  return <section className={styles.panel} aria-labelledby="course-setting-checks">
    <h2 id="course-setting-checks">{text.checks.heading}</h2>
    {rows.length === 0 ? <p className={styles.muted}>{text.checks.none}</p> : <ul className={styles.checks}>
      {rows.slice(0, 100).map(row => <li key={row.key}><button type="button" title={text.checks.show} onClick={() => onShow(row)}>{row.text}</button></li>)}
    </ul>}
  </section>;
}

export function LegPanel({ legKey, analysis, status }: { legKey: string | undefined; analysis: LegAnalysis | undefined;
  status: "idle" | "waiting" | "analysing" | "failed" | "done" }) {
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
      {analysis.best && <p>{text.leg.choices(1 + analysis.alternatives.length)}</p>}
      {analysis.warnings.length > 0 && <ul className={styles.warnings}>
        {analysis.warnings.map((warning, index) => <li key={index}>{warningText(legKey, warning)}</li>)}</ul>}
      <p className={styles.muted}>{text.leg.legend}</p>
    </div>}
  </section>;
}
