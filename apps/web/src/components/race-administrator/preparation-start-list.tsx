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
import { ShiftStartTimes } from "../race-corrections";
import type { Workspace } from "./workspace-state";
import { RaceInfo } from "../race-info";
import { mapBundlesSv as mapText } from "../../i18n/map-bundles-sv";

/**
 * Publiceringen av startlistan (PLAN.md steg 13): läget i en mening och en tydlig åtgärd. Läses in när Start visas
 * och igen när deltagarlistan ändrats, så att "ändrad sedan publiceringen" alltid stämmer.
 */
function StartPublication({ ws, visible, number }: { ws: Workspace; visible: boolean; number: number }) {
  const { busy, data, disabled, loadPublication, preparePublication, publicationAttempt, publicationPreview, raceId, submitPublication,
    unknown, operation, pending, saveStartListLive, startListLiveMessage } = ws;
  const attempted = useRef<number | undefined>(undefined);
  const snapshot = data?.snapshotVersion;
  // Andra åtgärder rensar publiceringens underlag; då läses det in igen. Ett misslyckat försök görs inte om av sig
  // självt för samma läge (knappen "Försök igen" finns), så att ett fel inte ger en slinga.
  useEffect(() => { if (publicationPreview) attempted.current = undefined; }, [publicationPreview]);
  useEffect(() => {
    if (!visible || snapshot === undefined || busy || operation.current || pending.current || publicationPreview?.snapshotVersion === snapshot ||
      attempted.current === snapshot) return;
    attempted.current = snapshot;
    void loadPublication().then(started => { if (!started) attempted.current = undefined; });
  }, [visible, snapshot, busy, publicationPreview]);
  const latest = publicationPreview?.latestDecision;
  const time = latest ? formatClockTime(latest.decidedAt, data?.timeZone ?? "UTC").slice(0, 5) : "";
  const published = latest?.action === "PUBLISH";
  const live = data?.startListLive === true;
  const changed = !live && published && latest.sourceHash !== publicationPreview?.sourceHash;
  const publishable = !!publicationPreview?.content?.classes.some(row => row.entries.length > 0);
  return <Section id={`start-publication-${raceId}`} title={publicationText.heading} number={number}
    help={publicationText.shortHelp(data?.publicStartListCardNumbers ?? true)}
    actions={<Link href={`/starts/${raceId}`}>{publicationText.publicLink}</Link>}>
    {!publicationPreview ? <div className={styles.actions}><p className={styles.muted}>{publicationText.loading}</p>
      {!busy && <Button variant="quiet" disabled={disabled} onClick={() => { attempted.current = undefined; void loadPublication(); }}>{text.retry}</Button>}</div>
      : <>
        {live ? <p>{publicationText.statusLive}</p> : changed ? <Notice tone="attention">{publicationText.statusChanged(time)}</Notice>
          : <p>{!latest ? publicationText.statusNone : published ? publicationText.statusPublished(time) : publicationText.statusWithdrawn(time)}</p>}
        <div className={styles.actions}>
          {!live && (!published || changed) && (publishable
            ? <Button disabled={disabled} onClick={() => preparePublication("PUBLISH")}>{publicationText.publish}</Button>
            : <p className={styles.muted}>{publicationPreview.content ? publicationText.empty : publicationText.invalidContent}</p>)}
          {!live && published && <Button variant="quiet" disabled={disabled} onClick={() => preparePublication("WITHDRAW")}>{publicationText.withdraw}</Button>}
        </div>
      </>}
    {/* "Uppdatera startlistan löpande": ett val bredvid Publicera, av som standard. */}
    {data && <div className={styles.fieldWithHelpBlock}>
      <label className={styles.check}><input type="checkbox" checked={live} disabled={disabled}
        aria-describedby={`start-list-live-${raceId}-help`} onChange={event => void saveStartListLive(event.target.checked)} />
        {publicationText.live}</label>
      <p className={styles.workflowHelp} id={`start-list-live-${raceId}-help`}>{publicationText.liveHelp}</p>
    </div>}
    {startListLiveMessage && <Notice tone={startListLiveMessage.tone} role={startListLiveMessage.tone === "ok" ? "status" : "alert"}>
      {startListLiveMessage.text}</Notice>}
    {publicationAttempt && unknown && <Notice tone="attention" role="alert">
      <p>{text.unreachable}</p>
      <div><Button disabled={busy} onClick={() => void submitPublication(publicationAttempt)}>{text.retry}</Button></div>
    </Notice>}
  </Section>;
}

/**
 * Start i ordningen 1 Lottning (typer med lottning; stafetten: masstart och omstart), 2 Startlistan (visa, skriv ut,
 * exportera) och 3 Publicera startlistan (PLAN.md steg 24). Funktionären ser bara startlistan (ADR-0172 beslut 3).
 */
export function PreparationStartList({ ws }: { ws: Workspace }) {
  const { data, disabled, downloadStartList, functionary, profile, raceId, select, shows } = ws;
  const visible = shows("START");
  const model = useMemo(() => data ? startListFromWorkspace(data) : undefined, [data]);
  const lists = model && (functionary ? <StartLists model={model} disabled={disabled} exportable={false} />
    : <StartLists model={model} onSelectEntry={id => select(id)} disabled={disabled}
      iof={{ onSelect: () => void downloadStartList(), disabled }} />);
  // Steg 33: kort info och första start överst i Start-steget, för administratören och funktionärerna.
  const info = data && <RaceInfo info={data.info} firstStartTime={data.firstStartTime} heading="h3" />;
  // Steg 61: kartor till starten (tryckantal, kartbuntslistan och baksidor) när någon klass är gafflad.
  const maps = data?.classes.some(row => row.courseVariants.length > 0) && <p className={styles.workflowHelp}>
    <Link href={`/admin/${raceId}/maps`}>{mapText.link}</Link> – {mapText.linkHelp}</p>;
  if (functionary) return <section className={styles.workflowGroup} aria-label={navigationText.steps.START} hidden={!visible}>{info}{maps}{lists}</section>;
  const first = profile.features.draw || profile.features.relay;
  return <section className={styles.workflowGroup} aria-label={navigationText.steps.START} hidden={!visible}>
    {info}
    {profile.features.draw && <StartDrawPanel ws={ws} visible={visible} number={1} />}
    {profile.features.relay && <RelayStartTimes ws={ws} visible={visible} number={1} />}
    {maps}
    <Section id={`start-lists-${raceId}`} title={publicationText.listHeading} number={first ? 2 : 1}
      help={publicationText.listHelp}>{lists}
      {/* PLAN.md steg 31: flytta en klass starttider; bara administratören. */}
      {data && <div className={styles.disclosureList}><ShiftStartTimes raceId={raceId} classes={data.classes} timeZone={data.timeZone}
        onChanged={ws.reloadQuietly} /></div>}
    </Section>
    <StartPublication ws={ws} visible={visible} number={first ? 3 : 2} />
  </section>;
}
