"use client";

import type { CardPunchListDto } from "@o-tid/contracts";
import styles from "../race-workflow-detail.module.css";
import { cardPunchesSv as text, cardPunchSummary, formatPunchDate, punchTimeText } from "../../i18n/card-punches-sv";
import { formatClockTime } from "../../lib/clock-time";

/**
 * Deltagarkortets stämplingslista (PLAN.md steg 27): alla stämplingar på brickan från senaste avläsningen, även från en
 * annan dag eller en annan bana, med en kort förklaring överst. Bara i arbetsytan.
 */
export function CardPunches({ punches, timeZone }: { punches: CardPunchListDto; timeZone: string }) {
  const summary = cardPunchSummary(punches);
  const station = (label: string, stamp: CardPunchListDto["start"]) => <div>
    <dt>{label}</dt><dd>{stamp ? punchTimeText(stamp, punches.raceDate, timeZone) : <span className={styles.missing}>{text.missing}</span>}</dd>
  </div>;
  return <section className={`${styles.panel} ${styles.resultControls}`} aria-labelledby="card-punches-title" data-testid="card-punches">
    <h2 id="card-punches-title">{text.title}</h2>
    <p className={styles.historicalNote}>{text.readAt(formatClockTime(punches.readAt, timeZone))}</p>
    {summary.length > 0 && <ul className={styles.punchSummary} role="note">{summary.map(line => <li key={line}>{line}</li>)}</ul>}
    <dl className={styles.facts}>
      {station(text.check, punches.check)}{station(text.start, punches.start)}{station(text.finish, punches.finish)}
    </dl>
    {punches.punches.length === 0 ? <p>{text.noPunches}</p> :
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={text.table}>
        <table className={styles.table}>
          <thead><tr><th scope="col" className={styles.numeric}>{text.order}</th><th scope="col">{text.code}</th>
            <th scope="col" className={styles.numeric}>{text.time}</th><th scope="col">{text.status}</th></tr></thead>
          <tbody>{punches.punches.map(row => <tr key={row.order} data-placement={row.placement}>
            <td className={styles.numeric}>{row.order}</td>
            <th scope="row">{row.code}</th>
            <td className={styles.numeric}><PunchTime stamp={row} raceDate={punches.raceDate} timeZone={timeZone} /></td>
            <td className={row.placement === "ON_COURSE" ? undefined : styles.punchOff}>{text.placement[row.placement]}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}

/** Klockslaget, med veckodag och datum på en egen rad när stämplingen inte är från tävlingsdagen (smalt på mobil). */
function PunchTime({ stamp, raceDate, timeZone }: { stamp: { punchedAt: string; localDate: string }; raceDate: string; timeZone: string }) {
  const time = formatClockTime(stamp.punchedAt, timeZone);
  if (stamp.localDate === raceDate) return <>{time}</>;
  return <>{time}<span className={styles.punchDate}>{formatPunchDate(stamp.localDate)}</span></>;
}
