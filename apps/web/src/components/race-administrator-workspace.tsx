"use client";

import { useEffect } from "react";
import Link from "next/link";
import { flushSync } from "react-dom";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import styles from "./race-administrator-workspace.module.css";
import shell from "./race-administrator/shell.module.css";
import { useWorkspace } from "./race-administrator/workspace-state";
import { useDuringRaceEffects } from "./race-administrator/during-race";
import { Sidebar, TopBar } from "./race-administrator/shell";
import { PreparationCourses } from "./race-administrator/preparation-courses";
import { PreparationClasses } from "./race-administrator/preparation-classes";
import { PreparationStartList } from "./race-administrator/preparation-start-list";
import { AfterRacePanel, ResultExportPanel } from "./race-administrator/after-race-panel";
import { DuringRaceFollowUp, DuringRaceOverview } from "./race-administrator/during-race-panel";
import { ParticipantsPanel, RentalPrint } from "./race-administrator/participants-panel";
import { RogainingNote, SettingsPanel } from "./race-administrator/settings-panel";
import { Button } from "./ui";

/**
 * Adminarbetsytan för en tävling. Den här komponenten håller sessionen, laddar data och visar skalet:
 * toppbalken, sidopanelen med tävlingens delar (efter tävlingstypen, ADR-0170) och den valda delen.
 * Varje del finns i `race-administrator/`.
 */
export function RaceAdministratorWorkspace({ raceId }: { raceId: string }) {
  const ws = useWorkspace(raceId);
  const { authenticated, busy, message, expiresAt, navigationLocked, printTarget, deadline, begin, session,
    enterWithAccount, current, lock, finish, invalidate, loadRaceDayAttention, login, setPrintTarget } = ws;
  useEffect(() => {
    const op = begin();
    void session(op)
      .catch(() => enterWithAccount(op))
      .then(() => true, () => { if (current(op)) lock(); return false; })
      .then(entered => {
        finish(op);
        // Sidopanelens avläsningsstatus behöver okända brickor och kvar i skogen direkt.
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
  const status = <p className={styles.status} role="status" aria-live="polite">{message}</p>;
  if (!authenticated) return <div className={`${styles.workspace} ${styles.login}`} data-authenticated="false">
    <p>{text.introduction}</p>
    {status}
    <form onSubmit={event => void login(event)}>
      <p>{text.accountLoginHelp} <Link href="/organizer" prefetch={false}>{text.accountLoginLink}</Link></p>
      <div><Button type="submit" disabled={busy}>{text.login}</Button></div>
    </form>
  </div>;
  return <div className={`${styles.root} ${shell.shell}`} data-print-target={printTarget} data-authenticated="true">
    <TopBar ws={ws} />
    <div className={shell.frame}>
      <Sidebar ws={ws} />
      <div className={`${shell.content} ${styles.content}`}>
        {status}
        {navigationLocked && <p className={styles.workflowHelp} role="status">{text.workflowHelp}</p>}
        <RogainingNote ws={ws} />
        <PreparationCourses ws={ws} />
        <PreparationClasses ws={ws} />
        <ParticipantsPanel ws={ws} />
        <RentalPrint ws={ws} />
        <PreparationStartList ws={ws} />
        <DuringRaceOverview ws={ws} />
        <DuringRaceFollowUp ws={ws} />
        <AfterRacePanel ws={ws} />
        <ResultExportPanel ws={ws} />
        <SettingsPanel ws={ws} />
      </div>
    </div>
  </div>;
}
