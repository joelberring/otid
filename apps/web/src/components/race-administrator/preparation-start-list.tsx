"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as text } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { startListPublicationSv as publicationText } from "../../i18n/start-list-publication-sv";
import { formatClockTime } from "../../lib/clock-time";
import { startListFromWorkspace } from "../../lib/lists/start-list-model";
import { StartLists } from "../lists/start-lists";
import { Button, Notice, Section } from "../ui";
import { StartDrawPanel } from "./start-draw-panel";
import { RelayStartTimes } from "./relay-panels";
import type { Workspace } from "./workspace-state";

/**
 * Publiceringen av startlistan (PLAN.md steg 13): läget i en mening och en tydlig åtgärd. Läses in när Start visas
 * och igen när deltagarlistan ändrats, så att "ändrad sedan publiceringen" alltid stämmer.
 */
function StartPublication({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { busy, data, disabled, loadPublication, preparePublication, publicationAttempt, publicationPreview, raceId, submitPublication,
    unknown, pending } = ws;
  const attempted = useRef<number | undefined>(undefined);
  const snapshot = data?.snapshotVersion;
  // Andra åtgärder rensar publiceringens underlag; då läses det in igen. Ett misslyckat försök görs inte om av sig
  // självt för samma läge (knappen "Försök igen" finns), så att ett fel inte ger en slinga.
  useEffect(() => { if (publicationPreview) attempted.current = undefined; }, [publicationPreview]);
  useEffect(() => {
    if (!visible || snapshot === undefined || busy || pending.current || publicationPreview?.snapshotVersion === snapshot ||
      attempted.current === snapshot) return;
    attempted.current = snapshot;
    void loadPublication().then(started => { if (!started) attempted.current = undefined; });
  }, [visible, snapshot, busy, publicationPreview]);
  const latest = publicationPreview?.latestDecision;
  const time = latest ? formatClockTime(latest.decidedAt, data?.timeZone ?? "UTC").slice(0, 5) : "";
  const published = latest?.action === "PUBLISH";
  const changed = published && latest.sourceHash !== publicationPreview?.sourceHash;
  const publishable = !!publicationPreview?.content?.classes.some(row => row.entries.length > 0);
  return <Section id={`start-publication-${raceId}`} title={publicationText.heading} help={publicationText.shortHelp}
    actions={<Link href={`/starts/${raceId}`}>{publicationText.publicLink}</Link>}>
    {!publicationPreview ? <div className={styles.actions}><p className={styles.muted}>{publicationText.loading}</p>
      {!busy && <Button variant="quiet" disabled={disabled} onClick={() => { attempted.current = undefined; void loadPublication(); }}>{text.retry}</Button>}</div>
      : <>
        {changed ? <Notice tone="attention">{publicationText.statusChanged(time)}</Notice>
          : <p>{!latest ? publicationText.statusNone : published ? publicationText.statusPublished(time) : publicationText.statusWithdrawn(time)}</p>}
        <div className={styles.actions}>
          {(!published || changed) && (publishable
            ? <Button disabled={disabled} onClick={() => preparePublication("PUBLISH")}>{publicationText.publish}</Button>
            : <p className={styles.muted}>{publicationPreview.content ? publicationText.empty : publicationText.invalidContent}</p>)}
          {published && <Button variant="quiet" disabled={disabled} onClick={() => preparePublication("WITHDRAW")}>{publicationText.withdraw}</Button>}
        </div>
      </>}
    {publicationAttempt && unknown && <Notice tone="attention" role="alert">
      <p>{text.unreachable}</p>
      <div><Button disabled={busy} onClick={() => void submitPublication(publicationAttempt)}>{text.retry}</Button></div>
    </Notice>}
  </Section>;
}

/**
 * Start: lottningen (typer med lottning) eller stafettens masstart överst, publiceringen och sedan startlistorna
 * per klass, per starttid och per klubb (PLAN.md steg 13). Funktionärer finns under Inställningar (ADR-0170).
 */
export function PreparationStartList({ ws }: { ws: Workspace }) {
  const { data, disabled, downloadStartList, functionary, profile, select, shows } = ws;
  const visible = shows("START");
  const model = useMemo(() => data ? startListFromWorkspace(data) : undefined, [data]);
  return <section className={styles.workflowGroup} aria-label={navigationText.steps.START} hidden={!visible}>
    {/* Funktionären ser startlistorna; lottning, masstart, publicering, deltagarkort och export är administratörens. */}
    {!functionary && profile.features.draw && <StartDrawPanel ws={ws} visible={visible} />}
    {!functionary && profile.features.relay && <RelayStartTimes ws={ws} visible={visible} />}
    {!functionary && <StartPublication ws={ws} visible={visible} />}
    {model && (functionary ? <StartLists model={model} disabled={disabled} exportable={false} />
      : <StartLists model={model} onSelectEntry={id => select(id)} disabled={disabled}
        iof={{ onSelect: () => void downloadStartList(), disabled }} />)}
  </section>;
}
