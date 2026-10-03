"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { RaceCourseOverview } from "../race-course-overview";
import type { CourseClassRequest } from "./types";
import type { Workspace } from "./workspace-state";

/** Förberedelse: banor, ny bana med klass, ny banversion och resultatpåverkan. */
export function PreparationCourses({ ws }: { ws: Workspace }) {
  const { confirmCourseClass, busy, courseClassAttempt, courseClassError, courseClassName, courseClassReview, courseControls, courseName,
    courseRelinkAttempt, courseRelinkClassId, courseRelinkConfirmed, courseRelinkControls, courseRelinkError,
    courseRelinkPreview, courseResultImpact, courseResultImpactClassId, courseResultImpactError, courseStartRule,
    data, inspectCourseClass, inspectCourseVersionRelink, loadCourseResultImpact, loadCourseVersionRelinkPreview,
    openAssignedClass, openCourseWarningClass, pending, preparationArea, raceId, selectedCourseTarget, 
    setCourseClassName, setCourseClassReview, setCourseControls, setCourseName,
    setCourseRelinkAttempt, setCourseRelinkClassId, setCourseRelinkConfirmed, setCourseRelinkControls,
    setCourseRelinkError, setCourseRelinkPreview, setCourseResultImpact, setCourseResultImpactClassId,
    setCourseResultImpactError, setCourseStartRule, submitCourseClass, submitCourseVersionRelink, workflowLocked,
    workflowMode } = ws;
  return <section className={styles.workflowGroup} aria-label={navigationText.preparation.COURSES}
      hidden={workflowMode !== "BEFORE" || preparationArea !== "COURSES"}>
    {workflowMode === "BEFORE" && preparationArea === "COURSES" && data &&
      <RaceCourseOverview raceId={raceId} classes={data.classes} disabled={workflowLocked} onOpenClass={openCourseWarningClass}
        onOpenAssignedClass={openAssignedClass}
        selectedCourseVersionId={selectedCourseTarget?.raceId === raceId && selectedCourseTarget.snapshotVersion === data.snapshotVersion
          ? selectedCourseTarget.courseVersionId : undefined} />}
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
    <details className={styles.courseClassPanel}>
      <summary>{text.courseRelinkTitle}</summary>
      <form className={styles.panel} onSubmit={inspectCourseVersionRelink}>
        <p>{text.courseRelinkHelp}</p>
        <label>{text.courseRelinkClass}<select value={courseRelinkClassId} disabled={busy || !!courseRelinkAttempt}
          onChange={event => { setCourseRelinkClassId(event.target.value); setCourseRelinkPreview(undefined); setCourseRelinkError(""); }}>
          <option value="">{text.chooseClass}</option>
          {data?.classes.map(raceClass => <option key={raceClass.id} value={raceClass.id}>{raceClass.name}</option>)}
        </select></label>
        {!courseRelinkPreview && !courseRelinkAttempt && <button type="button" disabled={busy || !courseRelinkClassId}
          onClick={() => void loadCourseVersionRelinkPreview()}>{text.courseRelinkLoad}</button>}
        {courseRelinkPreview && !courseRelinkAttempt && <>
          <div className={styles.courseRelinkSummary}>
            <p><strong>{text.courseRelinkCourse}:</strong> {courseRelinkPreview.courseName}</p>
            <p><strong>{text.raceClass}:</strong> {courseRelinkPreview.className}</p>
            <p><strong>{text.courseRelinkVersion}:</strong> {courseRelinkPreview.classCourseVersion}</p>
            <p><strong>{text.courseRelinkEntries}:</strong> {courseRelinkPreview.entryCount} · <strong>{text.courseRelinkResults}:</strong> {courseRelinkPreview.resultRevisionCount}</p>
            <p><strong>{text.courseControls}:</strong> {courseRelinkPreview.controlCodes.join(" → ")}</p>
          </div>
          {courseRelinkPreview.resultRevisionCount > 0 && <p className={styles.warning} role="alert">{text.courseRelinkBlocked}</p>}
          <label>{text.courseRelinkControls}<textarea value={courseRelinkControls} maxLength={12000} disabled={busy}
            aria-describedby="course-relink-controls-help" onChange={event => setCourseRelinkControls(event.target.value)} required rows={2} /></label>
          <p id="course-relink-controls-help">{text.courseRelinkControlsHelp}</p>
          <label className={styles.confirmPerson}><input type="checkbox" checked={courseRelinkConfirmed} disabled={busy || !courseRelinkPreview.canRelink}
            onChange={event => setCourseRelinkConfirmed(event.target.checked)} />{text.courseRelinkAcknowledge}</label>
          {courseRelinkError && <p className={styles.warning} role="alert">{courseRelinkError}</p>}
          <button type="submit" disabled={busy || !courseRelinkPreview.canRelink || !courseRelinkConfirmed}>{text.courseRelinkInspect}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { setCourseRelinkPreview(undefined); setCourseRelinkConfirmed(false); }}>{navigationText.closeCoursePreview}</button>
        </>}
        {courseRelinkAttempt && <section className={styles.review} role="alert" aria-live="polite">
          <h2>{text.courseRelinkReview}</h2>
          <p><strong>{text.raceClass}:</strong> {courseRelinkAttempt.preview.className}</p>
          <p><strong>{text.courseRelinkCourse}:</strong> {courseRelinkAttempt.preview.courseName} · {text.courseRelinkVersion} {courseRelinkAttempt.preview.classCourseVersion} → {courseRelinkAttempt.preview.classCourseVersion + 1}</p>
          <p><strong>{text.courseRelinkControls}:</strong> {courseRelinkAttempt.request.controlCodes.join(" → ")}</p>
          <p>{text.courseRelinkNotSaved}</p>
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => void submitCourseVersionRelink(courseRelinkAttempt)}>{text.courseRelinkConfirm}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; setCourseRelinkAttempt(undefined); }}>{text.courseRelinkEdit}</button>
          </div>
          {courseRelinkError && <p className={styles.warning} role="alert">{courseRelinkError}</p>}
        </section>}
      </form>
    </details>
    <details className={styles.courseClassPanel}>
      <summary>{text.courseResultImpactTitle}</summary>
      <section className={styles.panel} aria-live="polite">
        <p>{text.courseResultImpactHelp}</p>
        <label>{text.courseResultImpactClass}<select value={courseResultImpactClassId} disabled={busy}
          onChange={event => { setCourseResultImpactClassId(event.target.value); setCourseResultImpact(undefined); setCourseResultImpactError(""); }}>
          <option value="">{text.chooseClass}</option>
          {data?.classes.map(raceClass => <option key={raceClass.id} value={raceClass.id}>{raceClass.name}</option>)}
        </select></label>
        {!courseResultImpact && <button type="button" disabled={busy || !courseResultImpactClassId}
          onClick={() => void loadCourseResultImpact()}>{text.courseResultImpactLoad}</button>}
        {courseResultImpact && <>
          <div className={styles.courseRelinkSummary}>
            <p><strong>{text.courseRelinkCourse}:</strong> {courseResultImpact.course.name} · {text.courseRelinkVersion} {courseResultImpact.course.currentVersion}</p>
            <p><strong>{text.raceClass}:</strong> {courseResultImpact.className}</p>
            <p><strong>{text.courseControls}:</strong> {courseResultImpact.course.controlCodes.join(" → ")}</p>
            <p><strong>{text.courseResultImpactEntries}:</strong> {courseResultImpact.totals.entryCount} · <strong>{text.courseResultImpactEntriesWithResults}:</strong> {courseResultImpact.totals.entriesWithResults} · <strong>{text.courseResultImpactHistorical}:</strong> {courseResultImpact.totals.historicalResultRevisions}</p>
          </div>
          <p className={styles.warning}>{text.courseResultImpactNotSaved}</p>
          {courseResultImpact.entries.length === 0 ? <p>{text.courseResultImpactNoResults}</p> : <>
            <h2>{text.courseResultImpactLatest}</h2>
            <div className={styles.tableScroll}><table className={styles.table}>
              <thead><tr><th>{text.participants}</th><th>{text.courseResultImpactRevision}</th><th>{text.courseResultImpactStatus}</th><th>{text.courseResultImpactManualDecision}</th></tr></thead>
              <tbody>{courseResultImpact.entries.map(entry => <tr key={entry.entryId}>
                <td>{entry.displayName}</td>
                <td>{entry.latestResultRevision.revision} · {entry.latestResultRevision.published ? text.courseResultImpactPublished : text.courseResultImpactNotPublished}</td>
                <td>{entry.latestResultRevision.status}</td>
                <td>{entry.latestResultRevision.effectiveManualDecision}</td>
              </tr>)}</tbody>
            </table></div>
          </>}
        </>}
        {courseResultImpactError && <p className={styles.warning} role="alert">{courseResultImpactError}</p>}
      </section>
    </details>
  </section>;
}
