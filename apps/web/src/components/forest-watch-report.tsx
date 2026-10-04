import React from "react";
import type { StartCheckinRosterResponse } from "@o-tid/contracts";
import { forestWatchSv as text } from "../i18n/forest-watch-sv";
import { formatClockTime } from "../lib/clock-time";
import { filterForestWatchEntries } from "../lib/forest-watch-filter";
import { reportedStartMinutes } from "../lib/reported-start-age";
import styles from "./forest-watch.module.css";

const groups = ["CONFLICT", "STARTED_NO_RETURN", "UNCONFIRMED", "NOT_STARTED", "RETURNED"] as const;

export function ForestWatchReport({ data, classId, query = "", stale, onOpenHistory, onReviewConflict, disabled = false, reportedStarts, sortByAge = false }: {
  data: StartCheckinRosterResponse; classId: string; query?: string; stale: boolean;
  onOpenHistory?: (entryId: string) => void; disabled?: boolean;
  onReviewConflict?: (entryId: string) => void;
  reportedStarts?: ReadonlyArray<{ entryId: string; observedAt: string | null }>;
  sortByAge?: boolean;
}) {
  const ages = new Map(reportedStarts?.map(row => [row.entryId, reportedStartMinutes(row.observedAt, data.generatedAt)]));
  const entries = filterForestWatchEntries(data.entries, classId, query);
  const className = classId ? data.entries.find((entry) => entry.classId === classId)?.className ?? classId : text.allClasses;
  return <section className={styles.report} aria-label={text.title}>
    <h2>{text.title}</h2>
    <p>{text.private}</p>
    <p className={styles.warning}>{text.uncertainty}</p>
    {stale && <p role="alert" className={styles.warning}>{text.stale}</p>}
    <p>{text.generated}: {formatClockTime(data.generatedAt, data.timeZone)}</p>
    <p>{text.raceClass}: {className} · {text.shown}: {entries.length} / {data.entries.length} ({text.total})</p>
    <p>{text.searchFilter}: {query.trim() || text.noSearch}</p>
    {sortByAge && <p>{text.ageSortHelp}</p>}
    {(classId || query.trim()) && <p className={styles.warning}>{text.filteredWarning}</p>}
    {entries.length === 0 && <p className={styles.warning}>{text.noMatchesWarning}</p>}
    {groups.map((state) => {
      const rows = entries.filter((entry) => entry.forestState === state);
      if (sortByAge && state === "STARTED_NO_RETURN") rows.sort((a, b) => {
        const left = ages.get(a.entryId) ?? null, right = ages.get(b.entryId) ?? null;
        if (left === null) return right === null ? 0 : -1;
        return right === null ? 1 : right - left;
      });
      const totalForState = data.entries.filter((entry) => entry.forestState === state).length;
      return <section key={state} data-forest-group={state} data-forest-visible={rows.length}
        data-forest-total={totalForState} className={styles.group}>
        <h3>{text.groups[state]} ({rows.length})</h3>
        <p className={styles.groupCounts}>{text.visibleSelection} {rows.length} / {text.total} {totalForState}</p>
        {rows.length > 0 && <table>
          <thead><tr><th>{text.name}</th><th>{text.raceClass} / {text.start}</th><th>{text.status}</th></tr></thead>
          <tbody>{rows.map((entry) => <tr key={entry.entryId}>
            <td><strong>{entry.displayName}</strong>{onOpenHistory && <button type="button" disabled={disabled}
              onClick={() => onOpenHistory(entry.entryId)}>{text.history}</button>}
              {onReviewConflict && entry.conflictingReports && <button type="button" disabled={disabled}
                onClick={() => onReviewConflict(entry.entryId)}>{text.reviewConflict}</button>}
              <div>{entry.organisationName ?? text.noOrganisation}</div>
              <div>{text.card}: {entry.multipleActiveAssignments ? text.multipleCards : entry.cardNumber ?? text.noCard}</div></td>
            <td><strong>{entry.className}</strong><div>{entry.startRule === "PUNCH" ? text.punch : entry.fixedStartTime
              ? formatClockTime(entry.fixedStartTime, data.timeZone) : text.missingTime}</div></td>
            <td><div>{text.reports[entry.startState]}</div>
              {entry.manualReturnRegistered && <div>{text.manualReturn}</div>}
              {entry.readoutReturnRegistered && <div>{text.readoutReturn}</div>}
              {!entry.manualReturnRegistered && !entry.readoutReturnRegistered && <div>{text.noReturn}</div>}
              {entry.activeDns && <div>{text.activeDns}</div>}
              {state === "STARTED_NO_RETURN" && reportedStarts && <div>{text.reportedStartAge}: {ages.get(entry.entryId) == null
                ? text.unknownStartAge : `${ages.get(entry.entryId)} ${text.minutes}`}</div>}
              {state === "CONFLICT" && <strong>{text.conflict}</strong>}</td>
          </tr>)}</tbody>
        </table>}
      </section>;
    })}
    <section className={styles.group}><h3>{text.devices}</h3><p>{text.deviceWarning}</p>
      {data.devices.length === 0 && <p>{text.noDevices}</p>}
      <ul>{data.devices.map((device) => <li key={device.deviceId}><strong>{device.label}</strong> ·
        {device.capability === "START_CHECKIN" ? text.startDevice : text.finishDevice}: {device.lastReceivedAt
          ? formatClockTime(device.lastReceivedAt, data.timeZone) : text.noReceipt} · {text.sequence}: {device.lastSequence}</li>)}</ul>
    </section>
  </section>;
}
