"use client";

import { useEffect, useState } from "react";
import { relayEn } from "../../i18n/workspace-relay-en";
import { removalEn } from "../../i18n/workspace-tools-en";
import { courseVariantsEn } from "../../i18n/workspace-tools-en";
import { classTableEn } from "../../i18n/workspace-admin-en";
import { raceAdministratorEn } from "../../i18n/workspace-admin-en";
import { useTexts } from "../language-provider";
import type { CourseEditListResponse } from "@o-tid/contracts";
import { formatClockTime } from "@o-tid/domain";
import styles from "../race-administrator-workspace.module.css";
import { classTableSv } from "../../i18n/class-table-sv";
import { raceAdministratorSv } from "../../i18n/race-administrator-sv";
import { courseVariantsSv } from "../../i18n/course-variants-sv";
import { relaySv } from "../../i18n/relay-sv";
import { classTableStatus } from "../../lib/class-table-status";
import { Button, ConfirmDialog, EmptyState, Field, Notice, Section, Table, numeric } from "../ui";
import { RemovalReview } from "./removal-review";
import { removalSv } from "../../i18n/removal-sv";
import type { Workspace } from "./workspace-state";
import { saveClassMassStart } from "./class-mass-start";

type ClassRow = CourseEditListResponse["classes"][number];

/** Klasser som tabell med redigering i raden: namn, bana och startsätt (ADR-0169 beslut 4). */
export function ClassTable({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const relayText = useTexts(relaySv, relayEn);
  const removalText = useTexts(removalSv, removalEn);
  const variantText = useTexts(courseVariantsSv, courseVariantsEn);
  const text = useTexts(classTableSv, classTableEn);
  const adminText = useTexts(raceAdministratorSv, raceAdministratorEn);
  const { authenticated, busy, classEditSaved, courseList, courseListError, selectedClassId, data, editingClassId, manualClassOpen,
    loadCourses, navigateStep, pending, profile, raceId, saving, section, setManualClassOpen, startClassEdit, workflowLocked,
    openMissingFixedStart, distributeVariants, distributionMessage, operation } = ws;
  // ADR-0170: startsätt bara där typen har val, varianter bara med gafflingar.
  const { startRuleChoice, variants } = profile.features;
  const columns = startRuleChoice ? 7 : 6;
  const stale = !courseList || (data !== undefined && courseList.snapshotVersion < data.snapshotVersion);
  useEffect(() => {
    if (visible && authenticated && data && !busy && !operation.current && !pending.current && stale && !courseListError) void loadCourses();
  }, [visible, authenticated, data, busy, stale, courseListError]);
  const courseNames = new Map(courseList?.courses.map(course => [course.courseId, course.name]));
  const removing = (classId: string) => (ws.removalAttempt?.kind === "CLASS" && ws.removalAttempt.id === classId) ||
    (ws.removalMessage?.kind === "CLASS" && ws.removalMessage.id === classId);
  // Stafettklass (ADR-0169 beslut 3): antal sträckor i stället för startsätt.
  const relayLegs = new Map(data?.classes.flatMap(row => row.relayLegCount ? [[row.id, row.relayLegCount] as const] : []));
  // Steg 56: en stafettklass har banor per sträcka (ADR-0174 beslut 10); raden visar dem i sträckordning.
  const relayCourses = (classId: string) => {
    const legs = ws.relay?.classes.find(row => row.id === classId)?.legCourses;
    return legs ? [...new Set(legs.map(leg => leg.courseName))].join(", ") : undefined;
  };
  const noCourses = courseList?.courses.length === 0, empty = courseList?.classes.length === 0;
  // Banor och klasser i samma steg (Träning, Rogaining): tomläget står under Banor, inte två gånger (PLAN.md steg 24).
  if (noCourses && section.panels.includes("COURSES")) return null;
  const newClass = (primary: boolean) => <Button variant={primary ? "primary" : "secondary"} disabled={manualClassOpen}
    onClick={() => setManualClassOpen(true)}>{adminText.manualClassOpen}</Button>;
  return <Section id={`class-table-${raceId}`} title={text.title} help={empty ? undefined : text.help}
    actions={!empty && courseList && !manualClassOpen ? newClass(false) : undefined}>
    {classEditSaved && <Notice tone="ok" role="status">{classEditSaved}</Notice>}
    {ws.removalMessage?.kind === "CLASS" && !courseList?.classes.some(row => row.classId === ws.removalMessage?.id) &&
      <RemovalReview ws={ws} kind="CLASS" id={ws.removalMessage.id} />}
    {distributionMessage && <Notice tone="ok" role="status">{distributionMessage}</Notice>}
    {courseListError && <Notice tone="error" role="alert"><p>{courseListError}</p>
      <div><Button variant="secondary" disabled={saving} onClick={() => void loadCourses()}>{text.retryList}</Button></div></Notice>}
    {!courseList && !courseListError && <p role="status" className={styles.workflowHelp}>{text.loading}</p>}
    {empty && !manualClassOpen && (noCourses
      ? <EmptyState title={adminText.classEmptyTitle} action={<Button onClick={() => navigateStep("COURSES")}>{adminText.manualClassGoCourses}</Button>}>
        {adminText.classEmptyNoCourse}</EmptyState>
      : <EmptyState title={adminText.classEmptyTitle} action={newClass(true)}>{adminText.classEmptyHelp}</EmptyState>)}
    {courseList && courseList.classes.length > 0 && <Table className={styles.cardTable}>
      <thead><tr>
        <th scope="col">{text.className}</th><th scope="col">{text.course}</th>{startRuleChoice && <th scope="col">{text.startRule}</th>}
        <th scope="col" className={numeric}>{text.entries}</th><th scope="col">{text.readOut}</th><th scope="col">{text.status}</th>
        <th scope="col"><span className={styles.visuallyHidden}>{text.action}</span></th>
      </tr></thead>
      <tbody>{courseList.classes.map(row => {
        const editing = row.classId === editingClassId;
        const selected = row.classId === selectedClassId;
        return [<tr key={row.classId} data-selected={selected ? "true" : undefined} aria-current={selected ? "true" : undefined}>
          <th scope="row">{row.name}{row.sourceName && <span className={styles.subLine}>{text.sourceNameShort(row.sourceName)}</span>}</th>
          <td data-label={text.course}>{(relayLegs.get(row.classId) ? relayCourses(row.classId) : undefined) ?? courseNames.get(row.courseId) ?? "–"}
            {variants && row.variantCount > 0 && <span className={styles.subLine}>{variantText.forked(row.variantCount)}</span>}
            {variants && row.missingVariantCount > 0 && <>
              <span className={styles.subLine}>{variantText.missingVariants(row.missingVariantCount)}</span>
              <Button variant="secondary" aria-label={variantText.distributeLabel(row.name)}
                disabled={workflowLocked} onClick={() => void distributeVariants(row.classId)}>
                {variantText.distribute}</Button>
            </>}</td>
          {startRuleChoice && <td data-label={text.startRule}>{relayLegs.get(row.classId) ? relayText.relayStartRule(relayLegs.get(row.classId)!)
            : row.startRule === "PUNCH" ? text.free : row.massStartTime ? text.massStartAt(formatClockTime(row.massStartTime, ws.data?.timeZone ?? "UTC").slice(0, 5)) : text.fixed}</td>}
          <td className={numeric} data-label={text.entries}>{row.entryCount}</td>
          <td data-label={text.readOut}>{text.readOutValue(row.readOutCount, row.resultCount)}</td>
          <td data-label={text.status}><ClassStatus row={row} disabled={workflowLocked} onMissingStartTimes={() => openMissingFixedStart(row.classId)} /></td>
          <td className={styles.rowAction}>{!editing && <><Button variant="secondary" aria-label={text.openLabel(row.name)}
            disabled={saving || !!editingClassId} onClick={() => startClassEdit(row.classId)}>{text.open}</Button>
            {/* PLAN.md steg 27: ta bort en klass utan anmälda; annars ett besked om vad som måste flyttas. */}
            <Button variant="quiet" aria-label={removalText.classDeleteLabel(row.name)} disabled={ws.disabled || !!editingClassId}
              onClick={() => ws.prepareClassRemoval(row.classId)}>{removalText.classDelete}</Button></>}</td>
        </tr>, editing && <tr key={`${row.classId}-editor`} className={styles.editorRow}>
          <td colSpan={columns}><ClassEditor ws={ws} row={row} /></td>
        </tr>, removing(row.classId) && <tr key={`${row.classId}-removal`} className={styles.editorRow}>
          <td colSpan={columns}><div className={styles.rowReview}><RemovalReview ws={ws} kind="CLASS" id={row.classId} /></div></td>
        </tr>];
      })}</tbody>
    </Table>}
  </Section>;
}

function ClassStatus({ row, disabled, onMissingStartTimes }: { row: ClassRow; disabled: boolean; onMissingStartTimes: () => void }) {
  const text = useTexts(classTableSv, classTableEn);
  const status = classTableStatus(row);
  switch (status.kind) {
    case "NO_ENTRIES": return <>{text.statusNoEntries}</>;
    case "MISSING_START_TIMES": return <button type="button" className={`${styles.inlineLink} ${styles.attentionLink}`} disabled={disabled}
      aria-label={text.statusMissingStartTimesOpen(row.name, status.count)} onClick={onMissingStartTimes}>
      {text.statusMissingStartTimes(status.count)}</button>;
    case "MISSING_VARIANTS": return <span className={styles.attentionText}>{text.statusMissingVariants(status.count)}</span>;
    case "ALL_READ_OUT": return <>{text.statusAllReadOut}</>;
    case "WAITING": return <>{text.statusWaiting(status.count)}</>;
    case "READY": return <>{text.statusReady}</>;
  }
}

function ClassEditor({ ws, row }: { ws: Workspace; row: ClassRow }) {
  const relayText = useTexts(relaySv, relayEn);
  const text = useTexts(classTableSv, classTableEn);
  const adminText = useTexts(raceAdministratorSv, raceAdministratorEn);
  const { busy, cancelClassEdit, changeClassEdit, classEditAttempt, classEditCourseId, classEditError, classEditName,
    classEditPreview, classEditStartRule, courseList, previewClassEdit, raceId, saveClassEdit, classEditMaxTime, classEditMaxTimeError } = ws;
  const id = `class-edit-${raceId}`;
  const locked = busy || !!classEditAttempt;
  const startRuleChoice = ws.profile.features.startRuleChoice;
  const relay = !!ws.data?.classes.some(raceClass => raceClass.id === row.classId && raceClass.relayLegCount);
  // Masstart är ett eget val i startsättet (ägaren 2026-11-15): tiden skrivs direkt under och sparas med samma knapp.
  const current = row.massStartTime ? formatClockTime(row.massStartTime, ws.data?.timeZone ?? "UTC").slice(0, 5) : "";
  const [mass, setMass] = useState(current !== "");
  const [clock, setClock] = useState(current);
  const [massBusy, setMassBusy] = useState(false);
  const [massMessage, setMassMessage] = useState<{ ok: boolean; text: string }>();
  const [massConfirm, setMassConfirm] = useState<(ok: boolean) => void>();
  async function save() {
    // Masstarten sparas när den är ny eller har en ny tid; annat i raden sparas som vanligt.
    if (!mass || clock.trim() === current) { void saveClassEdit(); return; }
    setMassMessage(undefined); setMassBusy(true);
    const outcome = await saveClassMassStart(ws, row.classId, clock.trim(),
      () => new Promise<boolean>(resolve => setMassConfirm(() => resolve)));
    setMassBusy(false);
    if (outcome.kind === "SAVED") { setClock(outcome.clock); setMassMessage({ ok: true, text: text.massStartSaved(outcome.clock) }); }
    else if (outcome.kind === "INVALID") setMassMessage({ ok: false, text: text.massStartInvalid });
    else if (outcome.kind === "ERROR") setMassMessage({ ok: false, text: text.massStartError });
  }
  return <form className={styles.editor} aria-label={text.openLabel(row.name)} noValidate
    onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className={styles.fieldRow}>
      <label htmlFor={`${id}-name`}>{text.fieldName}<input id={`${id}-name`} value={classEditName} maxLength={160}
        disabled={locked || !row.renamable} onChange={event => changeClassEdit({ name: event.target.value })} /></label>
      {ws.data?.classes.some(raceClass => raceClass.id === row.classId && raceClass.relayLegCount)
        ? <p className={styles.workflowHelp}>{relayText.classTableCourses}</p>
        : <label htmlFor={`${id}-course`}>{text.fieldCourse}<select id={`${id}-course`} value={classEditCourseId} disabled={locked}
          onChange={event => changeClassEdit({ courseId: event.target.value })}>
          {courseList?.courses.map(course => <option key={course.courseId} value={course.courseId}>{course.name}</option>)}
        </select></label>}
      {startRuleChoice && <label htmlFor={`${id}-start`}>{text.fieldStartRule}<select id={`${id}-start`} value={mass ? "MASS" : classEditStartRule}
        disabled={locked || massBusy || relay}
        onChange={event => { const value = event.target.value; setMass(value === "MASS"); setMassMessage(undefined);
          changeClassEdit({ startRule: value === "PUNCH" ? "PUNCH" : "FIXED" }); }}>
        <option value="PUNCH">{text.free}</option><option value="FIXED">{text.fixed}</option>
        {!row.rogaining && !relay && <option value="MASS">{text.mass}</option>}
      </select></label>}
      {startRuleChoice && mass && <Field label={text.massStart} help={text.massStartHelp} className={styles.narrowField}
        error={massMessage && !massMessage.ok ? massMessage.text : undefined}>
        <input inputMode="numeric" autoComplete="off" placeholder={text.massStartPlaceholder} value={clock} maxLength={5} disabled={locked || massBusy}
          data-testid="class-mass-start-time" onChange={event => { setClock(event.target.value); setMassMessage(undefined); }} /></Field>}
      {/* Maxtid (PLAN.md steg 25); rogainingklassen har egen tidsgräns. */}
      {!row.rogaining && <Field label={text.fieldMaxTime} help={text.maxTimeHelp} error={classEditMaxTimeError || undefined}
        className={styles.narrowField}>
        <input id={`${id}-max-time`} inputMode="numeric" autoComplete="off" value={classEditMaxTime} maxLength={4} disabled={locked}
          onChange={event => changeClassEdit({ maxTime: event.target.value })} /></Field>}
    </div>
    {massMessage?.ok && <p role="status" className={styles.workflowHelp} data-testid="class-mass-start-saved">{massMessage.text}</p>}
    {row.sourceName && <p className={styles.workflowHelp}>{text.sourceName(row.sourceName)}{" "}
      <Button variant="quiet" disabled={locked} onClick={() => changeClassEdit({ name: row.sourceName! })}>{text.useSourceName}</Button></p>}
    {classEditPreview && <section className={styles.review} role="status" aria-live="polite">
      {classEditPreview.readOutCount === 0 ? <p>{text.nobodyReadOut}</p> : <p><strong>{adminText.courseEditSummary(
        classEditPreview.readOutCount, classEditPreview.becomesOkCount, classEditPreview.becomesMispunchedCount,
        classEditPreview.unchangedCount,
        classEditPreview.changes.filter(change => change.after === "OVERTIME").length)}</strong></p>}
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
      <Button type="submit" disabled={busy || massBusy}>{text.save}</Button>
      {!classEditAttempt && <Button variant="quiet" disabled={busy} onClick={cancelClassEdit}>{text.cancel}</Button>}
    </div>
    {massConfirm && <ConfirmDialog title={text.massStart} message={text.massStartConfirm} confirmLabel={text.save}
      onConfirm={() => { massConfirm(true); setMassConfirm(undefined); }}
      onCancel={() => { massConfirm(false); setMassConfirm(undefined); }} />}
  </form>;
}
