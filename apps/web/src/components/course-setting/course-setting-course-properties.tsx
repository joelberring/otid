"use client";

import { useEffect, useState } from "react";
import { courseSettingLevelEn } from "../../i18n/course-setting-level-en";
import { coursePropertiesEn } from "../../i18n/course-setting-course-en";
import { useTexts } from "../language-provider";
import { COURSE_LEVELS, COURSE_PRINT_SCALES, defaultScorePoints, isCourseLevel, suggestedCourseLevel, type Course, type CourseSettingDocument, type CourseSettingEdit, type CourseSummary } from "@o-tid/course-setting";
import { coursePropertiesSv } from "../../i18n/course-setting-properties-sv";
import { formOf, parsePoints, propertyChanges, type PropertiesForm } from "../../lib/course-setting-properties";
import { courseSettingLevelSv } from "../../i18n/course-setting-level-sv";
import { levelGuideArticle } from "../../i18n/help-course-setting-sv";
import { HelpLink } from "../help/help-panel";
import { Button } from "../ui";
import styles from "./course-setting.module.css";

const thousands = (value: number) => Math.round(value).toLocaleString("sv-SE").replace(/\s/g, " ");

/**
 * ADR-0190: banans egenskaper i fliken Banor, som Purple Pens dialog Banans egenskaper: slag (vanlig eller poängbana),
 * stigning och fast längd (tom = uträknad). Spara ger en åtgärd med bara det som ändrats.
 */
export function CourseProperties({ course, summary, readOnly, onEdits, mapScale }: {
  course: Course; summary: CourseSummary | undefined; readOnly: boolean; onEdits: (edits: CourseSettingEdit[]) => void;
  /** Kartans skala: förval för banans skala (ADR-0211 beslut 5). */
  mapScale: number;
}) {
  const text = useTexts(coursePropertiesSv, coursePropertiesEn);
  const [form, setForm] = useState<PropertiesForm>(() => formOf(course));
  const [error, setError] = useState<"climb" | "length">();
  const [saved, setSaved] = useState(false);
  // Banan ändrad (av ångra, någon annan eller en annan bana vald): formuläret visar det som gäller.
  useEffect(() => { setForm(formOf(course)); setError(undefined); }, [course.id, course.kind, course.climbMeters, course.lengthOverrideMeters]);
  const variants = summary?.variants ?? [];
  const lengths = variants.map(variant => variant.lengthMeters);
  // En poängbana har ingen uträknad längd (ordningen är fri): fältet visar inget i stället för "0,0 km".
  const score = course.kind === "SCORE" || form.kind === "SCORE";
  const measured = !score && lengths.length > 0 ? text.measured(Math.min(...lengths), Math.max(...lengths)) : "–";
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
        placeholder={score ? "" : measured} aria-invalid={error === "length" || undefined} onChange={event => setForm({ ...form, length: event.target.value })} /></label>
    </div>
    <p className={styles.muted}>{text.climbHelp} {score ? text.lengthHelpScore : text.lengthHelp(measured)}</p>
    {/* ADR-0211 beslut 5: skalan hör till banan och sparas direkt (som Purple Pens "Utskriftsskala" i banans egenskaper). */}
    <label className={styles.stack}>{text.scale}
      <select value={course.printScale ?? mapScale} disabled={readOnly} data-testid="course-setting-course-scale"
        onChange={event => onEdits([{ type: "UPDATE_COURSE", course: course.id, changes: { printScale: Number(event.target.value) } }])}>
        {[...new Set([mapScale, ...COURSE_PRINT_SCALES, course.printScale ?? mapScale])].sort((a, b) => b - a).map(value =>
          <option key={value} value={value}>{value === mapScale ? text.scaleMap(thousands(value)) : `1:${thousands(value)}`}</option>)}
      </select></label>
    <p className={styles.muted}>{text.scaleHelp}</p>
    <LevelField course={course} readOnly={readOnly} onEdits={onEdits} />
    {error && <p role="alert" className={styles.muted}>{text.invalid}</p>}
    {!readOnly && <div className={styles.row}>
      <Button type="submit" variant="secondary">{text.save}</Button>
      {saved && <span role="status" className={styles.muted}>{text.saved}</span>}
    </div>}
  </form>;
}

/**
 * ADR-0212: banans målnivå för nivåstödet (sparas direkt). Med klasser i undertiteln föreslås nivån ur dem (SOFT:s tabell);
 * länken går till hjälpens guide för nivån.
 */
function LevelField({ course, readOnly, onEdits }: { course: Course; readOnly: boolean; onEdits: (edits: CourseSettingEdit[]) => void }) {
  const level = useTexts(courseSettingLevelSv, courseSettingLevelEn);
  const suggested = suggestedCourseLevel(course);
  const set = (value: string) => onEdits([{ type: "UPDATE_COURSE", course: course.id, changes: { level: isCourseLevel(value) ? value : null } }]);
  return <div className={styles.stack} data-testid="course-setting-level-field">
    <label className={styles.stack}>{level.field.label}
      <select value={course.level ?? ""} disabled={readOnly} data-testid="course-setting-level-select" onChange={event => set(event.target.value)}>
        <option value="">{level.field.none}</option>
        {COURSE_LEVELS.map(value => <option key={value} value={value}>{level.levelName(value)}</option>)}
      </select></label>
    {suggested && suggested !== course.level && <p className={styles.row}>
      <span className={styles.muted}>{level.field.suggested(level.levelName(suggested))}</span>
      {!readOnly && <Button variant="quiet" onClick={() => set(suggested)}>{level.field.use}</Button>}
    </p>}
    <p className={styles.muted}>{level.field.help} <HelpLink article={levelGuideArticle(course.level)} label={level.field.guide(course.level)} /></p>
  </div>;
}

/** Poängfältet på en kontroll i poängbanans lista; ändringen sparas när fältet lämnas eller med Enter. */
export function PointsField({ document, course, courseControl, label, readOnly, onEdits }: {
  document: CourseSettingDocument; course: string; courseControl: string; label: string; readOnly: boolean;
  onEdits: (edits: CourseSettingEdit[]) => void;
}) {
  const text = useTexts(coursePropertiesSv, coursePropertiesEn);
  const current = document.courseControls[courseControl]?.points;
  // Tomt fält = förvalet (kodens tiotal, som tävlingens rogaining); det visas som platshållare.
  const fallback = defaultScorePoints(document.controls[document.courseControls[courseControl]?.control ?? ""]?.code);
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
    aria-label={text.points(label)} title={text.pointsDefault(label, fallback)} placeholder={String(fallback)} aria-invalid={invalid || undefined}
    data-testid="course-setting-points"
    onChange={event => setValue(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />;
}
