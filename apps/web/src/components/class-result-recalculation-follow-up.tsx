import React, { useState } from "react";
import type { ResultRecalculationCandidates } from "../lib/result-recalculation-admin-client";
import { projectClassResultRecalculationFollowUp } from "../lib/class-result-recalculation-follow-up";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import styles from "./race-administrator-workspace.module.css";

const pageSize = 8;

export function ClassResultRecalculationFollowUp({ candidates, classId, disabled, onLoad, onSelect }: {
  candidates: ResultRecalculationCandidates | undefined;
  classId: string;
  disabled: boolean;
  onLoad: () => void;
  onSelect: (entryId: string) => void;
}) {
  const [page, setPage] = useState(0);
  const rows = candidates ? projectClassResultRecalculationFollowUp(candidates, classId) : [];
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return <section className={styles.startTimeFollowUp} aria-label={text.classResultFollowUpTitle}>
    <h2>{text.classResultFollowUpTitle}</h2>
    <p>{text.classResultFollowUpHelp}</p>
    <button type="button" className="secondary" disabled={disabled} onClick={onLoad}>
      {text.classResultFollowUpLoad}
    </button>
    {candidates && (rows.length === 0 ? <p>{text.classResultFollowUpComplete}</p> : <>
      <p className={styles.warning} role="status">{text.classResultFollowUpCount(rows.length)}</p>
      <ul className={styles.followUpList}>{visible.map((entry) => <li key={entry.id}>
        <span><strong>{entry.displayName}</strong><br />
          {text.classResultFollowUpRevision(entry.latestResultRevision.revision,
            entry.latestResultRevision.snapshotVersion, candidates.snapshotVersion)}<br />
          {entry.readiness === "READY" ? text.classResultFollowUpReady : text.recalculationReadiness[entry.readiness]}
        </span>
        <button type="button" className="secondary" disabled={disabled}
          aria-label={text.classResultFollowUpOpenFor(entry.displayName)} onClick={() => onSelect(entry.id)}>
          {text.classResultFollowUpOpen}
        </button>
      </li>)}</ul>
      {lastPage > 0 && <div className={styles.toolbar}>
        <button type="button" className="secondary" disabled={disabled || currentPage === 0}
          onClick={() => setPage(currentPage - 1)}>{text.startTimeFollowUpPrevious}</button>
        <span>{text.startTimeFollowUpPage} {currentPage + 1} / {lastPage + 1} · {text.shown} {visible.length} {text.of} {rows.length}</span>
        <button type="button" className="secondary" disabled={disabled || currentPage === lastPage}
          onClick={() => setPage(currentPage + 1)}>{text.startTimeFollowUpNext}</button>
      </div>}
    </>)}
  </section>;
}
