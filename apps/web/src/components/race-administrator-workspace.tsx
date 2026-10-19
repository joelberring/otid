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
import { AfterRacePanel } from "./race-administrator/after-race-panel";
import { DuringRaceFollowUp, DuringRaceOverview } from "./race-administrator/during-race-panel";
import { ParticipantsPanel, RentalPrint } from "./race-administrator/participants-panel";
import { SettingsPanel } from "./race-administrator/settings-panel";
import { RogainingPanel } from "./race-administrator/rogaining-panel";
import { PublishPanel } from "./race-administrator/race-publication-section";

/**
 * Adminarbetsytan för en tävling. Den här komponenten håller sessionen, laddar data och visar skalet:
 * toppbalken, sidopanelen med tävlingens delar (efter tävlingstypen, ADR-0170) och den valda delen.
 * Varje del finns i `race-administrator/`.
 */
export function RaceAdministratorWorkspace({ raceId }: { raceId: string }) {
  const ws = useWorkspace(raceId);
  const { authenticated, message, expiresAt, navigationLocked, printTarget, deadline, begin, session,
    current, lock, finish, invalidate, loadRaceDayAttention, setPrintTarget } = ws;
  useEffect(() => {
    const op = begin();
    void session(op)
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
    // Kontosessionen gäller 30 dagar, längre än setTimeouts största fördröjning (2^31−1 ms); en större
    // fördröjning skulle lösa ut direkt. Efter taket kontrollerar sidan utgången igen när den blir synlig.
    const timer = setTimeout(() => { if (Date.parse(expiresAt) <= Date.now()) lock(); },
      Math.min(2_147_483_647, Math.max(0, Date.parse(expiresAt) - Date.now())));
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
    <p>{text.accountLoginHelp} <Link href="/organizer" prefetch={false}>{text.accountLoginLink}</Link></p>
  </div>;
  return <div className={`${styles.root} ${shell.shell}`} data-print-target={printTarget} data-authenticated="true">
    <TopBar ws={ws} />
    <div className={shell.frame}>
      <Sidebar ws={ws} />
      <div className={`${shell.content} ${styles.content}`}>
        {status}
        {navigationLocked && <p className={styles.workflowHelp} role="status">{text.workflowHelp}</p>}
        {/* Funktionären (ADR-0172 beslut 3): bara Start och Avläsning. Servern nekar allt annat ändå. */}
        {!ws.functionary && <>
          <RogainingPanel ws={ws} />
          <PreparationCourses ws={ws} />
          <PreparationClasses ws={ws} />
          <ParticipantsPanel ws={ws} />
          <RentalPrint ws={ws} />
        </>}
        <PreparationStartList ws={ws} />
        {!ws.functionary && <PublishPanel ws={ws} />}
        <DuringRaceOverview ws={ws} />
        <DuringRaceFollowUp ws={ws} />
        {!ws.functionary && <>
          <AfterRacePanel ws={ws} />
          <SettingsPanel ws={ws} />
        </>}
      </div>
    </div>
  </div>;
}
