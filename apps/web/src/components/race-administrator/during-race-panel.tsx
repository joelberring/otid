"use client";

import { useState } from "react";
import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { forestWatchSv as forestText } from "../../i18n/forest-watch-sv";
import { checkinHistorySv } from "../../i18n/checkin-history-sv";
import { checkinConflictReviewSv as reviewText } from "../../i18n/checkin-conflict-review-sv";
import { RaceWorkspaceSpeaker } from "../race-workspace-speaker";
import { ForestWatchReport } from "../forest-watch-report";
import { CheckinHistoryTable } from "../checkin-history-table";
import { AdministratorConflictEvidence } from "../administrator-conflict-evidence";
import { ManualFinishTimeCorrection } from "../manual-finish-time-correction";
import { ManualFinishTimeCorrectionWithdrawal } from "../manual-finish-time-correction-withdrawal";
import { ManualPunchStartTimeCorrection } from "../manual-punch-start-time-correction";
import { ManualPunchStartTimeCorrectionWithdrawal } from "../manual-punch-start-time-correction-withdrawal";
import { administratorStartCorrectionRequestSchema } from "@o-tid/contracts";
import { ReadoutControlView } from "./readout-control-view";
import type { Workspace } from "./workspace-state";

/** Avläsning: kontrollvyn, hela skogslistan med manuell återkomst och speaker. */
export function DuringRaceOverview({ ws }: { ws: Workspace }) {
  const { data, disabled, entryId, forestAutoRefresh, forestClass, forestData, forestOpen, forestQuery, forestSortByAge,
    forestStale, loadForest, prepareReturn, prepareStartCorrection, printPrivate, raceId, select, setForestAutoRefresh,
    setForestClass, setForestOpen, setForestQuery, setForestSortByAge, setTargetStartState, step, targetStartState } = ws;
  const [speakerOpen, setSpeakerOpen] = useState(false);
  return <>
    <section className={styles.workflowGroup} id={`workflow-${raceId}-readout`} aria-label={navigationText.steps.READOUT}
      hidden={step !== "READOUT"}>
    {data && <ReadoutControlView ws={ws} />}
    <details id={`forest-watch-${raceId}`} className={styles.courseClassPanel} open={forestOpen} onToggle={event => setForestOpen(event.currentTarget.open)}>
      <summary>{text.forestFullList}</summary>
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
    <details className={styles.courseClassPanel} open={speakerOpen} onToggle={event => setSpeakerOpen(event.currentTarget.open)}>
      <summary>{navigationText.speaker}</summary>
      {speakerOpen && step === "READOUT" && <RaceWorkspaceSpeaker raceId={raceId} />}
    </details>
    </section>
    {forestData && <div className={styles.forestPrint} data-forest-print>
      <ForestWatchReport data={forestData} reportedStarts={forestData.reportedStarts} sortByAge={forestSortByAge} classId={forestClass} query={forestQuery} stale={forestStale} />
    </div>}
  </>;
}

/** Avläsning: incheckningsjournal, konfliktgranskning, start- och målrättningar. */
export function DuringRaceFollowUp({ ws }: { ws: Workspace }) {
  const { busy, checkinHistory, checkinHistoryPanel, data, disabled, entryId, loadCheckinHistory,
    loadConflictReview, pending, raceId, returnAttempt, reviewAttempt, reviewCandidate, reviewConfirmed,
    reviewReason, sent, setFinishCorrectionPending, setFinishWithdrawalPending,
    setReturnAttempt, setReviewCandidate, setReviewConfirmed, setReviewReason, setStartCorrection,
    setStartCorrectionPending, setStartWithdrawalPending, startCorrection, submitConflictReview, submitReturn,
    submitStartCorrection, step, unknown } = ws;
  return <>
    <section className={styles.workflowGroup} aria-label={text.followUpTitle} hidden={step !== "READOUT"}>
    <details ref={checkinHistoryPanel} className={styles.courseClassPanel}>
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
      <AdministratorConflictEvidence candidate={reviewAttempt?.candidate ?? reviewCandidate!} timeZone={data?.timeZone ?? "UTC"} />
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
      {unknown && <p>{text.unreachable}</p>}
      <button type="button" disabled={busy} onClick={() => void submitStartCorrection(startCorrection)}>{unknown ? text.retry : text.startCorrectionConfirm}</button>
      {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setStartCorrection(undefined); }}>{text.cancel}</button>}
    </section>}
    {returnAttempt && <section className={styles.panel} role="alert" aria-label={returnAttempt.withdraw ? text.returnWithdrawalReview : text.returnReview}>
      <h3>{returnAttempt.withdraw ? text.returnWithdrawalReview : text.returnReview}: {returnAttempt.name}</h3>
      <p>{returnAttempt.withdraw ? text.returnWithdrawalConsequence : text.returnConsequence}</p>
      <p>{forestText.reports[returnAttempt.request.expectedStartState]}</p>
      {unknown && <p>{text.unreachable}</p>}
      <button type="button" disabled={busy} onClick={() => void submitReturn(returnAttempt)}>{unknown ? text.retry : returnAttempt.withdraw ? text.returnWithdrawalConfirm : text.returnConfirm}</button>
      {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setReturnAttempt(undefined); }}>{text.cancel}</button>}
    </section>}
    </section>
    <section className={styles.workflowGroup} aria-label={text.correctionTools} hidden={step !== "READOUT"}>
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
