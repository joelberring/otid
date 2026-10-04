"use client";

import { useEffect } from "react";
import type { CourseEditListResponse } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import { classTableSv as text } from "../../i18n/class-table-sv";
import { raceAdministratorSv as adminText } from "../../i18n/race-administrator-sv";
import { courseVariantsSv as variantText } from "../../i18n/course-variants-sv";
import { relaySv as relayText } from "../../i18n/relay-sv";
import { classTableStatus } from "../../lib/class-table-status";
import { Button, EmptyState, Notice, Section, Table, numeric } from "../ui";
import type { Workspace } from "./workspace-state";

type ClassRow = CourseEditListResponse["classes"][number];

/** Klasser som tabell med redigering i raden: namn, bana och startsätt (ADR-0169 beslut 4). */
export function ClassTable({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { authenticated, busy, classEditSaved, courseList, courseListError, selectedClassId, data, editingClassId,
    loadCourses, pending, profile, raceId, startClassEdit, workflowLocked, openMissingFixedStart, distributeVariants, distributionMessage } = ws;
  // ADR-0170: startsätt bara där typen har val, varianter bara med gafflingar.
  const { startRuleChoice, variants } = profile.features;
  const columns = startRuleChoice ? 7 : 6;
  const stale = !courseList || (data !== undefined && courseList.snapshotVersion < data.snapshotVersion);
  useEffect(() => {
    if (visible && authenticated && data && !busy && !pending.current && stale && !courseListError) void loadCourses();
  }, [visible, authenticated, data, busy, stale, courseListError]);
  const courseNames = new Map(courseList?.courses.map(course => [course.courseId, course.name]));
  // Stafettklass (ADR-0169 beslut 3): antal sträckor i stället för startsätt.
  const relayLegs = new Map(data?.classes.flatMap(row => row.relayLegCount ? [[row.id, row.relayLegCount] as const] : []));
  return <Section id={`class-table-${raceId}`} title={text.title} help={text.help}>
    {classEditSaved && <Notice tone="ok" role="status">{classEditSaved}</Notice>}
    {distributionMessage && <Notice tone="ok" role="status">{distributionMessage}</Notice>}
    {courseListError && <Notice tone="error" role="alert"><p>{courseListError}</p>
      <div><Button variant="secondary" disabled={busy} onClick={() => void loadCourses()}>{text.retryList}</Button></div></Notice>}
    {!courseList && !courseListError && <p role="status" className={styles.workflowHelp}>{text.loading}</p>}
    {courseList && courseList.classes.length === 0 && <EmptyState title={text.noClasses} />}
    {courseList && courseList.classes.length > 0 && <Table>
      <thead><tr>
        <th scope="col">{text.className}</th><th scope="col">{text.course}</th>{startRuleChoice && <th scope="col">{text.startRule}</th>}
        <th scope="col" className={numeric}>{text.entries}</th><th scope="col">{text.readOut}</th><th scope="col">{text.status}</th>
        <th scope="col"><span className={styles.visuallyHidden}>{text.action}</span></th>
      </tr></thead>
      <tbody>{courseList.classes.map(row => {
        const editing = row.classId === editingClassId;
        const selected = row.classId === selectedClassId;
        return [<tr key={row.classId} data-selected={selected ? "true" : undefined} aria-current={selected ? "true" : undefined}>
          <th scope="row">{row.name}</th>
          <td>{courseNames.get(row.courseId) ?? "–"}
            {variants && row.variantCount > 0 && <span className={styles.subLine}>{variantText.forked(row.variantCount)}</span>}
            {variants && row.missingVariantCount > 0 && <>
              <span className={styles.subLine}>{variantText.missingVariants(row.missingVariantCount)}</span>
              <Button variant="secondary" aria-label={variantText.distributeLabel(row.name)}
                disabled={busy || workflowLocked || !!pending.current} onClick={() => void distributeVariants(row.classId)}>
                {variantText.distribute}</Button>
            </>}</td>
          {startRuleChoice && <td>{relayLegs.get(row.classId) ? relayText.relayStartRule(relayLegs.get(row.classId)!)
            : row.startRule === "PUNCH" ? text.free : text.fixed}</td>}
          <td className={numeric}>{row.entryCount}</td>
          <td>{text.readOutValue(row.readOutCount, row.resultCount)}</td>
          <td><ClassStatus row={row} disabled={workflowLocked} onMissingStartTimes={() => openMissingFixedStart(row.classId)} /></td>
          <td className={styles.rowAction}>{!editing && <Button variant="secondary" aria-label={text.openLabel(row.name)}
            disabled={busy || !!editingClassId || !!pending.current} onClick={() => startClassEdit(row.classId)}>{text.open}</Button>}</td>
        </tr>, editing && <tr key={`${row.classId}-editor`} className={styles.editorRow}>
          <td colSpan={columns}><ClassEditor ws={ws} row={row} /></td>
        </tr>];
      })}</tbody>
    </Table>}
  </Section>;
}

function ClassStatus({ row, disabled, onMissingStartTimes }: { row: ClassRow; disabled: boolean; onMissingStartTimes: () => void }) {
  const status = classTableStatus(row);
  switch (status.kind) {
    case "NO_ENTRIES": return <>{text.statusNoEntries}</>;
    case "MISSING_START_TIMES": return <button type="button" className={`${styles.inlineLink} ${styles.attentionLink}`} disabled={disabled}
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
  const startRuleChoice = ws.profile.features.startRuleChoice;
  return <form className={styles.editor} aria-label={text.openLabel(row.name)}
    onSubmit={event => { event.preventDefault(); void saveClassEdit(); }}>
    <div className={styles.fieldRow}>
      <label htmlFor={`${id}-name`}>{text.fieldName}<input id={`${id}-name`} value={classEditName} maxLength={160}
        disabled={locked || !row.renamable} onChange={event => changeClassEdit({ name: event.target.value })} /></label>
      <label htmlFor={`${id}-course`}>{text.fieldCourse}<select id={`${id}-course`} value={classEditCourseId} disabled={locked}
        onChange={event => changeClassEdit({ courseId: event.target.value })}>
        {courseList?.courses.map(course => <option key={course.courseId} value={course.courseId}>{course.name}</option>)}
      </select></label>
      {startRuleChoice && <label htmlFor={`${id}-start`}>{text.fieldStartRule}<select id={`${id}-start`} value={classEditStartRule}
        disabled={locked || !!ws.data?.classes.some(raceClass => raceClass.id === row.classId && raceClass.relayLegCount)}
        onChange={event => changeClassEdit({ startRule: event.target.value === "FIXED" ? "FIXED" : "PUNCH" })}>
        <option value="PUNCH">{text.free}</option><option value="FIXED">{text.fixed}</option>
      </select></label>}
    </div>
    {!row.renamable && <p className={styles.workflowHelp}>{text.importedName}</p>}
    {classEditPreview && <section className={styles.review} role="status" aria-live="polite">
      {classEditPreview.readOutCount === 0 ? <p>{text.nobodyReadOut}</p> : <p><strong>{adminText.courseEditSummary(
        classEditPreview.readOutCount, classEditPreview.becomesOkCount, classEditPreview.becomesMispunchedCount,
        classEditPreview.unchangedCount)}</strong></p>}
      {classEditPreview.clearedStartTimeCount > 0 && <p>{text.clearedStartTimes(classEditPreview.clearedStartTimeCount)}</p>}
      {classEditPreview.notRecalculatedCount > 0 && <Notice tone="attention">{adminText.courseEditNotRecalculated(classEditPreview.notRecalculatedCount)}</Notice>}
      {classEditPreview.changes.length > 0 ? <>
        <h3>{adminText.courseEditChangesTitle}</h3>
        <ul className={styles.changeList}>{classEditPreview.changes.map(change => <li key={change.entryId}>
          <strong>{change.displayName}</strong> · {adminText.courseEditStatus[change.before]} → {adminText.courseEditStatus[change.after]}
        </li>)}</ul>
        <p>{text.confirmHelp}</p>
      </> : classEditPreview.readOutCount > 0 && <p>{text.noStatusChange}</p>}
    </section>}
    {classEditError && <Notice tone="error" role="alert">{classEditError}</Notice>}
    <div className={styles.actions}>
      <Button variant="secondary" disabled={locked} onClick={() => void previewClassEdit()}>{text.preview}</Button>
      <Button type="submit" disabled={busy}>{text.save}</Button>
      {!classEditAttempt && <Button variant="quiet" disabled={busy} onClick={cancelClassEdit}>{text.cancel}</Button>}
    </div>
  </form>;
}
