"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import type { ManualClassCreateRequest } from "@o-tid/contracts";
import { ClassTable } from "./class-table";
import type { Workspace } from "./workspace-state";

/** Klasser: tabell (namn, bana, startsätt), ny klass och maxantal. Det som inte ändrar resultat sparas direkt. */
export function PreparationClasses({ ws }: { ws: Workspace }) {
  const { busy, capacityAttempt, capacityClass, capacityClassId, capacityInput, selectedClassId, data,
    disabled, manualClassAttempt, manualClassCourseVersionId, manualClassError, manualClassName,
    manualClassStartRule, manualClassTargets, navigateStep, saveCapacity, saveManualClass,
    setCapacityClassId, setCapacityInput, setSelectedClassId, setManualClassCourseVersionId,
    setManualClassName, setManualClassStartRule, setMessage, step, submitCapacity,
    submitManualClass, unknown, workflowLocked } = ws;
  const visible = step === "CLASSES";
  return <section className={styles.workflowGroup} aria-label={navigationText.steps.CLASSES} hidden={!visible}>
    {visible && <ClassTable ws={ws} visible={visible} />}
    <details className={styles.manualClassPanel} open={manualClassAttempt ? true : undefined}
      onToggle={event => { if (manualClassAttempt && !event.currentTarget.open) event.currentTarget.open = true; }}>
      <summary>{text.manualClassTitle}</summary>
      <div className={styles.manualClassBody}>
        <p>{text.manualClassHelp}</p>
        {manualClassTargets.length === 0 ? <p>{text.manualClassNoTargets}{" "}
          <button type="button" className="secondary" disabled={workflowLocked} onClick={() => navigateStep("COURSES")}>{text.manualClassGoCourses}</button>
        </p> : <form onSubmit={saveManualClass}>
          <div className={styles.manualClassFields}>
            <label>{text.manualClassName}<input value={manualClassName} maxLength={160} required autoComplete="off"
              disabled={workflowLocked}
              onChange={event => setManualClassName(event.target.value)} /></label>
            <label>{text.manualClassTarget}<select value={manualClassCourseVersionId} required
              disabled={workflowLocked}
              onChange={event => setManualClassCourseVersionId(event.target.value)}>
              <option value="">{text.manualClassChooseTarget}</option>
              {manualClassTargets.map(target => <option key={target.courseVersionId} value={target.courseVersionId}>
                {target.courseName}</option>)}
            </select></label>
            <label>{text.manualClassStartRule}<select value={manualClassStartRule}
              disabled={workflowLocked}
              onChange={event => setManualClassStartRule(event.target.value as ManualClassCreateRequest["startRule"])}>
              <option value="PUNCH">{text.courseFreeStart}</option><option value="FIXED">{text.courseFixedStart}</option>
            </select></label>
          </div>
          {manualClassError && <p className={styles.warning} role="alert">{manualClassError}</p>}
          {!manualClassAttempt && <button type="submit" disabled={workflowLocked}>{text.manualClassSave}</button>}
        </form>}
        {manualClassAttempt && !busy && <div className={styles.actions}>
          <button type="button" onClick={() => void submitManualClass(manualClassAttempt)}>{text.retry}</button>
        </div>}
      </div>
    </details>
    <details className={styles.panel} open={capacityAttempt ? true : undefined}>
      <summary>{text.capacityTitle}{capacityClass && text.classOverviewSelected(capacityClass.name)}</summary>
      <div className={styles.workspace}>
        <p>{text.capacityHelp}</p>
        {capacityAttempt && unknown ? <div className={styles.review} role="alert">
          <p>{capacityAttempt.className} · {text.capacityLimit}: {capacityAttempt.request.maxEntries ?? text.unlimited}</p>
          <p>{text.unreachable}</p>
          <button disabled={busy} onClick={() => void submitCapacity(capacityAttempt)}>{text.retry}</button>
        </div> : <form className={styles.workspace} onSubmit={saveCapacity}>
          <div className={styles.capacityFields}>
            <label>{text.capacityClass}<select required value={capacityClassId} disabled={disabled || !data} onChange={(event) => {
              if (event.target.value !== selectedClassId) setSelectedClassId("");
              setCapacityClassId(event.target.value);
              const row = data?.classes.find((item) => item.id === event.target.value);
              setCapacityInput(row?.maxEntries === null || row?.maxEntries === undefined ? "" : String(row.maxEntries)); setMessage("");
            }}><option value="">{text.chooseClass}</option>{data?.classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label>{text.capacityLimit}<input type="text" inputMode="numeric" autoComplete="off" value={capacityInput}
              disabled={disabled || !capacityClass} onChange={(event) => setCapacityInput(event.target.value)} /></label>
            <button disabled={disabled || !capacityClass}>{text.capacitySave}</button>
          </div>
          {capacityClass && <p>{text.capacityCount}: {capacityClass.entryCount} / {capacityClass.maxEntries ?? text.unlimited}</p>}
        </form>}
      </div>
    </details>
  </section>;
}
