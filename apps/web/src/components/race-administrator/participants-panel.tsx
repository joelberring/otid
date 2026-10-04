"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { sv } from "../../i18n/sv";
import { relaySv as relayText } from "../../i18n/relay-sv";
import { formatClockTime } from "../../lib/clock-time";
import { administratorRosterResultFilters, needsPaymentAttention, type AdministratorRosterResultFilter } from "../../lib/administrator-roster-filter";
import { resultDuration } from "./types";
import { ParticipantCard } from "./participant-card";
import { RelayTeams } from "./relay-teams";
import type { Workspace } from "./workspace-state";

/** Deltagare: lista och deltagarkort för vald deltagare. */
export function ParticipantsPanel({ ws }: { ws: Workspace }) {
  const { currentPage, disabled, mobilePanel, navigateMobile, participantsVisible, raceId, revealSelected,
    selected, selectedIndex, selectedPage, wideTable, workflowLocked } = ws;
  return <section className={styles.workflowGroup} id={`workflow-${raceId}-participants`} aria-label={navigationText.steps.ENTRIES}
      hidden={!participantsVisible}>
    <p className={styles.workflowHelp}>{text.workflowParticipantsHelp}</p>
    <RelayTeams ws={ws} visible={participantsVisible} />
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
      <ParticipantCard ws={ws} />
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
          const open = () => select(entry.id, false, false, paymentAttentionOnly ? "PAYMENT" : undefined);
          // ADR-0169: ett klick var som helst i raden öppnar deltagarkortet. Namnknappen är vägen för tangentbord.
          return <tr key={entry.id} className={styles.rosterRow} data-selected={entryId === entry.id ? "true" : undefined}
            onClick={event => { if (!disabled && !(event.target as HTMLElement).closest("button")) open(); }}>
            <td><button className={styles.participant} disabled={disabled}
            aria-label={`${entry.displayName} ${entry.organisationName ?? text.none}`}
            aria-pressed={entryId === entry.id} onClick={open}>{entry.displayName}</button>
            <div className={styles.rosterMetadata}>
              <span className={styles.organisation} aria-hidden="true">{entry.organisationName ?? text.none}</span>
              {entry.resultRevisionMarker === "MANUAL_FINISH_TIME_CORRECTION" && <span className={styles.resultBadge}>{text.rosterFinishCorrection}</span>}
              {entry.resultRevisionMarker === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" && <span className={styles.resultBadge}>{text.rosterFinishCorrectionWithdrawal}</span>}
              {entry.activeAssignment?.isRental && <span className={`${styles.resultBadge} ${entry.activeAssignment.rentalReturned ? "" : styles.resultBadgeAttention}`}>{text.rentalBadge} · {entry.activeAssignment.cardNumber} · {entry.activeAssignment.rentalReturned ? text.rentalReturned : text.rentalOutstanding}</span>}
              {entry.paymentStatus !== "UNMARKED" && <span className={`${styles.resultBadge} ${needsPaymentAttention(entry.paymentStatus) ? styles.resultBadgeAttention : ""}`}>{text.paymentStatusBadge} · {text.paymentStatuses[entry.paymentStatus]}</span>}
            </div>
          </td><td data-label={text.raceClass}>{raceClass.name}
            {entry.relay && <span className={styles.rosterMetadata}>{relayText.teamHeading(entry.relay.teamNumber, entry.relay.teamName)} ·
              {" "}{relayText.leg(entry.relay.leg)}</span>}</td>
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
            <div className={styles.startDetail}>{!entry.relay && <strong>{text.rosterFixedStart}</strong>}
              {entry.fixedStartTime
                ? <time dateTime={entry.fixedStartTime}>{formatClockTime(entry.fixedStartTime, data.timeZone)}</time>
                : entry.relay ? <span>{relayText.waitingStart}</span> : <><span className={styles.startMissing}>{text.rosterMissingFixedStart}</span>
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

/** Utskrift av hyrbrickor som inte är återlämnade. */
export function RentalPrint({ ws }: { ws: Workspace }) {
  const { classNames, data, rentalEntries } = ws;
  return <>
    {data && rentalEntries.length > 0 && <section className={styles.rentalPrint} data-rental-print aria-label={text.rentalPrintHeading}>
      <h1>{text.rentalPrintHeading}</h1>
      <p>{data.eventName} · {data.raceName} · {data.raceDate}</p>
      <p>{text.rentalPrintGenerated}: {formatClockTime(data.generatedAt, data.timeZone)}</p>
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
