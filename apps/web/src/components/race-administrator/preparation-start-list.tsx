"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { startListPublicationSv as publicationText } from "../../i18n/start-list-publication-sv";
import { classStartDrawSv as drawText } from "../../i18n/class-start-draw-sv";
import { formatStartListTime } from "../../lib/start-list-time";
import Link from "next/link";
import { RaceOperatorAccess } from "../race-operator-access";
import { RacePreparationStartList } from "../race-preparation-start-list";
import { FixedStartSlotPlans } from "../fixed-start-slot-plans";
import type { Workspace } from "./workspace-state";

/** Förberedelse: funktionärer, startlista med publicering och lottning. */
export function PreparationStartList({ ws }: { ws: Workspace }) {
  const { busy, data, disabled, drawAttempt, drawClassId, drawClasses, drawFirst, drawInterval, drawPanel,
    loadDrawClasses, loadPublication, pending, preparationArea, preparePublication, previewDraw, publicationAttempt,
    publicationPreview, raceId, select, sent, setDrawAttempt, setDrawClassId, setDrawFirst, setDrawInterval,
    setOperatorAccessPending, setPublicationAttempt, submitDraw, submitPublication, unknown, workflowMode } = ws;
  return <>
    <section className={styles.workflowGroup} aria-label={navigationText.preparation.STAFF} hidden={workflowMode !== "BEFORE" || preparationArea !== "STAFF"}>
    <RaceOperatorAccess raceId={raceId} onPendingChange={setOperatorAccessPending} />
    </section>
    <section className={styles.workflowGroup} aria-label={navigationText.preparation.PUBLICATION} hidden={workflowMode !== "BEFORE" || preparationArea !== "PUBLICATION"}>
    {data && <RacePreparationStartList data={data} disabled={disabled} onSelectEntry={id => select(id)} />}
    <details>
      <summary>{publicationText.title}</summary>
      <p>{publicationText.help}</p>
      <Link href={`/starts/${raceId}`}>{publicationText.publicLink}</Link>
      <button type="button" className="secondary" disabled={disabled} onClick={() => void loadPublication()}>{publicationText.refresh}</button>
      {publicationPreview && <>
        <p>{publicationPreview.latestDecision ? `${publicationText.currentRevision}: ${publicationPreview.latestDecision.revision} · ${publicationPreview.latestDecision.action === "PUBLISH" ? publicationText.published : publicationText.withdrawn}` : publicationText.noPublication}</p>
        {publicationPreview.latestDecision?.action === "PUBLISH" && publicationPreview.latestDecision.sourceHash !== publicationPreview.sourceHash && <p>{publicationText.changed}</p>}
        {publicationPreview.content?.classes.some(row => row.entries.length > 0)
          ? <button type="button" disabled={disabled} onClick={() => preparePublication("PUBLISH")}>{publicationText.inspectPublish}</button>
          : <p>{publicationPreview.content ? publicationText.empty : publicationText.invalidContent}</p>}
        {publicationPreview.latestDecision?.action === "PUBLISH" && <button type="button" className="secondary" disabled={disabled} onClick={() => preparePublication("WITHDRAW")}>{publicationText.inspectWithdraw}</button>}
      </>}
    </details>
    {publicationAttempt && <section className={styles.panel} role="alert" aria-label={publicationText.preview}>
      <h3>{publicationAttempt.request.action === "PUBLISH" ? publicationText.pendingPublish : publicationText.pendingWithdraw}</h3>
      <p>{publicationText.help}</p><p>{publicationText.privacy}</p>
      <p>{publicationText.currentRevision}: {publicationAttempt.request.expectedRevision} → {publicationAttempt.request.expectedRevision + 1}</p>
      {publicationAttempt.content && <div className={styles.tableScroll} style={{ maxHeight: "22rem" }}>
        <p>{publicationAttempt.content.eventName} · {publicationAttempt.content.raceName} · {publicationAttempt.content.raceDate} · {publicationAttempt.content.timeZone}</p>
        <table className={styles.table}><thead><tr><th>{text.name}</th><th>{text.raceClass}</th><th>{text.publicationStartTime}</th></tr></thead>
          <tbody>{publicationAttempt.content.classes.flatMap((row, classIndex) => row.entries.length === 0
            ? [<tr key={`${classIndex}-empty`}><td>{text.publicationEmptyClass}</td><td>{row.name}</td><td>{row.startRule === "PUNCH" ? text.publicationFreeStart : text.publicationFixedStart}</td></tr>]
            : row.entries.map((entry, entryIndex) => <tr key={`${classIndex}-${entryIndex}`}>
            <td>{entry.displayName}<br />{entry.organisationName ?? text.none}</td><td>{row.name}</td>
            <td>{row.startRule === "PUNCH" ? text.publicationFreeStart : entry.fixedStartTime ? formatStartListTime(entry.fixedStartTime, publicationAttempt.content!.timeZone) : drawText.missing}</td>
          </tr>))}</tbody></table>
      </div>}
      {unknown && <p>{publicationText.unknown}</p>}
      <button type="button" disabled={busy} onClick={() => void submitPublication(publicationAttempt)}>{unknown ? publicationText.retry : publicationAttempt.request.action === "PUBLISH" ? publicationText.confirmPublish : publicationText.confirmWithdraw}</button>
      {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => {
        pending.current = undefined; sent.current = false; setPublicationAttempt(undefined);
      }}>{publicationText.cancel}</button>}
    </section>}
    </section>
    <section className={styles.workflowGroup} aria-label={navigationText.preparation.DRAW} hidden={workflowMode !== "BEFORE" || preparationArea !== "DRAW"}>
    <details ref={drawPanel}>
      <summary>{drawText.title}</summary>
      <p>{drawText.help}</p>
      <button type="button" className="secondary" disabled={disabled} onClick={() => void loadDrawClasses()}>{drawText.refresh}</button>
      {drawClasses && <form onSubmit={event => void previewDraw(event)}>
        <p>{drawText.timezone}: {drawClasses.timeZone}</p>
        <label>{drawText.class}<select value={drawClassId} disabled={disabled} onChange={event => setDrawClassId(event.target.value)}>
          <option value="">—</option>{drawClasses.classes.map(row => <option key={row.id} value={row.id} disabled={row.entryCount === 0}>{row.name} ({row.entryCount})</option>)}
        </select></label>
        <label>{drawText.first}<input value={drawFirst} disabled={disabled} placeholder={drawText.firstExample} onChange={event => setDrawFirst(event.target.value)} /></label>
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
          <td>{row.previousFixedStartTime ? formatStartListTime(row.previousFixedStartTime, drawAttempt.preview.timeZone) : drawText.missing}</td>
          <td>{formatStartListTime(row.fixedStartTime, drawAttempt.preview.timeZone)}</td></tr>)}</tbody>
      </table></div>
      <details key={drawAttempt.id}><summary>{text.finalizationDetails}</summary>
        <p>{drawText.seed}: {drawAttempt.request.parameters.seed} · {drawText.snapshot}: {drawAttempt.request.expectedSnapshotVersion}</p>
      </details>
      {unknown && <p>{drawText.unknown}</p>}
      <button type="button" disabled={busy || !drawAttempt.preview.entries.some(row => row.changed)} onClick={() => void submitDraw(drawAttempt)}>{unknown ? drawText.retry : drawText.confirm}</button>
      {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => {
        pending.current = undefined; sent.current = false; setDrawAttempt(undefined);
      }}>{drawText.cancel}</button>}
    </section>}
    <FixedStartSlotPlans raceId={raceId} disabled={disabled} />
    </section>
  </>;
}
