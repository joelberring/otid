"use client";

import { useEffect } from "react";
import type { CourseEditListResponse } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import { classTableSv as text } from "../../i18n/class-table-sv";
import { raceAdministratorSv as adminText } from "../../i18n/race-administrator-sv";
import { courseVariantsSv as variantText } from "../../i18n/course-variants-sv";
import { relaySv as relayText } from "../../i18n/relay-sv";
import { classTableStatus } from "../../lib/class-table-status";
import type { Workspace } from "./workspace-state";

type ClassRow = CourseEditListResponse["classes"][number];

/** Klasser som tabell med redigering i raden: namn, bana och startsätt (ADR-0169 beslut 4). */
export function ClassTable({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { authenticated, busy, classEditSaved, courseList, courseListError, selectedClassId, data, editingClassId,
    loadCourses, pending, raceId, startClassEdit, workflowLocked, openMissingFixedStart, distributeVariants, distributionMessage } = ws;
  const stale = !courseList || (data !== undefined && courseList.snapshotVersion < data.snapshotVersion);
  useEffect(() => {
    if (visible && authenticated && data && !busy && !pending.current && stale && !courseListError) void loadCourses();
  }, [visible, authenticated, data, busy, stale, courseListError]);
  const courseNames = new Map(courseList?.courses.map(course => [course.courseId, course.name]));
  // Stafettklass (ADR-0169 beslut 3): antal sträckor i stället för startsätt.
  const relayLegs = new Map(data?.classes.flatMap(row => row.relayLegCount ? [[row.id, row.relayLegCount] as const] : []));
  return <section className={styles.panel} aria-labelledby={`class-table-${raceId}`}>
    <h2 id={`class-table-${raceId}`}>{text.title}</h2>
    <p className={styles.workflowHelp}>{text.help}</p>
    {classEditSaved && <p role="status" className={styles.courseEditSaved}>{classEditSaved}</p>}
    {distributionMessage && <p role="status" className={styles.courseEditSaved}>{distributionMessage}</p>}
    {courseListError && <div className={styles.warning} role="alert"><p>{courseListError}</p>
      <button type="button" className="secondary" disabled={busy} onClick={() => void loadCourses()}>{text.retryList}</button></div>}
    {!courseList && !courseListError && <p role="status">{text.loading}</p>}
    {courseList && courseList.classes.length === 0 && <p>{text.noClasses}</p>}
    {courseList && courseList.classes.length > 0 && <div className={styles.courseTableScroll}><table className={styles.courseTable}>
      <thead><tr>
        <th scope="col">{text.className}</th><th scope="col">{text.course}</th><th scope="col">{text.startRule}</th>
        <th scope="col">{text.entries}</th><th scope="col">{text.readOut}</th><th scope="col">{text.status}</th>
        <th scope="col"><span className={styles.visuallyHidden}>{text.action}</span></th>
      </tr></thead>
      <tbody>{courseList.classes.map(row => {
        const editing = row.classId === editingClassId;
        const selected = row.classId === selectedClassId;
        return [<tr key={row.classId} data-selected={selected ? "true" : undefined} aria-current={selected ? "true" : undefined}>
          <th scope="row">{row.name}</th>
          <td>{courseNames.get(row.courseId) ?? "–"}
            {row.variantCount > 0 && <span className={styles.variantLine}>{variantText.forked(row.variantCount)}</span>}
            {row.missingVariantCount > 0 && <>
              <span className={styles.variantLine}>{variantText.missingVariants(row.missingVariantCount)}</span>
              <button type="button" className="secondary" aria-label={variantText.distributeLabel(row.name)}
                disabled={busy || workflowLocked || !!pending.current} onClick={() => void distributeVariants(row.classId)}>
                {variantText.distribute}</button>
            </>}</td>
          <td>{relayLegs.get(row.classId) ? relayText.relayStartRule(relayLegs.get(row.classId)!) : row.startRule === "PUNCH" ? text.free : text.fixed}</td>
          <td>{row.entryCount}</td>
          <td>{text.readOutValue(row.readOutCount, row.resultCount)}</td>
          <td><ClassStatus row={row} disabled={workflowLocked} onMissingStartTimes={() => openMissingFixedStart(row.classId)} /></td>
          <td>{!editing && <button type="button" className="secondary" aria-label={text.openLabel(row.name)}
            disabled={busy || !!editingClassId || !!pending.current} onClick={() => startClassEdit(row.classId)}>{text.open}</button>}</td>
        </tr>, editing && <tr key={`${row.classId}-editor`} className={styles.courseEditorRow}>
          <td colSpan={7}><ClassEditor ws={ws} row={row} /></td>
        </tr>];
      })}</tbody>
    </table></div>}
  </section>;
}

function ClassStatus({ row, disabled, onMissingStartTimes }: { row: ClassRow; disabled: boolean; onMissingStartTimes: () => void }) {
  const status = classTableStatus(row);
  switch (status.kind) {
    case "NO_ENTRIES": return <>{text.statusNoEntries}</>;
    case "MISSING_START_TIMES": return <button type="button" className={styles.courseClassLink} disabled={disabled}
      aria-label={text.statusMissingStartTimesOpen(row.name, status.count)} onClick={onMissingStartTimes}>
      {text.statusMissingStartTimes(status.count)}</button>;
    case "ALL_READ_OUT": return <>{text.statusAllReadOut}</>;
    case "WAITING": return <>{text.statusWaiting(status.count)}</>;
    case "READY": return <>{text.statusReady}</>;
  }
}

function ClassEditor({ ws, row }: { ws: Workspace; row: ClassRow }) {
  const { busy, cancelClassEdit, changeClassEdit, classEditAttempt, classEditCourseId, classEditError, classEditName,
    classEditPreview, classEditStartRule, courseList, previewClassEdit, raceId, saveClassEdit } = ws;
  const id = `class-edit-${raceId}`;
  const locked = busy || !!classEditAttempt;
  return <form className={styles.courseEditor} aria-label={text.openLabel(row.name)}
    onSubmit={event => { event.preventDefault(); void saveClassEdit(); }}>
    <div className={styles.courseClassFields}>
      <label htmlFor={`${id}-name`}>{text.fieldName}<input id={`${id}-name`} value={classEditName} maxLength={160}
        disabled={locked || !row.renamable} onChange={event => changeClassEdit({ name: event.target.value })} /></label>
      <label htmlFor={`${id}-course`}>{text.fieldCourse}<select id={`${id}-course`} value={classEditCourseId} disabled={locked}
        onChange={event => changeClassEdit({ courseId: event.target.value })}>
        {courseList?.courses.map(course => <option key={course.courseId} value={course.courseId}>{course.name}</option>)}
      </select></label>
      <label htmlFor={`${id}-start`}>{text.fieldStartRule}<select id={`${id}-start`} value={classEditStartRule}
        disabled={locked || !!ws.data?.classes.some(raceClass => raceClass.id === row.classId && raceClass.relayLegCount)}
        onChange={event => changeClassEdit({ startRule: event.target.value === "FIXED" ? "FIXED" : "PUNCH" })}>
        <option value="PUNCH">{text.free}</option><option value="FIXED">{text.fixed}</option>
      </select></label>
    </div>
    {!row.renamable && <p className={styles.workflowHelp}>{text.importedName}</p>}
    {classEditPreview && <section className={styles.review} role="status" aria-live="polite">
      {classEditPreview.readOutCount === 0 ? <p>{text.nobodyReadOut}</p> : <p><strong>{adminText.courseEditSummary(
        classEditPreview.readOutCount, classEditPreview.becomesOkCount, classEditPreview.becomesMispunchedCount,
        classEditPreview.unchangedCount)}</strong></p>}
      {classEditPreview.clearedStartTimeCount > 0 && <p>{text.clearedStartTimes(classEditPreview.clearedStartTimeCount)}</p>}
      {classEditPreview.notRecalculatedCount > 0 && <p className={styles.warning}>{adminText.courseEditNotRecalculated(classEditPreview.notRecalculatedCount)}</p>}
      {classEditPreview.changes.length > 0 ? <>
        <h3>{adminText.courseEditChangesTitle}</h3>
        <ul className={styles.courseEditChanges}>{classEditPreview.changes.map(change => <li key={change.entryId}>
          <strong>{change.displayName}</strong> · {adminText.courseEditStatus[change.before]} → {adminText.courseEditStatus[change.after]}
        </li>)}</ul>
        <p>{text.confirmHelp}</p>
      </> : classEditPreview.readOutCount > 0 && <p>{text.noStatusChange}</p>}
    </section>}
    {classEditError && <p className={styles.warning} role="alert">{classEditError}</p>}
    <div className={styles.actions}>
      <button type="button" className="secondary" disabled={locked} onClick={() => void previewClassEdit()}>{text.preview}</button>
      <button type="submit" disabled={busy}>{text.save}</button>
      {!classEditAttempt && <button type="button" className="secondary" disabled={busy} onClick={cancelClassEdit}>{text.cancel}</button>}
    </div>
  </form>;
}
