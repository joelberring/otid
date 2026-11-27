"use client";

import { sectionFromSlug } from "../lib/race-sections";
import { GroupBackLink } from "./race-administrator/group-back-link";
import { useEffect } from "react";
import { raceAdministratorEn } from "../i18n/workspace-admin-en";
import { useLanguage, useTexts } from "./language-provider";
import dynamic from "next/dynamic";
import Link from "next/link";
import { flushSync } from "react-dom";
import { raceAdministratorSv } from "../i18n/race-administrator-sv";
import styles from "./race-administrator-workspace.module.css";
import shell from "./race-administrator/shell.module.css";
import { useWorkspace } from "./race-administrator/workspace-state";
import { useDuringRaceEffects } from "./race-administrator/during-race";
import { Sidebar, TopBar } from "./race-administrator/shell";
import { PreparationCourses } from "./race-administrator/preparation-courses";
import { PreparationClasses } from "./race-administrator/preparation-classes";
import { PreparationStartList } from "./race-administrator/preparation-start-list";
import { DuringRaceFollowUp, DuringRaceOverview } from "./race-administrator/during-race-panel";
import { ParticipantsPanel, RentalPrint } from "./race-administrator/participants-panel";
import { Notice } from "./ui";
import { AccessNotice } from "./race-administrator/access-notice";
import { SiteFooter } from "./about/site-footer";
import { useMobileExercise } from "./race-administrator/use-mobile-exercise";
import { useRaceWorkspace } from "./app-tabs/race-nav";
import { RaceModeSwitch } from "./app-tabs/race-tab-bar";

function PanelLoading() {
  const language = useLanguage();
  return <p className={styles.muted} role="status">{language === "en" ? "Loading…" : "Hämtar…"}</p>;
}

const loading = () => <PanelLoading />;
const AfterRacePanel = dynamic(() => import("./race-administrator/after-race-panel").then(m => m.AfterRacePanel), { ssr: false, loading });
const SettingsPanel = dynamic(() => import("./race-administrator/settings-panel").then(m => m.SettingsPanel), { ssr: false, loading });
const PeoplePanel = dynamic(() => import("./race-administrator/people-section").then(m => m.PeoplePanel), { ssr: false, loading });
const RogainingPanel = dynamic(() => import("./race-administrator/rogaining-panel").then(m => m.RogainingPanel), { ssr: false, loading });
const PublishPanel = dynamic(() => import("./race-administrator/race-publication-section").then(m => m.PublishPanel), { ssr: false, loading });
const PartyPanel = dynamic(() => import("./race-administrator/party-panel").then(m => m.PartyPanel), { ssr: false, loading });

/**
 * Adminarbetsytan för en tävling. Den här komponenten håller sessionen, laddar data och visar skalet:
 * toppbalken, sidopanelen med tävlingens delar (efter tävlingstypen, ADR-0170) och den valda delen.
 * Varje del finns i `race-administrator/`.
 */
export function RaceAdministratorWorkspace({ raceId }: { raceId: string }) {
  const text = useTexts(raceAdministratorSv, raceAdministratorEn);
  const language = useLanguage();
  const ws = useWorkspace(raceId);
  const { authenticated, message, expiresAt, navigationBlocked, navigationLocked, printTarget, deadline, begin, session,
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
    // ADR-0191 beslut 3 och användartestet 2026-11-12: `?del=…` öppnar delen (t.ex. importsidans "Tillbaka till Anmälda").
    const linked = sectionFromSlug(new URLSearchParams(window.location.search).get("del"));
    if (linked) ws.setStep(linked);
  }, [raceId]);
  useEffect(() => {
    const clearPrintTarget = () => setPrintTarget(undefined);
    window.addEventListener("afterprint", clearPrintTarget);
    return () => window.removeEventListener("afterprint", clearPrintTarget);
  }, []);
  useDuringRaceEffects(ws);
  // Tävlingsraden i telefonbredd (ADR-0227 tillägg 2026-11-18): raden byter del här och stannar vid osparat, som sidopanelen.
  useRaceWorkspace(ws.section.id, { navigate: ws.navigateStep, mayLeave: ws.mayLeave, refresh: () => void ws.refresh() });
  const exercise = useMobileExercise(ws);
  const status = <p className={styles.status} role="status" aria-live="polite">{message}</p>;
  // Användartestet 2026-11-12: nekad (inte ett nätfel) – säg varför i stället för "Logga in igen" till den som är inloggad.
  if (!authenticated) return <div className={`${styles.workspace} ${styles.login}`} data-authenticated="false">
    <p>{text.introduction}</p>
    {message === text.denied ? <AccessNotice /> : <>
      {status}
      <p>{text.accountLoginHelp} <Link href="/organizer" prefetch={false}>{text.accountLoginLink}</Link></p>
    </>}
    <SiteFooter newTab className={styles.footer} language={language} />
  </div>;
  return <div className={`${styles.root} ${shell.shell}`} data-print-target={printTarget} data-authenticated="true">
    <TopBar ws={ws} exercise={exercise} />
    <div className={shell.frame}>
      <Sidebar ws={ws} exercise={exercise} />
      <div className={`${shell.content} ${styles.content}`}>
        <RaceModeSwitch inline />
        {status}
        {ws.functionary && <details className={styles.disclosure} data-testid="functionary-note"><summary>{text.functionaryTitle}</summary>
          <p className={styles.muted}>{text.functionaryNote}</p></details>}
        {!ws.functionary && <GroupBackLink raceId={raceId} />}
        {/* Bara när användaren försökte lämna steget med något som inte är sparat (PLAN.md steg 24). */}
        {navigationBlocked && navigationLocked && <Notice tone="attention" role="alert">{text.workflowHelp}</Notice>}
        {/* Funktionären (ADR-0172 beslut 3): bara Start och Avläsning. Servern nekar allt annat ändå. */}
        {!ws.functionary && <>
          {ws.shows("ROGAINING") && <RogainingPanel ws={ws} />}
          <PreparationCourses ws={ws} />
          <PreparationClasses ws={ws} />
          <ParticipantsPanel ws={ws} />
          <RentalPrint ws={ws} />
        </>}
        {/* PLAN.md steg 40: festen (varor, köp, export); funktionären ser köpen men ändrar inte varor. */}
        {ws.shows("PARTY") && <PartyPanel ws={ws} />}
        <PreparationStartList ws={ws} />
        {!ws.functionary && ws.shows("PUBLISH") && !!ws.data && <PublishPanel ws={ws} />}
        <DuringRaceOverview ws={ws} />
        <DuringRaceFollowUp ws={ws} />
        {!ws.functionary && <>
          {ws.shows("RESULTS") && <AfterRacePanel ws={ws} />}
          {ws.shows("PEOPLE") && <PeoplePanel ws={ws} />}
          {ws.shows("SETTINGS") && !!ws.data && <SettingsPanel ws={ws} />}
        </>}
        {/* PLAN.md steg 37: sidfoten, länkarna i en ny flik så att inget osparat lämnas. */}
        <SiteFooter newTab className={styles.footer} language={language} />
      </div>
    </div>
  </div>;
}
