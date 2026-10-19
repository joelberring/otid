"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { raceTypeSv } from "../../i18n/race-type-sv";
import { sv } from "../../i18n/sv";
import { relaySv as relayText } from "../../i18n/relay-sv";
import { formatClockTime } from "../../lib/clock-time";
import { rosterStatusOptions } from "../../lib/administrator-roster-filter";
import { sectionForPanel } from "../../lib/race-sections";
import { resultDuration } from "./types";
import { ParticipantCard } from "./participant-card";
import { RelayTeams } from "./relay-teams";
import { Button, EmptyState } from "../ui";
import type { Workspace } from "./workspace-state";

/**
 * Anmälda: listan och deltagarkortet för vald deltagare. Rubriken heter som steget (Anmälda, Deltagare eller Lag);
 * en person är alltid en deltagare (PLAN.md steg 24). Kortet visas bredvid listan först när någon är vald.
 */
export function ParticipantsPanel({ ws }: { ws: Workspace }) {
  const { action, data, mobilePanel, navigateStep, participantsVisible, profile, raceId, revealSelected,
    selected, selectedIndex, selectedPage, currentPage, workflowLocked } = ws;
  const relayClasses = data?.classes.filter(row => row.relayLegCount !== undefined).length ?? 0;
  const individualClasses = (data?.classes.length ?? 0) - relayClasses;
  // Stafett utan stafettklass: säg vad som behövs i stället för att visa en tom deltagarlista.
  if (profile.features.relay && data && relayClasses === 0) {
    const classes = sectionForPanel(profile, "CLASSES");
    return <section className={styles.workflowGroup} aria-label={navigationText.steps.ENTRIES} hidden={!participantsVisible}>
      <h2>{raceTypeSv.sections.TEAMS}</h2>
      <EmptyState title={relayText.noRelayClassTitle}
        action={classes && <Button onClick={() => navigateStep(classes.id)}>{relayText.goToClasses}</Button>}>
        {relayText.noRelayClassHelp}</EmptyState>
    </section>;
  }
  const card = !!selected || action === "REGISTRATION";
  return <section className={styles.workflowGroup} id={`workflow-${raceId}-participants`} aria-label={navigationText.steps.ENTRIES}
      hidden={!participantsVisible}>
    {profile.features.relay && <RelayTeams ws={ws} visible={participantsVisible} />}
    {(!profile.features.relay || individualClasses > 0) && <>
      {selected && (selectedIndex < 0 || selectedPage !== currentPage) && <div className={styles.selectionContext}
        aria-label={navigationText.selectedContext}>
        <span><strong>{navigationText.selected}: {selected.displayName}</strong> · {selectedIndex < 0
          ? navigationText.selectedOutsideFilters : navigationText.selectedOnPage(selectedPage + 1)}</span>
        <button type="button" className="secondary" disabled={workflowLocked} onClick={revealSelected}>{selectedIndex < 0
          ? navigationText.revealFilteredSelected : navigationText.revealSelectedOnPage(selectedPage + 1)}</button>
      </div>}
      <div className={styles.columns} data-mobile-panel={mobilePanel} data-card={card}>
        <ParticipantList ws={ws} />
        <ParticipantCard ws={ws} />
      </div>
    </>}
  </section>;
}

/** Deltagarlistan: sök och klass alltid, övriga filter under "Fler filter" (bara de som har något att visa). */
export function ParticipantList({ ws }: { ws: Workspace }) {
  const { classesById, currentPage, data, disabled, entryId, filtered, lastPage, listPanel, missingFixedStartOnly,
    newParticipant, olderResultCount, olderResultsOnly, openMissingStartTime, pageSize, printPrivate, profile, query, raceId,
    rentalCardCount, rentalCardsOnly, rentalEntries, resultState, rosterClassId, rosterOrder, section, select, setMissingFixedStartOnly,
    setOlderResultsOnly, setPage, setPageSize, setQuery, setRentalCardsOnly, setResultState, setRosterClassId, setRosterOrder,
    visible, workflowLocked } = ws;
  const [moreFilters, setMoreFilters] = useState(false);
  const title = raceTypeSv.sections[section.label === "TEAMS" ? "PARTICIPANTS" : section.label];
  const empty = !!data && data.entries.length === 0;
  const statusOptions = rosterStatusOptions(data?.entries ?? [], resultState);
  const filtersActive = resultState !== "ALL" || rosterOrder !== "NAME" || olderResultsOnly || rentalCardsOnly || pageSize !== 25;
  const showMore = moreFilters || filtersActive;
  const fixedStarts = !!data?.classes.some(row => row.startRule === "FIXED");
  return <section className={styles.panel} aria-label={text.participants} data-panel="LIST" ref={listPanel} tabIndex={-1} id={`participant-list-${raceId}`}>
    <div className={styles.listHead}>
      <div><h2>{title}</h2>{!empty && <p className={styles.workflowHelp}>{text.workflowParticipantsHelp}</p>}</div>
      {!empty && <div className={styles.actions}>
        <Button disabled={disabled || !data} onClick={newParticipant}>{text.newParticipant}</Button>
        {rentalEntries.length > 0 && <Button variant="secondary" disabled={disabled}
          onClick={() => printPrivate("RENTAL")}>{text.rentalPrint}</Button>}
      </div>}
    </div>
    {empty && <EmptyState title={navigationText.entriesEmpty} action={<>
      <Button disabled={disabled} onClick={newParticipant}>{text.newParticipant}</Button>
      {profile.features.import && <Link href={`/admin/${raceId}/imports`}>{navigationText.entriesImport}</Link>}
    </>}>{navigationText.entriesEmptyHelp}</EmptyState>}
    {!empty && <div className={styles.rosterFilters}>
      <label className={styles.rosterSearch}>{navigationText.search}<input type="search" autoComplete="off" value={query}
        onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>{navigationText.classFilter}<select value={rosterClassId} onChange={event => { setRosterClassId(event.target.value); setPage(0); }}>
        <option value="">{text.rosterAllClasses}</option>
        {data?.classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      {/* Med ett filter påslaget står filtren framme, så att det syns varför listan är kortare. */}
      {!filtersActive && <Button variant="quiet" aria-expanded={showMore} aria-controls={`roster-more-${raceId}`}
        onClick={() => setMoreFilters(!moreFilters)}>{showMore ? text.rosterFewerFilters : text.rosterMoreFilters}</Button>}
    </div>}
    {!empty && showMore && <div className={styles.rosterMoreFilters} id={`roster-more-${raceId}`}>
      <label>{text.rosterResultStateFilter}<select value={resultState} onChange={event => {
        const next = statusOptions.find(option => option.value === event.target.value);
        if (next) { setResultState(next.value); setPage(0); }
      }}>
        {statusOptions.map(({ value, count }) => <option key={value} value={value}>
          {value === "ALL" ? text.rosterResultStateAll : value === "NO_ACTIVE_RESULT" ? text.rosterNoActiveFilter :
            value === "NO_PUBLISHED_RESULT" ? text.rosterNoPublishedFilter : sv.publicResultsStatusLabels[value]} ({count})
        </option>)}
      </select></label>
      {fixedStarts && <label>{navigationText.rosterOrder}<select value={rosterOrder}
        onChange={event => { setRosterOrder(event.target.value === "FIXED_START" ? "FIXED_START" : "NAME"); setPage(0); }}>
        <option value="NAME">{navigationText.rosterNameOrder}</option>
        <option value="FIXED_START">{navigationText.rosterFixedStartOrder}</option>
      </select></label>}
      <label>{navigationText.rows}<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }}>
        {[25, 100, 250].map(size => <option key={size} value={size}>{size}</option>)}
      </select></label>
      {(!!olderResultCount || olderResultsOnly) && <label className={styles.listFilter}><input type="checkbox" checked={olderResultsOnly}
        onChange={(event) => { setOlderResultsOnly(event.target.checked); setPage(0); }} />{text.rosterOlderResultsCompact(olderResultCount)}</label>}
      {(!!rentalCardCount || rentalCardsOnly) && <label className={styles.listFilter}><input type="checkbox" checked={rentalCardsOnly}
        onChange={(event) => { setRentalCardsOnly(event.target.checked); setPage(0); }} />{text.rosterRentalCardsCompact(rentalCardCount)}</label>}
    </div>}
    {missingFixedStartOnly && <div className={styles.activeRosterFilter}>
      <span>{text.rosterMissingFixedStartFilter}</span>
      <button type="button" className="secondary" onClick={() => { setMissingFixedStartOnly(false); setPage(0); }}>{text.rosterShowAllStartTimes}</button>
    </div>}
    {data && !empty && <><p className={styles.workflowHelp}>{text.shown} {filtered.length} {text.of} {data.entries.length}
      {rosterOrder === "FIXED_START" && <span className={styles.rosterOrderHint}> · {navigationText.rosterFixedStartOrderHelp}</span>}</p>
      <div className={styles.tableScroll}><table className={`${styles.table} ${styles.rosterTable}`}><thead><tr>
        <th scope="col">{text.name}</th><th scope="col">{text.raceClass}</th>
        <th scope="col">{text.rosterResultStateFilter}</th><th scope="col">{text.rosterCard}</th><th scope="col">{text.rosterStart}</th>
      </tr></thead>
        <tbody>{visible.map((entry) => {
          const raceClass = classesById.get(entry.classId);
          if (!raceClass) throw new Error("Validated participant class missing");
          const open = () => select(entry.id);
          // ADR-0169: ett klick var som helst i raden öppnar deltagarkortet. Namnknappen är vägen för tangentbord.
          return <tr key={entry.id} className={styles.rosterRow} data-selected={entryId === entry.id ? "true" : undefined}
            onClick={event => { if (!(event.target as HTMLElement).closest("button")) open(); }}>
            <td><button className={styles.participant} aria-label={`${entry.displayName} ${entry.organisationName ?? text.none}`}
              aria-pressed={entryId === entry.id} onClick={open}>{entry.displayName}</button>
            <div className={styles.rosterMetadata}>
              <span className={styles.organisation} aria-hidden="true">{entry.organisationName ?? text.none}</span>
              <span className={styles.rosterMobileClass} aria-hidden="true">{raceClass.name}</span>
              {entry.resultRevisionMarker === "MANUAL_FINISH_TIME_CORRECTION" && <span className={styles.resultBadge}>{text.rosterFinishCorrection}</span>}
              {entry.resultRevisionMarker === "MANUAL_FINISH_TIME_CORRECTION_WITHDRAWAL" && <span className={styles.resultBadge}>{text.rosterFinishCorrectionWithdrawal}</span>}
              {entry.activeAssignment?.isRental && <span className={`${styles.resultBadge} ${entry.activeAssignment.rentalReturned ? "" : styles.resultBadgeAttention}`}>{text.rentalBadge} · {entry.activeAssignment.cardNumber} · {entry.activeAssignment.rentalReturned ? text.rentalReturned : text.rentalOutstanding}</span>}
            </div>
          </td><td className={styles.classCell}>{raceClass.name}
            {entry.relay && <span className={styles.rosterMetadata}>{relayText.teamHeading(entry.relay.teamNumber, entry.relay.teamName)} ·
              {" "}{relayText.leg(entry.relay.leg)}</span>}</td>
          <td className={styles.rosterResultCell}>
            {entry.effectiveResult.state === "ACTIVE_RESULT"
              ? <><span className={styles.rosterResultLine}>
                <strong className={entry.effectiveResult.result.status === "MP" || entry.effectiveResult.result.status === "DSQ" ? styles.rosterCritical : undefined}>{sv.publicResultsStatusLabels[entry.effectiveResult.result.status]}</strong>
                {"elapsedMs" in entry.effectiveResult.result && entry.effectiveResult.result.elapsedMs !== undefined &&
                  <span className={styles.rosterResultTime}>{resultDuration(entry.effectiveResult.result.elapsedMs)}</span>}
              </span>{entry.resultFreshness === "OLDER_SNAPSHOT" &&
                <span className={styles.rosterStale}>{text.rosterOlderResult}</span>}</>
              : <span className={styles.muted}>{entry.effectiveResult.state === "NO_ACTIVE_RESULT" ? text.rosterNoActiveResult : text.rosterNoPublishedResult}</span>}
            <span className={styles.rowChevron} aria-hidden="true">›</span>
          </td>
          <td className={styles.cardCell}>{entry.multipleActiveAssignments
            ? text.rosterMultipleActiveCards : entry.activeAssignment?.cardNumber ?? <span className={styles.muted}>{text.rosterNoActiveCard}</span>}</td>
          <td className={styles.startCell}>{raceClass.startRule === "PUNCH" ? <span className={styles.muted}>{text.rosterFreeStart}</span> :
            <div className={styles.startDetail}>
              {entry.fixedStartTime
                ? <time dateTime={entry.fixedStartTime}>{formatClockTime(entry.fixedStartTime, data.timeZone)}</time>
                : entry.relay ? <span>{relayText.waitingStart}</span> : <><span className={styles.startMissing}>{text.rosterMissingFixedStart}</span>
                  <button type="button" className={styles.startSetButton} disabled={workflowLocked}
                    aria-label={text.rosterSetStartTimeFor(entry.displayName)}
                    onClick={() => openMissingStartTime(entry.id)}>{text.rosterSetStartTime}</button></>}
            </div>}</td></tr>;
        })}</tbody>
      </table></div>
      {!filtered.length && <p>{text.noMatches}</p>}
      {lastPage > 0 && <div className={styles.pager}><Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{text.previousPage}</Button>
        <span>{currentPage + 1} / {lastPage + 1}</span><Button variant="secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>{text.nextPage}</Button></div>}
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
