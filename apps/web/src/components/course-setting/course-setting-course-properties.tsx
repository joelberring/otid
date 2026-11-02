"use client";

import { useEffect, useState } from "react";
import type { Course, CourseSettingDocument, CourseSettingEdit, CourseSummary } from "@o-tid/course-setting";
import { coursePropertiesSv as text } from "../../i18n/course-setting-properties-sv";
import { formOf, parsePoints, propertyChanges, type PropertiesForm } from "../../lib/course-setting-properties";
import { Button } from "../ui";
import styles from "./course-setting.module.css";

/**
 * ADR-0190: banans egenskaper i fliken Banor, som Purple Pens dialog Banans egenskaper: slag (vanlig eller poängbana),
 * stigning och fast längd (tom = uträknad). Spara ger en åtgärd med bara det som ändrats.
 */
export function CourseProperties({ course, summary, readOnly, onEdits }: {
  course: Course; summary: CourseSummary | undefined; readOnly: boolean; onEdits: (edits: CourseSettingEdit[]) => void;
}) {
  const [form, setForm] = useState<PropertiesForm>(() => formOf(course));
  const [error, setError] = useState<"climb" | "length">();
  const [saved, setSaved] = useState(false);
  // Banan ändrad (av ångra, någon annan eller en annan bana vald): formuläret visar det som gäller.
  useEffect(() => { setForm(formOf(course)); setError(undefined); }, [course.id, course.kind, course.climbMeters, course.lengthOverrideMeters]);
  const variants = summary?.variants ?? [];
  const lengths = variants.map(variant => variant.lengthMeters);
  const measured = lengths.length > 0 ? text.measured(Math.min(...lengths), Math.max(...lengths)) : "–";
  const id = `course-properties-${course.id}`;
  return <form className={styles.panel} aria-labelledby={id} data-testid="course-setting-properties" onSubmit={event => {
    event.preventDefault();
    const result = propertyChanges(course, form);
    if ("error" in result) { setError(result.error); return; }
    setError(undefined);
    if (result.changes) onEdits([{ type: "UPDATE_COURSE", course: course.id, changes: result.changes }]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }}>
    <h2 id={id}>{text.heading(course.name)}</h2>
    <fieldset className={styles.row} disabled={readOnly}>
      <legend className={styles.muted}>{text.kind}</legend>
      {(["NORMAL", "SCORE"] as const).map(kind => <label key={kind} className={styles.inline}>
        <input type="radio" name={`${id}-kind`} value={kind} checked={form.kind === kind} onChange={() => setForm({ ...form, kind })} />
        {text.kinds[kind]}</label>)}
    </fieldset>
    <p className={styles.muted}>{text.kindHelp}</p>
    <div className={styles.row}>
      <label>{text.climb}<input type="text" inputMode="numeric" size={6} value={form.climb} disabled={readOnly} data-testid="course-setting-climb"
        aria-invalid={error === "climb" || undefined} onChange={event => setForm({ ...form, climb: event.target.value })} /></label>
      <label>{text.length}<input type="text" inputMode="numeric" size={7} value={form.length} disabled={readOnly} data-testid="course-setting-length"
        placeholder={measured} aria-invalid={error === "length" || undefined} onChange={event => setForm({ ...form, length: event.target.value })} /></label>
    </div>
    <p className={styles.muted}>{text.climbHelp} {text.lengthHelp(measured)}</p>
    {error && <p role="alert" className={styles.muted}>{text.invalid}</p>}
    {!readOnly && <div className={styles.row}>
      <Button type="submit" variant="secondary">{text.save}</Button>
      {saved && <span role="status" className={styles.muted}>{text.saved}</span>}
    </div>}
  </form>;
}

/** Poängfältet på en kontroll i poängbanans lista; ändringen sparas när fältet lämnas eller med Enter. */
export function PointsField({ document, course, courseControl, label, readOnly, onEdits }: {
  document: CourseSettingDocument; course: string; courseControl: string; label: string; readOnly: boolean;
  onEdits: (edits: CourseSettingEdit[]) => void;
}) {
  const current = document.courseControls[courseControl]?.points;
  const [value, setValue] = useState(current ? String(current) : "");
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setValue(current ? String(current) : ""); setInvalid(false); }, [current]);
  const commit = () => {
    const points = parsePoints(value);
    if (points === undefined) { setInvalid(true); return; }
    setInvalid(false);
    if ((points ?? undefined) !== current) onEdits([{ type: "SET_POINTS", course, courseControl, points }]);
  };
  return <input type="text" inputMode="numeric" size={3} maxLength={4} className={styles.points} value={value} disabled={readOnly}
    aria-label={text.points(label)} title={text.points(label)} aria-invalid={invalid || undefined} data-testid="course-setting-points"
    onChange={event => setValue(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />;
}
