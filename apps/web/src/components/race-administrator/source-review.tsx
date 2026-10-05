"use client";

import type { SyncRow } from "@o-tid/contracts";
import { raceAdministratorSv as adminText } from "../../i18n/race-administrator-sv";
import { sourcesSv } from "../../i18n/sources-sv";
import { Button, Notice } from "../ui";
import styles from "./sources.module.css";
import type { SourceReview } from "./source-sync-actions";

const text = sourcesSv.review;
const groups: readonly SyncRow["kind"][] = ["NEW", "CHANGED", "WITHDRAWN", "CONFLICT"];

function Change({ change }: { change: SyncRow["changes"][number] }) {
  if (change.field === "LEGS") return <li><span className={styles.field}>{text.field.LEGS} {change.from}</span> {change.to}</li>;
  return <li><span className={styles.field}>{text.field[change.field]}</span>{" "}
    {change.from !== null && <><span className={styles.from}>{change.from}</span>{change.to !== null && <span aria-hidden="true"> → </span>}</>}
    {change.from !== null && change.to !== null && <span className={styles.visuallyHidden}> {text.becomes} </span>}
    {change.to !== null ? <span>{change.to}</span> : <span className={styles.from}>{text.none}</span>}</li>;
}

/**
 * Skillnaderna mot en källa, grupperade som nya, ändrade, strukna och att lösa själv. Varje rad som
 * går att välja har en kryssruta; beskedet om resultaten följer urvalet (samma text som "Redigera bana").
 */
export function SourceReviewPanel({ review, busy, sourceName }: { review: SourceReview; busy: boolean; sourceName: string }) {
  const { preview, excluded, consequence, attempt, toggle, apply, close } = review;
  if (!preview) return null;
  const selected = preview.rows.filter(row => row.kind !== "CONFLICT" && !excluded.includes(row.id)).length;
  const actionable = preview.rows.some(row => row.kind !== "CONFLICT");
  return <section className={styles.review} aria-label={text.title(sourceName)}>
    <div className={styles.reviewHead}>
      <h3>{text.title(sourceName)}</h3>
      <p className={styles.summary}>{text.summary(preview.summary)}</p>
    </div>
    {preview.rows.length === 0 && <p>{text.nothing}</p>}
    {groups.map(kind => {
      const rows = preview.rows.filter(row => row.kind === kind);
      if (rows.length === 0) return null;
      return <div key={kind} className={styles.group} data-kind={kind}>
        <h4><span aria-hidden="true" className={styles.symbol}>{text.kindSymbol[kind]}</span> {text.groups[kind]} <span className={styles.count}>{rows.length}</span></h4>
        {kind === "WITHDRAWN" && <p className={styles.summary}>{text.withdrawnHelp}</p>}
        <ul className={styles.rows}>{rows.map(row => <li key={row.id} className={styles.row} data-kind={row.kind}>
          <span className={styles.include}>{row.kind === "CONFLICT" ? null : row.optional
            ? <input type="checkbox" checked={!excluded.includes(row.id)} disabled={busy || !!attempt} aria-label={text.include(row.label)}
              onChange={() => void toggle(row.id)} />
            : <span className={styles.always} title={text.always} aria-label={text.always}>✓</span>}</span>
          <div className={styles.rowBody}>
            <div className={styles.rowTitle}>
              <span className={styles.subject}>{text.subject[row.subject]}</span>
              <strong>{row.label}</strong>
              {row.context && <span className={styles.context}>{row.subject === "CLASS" && /^\d+$/.test(row.context)
                ? text.legs(row.context) : row.context}</span>}
              {row.matchedByName && <span className={styles.tag}>{text.matchedByName}</span>}
              {row.readOut && <span className={styles.tag}>{text.readOut}</span>}
            </div>
            {row.changes.length > 0 && <ul className={styles.changes}>{row.changes.map((change, index) => <Change key={index} change={change} />)}</ul>}
            {row.note && <p className={styles.note}>{text.note[row.note]}</p>}
          </div>
        </li>)}</ul>
      </div>;
    })}
    {actionable && <div className={styles.consequence} role="status" aria-live="polite">
      <h4>{text.consequenceTitle}</h4>
      {!consequence ? <p className={styles.summary}>…</p> : <>
        {consequence.readOutCount === 0 && consequence.cardsAfterReadout.length === 0 && <p>{text.noResults}</p>}
        {consequence.readOutCount > 0 && <p><strong>{adminText.courseEditSummary(consequence.readOutCount, consequence.becomesOkCount,
          consequence.becomesMispunchedCount, consequence.unchangedCount)}</strong></p>}
        {consequence.changes.length > 0 && <ul className={styles.statusChanges}>{consequence.changes.map(change => <li key={change.entryId}>
          <strong>{change.displayName}</strong> · {change.className} · {adminText.courseEditStatus[change.before]} → {adminText.courseEditStatus[change.after]}
        </li>)}</ul>}
        {consequence.notRecalculatedCount > 0 && <Notice tone="attention">{adminText.courseEditNotRecalculated(consequence.notRecalculatedCount)}</Notice>}
        {consequence.cardsAfterReadout.length > 0 && <p>{text.cardsKept(consequence.cardsAfterReadout.length)}</p>}
      </>}
    </div>}
    <div className={styles.actions}>
      {actionable && <Button disabled={busy || !consequence || selected === 0} onClick={() => void apply()}>
        {consequence?.requiresConfirmation ? text.applyAndRecalculate(selected) : text.apply(selected)}</Button>}
      {!attempt && <Button variant="quiet" disabled={busy} onClick={close}>{text.cancel}</Button>}
    </div>
  </section>;
}
