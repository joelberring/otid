"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { rogainingSv } from "../../i18n/rogaining-sv";
import { Button, Field, Notice } from "../ui";
import { CourseTable } from "./course-table";
import { CourseFileSection } from "./course-file-section";
import type { CourseClassRequest } from "./types";
import type { Workspace } from "./workspace-state";

/** Banor: tabell med Redigera bana, banfil (med skillnader vid ny fil) och ny bana med klass (sparas direkt). */
export function PreparationCourses({ ws }: { ws: Workspace }) {
  const { busy, courseClassAttempt, courseClassError, courseClassName, courseControls, courseName, courseStartRule, coursePenalty,
    courseTimeLimit, profile, saveCourseClass, setCourseClassName, setCourseControls, setCourseName, setCourseStartRule, setCoursePenalty,
    setCourseTimeLimit, shows, submitCourseClass } = ws;
  const rogaining = profile.features.rogaining;
  const visible = shows("COURSES");
  const locked = busy || !!courseClassAttempt;
  return <section className={styles.workflowGroup} aria-label={navigationText.steps.COURSES} hidden={!visible}>
    {visible && <CourseTable ws={ws} visible={visible} />}
    {visible && <CourseFileSection ws={ws} />}
    <details className={styles.disclosure}>
      <summary>{text.courseClassTitle}</summary>
      <form className={styles.disclosureBody} onSubmit={saveCourseClass}>
        <p className={styles.workflowHelp}>{text.courseClassHelp}</p>
        <div className={styles.fieldRow}>
          <Field label={text.courseName}><input value={courseName} maxLength={160} disabled={locked}
            onChange={event => setCourseName(event.target.value)} required /></Field>
          <Field label={text.courseClassName}><input value={courseClassName} maxLength={160} disabled={locked}
            onChange={event => setCourseClassName(event.target.value)} required /></Field>
          {profile.features.startRuleChoice && <Field label={text.courseStartRule}><select value={courseStartRule} disabled={locked}
            onChange={event => setCourseStartRule(event.target.value as CourseClassRequest["startRule"])}>
            <option value="PUNCH">{text.courseFreeStart}</option><option value="FIXED">{text.courseFixedStart}</option>
          </select></Field>}
          {rogaining && <Field label={rogainingSv.courseTimeLimit}><input type="text" inputMode="numeric" value={courseTimeLimit}
            disabled={locked} onChange={event => setCourseTimeLimit(event.target.value)} required /></Field>}
          {rogaining && <Field label={rogainingSv.coursePenalty}><input type="text" inputMode="numeric" value={coursePenalty}
            disabled={locked} onChange={event => setCoursePenalty(event.target.value)} required /></Field>}
        </div>
        <Field label={text.courseControls} help={rogaining ? rogainingSv.courseControlsHelp : text.courseControlsHelp}><textarea value={courseControls} maxLength={12000} disabled={locked}
          onChange={event => setCourseControls(event.target.value)} required rows={2} /></Field>
        {courseClassError && <Notice tone="error" role="alert">{courseClassError}</Notice>}
        <div className={styles.actions}>
          {!courseClassAttempt && <Button type="submit" disabled={busy}>{text.courseClassSave}</Button>}
          {courseClassAttempt && !busy && <Button disabled={busy} onClick={() => void submitCourseClass(courseClassAttempt)}>{text.retry}</Button>}
        </div>
      </form>
    </details>
  </section>;
}
