"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { sv } from "../../i18n/sv";
import { formatStartListTime } from "../../lib/start-list-time";
import { RaceParticipantFacts } from "../race-participant-facts";
import { RaceParticipantCourse } from "../race-participant-course";
import { RaceResultControls } from "../race-result-controls";
import { ParticipantEntryClaimAdmin } from "../participant-entry-claim-admin";
import { administratorRosterResultFilters, needsPaymentAttention, type AdministratorRosterResultFilter } from "../../lib/administrator-roster-filter";
import { resultDuration, type Action } from "./types";
import { EntryActionForms, RegistrationForm } from "./entry-action-forms";
import { RecalculationForm, ResultDecisionForms } from "./result-decision-forms";
import type { Workspace } from "./workspace-state";

/** Deltagare: lista och arbetsyta för vald deltagare. */
export function ParticipantsPanel({ ws }: { ws: Workspace }) {
  const { currentPage, disabled, mobilePanel, navigateMobile, participantsVisible, raceId, revealSelected,
    selected, selectedIndex, selectedPage, wideTable, workflowLocked } = ws;
  return <section className={styles.workflowGroup} id={`workflow-${raceId}-participants`} aria-label={text.workflowParticipants}
      hidden={!participantsVisible}>
    <p className={styles.workflowHelp}>{text.workflowParticipantsHelp}</p>
    <nav className={styles.mobileNavigation} aria-label={text.mobileNavigation}>
      <button type="button" className="secondary" aria-pressed={mobilePanel === "LIST"} disabled={disabled}
        aria-controls={`participant-list-${raceId}`} onClick={() => navigateMobile("LIST")}>{text.mobileList}</button>
      <button type="button" className="secondary" aria-pressed={mobilePanel === "WORK"} disabled={disabled}
        aria-controls={`participant-work-${raceId}`} onClick={() => navigateMobile("WORK")}>{text.mobileWork}</button>
    </nav>
    {selected && (selectedIndex < 0 || selectedPage !== currentPage) && <div className={styles.selectionContext}
      aria-label={navigationText.selectedContext}>
      <span><strong>{navigationText.selected}: {selected.displayName}</strong> · {selectedIndex < 0
        ? navigationText.selectedOutsideFilters : navigationText.selectedOnPage(selectedPage + 1)}</span>
      <button type="button" className="secondary" disabled={workflowLocked} onClick={revealSelected}>{selectedIndex < 0
        ? navigationText.revealFilteredSelected : navigationText.revealSelectedOnPage(selectedPage + 1)}</button>
    </div>}
    <div className={styles.columns} data-mobile-panel={mobilePanel} data-wide-table={wideTable}>
      <ParticipantList ws={ws} />
      <ParticipantWorkPanel ws={ws} />
    </div>
  </section>;
}

/** Deltagarlistan med sökning, filter och sidindelning. */
export function ParticipantList({ ws }: { ws: Workspace }) {
  const { classesById, currentPage, data, disabled, entryId, filtered, lastPage, listPanel, missingFixedStartOnly,
    newParticipant, olderResultCount, olderResultsOnly, openMissingStartTime, pageSize, paymentAttentionCount,
    paymentAttentionOnly, printPrivate, query, raceId, refresh, rentalCardCount, rentalCardsOnly, rentalEntries,
    resultState, rosterClassId, rosterOrder, select, setMissingFixedStartOnly, setOlderResultsOnly, setPage,
    setPageSize, setPaymentAttentionOnly, setQuery, setRentalCardsOnly, setResultState, setRosterClassId,
    setRosterOrder, setWideTable, visible, wideTable, workflowLocked } = ws;
  return <section className={styles.panel} aria-label={text.participants} data-panel="LIST" ref={listPanel} tabIndex={-1} id={`participant-list-${raceId}`}>
    <div className={`${styles.toolbar} ${styles.participantToolbar}`}><h2>{text.participants}</h2>
      <button disabled={disabled || !data} onClick={newParticipant}>{text.newParticipant}</button>
      <button type="button" className={`secondary ${styles.wideTableButton}`} disabled={disabled} aria-pressed={wideTable}
        aria-label={wideTable ? navigationText.splitTableAccessible : navigationText.wideTableAccessible}
        onClick={() => setWideTable(!wideTable)}>{wideTable ? navigationText.splitTable : navigationText.wideTable}</button>
      {rentalEntries.length > 0 && <button type="button" className="secondary" disabled={disabled}
        onClick={() => printPrivate("RENTAL")}>{text.rentalPrint}</button>}
      <button className="secondary" disabled={disabled} onClick={() => void refresh()}>{text.refresh}</button></div>
    <div className={styles.rosterSearch}>
    <label>{navigationText.search}<input type="search" autoComplete="off" value={query} disabled={disabled}
      onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
    <div className={styles.tableOptions}>
      <label>{navigationText.classFilter}<select value={rosterClassId} disabled={disabled} onChange={event => { setRosterClassId(event.target.value); setPage(0); }}>
        <option value="">{text.rosterAllClasses}</option>
        {data?.classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      <label>{text.rosterResultStateFilter}<select value={resultState}
        disabled={disabled || !data} onChange={event => {
          const next = event.target.value;
          if (!administratorRosterResultFilters.some(value => value === next)) return;
          setResultState(next as AdministratorRosterResultFilter); setPage(0);
        }}>
        {administratorRosterResultFilters.map(value => <option key={value} value={value}>
          {value === "ALL" ? text.rosterResultStateAll : value === "NO_ACTIVE_RESULT" ? text.rosterNoActiveFilter :
            value === "NO_PUBLISHED_RESULT" ? text.rosterNoPublishedFilter : sv.publicResultsStatusLabels[value]}
        </option>)}
      </select></label>
      <label>{navigationText.rosterOrder}<select value={rosterOrder} disabled={disabled || !data}
        onChange={event => { setRosterOrder(event.target.value === "FIXED_START" ? "FIXED_START" : "NAME"); setPage(0); }}>
        <option value="NAME">{navigationText.rosterNameOrder}</option>
        <option value="FIXED_START">{navigationText.rosterFixedStartOrder}</option>
      </select></label>
      <label><span className={styles.rowsLabelFull}>{navigationText.rows}</span>
        <span className={styles.rowsLabelCompact} aria-hidden="true">{navigationText.rowsCompact}</span>
        <select aria-label={navigationText.rows} value={pageSize} disabled={disabled}
          onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}>
        {[25, 100, 250].map(size => <option key={size} value={size}>{size}</option>)}
      </select></label>
    </div>
    </div>
    <div className={styles.rosterFilters}>
      <label className={styles.listFilter}><input type="checkbox" checked={olderResultsOnly} disabled={disabled}
        aria-label={text.rosterOlderResultsOnly(olderResultCount)}
        onChange={(event) => { setOlderResultsOnly(event.target.checked); setPage(0); }} />
        <span className={styles.filterLabelFull}>{text.rosterOlderResultsOnly(olderResultCount)}</span>
        <span className={styles.filterLabelCompact} aria-hidden="true">{text.rosterOlderResultsCompact(olderResultCount)}</span></label>
      <label className={styles.listFilter}><input type="checkbox" checked={rentalCardsOnly} disabled={disabled}
        aria-label={text.rosterRentalCardsOnly(rentalCardCount)}
        onChange={(event) => { setRentalCardsOnly(event.target.checked); setPage(0); }} />
        <span className={styles.filterLabelFull}>{text.rosterRentalCardsOnly(rentalCardCount)}</span>
        <span className={styles.filterLabelCompact} aria-hidden="true">{text.rosterRentalCardsCompact(rentalCardCount)}</span></label>
      <label className={styles.listFilter}><input type="checkbox" checked={paymentAttentionOnly} disabled={disabled}
        aria-label={text.rosterPaymentAttentionOnly(paymentAttentionCount)}
        onChange={(event) => { setPaymentAttentionOnly(event.target.checked); setPage(0); }} />
        <span className={styles.filterLabelFull}>{text.rosterPaymentAttentionOnly(paymentAttentionCount)}</span>
        <span className={styles.filterLabelCompact} aria-hidden="true">{text.rosterPaymentAttentionCompact(paymentAttentionCount)}</span></label>
    </div>
    {missingFixedStartOnly && <div className={styles.activeRosterFilter}>
      <span>{text.rosterMissingFixedStartFilter}</span>
      <button type="button" className="secondary" disabled={disabled} onClick={() => {
        setMissingFixedStartOnly(false); setPage(0);
      }}>{text.rosterShowAllStartTimes}</button>
    </div>}
    {data && <><p>{text.shown} {filtered.length} {text.of} {data.entries.length}
      {rosterOrder === "FIXED_START" && <span className={styles.rosterOrderHint}> · {navigationText.rosterFixedStartOrderHelp}</span>}</p>
      <div className={styles.tableScroll}><table className={`${styles.table} ${styles.rosterTable}`}><thead><tr>
        <th scope="col">{text.name}</th><th scope="col">{text.raceClass}</th>
        <th scope="col">{text.rosterResult}</th><th scope="col">{text.rosterCard}</th><th scope="col">{text.rosterStart}</th>
      </tr></thead>
        <tbody>{visible.map((entry) => {
          const raceClass = classesById.get(entry.classId);
          if (!raceClass) throw new Error("Validated participant class missing");
          return <tr key={entry.id}><td><button className={styles.participant} disabled={disabled}
            aria-label={`${entry.displayName} ${entry.organisationName ?? text.none}`}
            aria-pressed={entryId === entry.id} onClick={() => select(entry.id, false, false, paymentAttentionOnly ? "PAYMENT" : undefined)}>{entry.displayName}</button>
            <div className={styles.rosterMetadata}>
              <span className={styles.organisation} aria-hidden="true">{entry.organisationName ?? text.none}</span>
              {entry.resultRevisionMarker === "MANUAL_FINISH_TIME_CORRECTION" && <span className={styles.resultBadge}>{text.rosterFinishCorrection}</span>}
              {entry.resultRevisionMarker === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" && <span className={styles.resultBadge}>{text.rosterFinishCorrectionWithdrawal}</span>}
              {entry.activeAssignment?.isRental && <span className={`${styles.resultBadge} ${entry.activeAssignment.rentalReturned ? "" : styles.resultBadgeAttention}`}>{text.rentalBadge} · {entry.activeAssignment.cardNumber} · {entry.activeAssignment.rentalReturned ? text.rentalReturned : text.rentalOutstanding}</span>}
              {entry.paymentStatus !== "UNMARKED" && <span className={`${styles.resultBadge} ${needsPaymentAttention(entry.paymentStatus) ? styles.resultBadgeAttention : ""}`}>{text.paymentStatusBadge} · {text.paymentStatuses[entry.paymentStatus]}</span>}
            </div>
          </td><td data-label={text.raceClass}>{raceClass.name}</td>
          <td data-label={text.rosterResult} className={styles.rosterResultCell}>
            {entry.effectiveResult.state === "ACTIVE_RESULT"
              ? <><span className={styles.rosterResultLine}>
                <strong className={entry.effectiveResult.result.status === "MP" || entry.effectiveResult.result.status === "DSQ" ? styles.rosterCritical : undefined}>{sv.publicResultsStatusLabels[entry.effectiveResult.result.status]}</strong>
                {"elapsedMs" in entry.effectiveResult.result && entry.effectiveResult.result.elapsedMs !== undefined &&
                  <span className={styles.rosterResultTime}>{resultDuration(entry.effectiveResult.result.elapsedMs)}</span>}
              </span>{entry.resultFreshness === "OLDER_SNAPSHOT" &&
                <span className={styles.rosterStale}>{text.rosterOlderResult}</span>}</>
              : entry.effectiveResult.state === "NO_ACTIVE_RESULT" ? text.rosterNoActiveResult : text.rosterNoPublishedResult}
          </td>
          <td data-label={text.rosterCard} className={styles.cardCell}>{entry.multipleActiveAssignments
            ? text.rosterMultipleActiveCards : entry.activeAssignment?.cardNumber ?? text.rosterNoActiveCard}</td>
          <td data-label={text.rosterStart} className={styles.startCell}>{raceClass.startRule === "PUNCH" ? text.rosterFreeStart :
            <div className={styles.startDetail}><strong>{text.rosterFixedStart}</strong>
              {entry.fixedStartTime
                ? <time dateTime={entry.fixedStartTime}>{formatStartListTime(entry.fixedStartTime, data.timeZone)}</time>
                : <><span className={styles.startMissing}>{text.rosterMissingFixedStart}</span>
                  <button type="button" className={styles.startSetButton} disabled={workflowLocked}
                    aria-label={text.rosterSetStartTimeFor(entry.displayName)}
                    onClick={() => openMissingStartTime(entry.id)}>{text.rosterSetStartTime}</button></>}
            </div>}</td></tr>;
        })}</tbody>
      </table></div>
      {!filtered.length && <p>{paymentAttentionOnly && paymentAttentionCount === 0 ? text.rosterNoPaymentAttention : text.noMatches}</p>}
      {lastPage > 0 && <div className={styles.toolbar}><button className="secondary" disabled={disabled || currentPage === 0} onClick={() => setPage(currentPage - 1)}>{text.previousPage}</button>
        <span>{currentPage + 1} / {lastPage + 1}</span><button className="secondary" disabled={disabled || currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>{text.nextPage}</button></div>}
    </>}
  </section>;
}

/** Arbetsytan för vald deltagare: fakta, gällande resultat och åtgärder. */
export function ParticipantWorkPanel({ ws }: { ws: Workspace }) {
  const { action, approvalAttempt, authenticated, capacityAttempt, cardAttempt, chooseAction, classesById, data,
    disabled, dnfAttempt, dnsAttempt, dsqAttempt, effectiveResult, effectiveResultError, filtered, identityAttempt,
    lock, navigateParticipantSequence, ntAttempt, oocAttempt, openAssignedCourse, openRecalculation,
    participantActionPending, paymentStatusAttempt, raceId, recalculationAttempt, rentalAttempt, rentalReturnAttempt,
    rentalReuseAttempt, selected, selectedClass, selectedIndex, setParticipantActionPending, timeAttempt,
    transferAttempt, workPanel, workflowLocked } = ws;
  return <section className={styles.panel} aria-label={text.participantAction} data-panel="WORK" ref={workPanel} tabIndex={-1} id={`participant-work-${raceId}`}>
    {selected && selectedClass && action !== "REGISTRATION" && <section className={styles.selectedParticipantContext}
      aria-label={navigationText.selectedParticipantContext}>
      <span className={styles.selectedParticipantLabel}>{navigationText.selectedParticipantContext}</span>
      <strong>{selected.displayName}</strong>
      <span className={styles.selectedParticipantClass}>{selectedClass.name}</span>
    </section>}
    {selected && action !== "REGISTRATION" && <nav className={styles.participantSequence}
      aria-label={navigationText.participantSequence}>
      <button type="button" className="secondary" disabled={workflowLocked || selectedIndex <= 0}
        onClick={() => navigateParticipantSequence(-1)}>{navigationText.previousParticipant}</button>
      <span>{selectedIndex < 0 ? navigationText.participantOutsideSequence
        : navigationText.participantPosition(selectedIndex + 1, filtered.length)}</span>
      <button type="button" className="secondary"
        disabled={workflowLocked || selectedIndex < 0 || selectedIndex >= filtered.length - 1}
        onClick={() => navigateParticipantSequence(1)}>{navigationText.nextParticipant}</button>
    </nav>}
    {selected && data && action !== "REGISTRATION" && <RaceParticipantFacts entry={selected}
      raceClass={classesById.get(selected.classId)!} timeZone={data.timeZone} disabled={disabled} activeAction={action} onEdit={chooseAction} />}
    {!selected && action !== "REGISTRATION" && <p>{navigationText.selectedHelp}</p>}
    {selected && !transferAttempt && !cardAttempt && !rentalAttempt && !rentalReturnAttempt && !rentalReuseAttempt && !paymentStatusAttempt && !timeAttempt && !recalculationAttempt && !capacityAttempt && !identityAttempt && !dnsAttempt && !dnfAttempt && !ntAttempt && !oocAttempt && !dsqAttempt && !approvalAttempt && <section className={styles.resultSummary} aria-label={text.effectiveResult}>
      {effectiveResult?.entryId === selected.id ? <>
        <p><strong className={effectiveResult.state === "ACTIVE_RESULT" && (effectiveResult.result.status === "MP" || effectiveResult.result.status === "DSQ") ? styles.rosterCritical : undefined}>{text.effectiveResult}: {effectiveResult.state === "ACTIVE_RESULT" ? sv.publicResultsStatusLabels[effectiveResult.result.status] : effectiveResult.state === "NO_ACTIVE_RESULT" ? text.noActiveResult : text.noPublishedResult}</strong>
          {effectiveResult.state === "ACTIVE_RESULT" && "elapsedMs" in effectiveResult.result && effectiveResult.result.elapsedMs !== undefined && <> · {resultDuration(effectiveResult.result.elapsedMs)}</>}</p>
        {effectiveResult.state === "ACTIVE_RESULT" && <>
          <p>{sv.publicResultsReasonLabels[effectiveResult.result.reason]}
            {effectiveResult.governingDecision !== "NONE" && <> · {text.governingDecision}: <strong>{text.governingDecisions[effectiveResult.governingDecision]}</strong></>}</p>
          {selected.resultRevisionMarker !== null && <p><strong>{text.resultFinishCorrection}:</strong> {selected.resultRevisionMarker === "MANUAL_FINISH_TIME_CORRECTION"
            ? text.rosterFinishCorrection : text.rosterFinishCorrectionWithdrawal}</p>}
          {effectiveResult.resultClass.id !== selected.classId && <p>{text.resultHistoricalClass}: {effectiveResult.resultClass.name}</p>}
          {effectiveResult.resultSnapshotVersion < effectiveResult.snapshotVersion && <>
            <p className={styles.resultStale}>{text.resultStale}</p>
            <button type="button" className="secondary" disabled={disabled}
              aria-label={text.resultStaleOpenFor(selected.displayName)} onClick={() => openRecalculation(selected.id)}>
              {text.resultStaleOpen}
            </button>
          </>}
          <p>{text.resultRevision}: {effectiveResult.result.revision} · {text.selectedPublishedRevision}: {effectiveResult.selectedRevision.revision}</p>
        </>}
        <p className={styles.organisation}>{text.resultReadAt}: {formatStartListTime(effectiveResult.generatedAt, effectiveResult.timeZone)}</p>
      </> : <p>{effectiveResultError ? text.effectiveResultError : text.effectiveResultPending}</p>}
    </section>}
    {selected && selectedClass && data && action === "INFO" && <RaceParticipantCourse raceId={raceId}
      snapshotVersion={data.snapshotVersion} raceClass={selectedClass} disabled={workflowLocked}
      onUnauthorized={lock} onOpenCourse={openAssignedCourse} />}
    <EntryActionForms ws={ws} />
    {selected && data && <RaceResultControls result={effectiveResult?.entryId === selected.id ? effectiveResult : undefined}
      resultError={effectiveResultError} timeZone={data.timeZone} />}
    {selected && action !== "REGISTRATION" && <details className={styles.resultActions}
      open={(["RECALCULATION", "HISTORY", "DNS", "DNF", "DSQ", "OOC", "NT", "APPROVAL"] as Action[]).includes(action) || undefined}>
      <summary>{navigationText.resultActions}</summary>
      <div className={styles.actions} aria-label={text.participantAction}>
      <button type="button" className="secondary" aria-pressed={action === "RECALCULATION"} disabled={disabled} onClick={() => chooseAction("RECALCULATION")}>{text.recalculationAction}</button>
      <button type="button" className="secondary" aria-pressed={action === "HISTORY"} disabled={disabled} onClick={() => chooseAction("HISTORY")}>{text.historyAction}</button>
      <button type="button" className="secondary" aria-pressed={action === "DNS"} disabled={disabled} onClick={() => chooseAction("DNS")}>{text.dnsAction}</button>
      <button type="button" className="secondary" aria-pressed={action === "DNF"} disabled={disabled} onClick={() => chooseAction("DNF")}>{text.dnfAction}</button>
      <button type="button" className="secondary" aria-pressed={action === "DSQ"} disabled={disabled} onClick={() => chooseAction("DSQ")}>{text.dsqAction}</button>
      <button type="button" className="secondary" aria-pressed={action === "OOC"} disabled={disabled} onClick={() => chooseAction("OOC")}>{text.oocAction}</button>
      <button type="button" className="secondary" aria-pressed={action === "NT"} disabled={disabled} onClick={() => chooseAction("NT")}>{text.ntAction}</button>
      <button type="button" className="secondary" aria-pressed={action === "APPROVAL"} disabled={disabled} onClick={() => chooseAction("APPROVAL")}>{text.approvalAction}</button>
    </div></details>}
    <ResultDecisionForms ws={ws} />
    <RegistrationForm ws={ws} />
    <RecalculationForm ws={ws} />
    {authenticated && selected && <details className={styles.claimPanel} open={participantActionPending || undefined}
      onToggle={event => { if (participantActionPending && !event.currentTarget.open) event.currentTarget.open = true; }}>
      <summary>{text.claimOptionalSummary}</summary>
      <ParticipantEntryClaimAdmin key={`${raceId}:${selected.id}`} raceId={raceId} entryId={selected.id}
        displayName={selected.displayName} onPendingChange={setParticipantActionPending} />
    </details>}
  </section>;
}

/** Utskrift av hyrbrickor som inte är återlämnade. */
export function RentalPrint({ ws }: { ws: Workspace }) {
  const { classNames, data, rentalEntries } = ws;
  return <>
    {data && rentalEntries.length > 0 && <section className={styles.rentalPrint} data-rental-print aria-label={text.rentalPrintHeading}>
      <h1>{text.rentalPrintHeading}</h1>
      <p>{data.eventName} · {data.raceName} · {data.raceDate}</p>
      <p>{text.rentalPrintGenerated}: {formatStartListTime(data.generatedAt, data.timeZone)} · {data.timeZone}</p>
      <p>{text.rentalPrintCount}: {rentalEntries.length}</p>
      <p>{text.rentalPrintPrivacy}</p>
      <table><caption>{text.rentalPrintCaption}</caption><thead><tr>
        <th scope="col">{text.name}</th><th scope="col">{text.raceClass}</th><th scope="col">{text.rentalPrintCard}</th>
      </tr></thead><tbody>{rentalEntries.map(entry => <tr key={entry.id}>
        <td>{entry.displayName}{entry.organisationName ? <><br /><span>{entry.organisationName}</span></> : null}</td>
        <td>{classNames.get(entry.classId)}</td><td>{entry.activeAssignment!.cardNumber}</td>
      </tr>)}</tbody></table>
    </section>}
  </>;
}
