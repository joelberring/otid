"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { startListPublicationSv as publicationText } from "../../i18n/start-list-publication-sv";
import Link from "next/link";
import { RaceOperatorAccess } from "../race-operator-access";
import { RacePreparationStartList } from "../race-preparation-start-list";
import { StartDrawPanel } from "./start-draw-panel";
import type { Workspace } from "./workspace-state";

/**
 * Start: lottning (PLAN.md steg 9), startlistan med publicering (sparas direkt) och funktionärer.
 */
export function PreparationStartList({ ws }: { ws: Workspace }) {
  const { busy, data, disabled, loadPublication, preparePublication, publicationAttempt,
    publicationPreview, raceId, select, setOperatorAccessPending, step, submitPublication, unknown } = ws;
  return <section className={styles.workflowGroup} aria-label={navigationText.steps.START} hidden={step !== "START"}>
    <StartDrawPanel ws={ws} visible={step === "START"} />
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
