"use client";

import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { startListPublicationSv as publicationText } from "../../i18n/start-list-publication-sv";
import Link from "next/link";
import { RacePreparationStartList } from "../race-preparation-start-list";
import { Button, Notice, Section } from "../ui";
import { StartDrawPanel } from "./start-draw-panel";
import { RelayStartTimes } from "./relay-panels";
import type { Workspace } from "./workspace-state";

/**
 * Start: lottning (PLAN.md steg 9, bara typer med lottning), masstart och omstart för stafett, startlistan och
 * publiceringen (sparas direkt). Funktionärer finns under Inställningar (ADR-0170).
 */
export function PreparationStartList({ ws }: { ws: Workspace }) {
  const { busy, data, disabled, loadPublication, preparePublication, profile, publicationAttempt,
    publicationPreview, raceId, select, shows, submitPublication, unknown } = ws;
  const visible = shows("START");
  return <section className={styles.workflowGroup} aria-label={navigationText.steps.START} hidden={!visible}>
    {profile.features.draw && <StartDrawPanel ws={ws} visible={visible} />}
    {profile.features.relay && <RelayStartTimes ws={ws} visible={visible} />}
    {data && <RacePreparationStartList data={data} disabled={disabled} onSelectEntry={id => select(id)} />}
    <Section id={`start-publication-${raceId}`} title={publicationText.title} help={publicationText.help}
      actions={<Link href={`/starts/${raceId}`}>{publicationText.publicLink}</Link>}>
      {!publicationPreview && <div><Button variant="secondary" disabled={disabled} onClick={() => void loadPublication()}>{publicationText.refresh}</Button></div>}
      {publicationPreview && <>
        <p>{publicationPreview.latestDecision ? publicationPreview.latestDecision.action === "PUBLISH" ? publicationText.published : publicationText.withdrawn : publicationText.noPublication}</p>
        {publicationPreview.latestDecision?.action === "PUBLISH" && publicationPreview.latestDecision.sourceHash !== publicationPreview.sourceHash &&
          <Notice tone="attention">{publicationText.changed}</Notice>}
        <div className={styles.actions}>
          {publicationPreview.content?.classes.some(row => row.entries.length > 0)
            ? <Button disabled={disabled} onClick={() => preparePublication("PUBLISH")}>{publicationText.publish}</Button>
            : <p>{publicationPreview.content ? publicationText.empty : publicationText.invalidContent}</p>}
          {publicationPreview.latestDecision?.action === "PUBLISH" && <Button variant="secondary" disabled={disabled}
            onClick={() => preparePublication("WITHDRAW")}>{publicationText.withdraw}</Button>}
        </div>
      </>}
      {publicationAttempt && unknown && <Notice tone="attention" role="alert">
        <p>{text.unreachable}</p>
        <div><Button disabled={busy} onClick={() => void submitPublication(publicationAttempt)}>{text.retry}</Button></div>
      </Notice>}
    </Section>
  </section>;
}
