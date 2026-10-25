"use client";

import { useEffect } from "react";
import styles from "../race-administrator-workspace.module.css";
import type { CourseEditListResponse } from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { courseVariantsSv as variantText } from "../../i18n/course-variants-sv";
import { Button, EmptyState, Field, Notice, Section, Table, numeric } from "../ui";
import { RemovalReview } from "./removal-review";
import { removalSv as removalText } from "../../i18n/removal-sv";
import { courseMeasures } from "../../lib/lists/result-list-model";
import { focusCourseFile } from "./course-file-section";
import type { Workspace } from "./workspace-state";
import { forkingLetters } from "@o-tid/domain";
import { forkingSv as forking } from "../../i18n/forking-sv";
import { ForkingDiagram } from "../forking/forking-diagram";
import { ForkingEditor } from "./forking-editor";

type CourseRow = CourseEditListResponse["courses"][number];

/** Banor som tabell med "Redigera bana" i raden (ADR-0169 beslut 4). */
export function CourseTable({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { authenticated, busy, courseEditSaved, courseFormOpen, courseList, courseListError, data, editingCourseId, loadCourses,
    openAssignedClass, operation, pending, profile, raceId, saving, setCourseFormOpen, startCourseEdit, workflowLocked } = ws;
  const stale = !courseList || (data !== undefined && courseList.snapshotVersion < data.snapshotVersion);
  useEffect(() => {
    if (visible && authenticated && data && !busy && !operation.current && !pending.current && stale && !courseListError) void loadCourses();
  }, [visible, authenticated, data, busy, stale, courseListError]);
  // ADR-0170: varianter och gafflingskontroll bara i typerna som har gafflingar.
  const variants = profile.features.variants;
  const empty = courseList?.courses.length === 0;
  // Rogaining: kontrollerna med poäng står först och har sitt eget tomläge; banorna visas först när de finns.
  if (empty && profile.features.rogaining) return null;
  const newCourse = (primary: boolean) => <Button variant={primary ? "primary" : "secondary"} disabled={courseFormOpen}
    onClick={() => setCourseFormOpen(true)}>{text.courseClassOpen}</Button>;
  return <Section id={`course-table-${raceId}`} title={text.courseEditTitle} help={empty ? undefined : text.courseEditHelp}
    actions={!empty && courseList && !courseFormOpen ? newCourse(false) : undefined}>
    {courseEditSaved && <Notice tone="ok" role="status">{courseEditSaved}</Notice>}
    {ws.detailsMessage && <Notice tone={ws.detailsMessage === text.courseDetailsError ? "error" : "ok"} role="status">{ws.detailsMessage}</Notice>}
    {courseListError && <Notice tone="error" role="alert"><p>{courseListError}</p>
      <div><Button variant="secondary" disabled={saving} onClick={() => void loadCourses()}>{text.courseEditRetryList}</Button></div></Notice>}
    {!courseList && !courseListError && <p role="status" className={styles.workflowHelp}>{text.courseEditLoading}</p>}
    {empty && !courseFormOpen && <EmptyState title={text.courseEditNoCourses} action={<>{newCourse(true)}
      <Button variant="quiet" onClick={() => focusCourseFile(raceId)}>{text.courseClassFileAlternative}</Button></>}>
      {text.courseEmptyHelp}</EmptyState>}
    {ws.removalMessage?.kind === "COURSE" && !courseList?.courses.some(row => row.courseId === ws.removalMessage?.id) &&
      <RemovalReview ws={ws} kind="COURSE" id={ws.removalMessage.id} />}
    {courseList && courseList.courses.length > 0 && <Table className={styles.courseTable}>
      <thead><tr>
        <th scope="col">{text.courseEditCourse}</th><th scope="col">{text.courseLengthColumn}</th>
        <th scope="col">{text.courseEditControlsColumn}</th>
        <th scope="col">{text.courseEditClasses}</th><th scope="col" className={numeric}>{text.courseEditEntries}</th>
        <th scope="col" className={numeric}>{text.courseEditReadOut}</th><th scope="col"><span className={styles.visuallyHidden}>{text.courseEditAction}</span></th>
      </tr></thead>
      <tbody>{courseList.courses.map(course => {
        const removing = (courseId: string) => (ws.removalAttempt?.kind === "COURSE" && ws.removalAttempt.id === courseId) ||
          (ws.removalMessage?.kind === "COURSE" && ws.removalMessage.id === courseId);
        const editing = course.courseId === editingCourseId;
        const details = course.courseId === ws.detailsCourseId;
        const forked = course.variants.length > 0;
        const measured = course.lengthMeters != null || course.climbMeters != null;
        return [<tr key={course.courseId}>
          <th scope="row">{course.name}</th>
          <td className={styles.courseLength}>{measured ? courseMeasures(course.lengthMeters ?? null, course.climbMeters ?? null)
            : <span className={styles.muted}>–</span>}</td>
          <td className={styles.controlCodes}>{forked && variants ? <span className={styles.muted}>{forking.variantsBelow(course.variants.length)}</span>
            : course.controlCodes.join(" ")}</td>
          <td>{course.classes.length === 0 ? <span className={styles.muted}>{text.courseEditNoClasses}</span> : course.classes.map(raceClass =>
            <button key={raceClass.classId} type="button" className={styles.inlineLink} disabled={workflowLocked}
              onClick={() => openAssignedClass(raceClass.classId)}>{raceClass.name}</button>)}</td>
          <td className={numeric}>{course.entryCount}</td>
          <td className={numeric}>{course.readOutCount}</td>
          <td className={styles.rowAction}>{!editing && !forked && <Button variant="secondary" aria-label={text.courseEditOpenLabel(course.name)}
            disabled={saving || !!editingCourseId} onClick={() => startCourseEdit(course.courseId)}>{text.courseEditOpen}</Button>}
            {/* Steg 49: en bana gafflas i bilden; grundföljden är banans kontroller. */}
            {!editing && !forked && variants && !profile.features.rogaining && <Button variant="quiet" aria-label={forking.makeForkedLabel(course.name)}
              disabled={saving || !!editingCourseId} onClick={() => ws.startForkingEdit(course.courseId)}>{forking.makeForked}</Button>}
            {!details && <Button variant="quiet" aria-label={text.courseDetailsOpenLabel(course.name)} disabled={saving || !!ws.detailsCourseId}
              onClick={() => ws.startCourseDetails(course.courseId)}>{text.courseDetailsOpen}</Button>}
            {/* PLAN.md steg 27: ta bort en bana som ingen klass använder; annars ett besked om vilka klasser. */}
            {!editing && !details && <Button variant="quiet" aria-label={removalText.courseDeleteLabel(course.name)}
              disabled={ws.disabled || !!editingCourseId} onClick={() => ws.prepareCourseRemoval(course.courseId)}>{removalText.courseDelete}</Button>}</td>
        </tr>,
        // Steg 49: gafflingarna (bild, gafflingssätt, knappar och varianter) i en egen rad över hela tabellens bredd.
        forked && variants && <tr key={`${course.courseId}-forking`} className={styles.forkingRow}>
          <td colSpan={7}><div className={styles.forkingDetail}>
            <span className={styles.visuallyHidden}>{course.name} – </span><CourseVariants ws={ws} course={course} /></div></td>
        </tr>,
        editing && <tr key={`${course.courseId}-editor`} className={styles.editorRow}>
          <td colSpan={7}>{ws.courseEditForking ? <ForkingEditor ws={ws} course={course} /> : <CourseEditor ws={ws} courseName={course.name} />}</td>
        </tr>, details && <tr key={`${course.courseId}-details`} className={styles.editorRow}>
          <td colSpan={7}><CourseDetailsEditor ws={ws} courseName={course.name} /></td>
        </tr>, removing(course.courseId) && <tr key={`${course.courseId}-removal`} className={styles.editorRow}>
          <td colSpan={7}><div className={styles.rowReview}><RemovalReview ws={ws} kind="COURSE" id={course.courseId} /></div></td>
        </tr>];
      })}</tbody>
    </Table>}
  </Section>;
}

/**
 * Antal anmälda och avlästa per alternativ (enkel gaffling) eller för hela fjärilen (vid första slingan), efter grenens
 * bokstav. Inga antal när banan saknar anmälda, så att bilden är lugn medan banan byggs.
 */
function branchCount(course: CourseRow) {
  return (item: number, branch: number) => {
    const view = course.forking;
    if (!view || course.entryCount === 0) return undefined;
    const kind = view.items[item]?.kind;
    if (kind === "LOOP" && branch > 0) return undefined;
    const on = course.variants.filter(variant => kind === "LOOP" || view.variants.find(row => row.code === variant.code)?.choices[item] === branch);
    const entries = on.reduce((sum, row) => sum + row.entryCount, 0), readOut = on.reduce((sum, row) => sum + row.readOutCount, 0);
    return { text: forking.branchCountShort(entries, readOut), description: forking.branchCountLong(entries, readOut) };
  };
}

/**
 * Gafflad bana: bilden (steg 49) med anmälda och avlästa per gren, gafflingssättet, rättvisekontrollen, längderna och
 * varje variant. En sparad struktur redigeras i bilden; varianter från en banfil redigeras var för sig eller görs om
 * till struktur när det går.
 */
function CourseVariants({ ws, course }: { ws: Workspace; course: CourseRow }) {
  const { editingCourseId, profile, saving, startCourseEdit } = ws;
  const view = course.forking;
  const fairness = course.fairness;
  const lengths = fairness && fairness.shortestMeters !== null && fairness.longestMeters !== null
    ? { shortest: fairness.shortestMeters, longest: fairness.longestMeters } : undefined;
  const mode = course.forkingMode ?? "BALANCED";
  const id = `forking-mode-${course.courseId}`;
  return <div className={styles.courseVariants}>
    <strong>{variantText.forked(course.variants.length)}</strong>
    {view && <ForkingDiagram items={view.items} letters={forkingLetters({ items: view.items })} count={branchCount(course)}
      label={forking.courseDiagram(course.name)} caption={lengths ? <span>{forking.lengths(lengths.shortest, lengths.longest)}</span> : undefined} />}
    <div className={styles.forkingTools}>
      <label htmlFor={id}>{forking.mode}
        <select id={id} value={mode} disabled={saving || !!editingCourseId}
          onChange={event => void ws.saveForkingMode(course.courseId, event.target.value as "BALANCED" | "UNEQUAL")}>
          <option value="BALANCED">{forking.modes.BALANCED}</option><option value="UNEQUAL">{forking.modes.UNEQUAL}</option>
        </select></label>
      <span className={styles.workflowHelp}>{forking.modeHelp[mode]}</span>
      {view?.stored && <Button variant="secondary" aria-label={forking.editForkingLabel(course.name)} disabled={saving || !!editingCourseId}
        onClick={() => ws.startForkingEdit(course.courseId)}>{forking.editForking}</Button>}
      {view && !view.stored && view.convertible && <Button variant="secondary" aria-label={forking.convertLabel(course.name)}
        disabled={saving || !!editingCourseId} onClick={() => ws.startForkingEdit(course.courseId)}>{forking.convert}</Button>}
    </div>
    {view && !view.stored && <p className={styles.workflowHelp}>{view.convertible ? forking.convertHelp(view.addedCount) : forking.derivedHelp}</p>}
    {fairness?.level === "WARNING" && <Notice tone="attention" role="status">{forking.warning(fairness.warningLegs)}</Notice>}
    {fairness?.level === "NOTICE" && <p className={styles.workflowHelp} role="status">{forking.notice}</p>}
    <details open={profile.features.variantsProminent ? true : undefined}>
      <summary>{variantText.showVariants(course.variants.length)}</summary>
      <table className={styles.subTable}>
        <thead><tr><th scope="col">{variantText.variant}</th><th scope="col">{variantText.variantControls}</th>
          {lengths && <th scope="col">{forking.lengthColumn}</th>}
          <th scope="col">{variantText.variantRunners}</th><th scope="col">{variantText.variantReadOut}</th>
          {!view?.stored && <th scope="col"><span className={styles.visuallyHidden}>{text.courseEditAction}</span></th>}</tr></thead>
        <tbody>{course.variants.map(variant => <tr key={variant.code}>
          <th scope="row">{variant.code}</th><td>{variant.controlCodes.join(" ")}</td>
          {lengths && <td>{forking.length(variant.lengthMeters ?? null)}{" "}
            <span className={styles.muted}>{forking.difference(variant.lengthMeters == null ? null : variant.lengthMeters - lengths.shortest)}</span></td>}
          <td>{variant.entryCount}</td><td>{variant.readOutCount}</td>
          {!view?.stored && <td className={styles.rowAction}><Button variant="quiet" aria-label={variantText.editVariantLabel(course.name, variant.code)}
            disabled={saving || !!editingCourseId}
            onClick={() => startCourseEdit(course.courseId, variant.code)}>{variantText.editVariant}</Button></td>}
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
        courseEditPreview.unchangedCount,
        courseEditPreview.changes.filter(change => change.after === "OVERTIME").length)}</strong></p>}
      {editingVariantCode && <p>{variantText.variantSummaryNote}</p>}
      {courseEditPreview.notRecalculatedCount > 0 && <Notice tone="attention">{text.courseEditNotRecalculated(courseEditPreview.notRecalculatedCount)}</Notice>}
      {courseEditPreview.manualDecisionCount > 0 && <Notice tone="attention">{text.courseEditManualDecisions(courseEditPreview.manualDecisionCount)}</Notice>}
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

/** Längd och stigning i meter (PLAN.md steg 25). Påverkar inga resultat och sparas direkt. */
function CourseDetailsEditor({ ws, courseName }: { ws: Workspace; courseName: string }) {
  const { busy, cancelCourseDetails, changeCourseDetails, detailsClimb, detailsErrors, detailsLength, saveCourseDetails } = ws;
  return <form className={styles.editor} aria-label={text.courseDetailsOpenLabel(courseName)} noValidate
    onSubmit={event => { event.preventDefault(); void saveCourseDetails(); }}>
    <div className={styles.fieldRow}>
      <Field label={text.courseLength} error={detailsErrors.length} className={styles.narrowField}>
        <input inputMode="numeric" autoComplete="off" value={detailsLength} maxLength={8} disabled={busy}
          onChange={event => changeCourseDetails({ length: event.target.value })} /></Field>
      <Field label={text.courseClimb} error={detailsErrors.climb} className={styles.narrowField}>
        <input inputMode="numeric" autoComplete="off" value={detailsClimb} maxLength={6} disabled={busy}
          onChange={event => changeCourseDetails({ climb: event.target.value })} /></Field>
    </div>
    <p className={styles.workflowHelp}>{text.courseDetailsHelp}</p>
    <div className={styles.actions}>
      <Button type="submit" disabled={busy}>{text.courseDetailsSave}</Button>
      <Button variant="quiet" disabled={busy} onClick={cancelCourseDetails}>{text.courseEditCancel}</Button>
    </div>
  </form>;
}
