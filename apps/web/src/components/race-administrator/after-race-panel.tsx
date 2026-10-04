"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import Link from "next/link";
import { ClassResultRecalculation } from "../class-result-recalculation";
import { sv } from "../../i18n/sv";
import type { Workspace } from "./workspace-state";

/** Efter tävlingen: omräkning per klass, fastställande och flytt till kortare bana. */
export function AfterRacePanel({ ws }: { ws: Workspace }) {
  const { busy, classRecalculationAttempt, classRecalculationCandidates, classRecalculationError,
    classRecalculationSaved, classRecalculationUnknown, data, disabled, finalizationAttempt, finalizationCandidate,
    finalizationCandidates, finalizationScope, inspectShortenedCourseTransfer, loadClassRecalculation,
    loadFinalizationBasis, loadShortenedCourseCandidate, pending, prepareClassRecalculation, prepareFinalization, raceId,
    sent, setClassRecalculationAttempt, setClassRecalculationUnknown, setFinalizationAttempt, setFinalizationScope, setShortenedClassName,
    setShortenedControlCount, setShortenedCourseAttempt, setShortenedCourseCandidate, setShortenedCourseClassId,
    setShortenedCourseError, setShortenedCourseName, setShortenedEntryIds, shortenedClassName, shortenedControlCount,
    shortenedCourseAttempt, shortenedCourseCandidate, shortenedCourseClassId, shortenedCourseError,
    shortenedCourseName, shortenedEntryIds, submitClassRecalculation,
    submitFinalization, submitShortenedCourseTransfer, toggleShortenedEntry, unknown, workflowLocked, workflowMode } = ws;
  return <section className={styles.workflowGroup} id={`workflow-${raceId}-after`} aria-label={text.workflowAfter}
      hidden={workflowMode !== "AFTER"}>
    <p className={styles.workflowHelp}>{text.workflowAfterHelp}</p>
    <details className={styles.afterRecalculation} open={classRecalculationAttempt ? true : undefined}>
      <summary>{text.classRecalculationTitle}</summary>
      {data && <ClassResultRecalculation classes={data.classes.map((item) => ({ id: item.id, name: item.name }))}
        disabled={disabled} candidates={classRecalculationCandidates} attempt={classRecalculationAttempt}
        unknown={classRecalculationUnknown} error={classRecalculationError} saved={classRecalculationSaved}
        onLoad={(id) => void loadClassRecalculation(id)} onPrepare={prepareClassRecalculation}
        onSubmit={(value) => void submitClassRecalculation(value)} onRetry={() => classRecalculationAttempt && void submitClassRecalculation(classRecalculationAttempt)}
        onCancel={() => { pending.current = undefined; sent.current = false; setClassRecalculationAttempt(undefined); setClassRecalculationUnknown(false); }} />}
    </details>
    <section className={styles.afterFinalization} aria-labelledby={`finalization-${raceId}`}>
      <h2 id={`finalization-${raceId}`}>{text.finalizationHeading}</h2>
      <p className={styles.workflowHelp}>{text.finalizationHelp}</p>
      <button type="button" className="secondary" disabled={disabled} onClick={() => void loadFinalizationBasis()}>{text.finalizationLoad}</button>
      {finalizationCandidates && <>
        <label>{text.finalizationScope}<select value={finalizationScope} disabled={disabled} onChange={event => setFinalizationScope(event.target.value)}>
          <option value="RACE">{sv.resultFinalizationRaceScope}</option>
          {finalizationCandidates.classes.map(row => <option key={row.classId} value={row.classId}>{row.className}</option>)}
        </select></label>
        {finalizationCandidate && <>
          <p>{text.participants}: {finalizationCandidate.entryCount} · {text.snapshot}: {finalizationCandidates.snapshotVersion}</p>
          <p>{text.finalizationLatest}: {finalizationCandidate.latestFinalization?.scopeRevision ?? text.finalizationNone}</p>
          {finalizationCandidate.blockerCodes.length > 0 && <ul>{finalizationCandidate.blockerCodes.map(code => <li key={code}>{sv.resultFinalizationBlockers[code]}</li>)}</ul>}
          <button type="button" disabled={disabled || finalizationCandidate.blockerCodes.length > 0} onClick={prepareFinalization}>{text.finalizationReview}</button>
        </>}
      </>}
      {finalizationAttempt && <section className={styles.panel} role="alert" aria-label={text.finalizationReview}>
        <h3>{text.finalizationReview}: {finalizationAttempt.value.label}</h3>
        <p>{text.finalizationConsequence}</p>
        <p>{text.finalizationLatest}: {(finalizationAttempt.value.request.expectedLatestScopeRevision ?? 0) + 1}</p>
        <details key={finalizationAttempt.value.requestId}><summary>{text.finalizationDetails}</summary>
          <p>{text.snapshot}: {finalizationAttempt.value.request.expectedSnapshotVersion}</p>
          <p style={{ overflowWrap: "anywhere" }}>{finalizationAttempt.value.request.expectedBasisHash}</p>
        </details>
        {unknown && <p>{text.finalizationUnknown}</p>}
        <button type="button" disabled={busy} onClick={() => void submitFinalization(finalizationAttempt)}>{unknown ? text.retry : text.finalizationConfirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => {
          pending.current = undefined; sent.current = false; setFinalizationAttempt(undefined);
        }}>{text.cancel}</button>}
      </section>}
    </section>
    {!workflowLocked && <nav className={styles.contextLinks} aria-label={text.afterRouteLinks}>
      <Link href={`/admin/${raceId}/map`}>{text.mapReleaseLink}</Link>
      <Link href={`/admin/${raceId}/route-upload`}>{text.privateRouteLinksLink}</Link>
      <Link href={`/admin/${raceId}/route-preview`}>{text.privateRoutePreviewLink}</Link>
    </nav>}
    <details className={styles.courseClassPanel}>
      <summary>{text.shortenedCourseTitle}</summary>
      <form className={styles.panel} onSubmit={inspectShortenedCourseTransfer}>
        <p>{text.shortenedCourseHelp}</p>
        <label>{text.shortenedCourseSourceClass}<select value={shortenedCourseClassId} disabled={busy || !!shortenedCourseAttempt}
          onChange={event => { setShortenedCourseClassId(event.target.value); setShortenedCourseCandidate(undefined); setShortenedCourseError(""); setShortenedEntryIds([]); }}>
          <option value="">{text.chooseClass}</option>
          {data?.classes.map(raceClass => <option key={raceClass.id} value={raceClass.id}>{raceClass.name}</option>)}
        </select></label>
        {!shortenedCourseCandidate && !shortenedCourseAttempt && <button type="button" disabled={busy || !shortenedCourseClassId}
          onClick={() => void loadShortenedCourseCandidate()}>{text.shortenedCourseLoad}</button>}
        {shortenedCourseCandidate && !shortenedCourseAttempt && <>
          <div className={styles.courseRelinkSummary}>
            <p><strong>{text.shortenedCourseSourceCourse}:</strong> {shortenedCourseCandidate.sourceCourseName} · {text.raceClass}: {shortenedCourseCandidate.sourceClassName}</p>
            <p><strong>{text.courseStartRule}:</strong> {shortenedCourseCandidate.sourceStartRule === "PUNCH" ? text.courseFreeStart : text.courseFixedStart}</p>
            <p><strong>{text.courseControls}:</strong> {shortenedCourseCandidate.sourceControls.map(control => control.controlCode).join(" → ")}</p>
          </div>
          <div className={styles.courseClassFields}>
            <label>{text.shortenedCourseName}<input value={shortenedCourseName} maxLength={160} disabled={busy}
              onChange={event => setShortenedCourseName(event.target.value)} required /></label>
            <label>{text.shortenedCourseClassName}<input value={shortenedClassName} maxLength={160} disabled={busy}
              onChange={event => setShortenedClassName(event.target.value)} required /></label>
            <label>{text.shortenedCoursePrefix}<select value={shortenedControlCount} disabled={busy}
              onChange={event => setShortenedControlCount(event.target.value)}>
              {shortenedCourseCandidate.sourceControls.slice(0, -1).map((_, index) => <option key={index + 1} value={index + 1}>
                {shortenedCourseCandidate.sourceControls.slice(0, index + 1).map(control => control.controlCode).join(" → ")}
              </option>)}
            </select></label>
          </div>
          {shortenedCourseCandidate.entries.length === 0 ? <p>{text.shortenedCourseNoEligibleEntries}</p> : <>
            <fieldset className={styles.shortenedEntries} disabled={busy}>
              <legend>{text.shortenedCourseEntries} ({shortenedEntryIds.length}/100)</legend>
              {shortenedCourseCandidate.entries.map(entry => <label key={entry.entryId}>
                <input type="checkbox" checked={shortenedEntryIds.includes(entry.entryId)}
                  disabled={busy || (!shortenedEntryIds.includes(entry.entryId) && shortenedEntryIds.length >= 100)}
                  onChange={event => toggleShortenedEntry(entry.entryId, event.target.checked)} />
                <span>{entry.displayName} · {entry.sourceResult.kind === "NO_RESULT" ? text.shortenedCourseNoResult : text.shortenedCourseMpResult}</span>
              </label>)}
            </fieldset>
            <p>{text.shortenedCourseConsequence}</p>
            {shortenedCourseError && <p className={styles.warning} role="alert">{shortenedCourseError}</p>}
            <button type="submit" disabled={busy || shortenedEntryIds.length === 0}>{text.shortenedCourseInspect}</button>
          </>}
        </>}
        {shortenedCourseError && !shortenedCourseCandidate && !shortenedCourseAttempt && <p className={styles.warning} role="alert">{shortenedCourseError}</p>}
        {shortenedCourseAttempt && <section className={styles.review} role="alert" aria-live="polite">
          <h2>{text.shortenedCourseReview}</h2>
          <p><strong>{text.raceClass}:</strong> {shortenedCourseAttempt.candidate.sourceClassName} → {shortenedCourseAttempt.request.shortClassName}</p>
          <p><strong>{text.shortenedCourseSourceCourse}:</strong> {shortenedCourseAttempt.candidate.sourceCourseName} → {shortenedCourseAttempt.request.shortCourseName}</p>
          <p><strong>{text.shortenedCoursePrefix}:</strong> {shortenedCourseAttempt.request.controlPrefix.map(control => control.controlCode).join(" → ")}</p>
          <ul className={styles.shortenedReviewList}>{shortenedCourseAttempt.request.entryIds.map(entryId => {
            const entry = shortenedCourseAttempt.candidate.entries.find(value => value.entryId === entryId);
            return <li key={entryId}>{entry?.displayName ?? entryId} · {entry?.sourceResult.kind === "NO_RESULT" ? text.shortenedCourseNoResult : text.shortenedCourseMpResult}</li>;
          })}</ul>
          <p>{text.shortenedCourseConsequence}</p><p>{text.shortenedCourseNotSaved}</p>
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => void submitShortenedCourseTransfer(shortenedCourseAttempt)}>{text.shortenedCourseConfirm}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; setShortenedCourseAttempt(undefined); }}>{text.shortenedCourseEdit}</button>
          </div>
          {shortenedCourseError && <p className={styles.warning} role="alert">{shortenedCourseError}</p>}
        </section>}
      </form>
    </details>
  </section>;
}

/** Efter tävlingen: IOF-export av resultat och fastställda versioner. */
export function ResultExportPanel({ ws }: { ws: Workspace }) {
  const { disabled, downloadFinalization, downloadResults, finalizationId, finalizations, loadFinalizations,
    setFinalizationId, workflowMode } = ws;
  return <section className={styles.workflowGroup} aria-label={text.exportHeading} hidden={workflowMode !== "AFTER"}>
    <details className={styles.afterExport}>
      <summary>{text.exportHeading}</summary>
      <p>{text.exportHelp}</p>
      <button type="button" className="secondary" disabled={disabled} onClick={() => void downloadResults()}>{text.exportDownload}</button>
      <h3>{text.exportCompleteHeading}</h3>
      <p>{text.exportCompleteHelp}</p>
      <button type="button" className="secondary" disabled={disabled} onClick={() => void loadFinalizations()}>{text.exportLoadHistory}</button>
      {finalizations?.length === 0 && <p>{text.exportEmptyHistory}</p>}
      {!!finalizations?.length && <>
        <label>{text.exportRevision}<select value={finalizationId} disabled={disabled} onChange={event => setFinalizationId(event.target.value)}>
          {finalizations.map(row => <option key={row.id} value={row.id}>{text.exportRevisionOption(row.scopeRevision, row.finalizedAt, row.entryCount)}</option>)}
        </select></label>
        <button type="button" disabled={disabled || !finalizationId} onClick={() => void downloadFinalization()}>{text.exportDownloadComplete}</button>
      </>}
    </details>
  </section>;
}
