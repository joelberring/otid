import React from "react";
import type { SpeakerBoardResponse } from "@o-tid/contracts";
import { speakerBoardSv as text } from "../i18n/speaker-board-sv";
import styles from "./speaker-board.module.css";

function elapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function SpeakerBoardReport({ data, stale }: { data: SpeakerBoardResponse; stale: boolean }) {
  const date = (value: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: data.timeZone, dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
  return <section className="stack" aria-label={text.title}>
    {stale && <p role="alert" className={styles.warning}>{text.stale}</p>}
    <h2>{data.eventName} – {data.raceName}</h2>
    <p>{text.generated}: <time dateTime={data.generatedAt}>{date(data.generatedAt)}</time> ({data.timeZone})</p>
    <p>{text.version}: {data.raceSnapshotVersion}. {text.currentNames}</p>
    {data.rows.length === 0 && <p>{text.empty}</p>}
    {data.rows.length > 0 && <div className={styles.rowHead} aria-hidden="true">
      <span>{text.name}</span><span>{text.raceClass}</span><span>{text.result}</span><span>{text.time}</span>
      <span>{text.registered}</span><span>{text.revision}</span>
    </div>}
    <ul className={styles.rows}>{data.rows.map((row) => {
      const critical = row.state === "ACTIVE_RESULT" && (row.result.status === "MP" || row.result.status === "DSQ");
      return <li key={row.slot} className={styles.row}>
        <div className={styles.identity}><h3>{row.givenName} {row.familyName}</h3>{row.organisationName && <p>{row.organisationName}</p>}</div>
        <p><span className={styles.mobileLabel}>{text.raceClass}: </span>{row.className}</p>
        <p className={`${styles.result} ${critical ? styles.resultCritical : ""}`}><span className={styles.mobileLabel}>{text.result}: </span>{row.state === "NO_ACTIVE_RESULT" ? text.noResult : text.statuses[row.result.status]}</p>
        <p><span className={styles.mobileLabel}>{text.time}: </span>{row.state === "ACTIVE_RESULT" && "elapsedMs" in row.result && row.result.elapsedMs !== undefined
          ? elapsed(row.result.elapsedMs) : text.noTime}</p>
        <p><span className={styles.mobileLabel}>{text.registered}: </span><time dateTime={row.registeredAt}>{date(row.registeredAt)}</time></p>
        <p><span className={styles.mobileLabel}>{text.revision}: </span>{row.selectedRevision}{row.state === "ACTIVE_RESULT" && <> · {text.effective}: {row.result.revision}</>}</p>
      </li>;
    })}</ul>
  </section>;
}
