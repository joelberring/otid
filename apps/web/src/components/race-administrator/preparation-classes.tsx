"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import type { ManualClassCreateRequest } from "@o-tid/contracts";
import { Button, Field, Notice } from "../ui";
import { ClassTable } from "./class-table";
import { RelayClassForm } from "./relay-panels";
import type { Workspace } from "./workspace-state";

/** Klasser: tabell (namn, bana, startsätt), ny klass och maxantal. Det som inte ändrar resultat sparas direkt. */
export function PreparationClasses({ ws }: { ws: Workspace }) {
  const { busy, capacityAttempt, capacityClass, capacityClassId, capacityInput, selectedClassId, data,
    disabled, manualClassAttempt, manualClassCourseVersionId, manualClassError, manualClassName,
    manualClassStartRule, manualClassTargets, navigateStep, profile, saveCapacity, saveManualClass,
    setCapacityClassId, setCapacityInput, setSelectedClassId, setManualClassCourseVersionId,
    setManualClassName, setManualClassStartRule, setMessage, shows, submitCapacity,
    submitManualClass, unknown, workflowLocked } = ws;
  const visible = shows("CLASSES");
  return <section className={styles.workflowGroup} aria-label={navigationText.steps.CLASSES} hidden={!visible}>
    {visible && <ClassTable ws={ws} visible={visible} />}
    {profile.features.relay && <RelayClassForm ws={ws} visible={visible} />}
    <details className={styles.disclosure} open={manualClassAttempt ? true : undefined}
      onToggle={event => { if (manualClassAttempt && !event.currentTarget.open) event.currentTarget.open = true; }}>
      <summary>{text.manualClassTitle}</summary>
      <div className={styles.disclosureBody}>
        <p className={styles.workflowHelp}>{text.manualClassHelp}</p>
        {manualClassTargets.length === 0 ? <p>{text.manualClassNoTargets}{" "}
          <Button variant="quiet" disabled={workflowLocked} onClick={() => navigateStep("COURSES")}>{text.manualClassGoCourses}</Button>
        </p> : <form className={styles.form} onSubmit={saveManualClass}>
          <div className={styles.fieldRow}>
            <Field label={text.manualClassName}><input value={manualClassName} maxLength={160} required autoComplete="off"
              disabled={workflowLocked} onChange={event => setManualClassName(event.target.value)} /></Field>
            <Field label={text.manualClassTarget}><select value={manualClassCourseVersionId} required disabled={workflowLocked}
              onChange={event => setManualClassCourseVersionId(event.target.value)}>
              <option value="">{text.manualClassChooseTarget}</option>
              {manualClassTargets.map(target => <option key={target.courseVersionId} value={target.courseVersionId}>
                {target.courseName}</option>)}
            </select></Field>
            {profile.features.startRuleChoice && <Field label={text.manualClassStartRule}><select value={manualClassStartRule}
              disabled={workflowLocked}
              onChange={event => setManualClassStartRule(event.target.value as ManualClassCreateRequest["startRule"])}>
              <option value="PUNCH">{text.courseFreeStart}</option><option value="FIXED">{text.courseFixedStart}</option>
            </select></Field>}
          </div>
          {manualClassError && <Notice tone="error" role="alert">{manualClassError}</Notice>}
          {!manualClassAttempt && <div className={styles.actions}><Button type="submit" disabled={workflowLocked}>{text.manualClassSave}</Button></div>}
        </form>}
        {manualClassAttempt && !busy && <div className={styles.actions}>
          <Button onClick={() => void submitManualClass(manualClassAttempt)}>{text.retry}</Button>
        </div>}
      </div>
    </details>
    <details className={styles.disclosure} open={capacityAttempt ? true : undefined}>
      <summary>{text.capacityTitle}{capacityClass && text.classOverviewSelected(capacityClass.name)}</summary>
      <div className={styles.disclosureBody}>
        <p className={styles.workflowHelp}>{text.capacityHelp}</p>
        {capacityAttempt && unknown ? <Notice tone="attention" role="alert">
          <p>{capacityAttempt.className} · {text.capacityLimit}: {capacityAttempt.request.maxEntries ?? text.unlimited}</p>
          <p>{text.unreachable}</p>
          <div><Button disabled={busy} onClick={() => void submitCapacity(capacityAttempt)}>{text.retry}</Button></div>
        </Notice> : <form className={styles.form} onSubmit={saveCapacity}>
          <div className={styles.fieldRow}>
            <Field label={text.capacityClass}><select required value={capacityClassId} disabled={disabled || !data} onChange={(event) => {
              if (event.target.value !== selectedClassId) setSelectedClassId("");
              setCapacityClassId(event.target.value);
              const row = data?.classes.find((item) => item.id === event.target.value);
              setCapacityInput(row?.maxEntries === null || row?.maxEntries === undefined ? "" : String(row.maxEntries)); setMessage("");
            }}><option value="">{text.chooseClass}</option>{data?.classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
            <Field label={text.capacityLimit}><input type="text" inputMode="numeric" autoComplete="off" value={capacityInput}
              disabled={disabled || !capacityClass} onChange={(event) => setCapacityInput(event.target.value)} /></Field>
            <div className={styles.fieldAction}><Button type="submit" variant="secondary" disabled={disabled || !capacityClass}>{text.capacitySave}</Button></div>
          </div>
          {capacityClass && <p className={styles.workflowHelp}>{text.capacityCount}: {capacityClass.entryCount} / {capacityClass.maxEntries ?? text.unlimited}</p>}
        </form>}
      </div>
    </details>
  </section>;
}
