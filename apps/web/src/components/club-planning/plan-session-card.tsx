"use client";

import Link from "next/link";
import { useState } from "react";
import type { ClubPlanResponse, ClubPlanSessionView } from "@o-tid/contracts";
import { clubPlanningEn } from "../../i18n/club-planning-en";
import { clubPlanningSv } from "../../i18n/club-planning-sv";
import { planRequest, shortDate } from "../../lib/club-planning-client";
import { useLanguage, useTexts } from "../language-provider";
import { Button } from "../ui";
import { MomentBadges } from "../training-moments/moment-picker";
import { PlanLinkRace } from "./plan-link-race";
import { RacePrintFiles } from "../race-print-files";
import { racePrintFilesEn } from "../../i18n/race-print-files-en";
import { racePrintFilesSv } from "../../i18n/race-print-files-sv";
import { PlanSessionForm } from "./plan-session-form";
import { PlanTasks } from "./plan-tasks";
import styles from "./club-planning.module.css";

export type PlanChange = (path: string, method: "POST" | "PUT" | "DELETE", body: unknown, done?: (json: unknown) => string | undefined) => Promise<boolean>;

/** ADR-0221: en planerad träning i veckan – vad, var, vem som ansvarar, uppgifterna och "Skapa träningen". */
export function PlanSessionCard({ plan, session, termId, busy, change, reload }: {
  plan: ClubPlanResponse; session: ClubPlanSessionView; termId: string; busy: boolean; change: PlanChange; reload: () => Promise<void>;
}) {
  const text = useTexts(clubPlanningSv, clubPlanningEn);
  const language = useLanguage();
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const printText = useTexts(racePrintFilesSv, racePrintFilesEn);
  const path = `/sessions/${session.sessionId}`;

  if (editing) return <div className={styles.session}>
    <PlanSessionForm plan={plan} termId={termId} session={session} busy={busy} onCancel={() => setEditing(false)}
      onSave={async body => { if (await change(path, "PUT", body, () => text.session.saved)) setEditing(false); }} />
  </div>;

  const facts = [session.place, session.mapName ? text.session.mapIs(session.mapName) : "", session.groupName ? text.session.groupIs(session.groupName) : ""]
    .filter(Boolean);
  return <article className={styles.session} data-testid="plan-session" aria-label={`${shortDate(session.sessionDate, language)} ${session.title}`}>
    <div className={styles.sessionHead}>
      <div>
        <p className={styles.when}>{shortDate(session.sessionDate, language)}{session.startTime ? ` · ${session.startTime}` : ""}</p>
        <h4>{session.title}</h4>
        {facts.length > 0 && <p className={styles.small}>{facts.join(" · ")}</p>}
        <p className={styles.small}>{session.responsibleName ? text.session.responsibleIs(session.responsibleName) : text.session.noResponsibleYet}</p>
        <MomentBadges moments={session.moments} levels={session.levels} tags={session.tags} />
        {session.note && <p className={styles.note}>{session.note}</p>}
      </div>
      <div className={`${styles.actions} ${styles.noPrint}`}>
        {session.raceId ? <>
          <Link className={styles.link} href={`/admin/${session.raceId}`}>{text.session.openRace}</Link>
          <Link className={styles.link} href={`/admin/${session.raceId}/course-setting`}>{text.session.courseSetting}</Link>
          <Button variant="quiet" disabled={busy} onClick={() => setLinking(true)}>{text.link.change}</Button>
          <Button variant="quiet" disabled={busy} onClick={() => { if (window.confirm(text.link.unlinkConfirm))
            void change(`${path}/race`, "PUT", { formatVersion: 1, raceId: null }, () => text.link.unlinked); }}>{text.link.unlink}</Button>
        </> : <>
          <Button variant="secondary" disabled={busy} title={text.session.createRaceHelp}
            onClick={() => void change(`${path}/race`, "POST", undefined, () => text.session.raceCreated)}>{text.session.createRace}</Button>
          <Button variant="quiet" disabled={busy} title={text.link.help} onClick={() => setLinking(true)}>{text.link.open}</Button>
        </>}
        <Button variant="quiet" disabled={busy} onClick={() => setEditing(true)}>{text.session.change}</Button>
        <Button variant="quiet" disabled={busy} onClick={() => { if (window.confirm(text.session.removeConfirm)) void change(path, "DELETE", undefined); }}>
          {text.session.remove}</Button>
      </div>
    </div>
    {session.raceId && <details className={styles.noPrint} data-testid="plan-print-files">
      <summary>{printText.heading}</summary>
      <RacePrintFiles raceId={session.raceId} canEdit compact />
    </details>}
    {linking && <PlanLinkRace path={path} sessionDate={session.sessionDate} busy={busy} change={change} onClose={() => setLinking(false)} />}
    <PlanTasks plan={plan} session={session} busy={busy} change={change}
      toggle={async (taskId, done) => { await planRequest(`/api/organizer/plan-tasks/${taskId}`, "PUT", { formatVersion: 1, done }); await reload(); }} />
  </article>;
}
