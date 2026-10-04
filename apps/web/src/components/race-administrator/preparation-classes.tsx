"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import type { ManualClassCreateRequest } from "@o-tid/contracts";
import { ClassTable } from "./class-table";
import type { Workspace } from "./workspace-state";

/** Förberedelse: klasser som tabell (namn, bana, startsätt), ny klass och maxantal. */
export function PreparationClasses({ ws }: { ws: Workspace }) {
  const { confirmManualClass, busy, capacityAttempt, capacityClass, capacityClassId, capacityInput, selectedClassId, data,
    disabled, inspectManualClass, manualClassAttempt, manualClassCourseVersionId, manualClassError, manualClassName,
    manualClassReview, manualClassStartRule, manualClassTargets, pending, preparationArea, prepareCapacity, sent,
    setCapacityAttempt, setCapacityClassId, setCapacityInput, setSelectedClassId, setManualClassCourseVersionId,
    setManualClassName, setManualClassReview, setManualClassStartRule, setMessage, setPreparationArea, submitCapacity,
    submitManualClass, unknown, workflowLocked, workflowMode } = ws;
  const visible = workflowMode === "BEFORE" && preparationArea === "CLASSES";
  return <section className={styles.workflowGroup} aria-label={navigationText.preparation.CLASSES} hidden={!visible}>
    {visible && <ClassTable ws={ws} visible={visible} />}
    <details className={styles.manualClassPanel} open={manualClassReview || manualClassAttempt ? true : undefined}
      onToggle={event => { if ((manualClassReview || manualClassAttempt) && !event.currentTarget.open) event.currentTarget.open = true; }}>
      <summary>{text.manualClassTitle}</summary>
      <div className={styles.manualClassBody}>
        <p>{text.manualClassHelp}</p>
        {manualClassTargets.length === 0 ? <p>{text.manualClassNoTargets}{" "}
          <button type="button" className="secondary" disabled={workflowLocked} onClick={() => setPreparationArea("COURSES")}>{text.manualClassGoCourses}</button>
        </p> : <form onSubmit={inspectManualClass}>
          <div className={styles.manualClassFields}>
            <label>{text.manualClassName}<input value={manualClassName} maxLength={160} required autoComplete="off"
              disabled={workflowLocked}
              onChange={event => setManualClassName(event.target.value)} /></label>
            <label>{text.manualClassTarget}<select value={manualClassCourseVersionId} required
              disabled={workflowLocked}
              onChange={event => setManualClassCourseVersionId(event.target.value)}>
              <option value="">{text.manualClassChooseTarget}</option>
              {manualClassTargets.map(target => <option key={target.courseVersionId} value={target.courseVersionId}>
                {text.manualClassTargetLabel(target.courseName, target.courseVersion,
                  data!.classes.findIndex(row => row.courseVersionId === target.courseVersionId) + 1)}
              </option>)}
            </select></label>
            <label>{text.manualClassStartRule}<select value={manualClassStartRule}
              disabled={workflowLocked}
              onChange={event => setManualClassStartRule(event.target.value as ManualClassCreateRequest["startRule"])}>
              <option value="PUNCH">{text.courseFreeStart}</option><option value="FIXED">{text.courseFixedStart}</option>
            </select></label>
          </div>
          {manualClassError && <p className={styles.warning} role="alert">{manualClassError}</p>}
          {!manualClassReview && !manualClassAttempt && <button type="submit" disabled={workflowLocked}>{text.manualClassInspect}</button>}
        </form>}
        {manualClassReview && !manualClassAttempt && <section className={styles.review} role="alert" aria-live="polite">
          <h2>{text.manualClassReview}</h2>
          <p><strong>{text.manualClassName}:</strong> {manualClassReview.request.className}</p>
          <p><strong>{text.manualClassTarget}:</strong> {manualClassReview.targetLabel}</p>
          <p><strong>{text.manualClassStartRule}:</strong> {manualClassReview.request.startRule === "PUNCH" ? text.courseFreeStart : text.courseFixedStart}</p>
          {manualClassReview.request.startRule === "FIXED" && <p>{text.courseFixedStartHelp}</p>}
          <p>{text.courseClassNotSaved}</p>
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => confirmManualClass(manualClassReview)}>{text.manualClassConfirm}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setManualClassReview(undefined)}>{text.courseClassEdit}</button>
          </div>
        </section>}
        {manualClassAttempt && <section className={styles.review} role="alert" aria-live="polite">
          <h2>{text.manualClassRetryTitle}</h2>
          <p><strong>{text.manualClassName}:</strong> {manualClassAttempt.request.className}</p>
          <p><strong>{text.manualClassTarget}:</strong> {manualClassAttempt.targetLabel}</p>
          <p><strong>{text.manualClassStartRule}:</strong> {manualClassAttempt.request.startRule === "PUNCH" ? text.courseFreeStart : text.courseFixedStart}</p>
          <button type="button" disabled={busy} onClick={() => void submitManualClass(manualClassAttempt)}>{text.retry}</button>
        </section>}
      </div>
    </details>
    <details className={styles.panel} open={capacityAttempt ? true : undefined}>
      <summary>{text.capacityTitle}{capacityClass && text.classOverviewSelected(capacityClass.name)}</summary>
      <div className={styles.workspace}>
        <p>{text.capacityHelp}</p>
        {capacityAttempt ? <div className={styles.review} role="alert">
          <h2>{text.capacityReview}</h2><p>{capacityAttempt.className}</p>
          <p>{text.capacityCount}: {capacityAttempt.entryCount}</p>
          <p>{text.capacityLimit}: {capacityAttempt.request.expectedMaxEntries ?? text.unlimited} → <strong>{capacityAttempt.request.maxEntries ?? text.unlimited}</strong></p>
          {unknown && <p>{text.capacityUnknown}</p>}
          <button disabled={busy} onClick={() => void submitCapacity(capacityAttempt)}>{unknown ? text.retry : text.capacityConfirm}</button>
          {!unknown && <button className="secondary" disabled={busy} onClick={() => {
            pending.current = undefined; sent.current = false; setCapacityAttempt(undefined);
          }}>{text.cancel}</button>}
        </div> : <form className={styles.workspace} onSubmit={prepareCapacity}>
          <div className={styles.capacityFields}>
            <label>{text.capacityClass}<select required value={capacityClassId} disabled={disabled || !data} onChange={(event) => {
              if (event.target.value !== selectedClassId) setSelectedClassId("");
              setCapacityClassId(event.target.value);
              const row = data?.classes.find((item) => item.id === event.target.value);
              setCapacityInput(row?.maxEntries === null || row?.maxEntries === undefined ? "" : String(row.maxEntries)); setMessage("");
            }}><option value="">{text.chooseClass}</option>{data?.classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label>{text.capacityLimit}<input type="text" inputMode="numeric" autoComplete="off" value={capacityInput}
              disabled={disabled || !capacityClass} onChange={(event) => setCapacityInput(event.target.value)} /></label>
            <button disabled={disabled || !capacityClass}>{text.capacityInspect}</button>
          </div>
          {capacityClass && <p>{text.capacityCount}: {capacityClass.entryCount} / {capacityClass.maxEntries ?? text.unlimited}</p>}
        </form>}
      </div>
    </details>
  </section>;
}
