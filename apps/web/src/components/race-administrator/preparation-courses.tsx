"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { CourseTable } from "./course-table";
import type { CourseClassRequest } from "./types";
import type { Workspace } from "./workspace-state";

/** Banor: tabell med Redigera bana och ny bana med klass (sparas direkt). */
export function PreparationCourses({ ws }: { ws: Workspace }) {
  const { busy, courseClassAttempt, courseClassError, courseClassName, courseControls, courseName, courseStartRule,
    saveCourseClass, setCourseClassName, setCourseControls, setCourseName, setCourseStartRule, step, submitCourseClass } = ws;
  const visible = step === "COURSES";
  return <section className={styles.workflowGroup} aria-label={navigationText.steps.COURSES} hidden={!visible}>
    {visible && <CourseTable ws={ws} visible={visible} />}
    <details className={styles.courseClassPanel}>
      <summary>{text.courseClassTitle}</summary>
      <form className={styles.panel} onSubmit={saveCourseClass}>
        <p>{text.courseClassHelp}</p>
        <div className={styles.courseClassFields}>
          <label>{text.courseName}<input value={courseName} maxLength={160} disabled={busy || !!courseClassAttempt}
            onChange={event => setCourseName(event.target.value)} required /></label>
          <label>{text.courseClassName}<input value={courseClassName} maxLength={160} disabled={busy || !!courseClassAttempt}
            onChange={event => setCourseClassName(event.target.value)} required /></label>
          <label>{text.courseStartRule}<select value={courseStartRule} disabled={busy || !!courseClassAttempt}
            onChange={event => setCourseStartRule(event.target.value as CourseClassRequest["startRule"])}>
            <option value="PUNCH">{text.courseFreeStart}</option><option value="FIXED">{text.courseFixedStart}</option>
          </select></label>
        </div>
        <label>{text.courseControls}<textarea value={courseControls} maxLength={12000} disabled={busy || !!courseClassAttempt}
          aria-describedby="course-class-controls-help" onChange={event => setCourseControls(event.target.value)} required rows={2} /></label>
        <p id="course-class-controls-help">{text.courseControlsHelp}</p>
        {courseClassError && <p className={styles.warning} role="alert">{courseClassError}</p>}
        {!courseClassAttempt && <button type="submit" disabled={busy}>{text.courseClassSave}</button>}
        {courseClassAttempt && !busy && <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={() => void submitCourseClass(courseClassAttempt)}>{text.retry}</button>
        </div>}
      </form>
    </details>
  </section>;
}
