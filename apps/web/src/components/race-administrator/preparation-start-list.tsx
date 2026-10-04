"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { startListPublicationSv as publicationText } from "../../i18n/start-list-publication-sv";
import { classStartDrawSv as drawText } from "../../i18n/class-start-draw-sv";
import { formatClockTime } from "../../lib/clock-time";
import Link from "next/link";
import { RaceOperatorAccess } from "../race-operator-access";
import { RacePreparationStartList } from "../race-preparation-start-list";
import { FixedStartSlotPlans } from "../fixed-start-slot-plans";
import type { Workspace } from "./workspace-state";

/**
 * Start: lottning av starttider (bekräftas, eftersom starttider ändras), startlistan med publicering
 * (sparas direkt) och funktionärer.
 */
export function PreparationStartList({ ws }: { ws: Workspace }) {
  const { busy, data, disabled, drawAttempt, drawClassId, drawClasses, drawFirst, drawInterval,
    loadDrawClasses, loadPublication, pending, preparePublication, previewDraw, publicationAttempt,
    publicationPreview, raceId, select, sent, setDrawAttempt, setDrawClassId, setDrawFirst, setDrawInterval,
    setOperatorAccessPending, step, submitDraw, submitPublication, unknown } = ws;
  return <section className={styles.workflowGroup} aria-label={navigationText.steps.START} hidden={step !== "START"}>
    <details className={styles.courseClassPanel}>
      <summary>{drawText.title}</summary>
      <p>{drawText.help}</p>
      {!drawClasses && <button type="button" className="secondary" disabled={disabled} onClick={() => void loadDrawClasses()}>{drawText.refresh}</button>}
      {drawClasses && <form onSubmit={event => void previewDraw(event)}>
        <label>{drawText.class}<select value={drawClassId} disabled={disabled} onChange={event => setDrawClassId(event.target.value)}>
          <option value="">—</option>{drawClasses.classes.map(row => <option key={row.id} value={row.id} disabled={row.entryCount === 0}>{row.name} ({row.entryCount})</option>)}
        </select></label>
        <label>{drawText.first}<input value={drawFirst} disabled={disabled} inputMode="numeric" placeholder={drawText.firstExample}
          onChange={event => setDrawFirst(event.target.value)} /></label>
        <label>{drawText.interval}<input type="number" min="1" max="3600" step="1" value={drawInterval} disabled={disabled} onChange={event => setDrawInterval(event.target.value)} /></label>
        <button disabled={disabled || !drawClassId}>{drawText.inspect}</button>
      </form>}
    </details>
    {drawAttempt && <section className={styles.panel} role="alert" aria-label={drawText.inspect}>
      <h3>{drawText.inspect}: {drawAttempt.preview.className}</h3>
      <p>{drawText.warning}</p>
      <p>{drawText.count}: {drawAttempt.preview.entries.length} · {drawText.changes}: {drawAttempt.preview.entries.filter(row => row.changed).length}</p>
      <div className={styles.tableScroll} style={{ maxHeight: "20rem" }}><table className={styles.table}>
        <thead><tr><th>{text.name}</th><th>{drawText.previous}</th><th>{drawText.next}</th></tr></thead>
        <tbody>{drawAttempt.preview.entries.map(row => <tr key={row.entryId}><td>{row.displayName}</td>
          <td>{row.previousFixedStartTime ? formatClockTime(row.previousFixedStartTime, drawAttempt.preview.timeZone) : drawText.missing}</td>
          <td>{formatClockTime(row.fixedStartTime, drawAttempt.preview.timeZone)}</td></tr>)}</tbody>
      </table></div>
      {unknown && <p>{text.unreachable}</p>}
      <button type="button" disabled={busy || !drawAttempt.preview.entries.some(row => row.changed)} onClick={() => void submitDraw(drawAttempt)}>{unknown ? text.retry : drawText.confirm}</button>
      {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => {
        pending.current = undefined; sent.current = false; setDrawAttempt(undefined);
      }}>{drawText.cancel}</button>}
    </section>}
    <FixedStartSlotPlans raceId={raceId} disabled={disabled} />
    {data && <RacePreparationStartList data={data} disabled={disabled} onSelectEntry={id => select(id)} />}
    <details className={styles.courseClassPanel}>
      <summary>{publicationText.title}</summary>
      <p>{publicationText.help}</p>
      <Link href={`/starts/${raceId}`}>{publicationText.publicLink}</Link>
      {!publicationPreview && <button type="button" className="secondary" disabled={disabled} onClick={() => void loadPublication()}>{publicationText.refresh}</button>}
      {publicationPreview && <>
        <p>{publicationPreview.latestDecision ? publicationPreview.latestDecision.action === "PUBLISH" ? publicationText.published : publicationText.withdrawn : publicationText.noPublication}</p>
        {publicationPreview.latestDecision?.action === "PUBLISH" && publicationPreview.latestDecision.sourceHash !== publicationPreview.sourceHash && <p>{publicationText.changed}</p>}
        {publicationPreview.content?.classes.some(row => row.entries.length > 0)
          ? <button type="button" disabled={disabled} onClick={() => preparePublication("PUBLISH")}>{publicationText.publish}</button>
          : <p>{publicationPreview.content ? publicationText.empty : publicationText.invalidContent}</p>}
        {publicationPreview.latestDecision?.action === "PUBLISH" && <button type="button" className="secondary" disabled={disabled} onClick={() => preparePublication("WITHDRAW")}>{publicationText.withdraw}</button>}
      </>}
      {publicationAttempt && unknown && <div className={styles.review} role="alert">
        <p>{text.unreachable}</p>
        <button type="button" disabled={busy} onClick={() => void submitPublication(publicationAttempt)}>{text.retry}</button>
      </div>}
    </details>
    <details className={styles.courseClassPanel}>
      <summary>{navigationText.staff}</summary>
      <RaceOperatorAccess raceId={raceId} onPendingChange={setOperatorAccessPending} />
    </details>
  </section>;
}
