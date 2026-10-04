"use client";

import { useEffect } from "react";
import styles from "../race-administrator-workspace.module.css";
import type { CourseEditListResponse } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { courseVariantsSv as variantText } from "../../i18n/course-variants-sv";
import type { Workspace } from "./workspace-state";

type CourseRow = CourseEditListResponse["courses"][number];

/** Banor som tabell med "Redigera bana" i raden (ADR-0169 beslut 4). */
export function CourseTable({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { authenticated, busy, courseEditSaved, courseList, courseListError, data, editingCourseId, loadCourses, openAssignedClass, pending, raceId,
    startCourseEdit, workflowLocked } = ws;
  const stale = !courseList || (data !== undefined && courseList.snapshotVersion < data.snapshotVersion);
  useEffect(() => {
    if (visible && authenticated && data && !busy && !pending.current && stale && !courseListError) void loadCourses();
  }, [visible, authenticated, data, busy, stale, courseListError]);
  return <section className={styles.panel} aria-labelledby={`course-table-${raceId}`}>
    <h2 id={`course-table-${raceId}`}>{text.courseEditTitle}</h2>
    <p className={styles.workflowHelp}>{text.courseEditHelp}</p>
    {courseEditSaved && <p role="status" className={styles.courseEditSaved}>{courseEditSaved}</p>}
    {courseListError && <div className={styles.warning} role="alert"><p>{courseListError}</p>
      <button type="button" className="secondary" disabled={busy} onClick={() => void loadCourses()}>{text.courseEditRetryList}</button></div>}
    {!courseList && !courseListError && <p role="status">{text.courseEditLoading}</p>}
    {courseList && courseList.courses.length === 0 && <p>{text.courseEditNoCourses}</p>}
    {courseList && courseList.courses.length > 0 && <div className={styles.courseTableScroll}><table className={styles.courseTable}>
      <thead><tr>
        <th scope="col">{text.courseEditCourse}</th><th scope="col">{text.courseEditControlsColumn}</th>
        <th scope="col">{text.courseEditClasses}</th><th scope="col">{text.courseEditEntries}</th>
        <th scope="col">{text.courseEditReadOut}</th><th scope="col"><span className={styles.visuallyHidden}>{text.courseEditAction}</span></th>
      </tr></thead>
      <tbody>{courseList.courses.map(course => {
        const editing = course.courseId === editingCourseId;
        const forked = course.variants.length > 0;
        return [<tr key={course.courseId}>
          <th scope="row">{course.name}</th>
          <td className={styles.courseTableControls}>{forked ? <CourseVariants ws={ws} course={course} /> : course.controlCodes.join(" ")}</td>
          <td>{course.classes.length === 0 ? text.courseEditNoClasses : course.classes.map(raceClass =>
            <button key={raceClass.classId} type="button" className={styles.courseClassLink} disabled={workflowLocked}
              onClick={() => openAssignedClass(raceClass.classId)}>{raceClass.name}</button>)}</td>
          <td>{course.entryCount}</td>
          <td>{course.readOutCount}</td>
          <td>{!editing && !forked && <button type="button" className="secondary" aria-label={text.courseEditOpenLabel(course.name)}
            disabled={busy || !!editingCourseId || !!pending.current} onClick={() => startCourseEdit(course.courseId)}>{text.courseEditOpen}</button>}</td>
        </tr>, editing && <tr key={`${course.courseId}-editor`} className={styles.courseEditorRow}>
          <td colSpan={6}><CourseEditor ws={ws} courseName={course.name} /></td>
        </tr>];
      })}</tbody>
    </table></div>}
  </section>;
}

/** Gafflad bana: antal varianter, gafflingskontrollen och varje variant med kontroller och "Redigera". */
function CourseVariants({ ws, course }: { ws: Workspace; course: CourseRow }) {
  const { busy, editingCourseId, pending, startCourseEdit } = ws;
  return <div className={styles.courseVariants}>
    <strong>{variantText.forked(course.variants.length)}</strong>
    {course.unevenLegs.length > 0 && <p className={styles.warning} role="status">⚠ {variantText.unevenLegs(course.unevenLegs)}</p>}
    <details>
      <summary>{variantText.showVariants(course.variants.length)}</summary>
      <table className={styles.courseVariantTable}>
        <thead><tr><th scope="col">{variantText.variant}</th><th scope="col">{variantText.variantControls}</th>
          <th scope="col">{variantText.variantRunners}</th><th scope="col">{variantText.variantReadOut}</th>
          <th scope="col"><span className={styles.visuallyHidden}>{text.courseEditAction}</span></th></tr></thead>
        <tbody>{course.variants.map(variant => <tr key={variant.code}>
          <th scope="row">{variant.code}</th><td>{variant.controlCodes.join(" ")}</td>
          <td>{variant.entryCount}</td><td>{variant.readOutCount}</td>
          <td><button type="button" className="secondary" aria-label={variantText.editVariantLabel(course.name, variant.code)}
            disabled={busy || !!editingCourseId || !!pending.current}
            onClick={() => startCourseEdit(course.courseId, variant.code)}>{variantText.editVariant}</button></td>
        </tr>)}</tbody>
      </table>
    </details>
  </div>;
}

function CourseEditor({ ws, courseName }: { ws: Workspace; courseName: string }) {
  const { busy, cancelCourseEdit, changeCourseEditControls, courseEditAttempt, courseEditControls, courseEditError,
    courseEditPreview, editingVariantCode, previewCourseEdit, raceId, saveCourseEdit } = ws;
  const inputId = `course-edit-controls-${raceId}`;
  const label = editingVariantCode ? variantText.editVariantLabel(courseName, editingVariantCode) : text.courseEditOpenLabel(courseName);
  return <form className={styles.courseEditor} aria-label={label}
    onSubmit={event => { event.preventDefault(); void saveCourseEdit(); }}>
    {editingVariantCode && <h3>{courseName} · {variantText.editingVariant(editingVariantCode)}</h3>}
    <label htmlFor={inputId}>{text.courseEditControls}</label>
    <input id={inputId} type="text" inputMode="numeric" value={courseEditControls} maxLength={12000}
      disabled={busy || !!courseEditAttempt} aria-describedby={`${inputId}-help`}
      onChange={event => changeCourseEditControls(event.target.value)} />
    <p id={`${inputId}-help`} className={styles.workflowHelp}>{text.courseEditControlsHelp}</p>
    {courseEditPreview && <section className={styles.review} role="status" aria-live="polite">
      {courseEditPreview.readOutCount === 0 ? <p>{text.courseEditNobodyReadOut}</p> : <p><strong>{text.courseEditSummary(
        courseEditPreview.readOutCount, courseEditPreview.becomesOkCount, courseEditPreview.becomesMispunchedCount,
        courseEditPreview.unchangedCount)}</strong></p>}
      {editingVariantCode && <p>{variantText.variantSummaryNote}</p>}
      {courseEditPreview.notRecalculatedCount > 0 && <p className={styles.warning}>{text.courseEditNotRecalculated(courseEditPreview.notRecalculatedCount)}</p>}
      {courseEditPreview.changes.length > 0 ? <>
        <h3>{text.courseEditChangesTitle}</h3>
        <ul className={styles.courseEditChanges}>{courseEditPreview.changes.map(change => <li key={change.entryId}>
          <strong>{change.displayName}</strong> · {change.className} · {text.courseEditStatus[change.before]} → {text.courseEditStatus[change.after]}
        </li>)}</ul>
        <p>{text.courseEditConfirmHelp}</p>
      </> : courseEditPreview.readOutCount > 0 && <p>{text.courseEditNoStatusChange}</p>}
    </section>}
    {courseEditError && <p className={styles.warning} role="alert">{courseEditError}</p>}
    <div className={styles.actions}>
      <button type="button" className="secondary" disabled={busy || !!courseEditAttempt} onClick={() => void previewCourseEdit()}>{text.courseEditPreview}</button>
      <button type="submit" disabled={busy}>{text.courseEditSave}</button>
      {!courseEditAttempt && <button type="button" className="secondary" disabled={busy} onClick={cancelCourseEdit}>{text.courseEditCancel}</button>}
    </div>
  </form>;
}
