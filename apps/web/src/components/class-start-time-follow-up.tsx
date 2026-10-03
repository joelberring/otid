import React, { useState } from "react";
import type { EntryTransferCandidates } from "@o-tid/contracts";
import { projectTargetClassStartTimes } from "../lib/target-class-start-times";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import styles from "./race-administrator-workspace.module.css";

const pageSize = 8;

export function ClassStartTimeFollowUp({ entries, classId, disabled, onSelect, onOpenDraw }: {
  entries: EntryTransferCandidates["entries"];
  classId: string;
  disabled: boolean;
  onSelect: (entryId: string) => void;
  onOpenDraw: (classId: string) => void;
}) {
  const [page, setPage] = useState(0);
  const missing = projectTargetClassStartTimes(entries, classId, null).missingRows;
  const lastPage = Math.max(0, Math.ceil(missing.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = missing.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return <section className={styles.startTimeFollowUp} aria-label={text.startTimeFollowUpTitle}>
    <h2>{text.startTimeFollowUpTitle}</h2>
    {missing.length === 0 ? <p>{text.startTimeFollowUpComplete}</p> : <>
      <p className={styles.warning} role="status">{text.startTimeFollowUpCount(missing.length)}</p>
      <p>{text.startTimeFollowUpHelp}</p>
      <button type="button" className="secondary" disabled={disabled} onClick={() => onOpenDraw(classId)}>
        {text.startTimeFollowUpDraw}
      </button>
      <ul className={styles.followUpList}>{visible.map((entry) => <li key={entry.id}>
        <span>{entry.displayName}</span>
        <button type="button" className="secondary" disabled={disabled}
          aria-label={text.startTimeFollowUpOpenFor(entry.displayName)} onClick={() => onSelect(entry.id)}>
          {text.startTimeFollowUpOpen}
        </button>
      </li>)}</ul>
      {lastPage > 0 && <div className={styles.toolbar}>
        <button type="button" className="secondary" disabled={disabled || currentPage === 0}
          onClick={() => setPage(currentPage - 1)}>{text.startTimeFollowUpPrevious}</button>
        <span>{text.startTimeFollowUpPage} {currentPage + 1} / {lastPage + 1} · {text.shown} {visible.length} {text.of} {missing.length}</span>
        <button type="button" className="secondary" disabled={disabled || currentPage === lastPage}
          onClick={() => setPage(currentPage + 1)}>{text.startTimeFollowUpNext}</button>
      </div>}
    </>}
  </section>;
}
