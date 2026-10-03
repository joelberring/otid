import React from "react";
import type { CheckinHistoryResponse } from "@o-tid/contracts";
import { checkinHistorySv as text } from "../i18n/checkin-history-sv";
import { formatStartListTime } from "../lib/start-list-time";
import styles from "./race-administrator-workspace.module.css";

export function CheckinHistoryTable({ data, timeZone }: { data: CheckinHistoryResponse; timeZone: string }) {
  if (!data.rows.length) return <p>{text.empty}</p>;
  return <div className={styles.tableScroll} style={{ maxHeight: "24rem" }}>
    <p>{text.timeZone}: {timeZone}</p>
    <table className={styles.table}><thead><tr>
      <th>{text.observed}</th><th>{text.received}</th><th>{text.source}</th><th>{text.action}</th><th>{text.effect}</th>
    </tr></thead><tbody>{data.rows.map(row => <tr key={row.requestId}>
      <td><time dateTime={row.observedAt}>{formatStartListTime(row.observedAt, timeZone)}</time></td>
      <td><time dateTime={row.receivedAt}>{formatStartListTime(row.receivedAt, timeZone)}</time></td>
      <td>{text.roles[row.source]}<br />{row.sourceLabel}</td>
      <td>{text.states[row.action.state]}{row.action.kind === "FINISH_CORRECTION" && <><br />{row.action.manualReturnRegistered ? text.returned : text.notReturned}</>}</td>
      <td>{text.effects[row.effect.kind]} · {text.revision} {row.effect.revision}
        {row.effect.kind === "CONFLICT" && <><br />{text.reasons[row.effect.reason]}{row.reviewed && <><br />{text.reviewed}: {row.reviewed.reason}<br /><time dateTime={row.reviewed.reviewedAt}>{text.reviewedAt}: {formatStartListTime(row.reviewed.reviewedAt, timeZone)}</time></>}</>}</td>
    </tr>)}</tbody></table>
  </div>;
}
