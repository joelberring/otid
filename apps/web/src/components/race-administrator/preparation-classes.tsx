"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { RaceClassOverview } from "../race-class-overview";
import type { ManualClassCreateRequest } from "@o-tid/contracts";
import { ClassStartTimeFollowUp } from "../class-start-time-follow-up";
import { ClassResultRecalculationFollowUp } from "../class-result-recalculation-follow-up";
import type { Workspace } from "./workspace-state";

/** Förberedelse: klasser, ny klass, klassnamn, maxantal och startregel. */
export function PreparationClasses({ ws }: { ws: Workspace }) {
  const { confirmManualClass, confirmClassName, busy, capacityAttempt, capacityClass, capacityClassId, capacityInput, classNameAttempt, classNameCandidate,
    classNameClassId, classNameError, classNameInput, classNamePanel, classNameReview, classNameSelected,
    courseSelectionReason, courseWarningClassId, data, disabled, inspectClassName, inspectManualClass,
    loadClassNameCandidate, loadRecalculation, loadStartRulePreview, manualClassAttempt, manualClassCourseVersionId,
    manualClassError, manualClassName, manualClassReview, manualClassStartRule, manualClassTargets, openClassCourse,
    openClassDraw, openClassParticipants, openClassSetup, openMissingFixedStart, openMissingStartTime,
    openRecalculation, pending, preparationArea, prepareCapacity, prepareStartRule, recalculationCandidates,
    returnToCourses, sent, setCapacityAttempt, setCapacityClassId, setCapacityInput, 
    setClassNameInput, setClassNameReview, setCourseWarningClassId, 
    setManualClassCourseVersionId, setManualClassName, setManualClassReview, setManualClassStartRule, setMessage,
    setPreparationArea, setRecalculationCandidates, setStartRuleAttempt, setStartRuleClassId, setStartRuleConfirmed,
    setStartRuleOpen, setStartRulePreview, setStartRuleReason, startRuleAttempt, startRuleClass, startRuleClassId,
    startRuleConfirmed, startRuleOpen, startRulePreview, startRuleReason, submitCapacity, submitClassName,
    submitManualClass, submitStartRule, unknown, workflowLocked, workflowMode } = ws;
  return <section className={styles.workflowGroup} aria-label={navigationText.preparation.CLASSES} hidden={workflowMode !== "BEFORE" || preparationArea !== "CLASSES"}>
    {workflowMode === "BEFORE" && preparationArea === "CLASSES" && data &&
      <RaceClassOverview data={data} disabled={workflowLocked} onMissingFixedStart={openMissingFixedStart}
        onReturnToCourses={returnToCourses} onOpenCourse={openClassCourse} onOpenClass={openClassSetup}
        onOpenParticipants={openClassParticipants}
        selectedClassId={courseWarningClassId}
        selectionReason={courseSelectionReason} />}
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
    <details ref={classNamePanel} className={styles.classNamePanel}
      open={classNameReview || classNameAttempt ? true : undefined}
      onToggle={event => {
        if (!event.currentTarget.open) {
          if (classNameReview || classNameAttempt) event.currentTarget.open = true;
          return;
        }
        if (workflowLocked && !classNameReview && !classNameAttempt) { event.currentTarget.open = false; return; }
        if (classNameClassId && !classNameCandidate && !classNameReview && !classNameAttempt) {
          void loadClassNameCandidate(classNameClassId);
        }
      }}>
      <summary>{text.classNameTitle}{classNameSelected ? ` · ${classNameSelected.name}` : ""}</summary>
      <div className={styles.classNameBody}>
        {(!classNameClassId || !classNameSelected) && !classNameAttempt && !classNameReview ? <p>{text.classNameChooseClass}</p> : <>
          <p>{text.classNameHelp}</p>
          {classNameError && <p className={styles.warning} role="alert">{classNameError}</p>}
          {classNameAttempt ? <section className={styles.review} role="alert" aria-live="polite">
            <h2>{text.classNameRetryTitle}</h2>
            <p>{classNameAttempt.request.expectedClassName} → <strong>{classNameAttempt.request.className}</strong></p>
            <button type="button" disabled={busy} onClick={() => void submitClassName(classNameAttempt)}>{text.retry}</button>
          </section> : classNameReview ? <section className={styles.review} role="alert" aria-live="polite">
            <h2>{text.classNameReviewTitle}</h2>
            <p>{classNameReview.request.expectedClassName} → <strong>{classNameReview.request.className}</strong></p>
            <p>{text.courseClassNotSaved}</p>
            <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => confirmClassName(classNameReview)}>{text.classNameConfirm}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => setClassNameReview(undefined)}>{text.courseClassEdit}</button>
            </div>
          </section> : classNameCandidate ? classNameCandidate.editable ? <form className={styles.classNameForm} onSubmit={inspectClassName}>
            <p>{text.classNameCurrent}: <strong>{classNameCandidate.className}</strong></p>
            <label>{text.classNameNew}<input value={classNameInput} required maxLength={160} autoComplete="off"
              disabled={workflowLocked} onChange={event => setClassNameInput(event.target.value)} /></label>
            <button type="submit" disabled={workflowLocked}>{text.classNameInspect}</button>
          </form> : <p>{text.classNameNotEditable}</p> :
            <button type="button" className="secondary" disabled={workflowLocked}
              onClick={() => void loadClassNameCandidate(classNameClassId)}>{text.classNameRead}</button>}
        </>}
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
              if (courseSelectionReason === "DIRECT" && event.target.value !== courseWarningClassId) setCourseWarningClassId("");
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
    <details className={styles.panel} open={startRuleOpen || !!startRuleAttempt}
      onToggle={(event) => setStartRuleOpen(event.currentTarget.open)}>
      <summary>{text.startRuleTitle}{startRuleClass && text.classOverviewSelected(startRuleClass.name)}</summary>
      <div className={styles.workspace}>
        <p>{text.startRuleHelp}</p>
        {startRuleAttempt ? <div className={styles.review} role="alert">
          <h2>{text.startRuleReview}</h2><p><strong>{startRuleAttempt.preview.className}</strong></p>
          <p>{text.startRuleCurrent}: {startRuleAttempt.request.expectedStartRule === "FIXED" ? text.fixed : text.punch}
            {" → "}<strong>{startRuleAttempt.request.startRule === "FIXED" ? text.fixed : text.punch}</strong></p>
          <p>{text.participants}: {startRuleAttempt.preview.entryCount} · {text.startRuleTimes}: {startRuleAttempt.preview.fixedStartTimeCount}
            {" · "}{text.startRuleResults}: {startRuleAttempt.preview.entriesWithResults}</p>
          <p>{text.startRuleConsequence}</p><p>{text.startRuleReason}: {startRuleAttempt.request.reason}</p>
          {unknown && <p>{text.startRuleUnknown}</p>}
          <button disabled={busy} onClick={() => void submitStartRule(startRuleAttempt)}>{unknown ? text.retry : text.startRuleConfirm}</button>
          {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => {
            pending.current = undefined; sent.current = false; setStartRuleAttempt(undefined);
          }}>{text.cancel}</button>}
        </div> : <div className={styles.workspace}>
          <label>{text.startRuleClass}<select value={startRuleClassId} disabled={disabled || !data} onChange={(event) => {
            if (courseSelectionReason === "DIRECT" && event.target.value !== courseWarningClassId) setCourseWarningClassId("");
            setStartRuleClassId(event.target.value); setStartRulePreview(undefined); setStartRuleReason(""); setStartRuleConfirmed(false);
            setRecalculationCandidates(undefined); setMessage("");
          }}><option value="">{text.chooseClass}</option>{data?.classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <button type="button" className="secondary" disabled={disabled || !startRuleClassId} onClick={() => void loadStartRulePreview()}>{text.startRuleLoad}</button>
          {startRulePreview && <form className={styles.workspace} onSubmit={prepareStartRule}>
            <p><strong>{startRulePreview.className}</strong> · {text.startRuleCurrent}: {startRulePreview.startRule === "FIXED" ? text.fixed : text.punch}
              {" → "}<strong>{startRulePreview.startRule === "FIXED" ? text.punch : text.fixed}</strong></p>
            <p>{text.participants}: {startRulePreview.entryCount} · {text.startRuleTimes}: {startRulePreview.fixedStartTimeCount}
              {" · "}{text.startRuleResults}: {startRulePreview.entriesWithResults}</p>
            <p>{text.startRuleConsequence}</p>
            <label>{text.startRuleReason}<textarea required maxLength={500} rows={2} value={startRuleReason} disabled={disabled}
              onChange={(event) => setStartRuleReason(event.target.value)} /></label>
            <label><input type="checkbox" checked={startRuleConfirmed} disabled={disabled}
              onChange={(event) => setStartRuleConfirmed(event.target.checked)} />{text.startRuleAcknowledge}</label>
            <button disabled={disabled || !startRuleReason.trim() || !startRuleConfirmed}>{text.startRuleInspect}</button>
          </form>}
          {data && startRuleClass?.startRule === "FIXED" && <ClassStartTimeFollowUp
            key={`${startRuleClass.id}:${data.snapshotVersion}`} entries={data.entries} classId={startRuleClass.id}
            disabled={disabled} onSelect={openMissingStartTime} onOpenDraw={openClassDraw} />}
          {data && startRuleClass && <ClassResultRecalculationFollowUp
            key={`results:${startRuleClass.id}:${data.snapshotVersion}`} candidates={recalculationCandidates}
            classId={startRuleClass.id} disabled={disabled} onLoad={() => void loadRecalculation("")}
            onSelect={openRecalculation} />}
        </div>}
      </div>
    </details>
  </section>;
}
