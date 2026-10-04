"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { forestWatchSv as forestText } from "../../i18n/forest-watch-sv";
import { checkinHistorySv } from "../../i18n/checkin-history-sv";
import { checkinConflictReviewSv as reviewText } from "../../i18n/checkin-conflict-review-sv";
import { formatStartListTime } from "../../lib/start-list-time";
import { RaceWorkspaceSpeaker } from "../race-workspace-speaker";
import { ForestWatchReport } from "../forest-watch-report";
import { CheckinHistoryTable } from "../checkin-history-table";
import { AdministratorConflictEvidence } from "../administrator-conflict-evidence";
import { ManualFinishTimeCorrection } from "../manual-finish-time-correction";
import { ManualFinishTimeCorrectionWithdrawal } from "../manual-finish-time-correction-withdrawal";
import { ManualPunchStartTimeCorrection } from "../manual-punch-start-time-correction";
import { ManualPunchStartTimeCorrectionWithdrawal } from "../manual-punch-start-time-correction-withdrawal";
import { administratorStartCorrectionRequestSchema } from "@o-tid/contracts";
import { unknownReadoutTargetLabel } from "./types";
import type { Workspace } from "./workspace-state";

/** Tävlingsdagen: speaker, att åtgärda, okända avläsningar och kvar i skogen. */
export function DuringRaceOverview({ ws }: { ws: Workspace }) {
  const { busy, data, disabled, duringArea, entryId, forestAttentionCounts, forestAttentionFresh,
    forestAutoRefresh, forestClass, forestData, forestOpen, forestPanel, forestQuery, forestSortByAge, forestStale,
    inspectUnknownReadoutResolution, loadForest, loadRaceDayAttention, loadUnknownReadoutCandidates,
    openAttentionPanel, pending, prepareReturn, prepareStartCorrection, printPrivate, raceId, select, sent,
    setForestAutoRefresh, setForestClass, setForestOpen, setForestQuery, setForestSortByAge, setTargetStartState,
    setUnknownReadoutAttempt, setUnknownReadoutClassId, setUnknownReadoutEntryId, setUnknownReadoutFamilyName,
    setUnknownReadoutGivenName, setUnknownReadoutId, setUnknownReadoutOrganisationName, setUnknownReadoutTarget,
    submitUnknownReadoutResolution, targetStartState, unknownReadoutAttempt, unknownReadoutAttentionFresh,
    unknownReadoutCandidate, unknownReadoutClassId, unknownReadoutEntryId, unknownReadoutError,
    unknownReadoutFamilyName, unknownReadoutFetchedAt, unknownReadoutGivenName, unknownReadoutId,
    unknownReadoutOrganisationName, unknownReadoutPanel, unknownReadoutTarget, workflowLocked, workflowMode } = ws;
  return <>
    {workflowMode === "DURING" && duringArea === "SPEAKER" && <RaceWorkspaceSpeaker raceId={raceId} />}
    <section className={styles.workflowGroup} id={`workflow-${raceId}-during`} aria-label={text.workflowDuring}
      hidden={workflowMode !== "DURING" || duringArea !== "OVERVIEW"}>
    <p className={styles.workflowHelp}>{navigationText.duringHelp}</p>
    <section className={styles.attention} aria-labelledby={`attention-${raceId}`}>
      <div className={styles.attentionHeader}>
        <div><h2 id={`attention-${raceId}`}>{text.attentionTitle}</h2><p>{text.attentionHelp}</p></div>
        <button type="button" className="secondary" disabled={workflowLocked}
          onClick={() => void loadRaceDayAttention()}>{text.attentionRefresh}</button>
      </div>
      <p className={styles.attentionCaveat}>{text.attentionUncertainty}</p>
      <div className={styles.attentionSources}>
        <section className={styles.attentionSource} aria-labelledby={`attention-forest-${raceId}`}>
          <h3 id={`attention-forest-${raceId}`}>{text.attentionForestSource}</h3>
          {forestData && <p className={styles.attentionBasis}>{text.attentionForestBasis(forestData.snapshotVersion,
            formatStartListTime(forestData.generatedAt, forestData.timeZone))}</p>}
          {!forestAttentionFresh && <p className={styles.attentionUnavailable} role="status">{text.attentionForestUnavailable}</p>}
          <ul className={styles.attentionItems}>
            <li data-testid="in-forest-count"><span>{text.attentionInForest}</span><strong>{forestAttentionCounts?.inForest ?? text.attentionUnknown}</strong>
              <button type="button" className="secondary" disabled={workflowLocked}
                onClick={() => openAttentionPanel("FOREST")}>{text.attentionOpen}</button>
            </li>
            <li className={forestAttentionCounts?.conflict ? styles.attentionConflict : undefined}>
              <span>{text.attentionConflict}</span><strong>{forestAttentionCounts?.conflict ?? text.attentionUnknown}</strong>
              <button type="button" className="secondary" disabled={workflowLocked}
                onClick={() => openAttentionPanel("CONFLICT")}>{text.attentionOpen}</button>
            </li>
            <li><span>{text.attentionStartedNoReturn}</span><strong>{forestAttentionCounts?.startedNoReturn ?? text.attentionUnknown}</strong>
              <button type="button" className="secondary" disabled={workflowLocked}
                onClick={() => openAttentionPanel("STARTED_NO_RETURN")}>{text.attentionOpen}</button>
            </li>
            <li><span>{text.attentionUnconfirmed}</span><strong>{forestAttentionCounts?.unconfirmed ?? text.attentionUnknown}</strong>
              <button type="button" className="secondary" disabled={workflowLocked}
                onClick={() => openAttentionPanel("UNCONFIRMED")}>{text.attentionOpen}</button>
            </li>
          </ul>
        </section>
        <section className={styles.attentionSource} aria-labelledby={`attention-readout-${raceId}`}>
          <h3 id={`attention-readout-${raceId}`}>{text.attentionReadoutSource}</h3>
          {unknownReadoutCandidate && unknownReadoutFetchedAt && <p className={styles.attentionBasis}>{text.attentionReadoutBasis(
            unknownReadoutCandidate.snapshotVersion, new Date(unknownReadoutFetchedAt).toLocaleTimeString("sv-SE"))}</p>}
          {!unknownReadoutAttentionFresh && <p className={styles.attentionUnavailable} role="status">{text.attentionReadoutUnavailable}</p>}
          <ul className={styles.attentionItems}><li>
            <span>{text.attentionUnknownReadouts}</span>
            <strong>{unknownReadoutAttentionFresh ? unknownReadoutCandidate?.readouts.length ?? text.attentionUnknown : text.attentionUnknown}</strong>
            <button type="button" className="secondary" disabled={workflowLocked}
              onClick={() => openAttentionPanel("READOUT")}>{text.attentionOpen}</button>
          </li></ul>
        </section>
      </div>
    </section>
    <details ref={unknownReadoutPanel} id={`unknown-readout-${raceId}`} className={styles.courseClassPanel}>
      <summary>{text.unknownReadoutTitle}</summary>
      <section className={styles.panel}>
        <p>{text.unknownReadoutHelp}</p>
        {!unknownReadoutCandidate && !unknownReadoutAttempt && <button type="button" disabled={busy}
          onClick={() => void loadUnknownReadoutCandidates()}>{text.unknownReadoutLoad}</button>}
        {unknownReadoutCandidate && !unknownReadoutAttempt && (unknownReadoutCandidate.readouts.length === 0 ? <p>{text.unknownReadoutNone}</p> : <>
          <label>{text.unknownReadoutSelect}<select value={unknownReadoutId} disabled={busy}
            onChange={event => setUnknownReadoutId(event.target.value)}>
            {unknownReadoutCandidate.readouts.map(readout => <option key={readout.id} value={readout.id}>
              {text.rosterCard} {readout.cardNumber} · {(readout.finishPunchedAt ? formatStartListTime(readout.finishPunchedAt, data?.timeZone ?? "UTC") : "–")}
            </option>)}
          </select></label>
          <label>{text.unknownReadoutTarget}<select value={unknownReadoutTarget} disabled={busy}
            onChange={event => setUnknownReadoutTarget(event.target.value === "NEW_ENTRY" ? "NEW_ENTRY" : "EXISTING_ENTRY")}>
            <option value="EXISTING_ENTRY">{text.unknownReadoutExisting}</option><option value="NEW_ENTRY">{text.unknownReadoutNew}</option>
          </select></label>
          {unknownReadoutTarget === "EXISTING_ENTRY" ? <label>{text.unknownReadoutEntry}<select value={unknownReadoutEntryId} disabled={busy}
            onChange={event => setUnknownReadoutEntryId(event.target.value)}>
            <option value="">{text.chooseEntry}</option>
            {unknownReadoutCandidate.entries.map(entry => <option key={entry.id} value={entry.id}>
              {entry.familyName}, {entry.givenName} · {unknownReadoutCandidate.classes.find(raceClass => raceClass.id === entry.classId)?.name ?? entry.classId}{entry.activeAssignment ? ` · ${text.rosterCard} ${entry.activeAssignment.cardNumber}` : ""}
            </option>)}
          </select></label> : <>
            <label>{text.unknownReadoutNewClass}<select value={unknownReadoutClassId} disabled={busy}
              onChange={event => setUnknownReadoutClassId(event.target.value)}><option value="">{text.chooseClass}</option>
              {unknownReadoutCandidate.classes.map(raceClass => <option key={raceClass.id} value={raceClass.id}>
                {raceClass.name} · {raceClass.entryCount}{raceClass.maxEntries === null ? "" : `/${raceClass.maxEntries}`}
              </option>)}
            </select></label>
            <label>{text.unknownReadoutGivenName}<input value={unknownReadoutGivenName} maxLength={160} disabled={busy}
              onChange={event => setUnknownReadoutGivenName(event.target.value)} required /></label>
            <label>{text.unknownReadoutFamilyName}<input value={unknownReadoutFamilyName} maxLength={160} disabled={busy}
              onChange={event => setUnknownReadoutFamilyName(event.target.value)} required /></label>
            <label>{text.unknownReadoutOrganisation}<input value={unknownReadoutOrganisationName} maxLength={200} disabled={busy}
              onChange={event => setUnknownReadoutOrganisationName(event.target.value)} /></label>
          </>}
          <p className={styles.warning}>{text.unknownReadoutConsequence}</p>
          {unknownReadoutError && <p className={styles.warning} role="alert">{unknownReadoutError}</p>}
          <button type="button" disabled={busy || !!unknownReadoutAttempt} onClick={inspectUnknownReadoutResolution}>{text.unknownReadoutInspect}</button>
        </>)}
        {unknownReadoutAttempt && <section className={styles.review} role="alert" aria-live="polite">
          <h2>{text.unknownReadoutReview}</h2>
          <p><strong>{text.rosterCard}:</strong> {unknownReadoutAttempt.request.cardNumber} · {text.unknownReadoutSelect}: {unknownReadoutAttempt.candidate.readouts.find(row => row.id === unknownReadoutAttempt.request.readoutId)?.finishPunchedAt ?? "–"}</p>
          <p><strong>{text.unknownReadoutTarget}:</strong> {unknownReadoutTargetLabel(unknownReadoutAttempt)}</p>
          <p>{text.unknownReadoutConsequence}</p><p>{text.unknownReadoutNotSaved}</p>
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => void submitUnknownReadoutResolution(unknownReadoutAttempt)}>{text.unknownReadoutConfirm}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setUnknownReadoutAttempt(undefined); }}>{text.unknownReadoutEdit}</button>
          </div>
          {unknownReadoutError && <p className={styles.warning} role="alert">{unknownReadoutError}</p>}
        </section>}
      </section>
    </details>
    <details ref={forestPanel} id={`forest-watch-${raceId}`} open={forestOpen} onToggle={event => setForestOpen(event.currentTarget.open)}>
      <summary>{forestText.title}</summary>
      <p>{text.returnHelp}</p>
      <label><input type="checkbox" checked={forestAutoRefresh} disabled={disabled}
        onChange={event => setForestAutoRefresh(event.target.checked)} />{text.forestAutoRefresh}</label>
      {forestAutoRefresh && <p>{text.forestAutoRefreshHelp}</p>}
      <button type="button" className="secondary" disabled={disabled} onClick={() => void loadForest()}>{forestText.refresh}</button>
      {forestData && <button type="button" className="secondary" disabled={disabled}
        onClick={() => printPrivate("FOREST")}>{forestText.print}</button>}
      {forestData && <>
        <details className={styles.personReturn}>
        <summary>{text.returnSelected}: {forestData.entries.find(row => row.entryId === entryId)?.displayName ?? text.returnChoose}</summary>
        <p>{text.returnSelected}: {forestData.entries.find(row => row.entryId === entryId)?.displayName ?? text.returnChoose}</p>
        <button type="button" disabled={disabled || forestStale || !forestData.entries.some(row => row.entryId === entryId && !row.manualReturnRegistered)} onClick={() => prepareReturn()}>{text.returnReview}</button>
        <button type="button" className="secondary" disabled={disabled || forestStale || !forestData.entries.some(row => row.entryId === entryId && row.manualReturnRegistered)} onClick={() => prepareReturn(true)}>{text.returnWithdrawalReview}</button>
        <label>{text.startCorrectionTarget}<select value={targetStartState} disabled={disabled} onChange={event => setTargetStartState(administratorStartCorrectionRequestSchema.shape.targetStartState.parse(event.target.value))}>
          {(["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"] as const).map(state => <option key={state} value={state}>{forestText.reports[state]}</option>)}
        </select></label>
        <button type="button" className="secondary" disabled={disabled || forestStale || !forestData.entries.some(row => row.entryId === entryId && row.startState !== targetStartState)} onClick={prepareStartCorrection}>{text.startCorrectionReview}</button>
        </details>
        <label>{forestText.raceClass}<select value={forestClass} disabled={disabled} onChange={event => setForestClass(event.target.value)}>
          <option value="">{forestText.allClasses}</option>
          {Array.from(new Map(forestData.entries.map(row => [row.classId, row.className]))).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label>{forestText.search}<input type="search" value={forestQuery} disabled={disabled} onChange={event => setForestQuery(event.target.value)} /></label>
        <button type="button" className="secondary" disabled={disabled} onClick={() => { setForestQuery(""); setForestClass(""); }}>{forestText.clearFilters}</button>
        <label><input type="checkbox" checked={forestSortByAge} disabled={disabled}
          onChange={event => setForestSortByAge(event.target.checked)} />{forestText.ageSort}</label>
        <ForestWatchReport data={forestData} reportedStarts={forestData.reportedStarts} sortByAge={forestSortByAge} classId={forestClass} query={forestQuery} stale={forestStale} disabled={disabled} onOpenHistory={id => select(id, true)} onReviewConflict={id => select(id, true, true)} />
      </>}
    </details>
    </section>
    {forestData && <div className={styles.forestPrint} data-forest-print>
      <ForestWatchReport data={forestData} reportedStarts={forestData.reportedStarts} sortByAge={forestSortByAge} classId={forestClass} query={forestQuery} stale={forestStale} />
    </div>}
  </>;
}

/** Tävlingsdagen: incheckningsjournal, konfliktgranskning, start- och målrättningar. */
export function DuringRaceFollowUp({ ws }: { ws: Workspace }) {
  const { busy, checkinHistory, checkinHistoryPanel, data, disabled, duringArea, entryId, loadCheckinHistory,
    loadConflictReview, pending, raceId, returnAttempt, reviewAttempt, reviewCandidate, reviewConfirmed,
    reviewReason, sent, setFinishCorrectionPending, setFinishWithdrawalPending,
    setReturnAttempt, setReviewCandidate, setReviewConfirmed, setReviewReason, setStartCorrection,
    setStartCorrectionPending, setStartWithdrawalPending, startCorrection, submitConflictReview, submitReturn,
    submitStartCorrection, unknown, workflowMode } = ws;
  return <>
    <section className={styles.workflowGroup} aria-label={text.workflowDuring} hidden={workflowMode !== "DURING" || duringArea !== "OVERVIEW"}>
    <details ref={checkinHistoryPanel}>
      <summary>{checkinHistorySv.title}</summary>
      <p>{checkinHistorySv.help}</p>
      <p>{data?.entries.find(entry => entry.id === entryId)?.displayName ?? checkinHistorySv.choose}</p>
      <button type="button" className="secondary" disabled={disabled || !entryId} onClick={() => void loadCheckinHistory()}>{checkinHistorySv.latest}</button>
      <button type="button" className="secondary" disabled={disabled || !entryId} onClick={() => void loadConflictReview()}>{reviewText.load}</button>
      {checkinHistory?.entryId === entryId && <section aria-label={checkinHistorySv.title}>
        <CheckinHistoryTable data={checkinHistory} timeZone={data?.timeZone ?? "UTC"} />
        {checkinHistory.nextCursor && <button type="button" className="secondary" disabled={disabled} onClick={() => void loadCheckinHistory(checkinHistory.nextCursor!)}>{checkinHistorySv.older}</button>}
      </section>}
    </details>
    {(reviewAttempt || reviewCandidate) && <section className={styles.panel} aria-label={reviewText.title}>
      <h2>{reviewText.title}</h2><p>{reviewText.adminHelp}</p>
      <AdministratorConflictEvidence candidate={reviewAttempt?.candidate ?? reviewCandidate!} />
      {(reviewAttempt?.candidate ?? reviewCandidate!).source.conflicts.length > 0 && <>
        <label>{reviewText.reason}<textarea maxLength={500} rows={2} disabled={busy || !!reviewAttempt}
          value={reviewAttempt?.request.reason ?? reviewReason} onChange={event => setReviewReason(event.target.value)} /></label>
        <label><input type="checkbox" disabled={busy || !!reviewAttempt} checked={!!reviewAttempt || reviewConfirmed}
          onChange={event => setReviewConfirmed(event.target.checked)} />{reviewText.confirm}</label>
        <button type="button" disabled={busy || (!reviewAttempt && (!reviewConfirmed || !reviewReason.trim()))}
          onClick={() => void submitConflictReview()}>{reviewAttempt ? reviewText.retry : reviewText.submit}</button>
      </>}
      {!reviewAttempt && <button type="button" className="secondary" disabled={busy} onClick={() => setReviewCandidate(undefined)}>{text.cancel}</button>}
    </section>}
    {startCorrection && <section className={styles.panel} role="alert" aria-label={text.startCorrectionReview}>
      <h3>{text.startCorrectionReview}: {startCorrection.name}</h3>
      <p>{text.startCorrectionConsequence}</p>
      <p>{forestText.reports[startCorrection.request.targetStartState]}</p>
      {unknown && <p>{text.returnUnknown}</p>}
      <button type="button" disabled={busy} onClick={() => void submitStartCorrection(startCorrection)}>{unknown ? text.retry : text.startCorrectionConfirm}</button>
      {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setStartCorrection(undefined); }}>{text.cancel}</button>}
    </section>}
    {returnAttempt && <section className={styles.panel} role="alert" aria-label={returnAttempt.withdraw ? text.returnWithdrawalReview : text.returnReview}>
      <h3>{returnAttempt.withdraw ? text.returnWithdrawalReview : text.returnReview}: {returnAttempt.name}</h3>
      <p>{returnAttempt.withdraw ? text.returnWithdrawalConsequence : text.returnConsequence}</p>
      <p>{forestText.reports[returnAttempt.request.expectedStartState]}</p>
      {unknown && <p>{text.returnUnknown}</p>}
      <button type="button" disabled={busy} onClick={() => void submitReturn(returnAttempt)}>{unknown ? text.retry : returnAttempt.withdraw ? text.returnWithdrawalConfirm : text.returnConfirm}</button>
      {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setReturnAttempt(undefined); }}>{text.cancel}</button>}
    </section>}
    </section>
    <section className={styles.workflowGroup} aria-label={navigationText.during.CORRECTIONS} hidden={workflowMode !== "DURING" || duringArea !== "CORRECTIONS"}>
    {data && <section className={styles.correctionTools} aria-label={text.correctionTools}>
      <h2>{text.correctionTools}</h2><p className={styles.workflowHelp}>{text.correctionToolsHelp}</p>
      <ManualFinishTimeCorrection raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setFinishCorrectionPending} />
      <ManualPunchStartTimeCorrection raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setStartCorrectionPending} />
      <ManualPunchStartTimeCorrectionWithdrawal raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setStartWithdrawalPending} />
      <ManualFinishTimeCorrectionWithdrawal raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setFinishWithdrawalPending} />
    </section>}
    </section>
  </>;
}
