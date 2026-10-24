import React from "react";
import type { PublicPartySplitRow } from "@o-tid/contracts";
import { formatDuration } from "../../lib/clock-time";
import { partyPublicSv as text } from "../../i18n/party-public-sv";
import styles from "./party-public.module.css";

/**
 * Kvällens sträcktider (PLAN.md steg 42) i sträcktidsvyns form: en rad per gäst med köp, flest köp först. Kolumner:
 * placering, namn (fast vid rullning i sidled), totalt, incheckning, varje köp och mål. Under klockslaget tiden sedan
 * förra händelsen. Bara visningsnamnet; när festen inte visar namn "Gäst N". Aldrig bricka eller belopp.
 */
const MARKS = ["var(--party-accent)", "var(--party-primary)", "#2f6fb5", "#c27c0e", "#7a4fb5", "#1f8a8a", "#c2477a", "#6b6b6b"] as const;

/** En färg per grupp (t.ex. "Drink") eller vara, stabil mellan uppdateringarna. */
export function splitMarkColor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return MARKS[hash % MARKS.length]!;
}

export function splitGuestName(row: Pick<PublicPartySplitRow, "name" | "guestNumber">): string {
  return row.name ?? text.guestNumber(row.guestNumber);
}

export function splitSince(seconds: number | undefined): string {
  return seconds === undefined ? "" : text.since(formatDuration(seconds * 1_000));
}

function Cell({ at, since, label, mark, clock }: { at: string; since: number | undefined; label?: string; mark?: string;
  clock: (value: string) => string }) {
  return <td className={styles.split}>
    <span className={styles.splitTime}>
      {mark ? <span className={styles.mark} style={{ background: mark }} aria-hidden="true" /> : null}
      {clock(at)}{label ? <> <strong>{label}</strong></> : null}
    </span>
    {since !== undefined ? <span className={styles.since}>{splitSince(since)}</span> : null}
  </td>;
}

export function PartySplits({ rows, showNames, clock }: { rows: readonly PublicPartySplitRow[]; showNames: boolean;
  clock: (value: string) => string }) {
  const columns = Math.max(0, ...rows.map(row => row.purchases.length));
  const hasCheckIn = rows.some(row => row.checkIn);
  const hasCheckout = rows.some(row => row.checkout);
  return <section className={`${styles.panel} ${styles.splits}`} id="stracktider" aria-labelledby="party-splits" data-testid="party-splits">
    <h2 id="party-splits">{text.splitsTitle}</h2>
    <p className={styles.help}>{text.splitsHelp}{showNames ? "" : ` ${text.splitsAnonymous}`}</p>
    {rows.length === 0 ? <p>{text.noneYet}</p> : <div className={styles.scroll} tabIndex={0} aria-label={text.splitsTitle}>
      <table className={styles.table}>
        <thead><tr>
          <th scope="col" className={styles.place}>{text.splitsPlace}</th>
          <th scope="col" className={styles.stick}>{text.splitsName}</th>
          <th scope="col" className={styles.num}>{text.splitsTotal}</th>
          {hasCheckIn ? <th scope="col" className={styles.num}>{text.splitsCheckIn}</th> : null}
          {Array.from({ length: columns }, (_, index) => <th key={index} scope="col" className={styles.num}>{text.splitsPurchase(index + 1)}</th>)}
          {hasCheckout ? <th scope="col" className={styles.num}>{text.splitsCheckout}</th> : null}
        </tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.guestNumber}>
          <td className={styles.place}>{index + 1}</td>
          <th scope="row" className={styles.stick}>{splitGuestName(row)}</th>
          <td className={styles.split}><span className={styles.splitTime}><strong>{text.purchases(row.purchaseCount)}</strong></span>
            <span className={styles.since}>{formatDuration(row.totalSeconds * 1_000)}</span></td>
          {hasCheckIn ? row.checkIn ? <Cell at={row.checkIn.at} since={row.checkIn.sinceSeconds} clock={clock} /> : <td /> : null}
          {Array.from({ length: columns }, (_, column) => {
            const purchase = row.purchases[column];
            return purchase ? <Cell key={column} at={purchase.at} since={purchase.sinceSeconds} label={purchase.itemName} clock={clock}
              mark={splitMarkColor(purchase.group ?? purchase.itemName)} /> : <td key={column} />;
          })}
          {hasCheckout ? row.checkout ? <Cell at={row.checkout.at} since={row.checkout.sinceSeconds} clock={value => text.finishAt(clock(value))} />
            : <td /> : null}
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
