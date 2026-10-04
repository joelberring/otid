"use client";

import { useEffect } from "react";
import Link from "next/link";
import { flushSync } from "react-dom";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../i18n/race-workspace-navigation-sv";
import styles from "./race-administrator-workspace.module.css";
import { useWorkspace } from "./race-administrator/workspace-state";
import { useDuringRaceEffects } from "./race-administrator/during-race";
import { Checklist } from "./race-administrator/checklist";
import { PreparationCourses } from "./race-administrator/preparation-courses";
import { PreparationClasses } from "./race-administrator/preparation-classes";
import { PreparationStartList } from "./race-administrator/preparation-start-list";
import { AfterRacePanel, ResultExportPanel } from "./race-administrator/after-race-panel";
import { DuringRaceFollowUp, DuringRaceOverview } from "./race-administrator/during-race-panel";
import { ParticipantsPanel, RentalPrint } from "./race-administrator/participants-panel";

/**
 * Adminarbetsytan för en tävling. Den här komponenten håller sessionen, laddar data och visar checklistan
 * (Banor → Klasser → Anmälda → Start → Avläsning → Resultat). Varje steg finns i `race-administrator/`.
 */
export function RaceAdministratorWorkspace({ raceId }: { raceId: string }) {
  const ws = useWorkspace(raceId);
  const { authenticated, busy, message, data, expiresAt, navigationLocked, workflowLocked, printTarget, deadline, begin, session,
    enterWithAccount, current, lock, finish, invalidate, loadRaceDayAttention, login, logout, refresh, setPrintTarget } = ws;
  useEffect(() => {
    const op = begin();
    void session(op)
      .catch(() => enterWithAccount(op))
      .then(() => true, () => { if (current(op)) lock(); return false; })
      .then(entered => {
        finish(op);
        // Checklistans avläsningsstatus behöver okända brickor och kvar i skogen direkt.
        if (entered && current(op)) void loadRaceDayAttention();
      });
    const hide = () => flushSync(() => lock(true));
    const visible = () => { if (document.visibilityState === "visible" && deadline.current && deadline.current <= Date.now()) lock(); };
    window.addEventListener("pagehide", hide); document.addEventListener("visibilitychange", visible);
    return () => { invalidate(); deadline.current = 0; window.removeEventListener("pagehide", hide); document.removeEventListener("visibilitychange", visible); };
    // This private surface is remounted for each race; mutable form state must not restart login.
  }, [raceId]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => lock(), Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, lock]);
  useEffect(() => {
    const clearPrintTarget = () => setPrintTarget(undefined);
    window.addEventListener("afterprint", clearPrintTarget);
    return () => window.removeEventListener("afterprint", clearPrintTarget);
  }, []);
  useDuringRaceEffects(ws);
  const eventsLabel = navigationText.backToEvents;
  const eventsLink = workflowLocked
    ? <span className={styles.backUnavailable} aria-disabled="true" title={navigationText.backLocked}>{eventsLabel}</span>
    : <Link className={styles.backToEvents} href="/organizer" prefetch={false}>{eventsLabel}</Link>;
  return <div className={styles.workspace} data-print-target={printTarget} data-authenticated={authenticated}>
    {!authenticated && <p>{text.introduction}</p>}
    <p className={styles.status} role="status" aria-live="polite">{message}</p>
    {!authenticated && <form className={`${styles.panel} ${styles.login}`} onSubmit={(event) => void login(event)}>
      <p>{text.accountLoginHelp} <Link href="/organizer" prefetch={false}>{text.accountLoginLink}</Link></p>
      <button disabled={busy}>{text.login}</button>
    </form>}
    {authenticated && <>
      <div className={styles.workspaceChrome}>
        {data && <div className={styles.raceIdentity}>
          <div><div className={styles.identityTitle}>
            {eventsLink}
            <span className={styles.identityDivider} aria-hidden="true">›</span><h2>{data.eventName}</h2>
          </div><p>{data.raceName} · <time dateTime={data.raceDate}>{data.raceDate}</time></p></div>
          <div className={styles.identityActions}>
            <button type="button" className="secondary" disabled={workflowLocked} onClick={() => void refresh()}>{text.refreshOverview}</button>
            <button className="secondary" disabled={workflowLocked} onClick={() => void logout()}>{text.logout}</button>
          </div>
        </div>}
        {!data && <div className={styles.identityActions}>
          {eventsLink}
          <button className="secondary" disabled={workflowLocked} onClick={() => void refresh()}>{text.refreshOverview}</button>
          <button className="secondary" disabled={workflowLocked} onClick={() => void logout()}>{text.logout}</button>
        </div>}
      </div>
      <Checklist ws={ws} />
      {navigationLocked && <p className={styles.workflowHelp} role="status">{text.workflowHelp}</p>}
      <PreparationCourses ws={ws} />
      <PreparationClasses ws={ws} />
      <ParticipantsPanel ws={ws} />
      <RentalPrint ws={ws} />
      <PreparationStartList ws={ws} />
      <DuringRaceOverview ws={ws} />
      <DuringRaceFollowUp ws={ws} />
      <AfterRacePanel ws={ws} />
      <ResultExportPanel ws={ws} />
    </>}
  </div>;
}
