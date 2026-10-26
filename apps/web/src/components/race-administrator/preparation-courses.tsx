"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { rogainingSv } from "../../i18n/rogaining-sv";
import { startRuleSv } from "../../i18n/start-rule-sv";
import { Button, Field, Notice } from "../ui";
import { CourseTable } from "./course-table";
import { CourseFileSection } from "./course-file-section";
import type { CourseClassRequest } from "./types";
import type { Workspace } from "./workspace-state";

/**
 * Banor: tabell med Redigera bana, "Ny bana" (sparas direkt, PLAN.md steg 24) och banfilen som andra väg.
 * I rogaining ligger kontrollerna med poäng först (RogainingPanel); banorna är där bara kontrollmängden.
 */
export function PreparationCourses({ ws }: { ws: Workspace }) {
  const visible = ws.shows("COURSES");
  return <section className={styles.workflowGroup} aria-label={navigationText.steps.COURSES} hidden={!visible}>
    {visible && <CourseTable ws={ws} visible={visible} />}
    <CourseClassForm ws={ws} />
    {visible && <CourseFileSection ws={ws} />}
  </section>;
}

/**
 * "Ny bana": banan med kontrollföljden och, om ett klassnamn fylls i, en klass som springer den (steg 55). Startsätt och
 * rogainingens tidsgräns och straff gäller klassen och visas bara då. Står kvar efter sparandet för nästa bana.
 */
export function CourseClassForm({ ws }: { ws: Workspace }) {
  const { busy, saving, courseClassAttempt, courseClassError, courseClassErrors, courseClassName, courseControls, courseForm, courseFormOpen,
    courseName, courseStartRule, coursePenalty, courseTimeLimit, profile, raceId, saveCourseClass, setCourseClassErrors, setCourseClassName,
    setCourseControls, setCourseFormOpen, setCourseName, setCourseStartRule, setCoursePenalty, setCourseTimeLimit, submitCourseClass } = ws;
  if (!courseFormOpen) return null;
  const rogaining = profile.features.rogaining;
  // Bara formuläret som sparas låses (PLAN.md steg 24); ett försök finns medan det skickas eller ska skickas om.
  const locked = !!courseClassAttempt || saving;
  const clear = (field: keyof typeof courseClassErrors) => { if (courseClassErrors[field]) setCourseClassErrors({ ...courseClassErrors, [field]: undefined }); };
  const id = `course-class-${raceId}`;
  const withClass = courseClassName.trim() !== "";
  return <form ref={courseForm} className={styles.inlineForm} aria-labelledby={`${id}-title`} noValidate onSubmit={saveCourseClass}>
    <div className={styles.inlineFormHead}>
      <h3 id={`${id}-title`}>{rogaining ? rogainingSv.newCourseTitle : text.courseClassTitle}</h3>
      <Button variant="quiet" disabled={locked} onClick={() => { setCourseFormOpen(false); setCourseClassErrors({}); }}>
        {text.courseClassClose}</Button>
    </div>
    <p className={styles.workflowHelp}>{rogaining ? rogainingSv.newCourseHelp : text.courseClassHelp}</p>
    <div className={`${styles.fieldRow} ${styles.fieldRowTop}`}>
      <Field label={text.courseName} error={courseClassErrors.courseName}><input value={courseName} maxLength={160} disabled={locked}
        autoComplete="off" onChange={event => { setCourseName(event.target.value); clear("courseName"); }} /></Field>
      <Field label={text.courseClassName} error={courseClassErrors.className}><input value={courseClassName} maxLength={160} disabled={locked}
        autoComplete="off" onChange={event => { setCourseClassName(event.target.value); clear("className"); }} /></Field>
      {withClass && profile.features.startRuleChoice && <Field label={text.courseStartRule}
        help={startRuleSv.details[courseStartRule]}><select value={courseStartRule} disabled={locked}
        onChange={event => setCourseStartRule(event.target.value as NonNullable<CourseClassRequest["startRule"]>)}>
        <option value="PUNCH">{text.courseFreeStart}</option><option value="FIXED">{text.courseFixedStart}</option>
      </select></Field>}
      {withClass && rogaining && <Field label={rogainingSv.courseTimeLimit} error={courseClassErrors.timeLimit}><input type="text" inputMode="numeric"
        value={courseTimeLimit} disabled={locked} onChange={event => { setCourseTimeLimit(event.target.value); clear("timeLimit"); }} /></Field>}
      {withClass && rogaining && <Field label={rogainingSv.coursePenalty} error={courseClassErrors.penalty}><input type="text" inputMode="numeric"
        value={coursePenalty} disabled={locked} onChange={event => { setCoursePenalty(event.target.value); clear("penalty"); }} /></Field>}
    </div>
    <Field label={text.courseControls} error={courseClassErrors.controls}
      help={rogaining ? rogainingSv.courseControlsHelp : text.courseControlsHelp}><textarea value={courseControls} maxLength={12000}
      disabled={locked} onChange={event => { setCourseControls(event.target.value); clear("controls"); }} rows={2} /></Field>
    {courseClassError && <Notice tone="error" role="alert">{courseClassError}</Notice>}
    <div className={styles.actions}>
      {!courseClassAttempt && <Button type="submit" disabled={locked}>{withClass ? text.courseClassSave : text.courseSave}</Button>}
      {courseClassAttempt && !busy && <Button onClick={() => void submitCourseClass(courseClassAttempt)}>{text.retry}</Button>}
    </div>
  </form>;
}
