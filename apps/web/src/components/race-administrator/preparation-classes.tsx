"use client";

import { useEffect } from "react";
import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { startRuleSv } from "../../i18n/start-rule-sv";
import type { ManualClassCreateRequest } from "@o-tid/contracts";
import { Button, Field, Notice } from "../ui";
import { ClassTable } from "./class-table";
import { RelayClassForm } from "./relay-class-form";
import type { Workspace } from "./workspace-state";

/** Klasser: tabell (namn, bana, startsätt), "Ny klass" och maxantal. Det som inte ändrar resultat sparas direkt. */
export function PreparationClasses({ ws }: { ws: Workspace }) {
  const { busy, capacityAttempt, capacityClass, capacityClassId, capacityInput, selectedClassId, data,
    disabled, courseList, profile, saveCapacity, setCapacityClassId, setCapacityInput, setSelectedClassId, setMessage, shows,
    submitCapacity, unknown } = ws;
  const visible = shows("CLASSES");
  // Utan banor finns inga klasser att visa; tomläget står under Banor (eller i klasstabellen när Klasser är ett eget steg).
  const hasClasses = (courseList?.classes.length ?? 0) > 0;
  return <section className={styles.workflowGroup} aria-label={navigationText.steps.CLASSES} hidden={!visible}>
    {visible && <ClassTable ws={ws} visible={visible} />}
    {profile.features.relay && <RelayClassForm ws={ws} visible={visible} />}
    <ManualClassForm ws={ws} />
    {hasClasses && <details className={styles.disclosure} open={capacityAttempt ? true : undefined}>
      <summary>{text.capacityTitle}{capacityClass && text.classOverviewSelected(capacityClass.name)}</summary>
      <div className={styles.disclosureBody}>
        <p className={styles.workflowHelp}>{text.capacityHelp}</p>
        {capacityAttempt && unknown ? <Notice tone="attention" role="alert">
          <p>{capacityAttempt.className} · {text.capacityLimit}: {capacityAttempt.request.maxEntries ?? text.unlimited}</p>
          <p>{text.unreachable}</p>
          <div><Button disabled={busy} onClick={() => void submitCapacity(capacityAttempt)}>{text.retry}</Button></div>
        </Notice> : <form className={styles.form} noValidate onSubmit={saveCapacity}>
          <div className={styles.fieldRow}>
            <Field label={text.capacityClass}><select value={capacityClassId} disabled={disabled || !data} onChange={(event) => {
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
    </details>}
  </section>;
}

/** "Ny klass" på en bana som finns. Banan ändras inte. Står kvar efter sparandet för nästa klass. */
function ManualClassForm({ ws }: { ws: Workspace }) {
  const { busy, manualClassAttempt, manualClassCourseVersionId, manualClassError, manualClassErrors, manualClassForm, manualClassName,
    manualClassOpen, manualClassStartRule, manualClassTargets, profile, raceId, saveManualClass, setManualClassCourseVersionId,
    setManualClassErrors, setManualClassName, setManualClassOpen, setManualClassStartRule, submitManualClass, courseList, courseListError, loadCourses } = ws;
  // Banor utan klass finns bara i banlistan; hämta den när formuläret öppnas (t.ex. direkt på Klasser utan att ha varit på Banor).
  useEffect(() => {
    if (manualClassOpen && !courseList && !courseListError && !busy) void loadCourses();
  }, [manualClassOpen, courseList, courseListError, busy, loadCourses]);
  if (!manualClassOpen && !manualClassAttempt) return null;
  const locked = !!manualClassAttempt;
  const id = `manual-class-${raceId}`;
  return <form ref={manualClassForm} className={styles.inlineForm} aria-labelledby={`${id}-title`} noValidate onSubmit={saveManualClass}>
    <div className={styles.inlineFormHead}>
      <h3 id={`${id}-title`}>{text.manualClassTitle}</h3>
      <Button variant="quiet" disabled={locked} onClick={() => { setManualClassOpen(false); setManualClassErrors({}); }}>{text.courseClassClose}</Button>
    </div>
    <p className={styles.workflowHelp}>{text.manualClassHelp}</p>
    <div className={`${styles.fieldRow} ${styles.fieldRowTop}`}>
      <Field label={text.manualClassName} error={manualClassErrors.className}><input value={manualClassName} maxLength={160}
        autoComplete="off" disabled={locked} onChange={event => { setManualClassName(event.target.value);
          setManualClassErrors({ ...manualClassErrors, className: undefined }); }} /></Field>
      <Field label={text.manualClassTarget} error={manualClassErrors.courseVersionId}><select value={manualClassCourseVersionId}
        disabled={locked} onChange={event => { setManualClassCourseVersionId(event.target.value);
          setManualClassErrors({ ...manualClassErrors, courseVersionId: undefined }); }}>
        <option value="">{text.manualClassChooseTarget}</option>
        {manualClassTargets.map(target => <option key={target.courseVersionId} value={target.courseVersionId}>{target.courseName}</option>)}
      </select></Field>
      {profile.features.startRuleChoice && <Field label={text.manualClassStartRule} help={startRuleSv.details[manualClassStartRule]}>
        <select value={manualClassStartRule} disabled={locked}
          onChange={event => setManualClassStartRule(event.target.value as ManualClassCreateRequest["startRule"])}>
          <option value="PUNCH">{text.courseFreeStart}</option><option value="FIXED">{text.courseFixedStart}</option>
        </select></Field>}
    </div>
    {manualClassError && <Notice tone="error" role="alert">{manualClassError}</Notice>}
    <div className={styles.actions}>
      {!manualClassAttempt && <Button type="submit">{text.manualClassSave}</Button>}
      {manualClassAttempt && !busy && <Button onClick={() => void submitManualClass(manualClassAttempt)}>{text.retry}</Button>}
    </div>
  </form>;
}
