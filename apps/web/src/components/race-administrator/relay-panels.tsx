"use client";

import { useEffect } from "react";
import type { RelayOverview } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import relayStyles from "./relay.module.css";
import controlStyles from "../race-workspace-checklist.module.css";
import { relaySv as text } from "../../i18n/relay-sv";
import { formatClockTime } from "../../lib/clock-time";
import type { Workspace } from "./workspace-state";

/** Läser in lagvyn när den visas och tävlingen har ändrats sedan senast. */
export function useRelayLoad(ws: Workspace, visible: boolean) {
  const { authenticated, busy, data, loadRelay, pending, relay, relayError } = ws;
  // Bara när tävlingen har stafettklasser; annars finns inget att läsa.
  const stale = !!data?.classes.some(row => row.relayLegCount) &&
    (!relay || relay.snapshotVersion < data.snapshotVersion);
  useEffect(() => {
    if (visible && authenticated && data && !busy && !pending.current && stale && !relayError) void loadRelay();
  }, [visible, authenticated, data, busy, stale, relayError]);
}

export function RelayMessages({ ws }: { ws: Workspace }) {
  const { busy, loadRelay, relayError, relayMessage } = ws;
  return <>
    {relayMessage && <p role="status" className={styles.courseEditSaved}>{relayMessage}</p>}
    {relayError && <div className={styles.warning} role="alert"><p>{relayError}</p>
      <button type="button" className="secondary" disabled={busy} onClick={() => void loadRelay()}>{text.retry}</button></div>}
  </>;
}

/** Klasser: "Ny stafettklass" med bana, antal sträckor och startsätt per sträcka. */
export function RelayClassForm({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { changeLeg, changeLegCount, courseList, createRelayClass, raceId, relayClassAttempt, relayClassCourseId, relayClassName,
    relayLegForms, setRelayClassCourseId, setRelayClassName, workflowLocked } = ws;
  useRelayLoad(ws, visible);
  const course = courseList?.courses.find(row => row.courseId === relayClassCourseId);
  const locked = workflowLocked || !!relayClassAttempt;
  const id = `relay-class-${raceId}`;
  return <>{visible && <RelayMessages ws={ws} />}<details className={styles.manualClassPanel} open={relayClassAttempt ? true : undefined}>
    <summary>{text.newClass}</summary>
    <form className={styles.manualClassBody} aria-label={text.newClass} onSubmit={event => { event.preventDefault(); void createRelayClass(); }}>
      <p className={styles.workflowHelp}>{text.newClassHelp}</p>
      <div className={styles.manualClassFields}>
        <label htmlFor={`${id}-name`}>{text.className}<input id={`${id}-name`} value={relayClassName} maxLength={160} required
          autoComplete="off" disabled={locked} onChange={event => setRelayClassName(event.target.value)} /></label>
        <label htmlFor={`${id}-course`}>{text.course}<select id={`${id}-course`} value={relayClassCourseId} required disabled={locked}
          onChange={event => setRelayClassCourseId(event.target.value)}>
          <option value="">{text.chooseCourse}</option>
          {courseList?.courses.map(row => <option key={row.courseId} value={row.courseId}>{row.name}</option>)}
        </select></label>
        <label htmlFor={`${id}-legs`}>{text.legCount}<select id={`${id}-legs`} value={relayLegForms.length} disabled={locked}
          onChange={event => changeLegCount(Number(event.target.value))}>
          {Array.from({ length: 19 }, (_, index) => index + 2).map(count => <option key={count} value={count}>{count}</option>)}
        </select></label>
      </div>
      <p className={styles.workflowHelp}>{text.methodHelp}</p>
      <div className={relayStyles.legs}>
        {relayLegForms.map((leg, index) => <div key={index} className={relayStyles.leg}>
          <span className={relayStyles.legName}>{text.leg(index + 1)}</span>
          <label>{text.legMethod(index + 1)}<select value={index === 0 ? "MASS_START" : leg.method} disabled={locked || index === 0}
            onChange={event => changeLeg(index, { method: event.target.value as typeof leg.method })}>
            {(["MASS_START", "CHANGEOVER", "RESTART"] as const).map(method => <option key={method} value={method}>{text.methods[method]}</option>)}
          </select></label>
          {(index === 0 || leg.method !== "CHANGEOVER")
            ? <label>{text.legTime(index + 1, index === 0 ? "MASS_START" : leg.method)}<input value={leg.time} inputMode="numeric"
              placeholder={text.timeExample} autoComplete="off" disabled={locked} onChange={event => changeLeg(index, { time: event.target.value })} /></label>
            : <span />}
          {course && course.variants.length > 0 ? <label>{text.legVariant(index + 1)}<select value={leg.variant} disabled={locked}
            onChange={event => changeLeg(index, { variant: event.target.value })}>
            <option value="">{text.forkedVariants}</option>
            {course.variants.map(variant => <option key={variant.code} value={variant.code}>{variant.code}</option>)}
          </select></label> : <span />}
        </div>)}
      </div>
      <div className={styles.actions}><button type="submit" disabled={workflowLocked}>{text.saveClass}</button></div>
    </form>
  </details></>;
}

/** Start: masstart- och omstartstider per stafettklass, som klockslag. */
export function RelayStartTimes({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { changeRelayTime, relay, relayTimeValue, saveRelayTimes, workflowLocked } = ws;
  useRelayLoad(ws, visible);
  const classes = relay?.classes.filter(row => row.legs.some(leg => leg.startMethod !== "CHANGEOVER")) ?? [];
  if (classes.length === 0) return null;
  return <section className={styles.panel} aria-label={text.startTitle}>
    <h2>{text.startTitle}</h2>
    <p className={styles.workflowHelp}>{text.startHelp}</p>
    {visible && <RelayMessages ws={ws} />}
    {classes.map(raceClass => <form key={raceClass.id} className={relayStyles.times} aria-label={raceClass.name}
      onSubmit={event => { event.preventDefault(); void saveRelayTimes(raceClass.id); }}>
      <h3>{raceClass.name}</h3>
      <div className={relayStyles.timeRow}>
        {raceClass.legs.filter(leg => leg.startMethod !== "CHANGEOVER").map(leg => <label key={leg.leg}>
          {text.legTime(leg.leg, leg.startMethod)}<input value={relayTimeValue(raceClass.id, leg.leg)} inputMode="numeric" autoComplete="off"
            placeholder={text.timeExample} disabled={workflowLocked} onChange={event => changeRelayTime(raceClass.id, leg.leg, event.target.value)} />
        </label>)}
        <button type="submit" disabled={workflowLocked}>{text.saveTimes(raceClass.name)}</button>
      </div>
    </form>)}
  </section>;
}

/** Lagen som är ute, grupperade per sträcka. */
export function teamsOutByLeg(relay: RelayOverview) {
  return relay.classes.map(raceClass => ({ raceClass, legs: raceClass.legs.map(leg => ({ leg: leg.leg,
    teams: relay.teams.filter(team => team.classId === raceClass.id && team.currentLeg === leg.leg) })) }))
    .filter(row => row.legs.some(leg => leg.teams.length > 0));
}

/** Avläsning: lag ute per sträcka med sträckans löpare och starttid. */
export function RelayControl({ ws }: { ws: Workspace }) {
  const { raceId, relay } = ws;
  if (!relay || relay.classes.length === 0) return null;
  const out = teamsOutByLeg(relay);
  const total = out.reduce((sum, row) => sum + row.legs.reduce((count, leg) => count + leg.teams.length, 0), 0);
  return <section className={controlStyles.controlCard} aria-labelledby={`control-relay-${raceId}`}>
    <h3 id={`control-relay-${raceId}`}>{text.controlTeams}{" "}
      <strong className={controlStyles.controlCount} data-testid="teams-out-count">{total}</strong></h3>
    <p className={styles.workflowHelp}>{text.controlTeamsHelp}</p>
    {total === 0 ? <p>{text.controlTeamsNone}</p> : <ul className={relayStyles.controlLegs}>
      {out.flatMap(row => row.legs.filter(leg => leg.teams.length > 0).map(leg => <li key={`${row.raceClass.id}:${leg.leg}`}>
        <h4>{row.raceClass.name} · {text.controlLeg(leg.leg, leg.teams.length)}</h4>
        <ul>{leg.teams.map(team => {
          const runner = team.legs.find(candidate => candidate.leg === leg.leg);
          return <li key={team.id}><strong>{text.teamHeading(team.number, team.name)}</strong>
            {runner && <> · {runner.givenName} {runner.familyName}{runner.startTime
              ? ` · ${text.legStart} ${formatClockTime(runner.startTime, relay.timeZone)}` : ""}</>}
            {team.status !== "RUNNING" && <> · <span className={relayStyles.status} data-status={team.status}>{text.status[team.status]}</span></>}
          </li>;
        })}</ul>
      </li>))}
    </ul>}
  </section>;
}
