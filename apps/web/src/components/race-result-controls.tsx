"use client";

import type { AdministratorEffectiveResultResponse } from "@o-tid/contracts";
import { raceWorkflowDetailSv as text } from "../i18n/race-workflow-detail-sv";
import styles from "./race-workflow-detail.module.css";
import { formatClockTime, formatDuration } from "../lib/clock-time";

function elapsed(value: number | null): string {
  if (value === null || !Number.isSafeInteger(value) || value < 0) return text.unknownTime;
  return formatDuration(value);
}

function wallTime(value: string | null, timeZone: string): string {
  return value === null ? text.notRecorded : formatClockTime(value, timeZone);
}

export function RaceResultControls({ result, resultError, timeZone }: {
  result: AdministratorEffectiveResultResponse | undefined;
  resultError: boolean;
  timeZone: string;
}) {
  const heading = <h2 id="race-result-controls-title">{text.resultTitle}</h2>;
  const panelClass = `${styles.panel} ${styles.resultControls}`;
  if (resultError) return <section className={panelClass} aria-labelledby="race-result-controls-title">{heading}<p role="status">{text.resultError}</p></section>;
  if (result === undefined) return <section className={panelClass} aria-labelledby="race-result-controls-title">{heading}<p>{text.missingDetails}</p></section>;
  if (result.state === "NO_PUBLISHED_RESULT") return <section className={panelClass} aria-labelledby="race-result-controls-title">{heading}<p>{text.noResult}</p></section>;
  if (result.state === "NO_ACTIVE_RESULT") return <section className={panelClass} aria-labelledby="race-result-controls-title">{heading}<p>{text.noActiveResult}</p></section>;
  const details = result.controlDetails;
  if (details === undefined) return <section className={panelClass} aria-labelledby="race-result-controls-title">{heading}<p>{text.missingDetails}</p></section>;
  if (details === null) return <section className={panelClass} aria-labelledby="race-result-controls-title">{heading}<p>{text.noTechnicalDetails}</p></section>;

  return <section className={panelClass} aria-labelledby="race-result-controls-title">
    {heading}
    <p className={styles.historicalNote}>{text.historical}</p>
    <dl className={styles.resultFacts}>
      <div><dt>{text.resultClass}</dt><dd>{result.resultClass.name}</dd></div>
      <div><dt>{text.course}</dt><dd>{details.courseName}</dd></div>
      <div><dt>{text.startRecorded}</dt><dd>{wallTime(details.startTime, timeZone)}</dd></div>
      <div><dt>{text.finishRecorded}</dt><dd>{wallTime(details.finishTime, timeZone)}</dd></div>
    </dl>
    {details.controls.length === 0 ? <p>{text.noTechnicalDetails}</p> :
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={text.resultTitle}>
        <table className={styles.table}>
          <thead><tr><th scope="col" className={styles.numeric}>{text.order}</th><th scope="col">{text.control}</th>
            <th scope="col" className={styles.numeric}>{text.leg}</th><th scope="col" className={styles.numeric}>{text.cumulative}</th></tr></thead>
          <tbody>{details.controls.map((control) => <tr key={`${control.sequence}-${control.controlCode}-${control.occurrence}`}>
            <td className={styles.numeric}>{control.sequence}</td>
            <th scope="row">{control.controlCode}{control.occurrence > 1 ? <span className={styles.occurrence}> · {text.occurrence} {control.occurrence}</span> : null}</th>
            <td className={styles.numeric}>{control.legMs === null ? text.noSplit : elapsed(control.legMs)}</td>
            <td className={styles.numeric}>{control.elapsedMs === null ? text.noSplit : elapsed(control.elapsedMs)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    {!!details.untimedControls?.length && <p className={styles.untimedNote} role="note">
      {text.untimedControls(details.untimedControls.join(", "))}</p>}
    <div className={styles.controlExceptions}>
      <p><strong>{text.missingControls}:</strong> {details.missingControls.length === 0 ? text.none : details.missingControls.join(", ")}</p>
      <p><strong>{text.extraPunches}:</strong> {details.extraPunches.length === 0 ? text.none : details.extraPunches.join(", ")}</p>
    </div>
  </section>;
}
