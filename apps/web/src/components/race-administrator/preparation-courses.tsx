"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { CourseTable } from "./course-table";
import type { CourseClassRequest } from "./types";
import type { Workspace } from "./workspace-state";

/** Förberedelse: banor som tabell med Redigera bana, och ny bana med klass. */
export function PreparationCourses({ ws }: { ws: Workspace }) {
  const { confirmCourseClass, busy, courseClassAttempt, courseClassError, courseClassName, courseClassReview, courseControls,
    courseName, courseStartRule, inspectCourseClass, preparationArea, setCourseClassName, setCourseClassReview,
    setCourseControls, setCourseName, setCourseStartRule, submitCourseClass, workflowMode } = ws;
  const visible = workflowMode === "BEFORE" && preparationArea === "COURSES";
  return <section className={styles.workflowGroup} aria-label={navigationText.preparation.COURSES} hidden={!visible}>
    {visible && <CourseTable ws={ws} visible={visible} />}
    <details className={styles.courseClassPanel}>
      <summary>{text.courseClassTitle}</summary>
      <form className={styles.panel} onSubmit={inspectCourseClass}>
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
        {!courseClassReview && !courseClassAttempt && <button type="submit" disabled={busy}>{text.courseClassInspect}</button>}
        {courseClassReview && !courseClassAttempt && <section className={styles.review} role="alert" aria-live="polite">
          <h2>{text.courseClassReview}</h2>
          <p><strong>{text.courseName}:</strong> {courseClassReview.courseName}</p>
          <p><strong>{text.courseClassName}:</strong> {courseClassReview.className}</p>
          <p><strong>{text.courseControls}:</strong> {courseClassReview.controlCodes.join(" → ")}</p>
          <p><strong>{text.courseStartRule}:</strong> {courseClassReview.startRule === "PUNCH" ? text.courseFreeStart : text.courseFixedStart}</p>
          {courseClassReview.startRule === "FIXED" && <p>{text.courseFixedStartHelp}</p>}
          <p>{text.courseClassNotSaved}</p>
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => confirmCourseClass(courseClassReview)}>{text.courseClassConfirm}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setCourseClassReview(undefined)}>{text.courseClassEdit}</button>
          </div>
        </section>}
        {courseClassAttempt && <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={() => void submitCourseClass(courseClassAttempt)}>{text.courseClassConfirm}</button>
        </div>}
      </form>
    </details>
  </section>;
}
