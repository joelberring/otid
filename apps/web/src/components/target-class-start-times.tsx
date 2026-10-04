import React, { useState } from "react";
import type { EntryTransferCandidates } from "@o-tid/contracts";
import { projectTargetClassStartTimes } from "../lib/target-class-start-times";
import { formatClockTime } from "../lib/clock-time";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import styles from "./race-administrator-workspace.module.css";

export function TargetClassStartTimes({ entries, classId, timeZone, proposedTime }: {
  entries: EntryTransferCandidates["entries"]; classId: string; timeZone: string; proposedTime: string | null;
}) {
  const [page, setPage] = useState(0);
  const projection = projectTargetClassStartTimes(entries, classId, proposedTime);
  const lastPage = Math.max(0, Math.ceil(projection.rows.length / 20) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = projection.rows.slice(currentPage * 20, (currentPage + 1) * 20);
  return <section className={styles.targetTimes} aria-label={text.targetTimesTitle}>
    <p className={styles.organisation}>{text.targetTimesBasis}</p>
    {projection.matchingTimeCount > 0 && <p className={styles.warning} role="status">{text.targetTimeMatch}: {projection.matchingTimeCount}. {text.targetTimeAdvisory}</p>}
    <details><summary>{text.targetTimesTitle} ({projection.rows.length})</summary>
      <div className={styles.workspace}>
        <p>{text.targetTimesHelp}</p>
        <p>{text.targetTimesMissing}: {projection.missingTimeCount}</p>
        {projection.rows.length === 0 ? <p>{text.targetTimesEmpty}</p> : <>
          <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={text.targetTimesTime}>
          <table className={styles.table}><thead><tr><th>{text.targetTimesParticipant}</th><th>{text.targetTimesTime}</th></tr></thead>
            <tbody>{visible.map((row) => <tr key={row.id}><td>{row.displayName}</td><td><time dateTime={row.fixedStartTime}>{formatClockTime(row.fixedStartTime, timeZone)}</time></td></tr>)}</tbody>
          </table>
          </div>
          <div className={styles.toolbar}>
            <button type="button" className="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{text.targetTimesPrevious}</button>
            <span>{text.targetTimesPage} {currentPage + 1} / {lastPage + 1} · {text.shown} {visible.length} {text.of} {projection.rows.length}</span>
            <button type="button" className="secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>{text.targetTimesNext}</button>
          </div>
        </>}
      </div>
    </details>
  </section>;
}
