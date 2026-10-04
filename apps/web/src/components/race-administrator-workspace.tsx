"use client";

import { useEffect } from "react";
import Link from "next/link";
import { flushSync } from "react-dom";
import { RaceWorkspaceOverview } from "./race-workspace-overview";
import { RacePreparationGuide } from "./race-preparation-guide";
import { formatStartListTime } from "../lib/start-list-time";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import { startListPublicationSv as publicationText } from "../i18n/start-list-publication-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../i18n/race-workspace-navigation-sv";
import styles from "./race-administrator-workspace.module.css";
import { useWorkspace } from "./race-administrator/workspace-state";
import { useDuringRaceEffects } from "./race-administrator/during-race";
import type { DuringArea, PreparationArea, WorkflowMode } from "./race-administrator/types";
import { PreparationCourses } from "./race-administrator/preparation-courses";
import { PreparationClasses } from "./race-administrator/preparation-classes";
import { PreparationStartList } from "./race-administrator/preparation-start-list";
import { AfterRacePanel, ResultExportPanel } from "./race-administrator/after-race-panel";
import { DuringRaceFollowUp, DuringRaceOverview } from "./race-administrator/during-race-panel";
import { ParticipantsPanel, RentalPrint } from "./race-administrator/participants-panel";

/**
 * Adminarbetsytan för en tävling. Den här komponenten håller sessionen, laddar data och styr navigeringen
 * mellan arbetsflödena. Varje område (förberedelse, deltagare, tävlingsdag, efter tävlingen) finns i
 * `race-administrator/`.
 */
export function RaceAdministratorWorkspace({ raceId }: { raceId: string }) {
  const ws = useWorkspace(raceId);
  const { authenticated, busy, message, data, expiresAt, workflowMode, preparationArea, duringArea, workflowLocked,
    printTarget, freeStartClassCount, fixedStartClassCount, olderResultCount, rentalCardCount, deadline, begin, session,
    enterWithAccount, current, lock, finish, invalidate, login, logout, refresh, navigateWorkflow, openMissingFixedStart,
    openClassSetup, followUp, openPreparationStep, loadRaceDayAttention, setPrintTarget, setSelectedClassId,
    setPreparationArea, setDuringArea, preparationNavigation, coursesNavigationButton,
    coursesNavigationSelect } = ws;
  useEffect(() => {
    const op = begin();
    void session(op)
      .catch(() => enterWithAccount(op))
      .catch(() => { if (current(op)) lock(); }).finally(() => finish(op));
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
          </div><p>{data.raceName} · <time dateTime={data.raceDate}>{data.raceDate}</time> · {data.timeZone}</p></div>
          <div className={styles.identityActions}>
            <button type="button" className="secondary" disabled={workflowLocked} onClick={() => void refresh()}>{text.refreshOverview}</button>
            <button className="secondary" disabled={workflowLocked} onClick={() => void logout()}>{text.logout}</button>
          </div>
        </div>}
        <div className={styles.toolbar}>
          {data && <section className={styles.statusStrip} aria-label={text.statusHeading}>
            <dl className={styles.statusMetrics}>
              <div><dt>{text.participants}</dt><dd>{data.entries.length}</dd></div>
              <div><dt>{text.classes}</dt><dd>{data.classes.length}</dd></div>
              <div><dt>{text.statusFreeStartClasses}</dt><dd>{freeStartClassCount}</dd></div>
              <div><dt>{text.statusFixedStartClasses}</dt><dd>{fixedStartClassCount}</dd></div>
              <div><dt>{text.statusOlderResults}</dt><dd>{olderResultCount}</dd></div>
              <div><dt>{text.statusOutstandingRentals}</dt><dd>{rentalCardCount}</dd></div>
            </dl>
            <p className={styles.statusBasis}>{text.statusBasis(data.snapshotVersion,
              formatStartListTime(data.generatedAt, data.timeZone))}</p>
          </section>}
          {!data && <div className={styles.identityActions}>
            {eventsLink}
            <button className="secondary" disabled={workflowLocked} onClick={() => void refresh()}>{text.refreshOverview}</button>
            <button className="secondary" disabled={workflowLocked} onClick={() => void logout()}>{text.logout}</button>
          </div>}
        </div>
      </div>
      <nav className={styles.workflowNavigation} aria-label={text.workflowNavigation}>
        {(["OVERVIEW", "BEFORE", "PARTICIPANTS", "DURING", "AFTER"] as const).map(mode => {
          const labels = { OVERVIEW: text.workflowOverview, PARTICIPANTS: text.workflowParticipants, BEFORE: text.workflowBefore,
            DURING: text.workflowDuring, AFTER: text.workflowAfter };
          const controls = { OVERVIEW: `workflow-${raceId}-overview`, PARTICIPANTS: `workflow-${raceId}-participants`, BEFORE: `workflow-${raceId}-before`,
            DURING: `workflow-${raceId}-during`, AFTER: `workflow-${raceId}-after` };
          return <button key={mode} type="button" className="secondary" aria-pressed={workflowMode === mode}
            aria-controls={controls[mode]} disabled={workflowLocked} onClick={() => navigateWorkflow(mode)}>{labels[mode]}</button>;
        })}
      </nav>
      <nav className={styles.mobileWorkflowNavigation} aria-label={text.workflowNavigation}>
        <label>{text.workflowNavigation}
          <select value={workflowMode} disabled={workflowLocked} onChange={event => navigateWorkflow(event.target.value as WorkflowMode)}>
            <option value="OVERVIEW">{text.workflowOverview}</option>
            <option value="BEFORE">{text.workflowBefore}</option>
            <option value="PARTICIPANTS">{text.workflowParticipants}</option>
            <option value="DURING">{text.workflowDuring}</option>
            <option value="AFTER">{text.workflowAfter}</option>
          </select>
        </label>
      </nav>
      {workflowMode === "BEFORE" && <nav ref={preparationNavigation} className={styles.subNavigation} aria-label={navigationText.preparationNavigation}>
        {(Object.keys(navigationText.preparation) as PreparationArea[]).map(area => <button key={area} type="button"
          ref={area === "COURSES" ? coursesNavigationButton : undefined}
          data-preparation-area={area}
          className={`${styles.preparationNavigationButton} secondary`} aria-label={navigationText.preparation[area]}
          aria-pressed={preparationArea === area} disabled={workflowLocked} onClick={() => { setSelectedClassId(""); setPreparationArea(area); }}>
          <span className={styles.preparationLabelDesktop} aria-hidden="true">{navigationText.preparation[area]}</span>
          <span className={styles.preparationLabelMobile} aria-hidden="true">{navigationText.preparationMobile[area]}</span>
        </button>)}
      </nav>}
      {workflowMode === "BEFORE" && <nav className={styles.mobileSubNavigation} aria-label={navigationText.preparationNavigation}>
        <label>{navigationText.preparationNavigation}
          <select ref={coursesNavigationSelect} value={preparationArea} disabled={workflowLocked}
            onChange={event => { setSelectedClassId(""); setPreparationArea(event.target.value as PreparationArea); }}>
            {(Object.keys(navigationText.preparation) as PreparationArea[]).map(area =>
              <option key={area} value={area}>{navigationText.preparation[area]}</option>)}
          </select>
        </label>
      </nav>}
      {workflowMode === "DURING" && <nav className={styles.subNavigation} aria-label={navigationText.duringNavigation}>
        {(Object.keys(navigationText.during) as DuringArea[]).map(area => <button key={area} type="button"
          className={`${styles.duringNavigationButton} secondary`} aria-label={navigationText.during[area]}
          aria-pressed={duringArea === area} disabled={workflowLocked}
          onClick={() => { setDuringArea(area); if (area === "OVERVIEW") void loadRaceDayAttention(); }}>
          <span className={styles.duringLabelDesktop} aria-hidden="true">{navigationText.during[area]}</span>
          <span className={styles.duringLabelMobile} aria-hidden="true">{navigationText.duringMobile[area]}</span>
        </button>)}
      </nav>}
      {workflowMode === "DURING" && <nav className={styles.mobileSubNavigation} aria-label={navigationText.duringNavigation}>
        <label>{navigationText.duringNavigation}
          <select value={duringArea} disabled={workflowLocked} onChange={event => {
            const area = event.target.value as DuringArea;
            setDuringArea(area);
            if (area === "OVERVIEW") void loadRaceDayAttention();
          }}>
            {(Object.keys(navigationText.during) as DuringArea[]).map(area =>
              <option key={area} value={area}>{navigationText.during[area]}</option>)}
          </select>
        </label>
      </nav>}
      {workflowLocked && <p className={styles.workflowHelp} role="status">{text.workflowHelp}</p>}
      <section className={styles.workflowGroup} id={`workflow-${raceId}-overview`} aria-label={text.workflowOverview}
        hidden={workflowMode !== "OVERVIEW"}>
        {data && <RaceWorkspaceOverview data={data} disabled={workflowLocked} onNavigate={navigateWorkflow}
          onFollowUp={followUp} onMissingFixedStart={openMissingFixedStart} onOpenClass={openClassSetup} />}
        {!workflowLocked && <nav className={styles.contextLinks} aria-label={text.overviewLinks}>
          <a href={`/admin/${raceId}/readout`}>{text.readoutLink}</a>
          <Link href={`/results/${raceId}`}>{text.publicResultsLink}</Link>
          <Link href={`/starts/${raceId}`}>{publicationText.publicLink}</Link>
        </nav>}
      </section>
      <section className={styles.workflowGroup} id={`workflow-${raceId}-before`} aria-label={navigationText.preparation.OVERVIEW}
        hidden={workflowMode !== "BEFORE" || preparationArea !== "OVERVIEW"}>
        {data && <RacePreparationGuide data={data} disabled={workflowLocked} onOpenArea={openPreparationStep}
          onMissingFixedStart={() => openMissingFixedStart("")} />}
      </section>
      <PreparationCourses ws={ws} />
      <AfterRacePanel ws={ws} />
      <DuringRaceOverview ws={ws} />
      <RentalPrint ws={ws} />
      <DuringRaceFollowUp ws={ws} />
      <PreparationStartList ws={ws} />
      <ResultExportPanel ws={ws} />
      <ParticipantsPanel ws={ws} />
      <PreparationClasses ws={ws} />
    </>}
  </div>;
}
