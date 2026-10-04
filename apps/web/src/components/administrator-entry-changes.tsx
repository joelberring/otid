import React from "react";
import type { AdministratorEntryChangesResponse } from "@o-tid/contracts";
import { formatClockTime } from "../lib/clock-time";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import styles from "./race-administrator-workspace.module.css";

export function AdministratorEntryChanges({ data }: { data: AdministratorEntryChangesResponse }) {
  const value = (field: string, content: string | null) => {
    if (content === null) return text.historyMissing;
    if (field === "START_TIME") return formatClockTime(content, data.timeZone);
    if (field === "RENTAL") return content === "true" ? text.rental : text.notRental;
    if (field === "RENTAL_RETURN") return content === "true" ? text.rentalReturned : text.rentalOutstanding;
    if (field === "RENTAL_REUSE") return text.rentalReuseHistoryStates[content as keyof typeof text.rentalReuseHistoryStates];
    return content;
  };
  return <div className={styles.workspace}>
    <p className={styles.organisation}>{text.resultReadAt}: {formatClockTime(data.generatedAt, data.timeZone)}</p>
    {data.items.length === 0 ? <p>{text.historyEmpty}</p> : <div className={styles.changeHistory}>
      {data.items.map((item) => <details key={`${item.kind}:${item.requestId}`}>
        <summary>{text.historyKinds[item.kind]} · {formatClockTime(item.changedAt, data.timeZone)}</summary>
        <dl>{item.changes.map((change) => <div key={change.field}>
          <dt>{text.historyFields[change.field]}</dt>
          <dd>{text.historyBefore}: {value(change.field, change.before)}</dd>
          <dd>{text.historyAfter}: {value(change.field, change.after)}</dd>
        </div>)}</dl>
      </details>)}
    </div>}
  </div>;
}
