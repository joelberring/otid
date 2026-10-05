"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { forestWatchSv as forestText } from "../../i18n/forest-watch-sv";
import { checkinHistorySv } from "../../i18n/checkin-history-sv";
import { checkinConflictReviewSv as reviewText } from "../../i18n/checkin-conflict-review-sv";
import { ForestWatchReport } from "../forest-watch-report";
import { CheckinHistoryTable } from "../checkin-history-table";
import { AdministratorConflictEvidence } from "../administrator-conflict-evidence";
import { ManualFinishTimeCorrection } from "../manual-finish-time-correction";
import { ManualFinishTimeCorrectionWithdrawal } from "../manual-finish-time-correction-withdrawal";
import { ManualPunchStartTimeCorrection } from "../manual-punch-start-time-correction";
import { ManualPunchStartTimeCorrectionWithdrawal } from "../manual-punch-start-time-correction-withdrawal";
import { administratorStartCorrectionRequestSchema } from "@o-tid/contracts";
import { ReadoutControlView } from "./readout-control-view";
import { Button, Field, Section } from "../ui";
import type { Workspace } from "./workspace-state";

/** Avläsning: kontrollvyn och hela skogslistan med manuell återkomst. Speakern har en egen sida (ADR-0170). */
export function DuringRaceOverview({ ws }: { ws: Workspace }) {
  const { data, disabled, entryId, forestAutoRefresh, forestClass, forestData, forestOpen, forestQuery, forestSortByAge,
    forestStale, functionary, loadForest, prepareReturn, prepareStartCorrection, printPrivate, raceId, select, setEntryId, setForestAutoRefresh,
    setForestClass, setForestOpen, setForestQuery, setForestSortByAge, setTargetStartState, shows, targetStartState } = ws;
  const selectedForest = forestData?.entries.find(row => row.entryId === entryId);
  return <>
    <section className={styles.workflowGroup} id={`workflow-${raceId}-readout`} aria-label={navigationText.steps.READOUT}
      hidden={!shows("READOUT")}>
    {data && <ReadoutControlView ws={ws} />}
    <details id={`forest-watch-${raceId}`} className={styles.disclosure} open={forestOpen} onToggle={event => setForestOpen(event.currentTarget.open)}>
      <summary>{text.forestFullList}</summary>
      <div className={styles.disclosureBody}>
      <p className={styles.workflowHelp}>{text.returnHelp}</p>
      <div className={styles.toolbarRow}>
        <label className={styles.check}><input type="checkbox" checked={forestAutoRefresh} disabled={disabled}
          onChange={event => setForestAutoRefresh(event.target.checked)} />{text.forestAutoRefresh}</label>
        <Button variant="secondary" disabled={disabled} onClick={() => void loadForest()}>{forestText.refresh}</Button>
        {forestData && <Button variant="secondary" disabled={disabled} onClick={() => printPrivate("FOREST")}>{forestText.print}</Button>}
      </div>
      {forestAutoRefresh && <p className={styles.workflowHelp}>{text.forestAutoRefreshHelp}</p>}
      {forestData && <>
        <div className={styles.toolbarRow}>
          <Field label={forestText.raceClass}><select value={forestClass} disabled={disabled} onChange={event => setForestClass(event.target.value)}>
            <option value="">{forestText.allClasses}</option>
            {Array.from(new Map(forestData.entries.map(row => [row.classId, row.className]))).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></Field>
          <Field label={forestText.search}><input type="search" value={forestQuery} disabled={disabled} onChange={event => setForestQuery(event.target.value)} /></Field>
          <Button variant="quiet" disabled={disabled} onClick={() => { setForestQuery(""); setForestClass(""); }}>{forestText.clearFilters}</Button>
          <label className={styles.check}><input type="checkbox" checked={forestSortByAge} disabled={disabled}
            onChange={event => setForestSortByAge(event.target.checked)} />{forestText.ageSort}</label>
        </div>
        <details className={styles.disclosure}>
          <summary>{text.returnSelected}: {selectedForest?.displayName ?? text.returnChoose}</summary>
          <div className={styles.toolbarRow}>
            <Button disabled={disabled || forestStale || !forestData.entries.some(row => row.entryId === entryId && !row.manualReturnRegistered)}
              onClick={() => prepareReturn()}>{text.returnReview}</Button>
            <Button variant="secondary" disabled={disabled || forestStale || !forestData.entries.some(row => row.entryId === entryId && row.manualReturnRegistered)}
              onClick={() => prepareReturn(true)}>{text.returnWithdrawalReview}</Button>
            <Field label={text.startCorrectionTarget}><select value={targetStartState} disabled={disabled}
              onChange={event => setTargetStartState(administratorStartCorrectionRequestSchema.shape.targetStartState.parse(event.target.value))}>
              {(["UNMARKED", "STARTED", "REPORTED_NOT_STARTED"] as const).map(state => <option key={state} value={state}>{forestText.reports[state]}</option>)}
            </select></Field>
            <Button variant="secondary" disabled={disabled || forestStale || !forestData.entries.some(row => row.entryId === entryId && row.startState !== targetStartState)}
              onClick={prepareStartCorrection}>{text.startCorrectionReview}</Button>
          </div>
        </details>
        {/* Journal och konfliktgranskning är administratörens; funktionären väljer bara löparen (ADR-0172 beslut 3). */}
        <ForestWatchReport data={forestData} reportedStarts={forestData.reportedStarts} sortByAge={forestSortByAge} classId={forestClass}
          query={forestQuery} stale={forestStale} disabled={disabled}
          {...functionary ? { onChoose: (id: string) => setEntryId(id) }
            : { onOpenHistory: (id: string) => select(id, true), onReviewConflict: (id: string) => select(id, true, true) }} />
      </>}
      </div>
    </details>
    </section>
    {forestData && <div className={styles.forestPrint} data-forest-print>
      <ForestWatchReport data={forestData} reportedStarts={forestData.reportedStarts} sortByAge={forestSortByAge} classId={forestClass} query={forestQuery} stale={forestStale} />
    </div>}
  </>;
}

/**
 * Avläsning: incheckningsjournal, konfliktgranskning, start- och målrättningar. Funktionären ser bara granskningen
 * av sin egen återkomst eller sitt startläge; journalen, konflikterna och tidsrättningarna är administratörens.
 */
export function DuringRaceFollowUp({ ws }: { ws: Workspace }) {
  const { busy, checkinHistory, checkinHistoryPanel, data, disabled, entryId, functionary, loadCheckinHistory,
    loadConflictReview, pending, raceId, returnAttempt, reviewAttempt, reviewCandidate, reviewConfirmed,
    reviewReason, sent, setFinishCorrectionPending, setFinishWithdrawalPending,
    setReturnAttempt, setReviewCandidate, setReviewConfirmed, setReviewReason, setStartCorrection,
    setStartCorrectionPending, setStartWithdrawalPending, startCorrection, submitConflictReview, submitReturn,
    submitStartCorrection, shows, unknown } = ws;
  return <>
    <section className={styles.workflowGroup} aria-label={text.followUpTitle} hidden={!shows("READOUT")}>
    {!functionary && <details ref={checkinHistoryPanel} className={styles.disclosure}>
      <summary>{checkinHistorySv.title}</summary>
      <div className={styles.disclosureBody}>
      <p className={styles.workflowHelp}>{checkinHistorySv.help}</p>
      <p><strong>{data?.entries.find(entry => entry.id === entryId)?.displayName ?? checkinHistorySv.choose}</strong></p>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={disabled || !entryId} onClick={() => void loadCheckinHistory()}>{checkinHistorySv.latest}</Button>
        <Button variant="secondary" disabled={disabled || !entryId} onClick={() => void loadConflictReview()}>{reviewText.load}</Button>
      </div>
      {checkinHistory?.entryId === entryId && <section aria-label={checkinHistorySv.title}>
        <CheckinHistoryTable data={checkinHistory} timeZone={data?.timeZone ?? "UTC"} />
        {checkinHistory.nextCursor && <Button variant="secondary" disabled={disabled} onClick={() => void loadCheckinHistory(checkinHistory.nextCursor!)}>{checkinHistorySv.older}</Button>}
      </section>}
      </div>
    </details>}
    {(reviewAttempt || reviewCandidate) && <section className={styles.review} aria-label={reviewText.title}>
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
    {startCorrection && <section className={styles.review} role="alert" aria-label={text.startCorrectionReview}>
      <h3>{text.startCorrectionReview}: {startCorrection.name}</h3>
      <p>{text.startCorrectionConsequence}</p>
      <p>{forestText.reports[startCorrection.request.targetStartState]}</p>
      {unknown && <p>{text.unreachable}</p>}
      <button type="button" disabled={busy} onClick={() => void submitStartCorrection(startCorrection)}>{unknown ? text.retry : text.startCorrectionConfirm}</button>
      {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setStartCorrection(undefined); }}>{text.cancel}</button>}
    </section>}
    {returnAttempt && <section className={styles.review} role="alert" aria-label={returnAttempt.withdraw ? text.returnWithdrawalReview : text.returnReview}>
      <h3>{returnAttempt.withdraw ? text.returnWithdrawalReview : text.returnReview}: {returnAttempt.name}</h3>
      <p>{returnAttempt.withdraw ? text.returnWithdrawalConsequence : text.returnConsequence}</p>
      <p>{forestText.reports[returnAttempt.request.expectedStartState]}</p>
      {unknown && <p>{text.unreachable}</p>}
      <button type="button" disabled={busy} onClick={() => void submitReturn(returnAttempt)}>{unknown ? text.retry : returnAttempt.withdraw ? text.returnWithdrawalConfirm : text.returnConfirm}</button>
      {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => { pending.current = undefined; sent.current = false; setReturnAttempt(undefined); }}>{text.cancel}</button>}
    </section>}
    {data && !functionary && <Section id={`corrections-${raceId}`} title={text.correctionTools} help={text.correctionToolsHelp}>
      <div className={styles.disclosureList}>
      <ManualFinishTimeCorrection raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setFinishCorrectionPending} />
      <ManualPunchStartTimeCorrection raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setStartCorrectionPending} />
      <ManualPunchStartTimeCorrectionWithdrawal raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setStartWithdrawalPending} />
      <ManualFinishTimeCorrectionWithdrawal raceId={raceId} entries={data.entries} timeZone={data.timeZone} onPendingChange={setFinishWithdrawalPending} />
      </div>
    </Section>}
    </section>
  </>;
}
