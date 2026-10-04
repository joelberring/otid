"use client";

import { useEffect } from "react";
import styles from "../race-administrator-workspace.module.css";
import type { CourseEditListResponse } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { courseVariantsSv as variantText } from "../../i18n/course-variants-sv";
import { Button, EmptyState, Notice, Section, Table, numeric } from "../ui";
import type { Workspace } from "./workspace-state";

type CourseRow = CourseEditListResponse["courses"][number];

/** Banor som tabell med "Redigera bana" i raden (ADR-0169 beslut 4). */
export function CourseTable({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { authenticated, busy, courseEditSaved, courseList, courseListError, data, editingCourseId, loadCourses, openAssignedClass, pending,
    profile, raceId, startCourseEdit, workflowLocked } = ws;
  const stale = !courseList || (data !== undefined && courseList.snapshotVersion < data.snapshotVersion);
  useEffect(() => {
    if (visible && authenticated && data && !busy && !pending.current && stale && !courseListError) void loadCourses();
  }, [visible, authenticated, data, busy, stale, courseListError]);
  // ADR-0170: varianter och gafflingskontroll bara i typerna som har gafflingar.
  const variants = profile.features.variants;
  return <Section id={`course-table-${raceId}`} title={text.courseEditTitle} help={text.courseEditHelp}>
    {courseEditSaved && <Notice tone="ok" role="status">{courseEditSaved}</Notice>}
    {courseListError && <Notice tone="error" role="alert"><p>{courseListError}</p>
      <div><Button variant="secondary" disabled={busy} onClick={() => void loadCourses()}>{text.courseEditRetryList}</Button></div></Notice>}
    {!courseList && !courseListError && <p role="status" className={styles.workflowHelp}>{text.courseEditLoading}</p>}
    {courseList && courseList.courses.length === 0 && <EmptyState title={text.courseEditNoCourses}>{text.courseClassHelp}</EmptyState>}
    {courseList && courseList.courses.length > 0 && <Table>
      <thead><tr>
        <th scope="col">{text.courseEditCourse}</th><th scope="col">{text.courseEditControlsColumn}</th>
        <th scope="col">{text.courseEditClasses}</th><th scope="col" className={numeric}>{text.courseEditEntries}</th>
        <th scope="col" className={numeric}>{text.courseEditReadOut}</th><th scope="col"><span className={styles.visuallyHidden}>{text.courseEditAction}</span></th>
      </tr></thead>
      <tbody>{courseList.courses.map(course => {
        const editing = course.courseId === editingCourseId;
        const forked = course.variants.length > 0;
        return [<tr key={course.courseId}>
          <th scope="row">{course.name}</th>
          <td className={styles.controlCodes}>{forked && variants ? <CourseVariants ws={ws} course={course} /> : course.controlCodes.join(" ")}</td>
          <td>{course.classes.length === 0 ? <span className={styles.muted}>{text.courseEditNoClasses}</span> : course.classes.map(raceClass =>
            <button key={raceClass.classId} type="button" className={styles.inlineLink} disabled={workflowLocked}
              onClick={() => openAssignedClass(raceClass.classId)}>{raceClass.name}</button>)}</td>
          <td className={numeric}>{course.entryCount}</td>
          <td className={numeric}>{course.readOutCount}</td>
          <td className={styles.rowAction}>{!editing && !forked && <Button variant="secondary" aria-label={text.courseEditOpenLabel(course.name)}
            disabled={busy || !!editingCourseId || !!pending.current} onClick={() => startCourseEdit(course.courseId)}>{text.courseEditOpen}</Button>}</td>
        </tr>, editing && <tr key={`${course.courseId}-editor`} className={styles.editorRow}>
          <td colSpan={6}><CourseEditor ws={ws} courseName={course.name} /></td>
        </tr>];
      })}</tbody>
    </Table>}
  </Section>;
}

/** Gafflad bana: antal varianter, gafflingskontrollen och varje variant med kontroller och "Redigera". */
function CourseVariants({ ws, course }: { ws: Workspace; course: CourseRow }) {
  const { busy, editingCourseId, pending, profile, startCourseEdit } = ws;
  return <div className={styles.courseVariants}>
    <strong>{variantText.forked(course.variants.length)}</strong>
    {course.unevenLegs.length > 0 && <Notice tone="attention" role="status">{variantText.unevenLegs(course.unevenLegs)}</Notice>}
    <details open={profile.features.variantsProminent ? true : undefined}>
      <summary>{variantText.showVariants(course.variants.length)}</summary>
      <table className={styles.subTable}>
        <thead><tr><th scope="col">{variantText.variant}</th><th scope="col">{variantText.variantControls}</th>
          <th scope="col">{variantText.variantRunners}</th><th scope="col">{variantText.variantReadOut}</th>
          <th scope="col"><span className={styles.visuallyHidden}>{text.courseEditAction}</span></th></tr></thead>
        <tbody>{course.variants.map(variant => <tr key={variant.code}>
          <th scope="row">{variant.code}</th><td>{variant.controlCodes.join(" ")}</td>
          <td>{variant.entryCount}</td><td>{variant.readOutCount}</td>
          <td className={styles.rowAction}><Button variant="quiet" aria-label={variantText.editVariantLabel(course.name, variant.code)}
            disabled={busy || !!editingCourseId || !!pending.current}
            onClick={() => startCourseEdit(course.courseId, variant.code)}>{variantText.editVariant}</Button></td>
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
  return <form className={styles.editor} aria-label={label}
    onSubmit={event => { event.preventDefault(); void saveCourseEdit(); }}>
    {editingVariantCode && <h3>{courseName} · {variantText.editingVariant(editingVariantCode)}</h3>}
    <label htmlFor={inputId}>{text.courseEditControls}</label>
    <input id={inputId} className={styles.controlInput} type="text" inputMode="numeric" value={courseEditControls} maxLength={12000}
      disabled={busy || !!courseEditAttempt} aria-describedby={`${inputId}-help`}
      onChange={event => changeCourseEditControls(event.target.value)} />
    <p id={`${inputId}-help`} className={styles.workflowHelp}>{text.courseEditControlsHelp}</p>
    {courseEditPreview && <section className={styles.review} role="status" aria-live="polite">
      {courseEditPreview.readOutCount === 0 ? <p>{text.courseEditNobodyReadOut}</p> : <p><strong>{text.courseEditSummary(
        courseEditPreview.readOutCount, courseEditPreview.becomesOkCount, courseEditPreview.becomesMispunchedCount,
        courseEditPreview.unchangedCount)}</strong></p>}
      {editingVariantCode && <p>{variantText.variantSummaryNote}</p>}
      {courseEditPreview.notRecalculatedCount > 0 && <Notice tone="attention">{text.courseEditNotRecalculated(courseEditPreview.notRecalculatedCount)}</Notice>}
      {courseEditPreview.changes.length > 0 ? <>
        <h3>{text.courseEditChangesTitle}</h3>
        <ul className={styles.changeList}>{courseEditPreview.changes.map(change => <li key={change.entryId}>
          <strong>{change.displayName}</strong> · {change.className} · {text.courseEditStatus[change.before]} → {text.courseEditStatus[change.after]}
        </li>)}</ul>
        <p>{text.courseEditConfirmHelp}</p>
      </> : courseEditPreview.readOutCount > 0 && <p>{text.courseEditNoStatusChange}</p>}
    </section>}
    {courseEditError && <Notice tone="error" role="alert">{courseEditError}</Notice>}
    <div className={styles.actions}>
      <Button variant="secondary" disabled={busy || !!courseEditAttempt} onClick={() => void previewCourseEdit()}>{text.courseEditPreview}</Button>
      <Button type="submit" disabled={busy}>{text.courseEditSave}</Button>
      {!courseEditAttempt && <Button variant="quiet" disabled={busy} onClick={cancelCourseEdit}>{text.courseEditCancel}</Button>}
    </div>
  </form>;
}
