"use client";

import { useEffect } from "react";
import type { RelayOverview } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import relayStyles from "./relay.module.css";
import controlStyles from "./readout-control.module.css";
import { relaySv as text } from "../../i18n/relay-sv";
import { formatClockTime } from "../../lib/clock-time";
import { Button, Notice, Section } from "../ui";
import type { Workspace } from "./workspace-state";

/** Läser in lagvyn när den visas och tävlingen har ändrats sedan senast. */
export function useRelayLoad(ws: Workspace, visible: boolean) {
  const { authenticated, busy, data, loadRelay, operation, pending, relay, relayError } = ws;
  // Bara när tävlingen har stafettklasser; annars finns inget att läsa.
  const stale = !!data?.classes.some(row => row.relayLegCount) &&
    (!relay || relay.snapshotVersion < data.snapshotVersion);
  useEffect(() => {
    if (visible && authenticated && data && !busy && !operation.current && !pending.current && stale && !relayError) void loadRelay();
  }, [visible, authenticated, data, busy, stale, relayError]);
}

export function RelayMessages({ ws }: { ws: Workspace }) {
  const { busy, loadRelay, relayError, relayMessage } = ws;
  return <>
    {relayMessage && <Notice role="status">{relayMessage}</Notice>}
    {relayError && <Notice tone="error" role="alert"><p>{relayError}</p>
      <div><Button variant="secondary" disabled={busy} onClick={() => void loadRelay()}>{text.retry}</Button></div></Notice>}
  </>;
}

/** Start: masstart- och omstartstider per stafettklass, som klockslag. */
export function RelayStartTimes({ ws, visible, number }: { ws: Workspace; visible: boolean; number: number }) {
  const { changeRelayTime, relay, relayTimeValue, saveRelayTimes, workflowLocked } = ws;
  useRelayLoad(ws, visible);
  const classes = relay?.classes.filter(row => row.legs.some(leg => leg.startMethod === "MASS_START" || leg.startMethod === "RESTART")) ?? [];
  if (classes.length === 0) return null;
  return <Section id={`relay-start-${ws.raceId}`} title={text.startTitle} number={number} help={text.startHelp}>
    {visible && <RelayMessages ws={ws} />}
    {classes.map(raceClass => <form key={raceClass.id} className={relayStyles.times} aria-label={raceClass.name}
      onSubmit={event => { event.preventDefault(); void saveRelayTimes(raceClass.id); }}>
      <h3>{raceClass.name}</h3>
      <div className={relayStyles.timeRow}>
        {raceClass.legs.filter(leg => leg.startMethod === "MASS_START" || leg.startMethod === "RESTART").map(leg => <label key={leg.leg}>
          {text.legTime(leg.leg, leg.startMethod)}<input value={relayTimeValue(raceClass.id, leg.leg)} inputMode="numeric" autoComplete="off"
            placeholder={text.timeExample} disabled={workflowLocked} onChange={event => changeRelayTime(raceClass.id, leg.leg, event.target.value)} />
        </label>)}
        <Button type="submit" variant="secondary" disabled={workflowLocked}>{text.saveTimes(raceClass.name)}</Button>
      </div>
    </form>)}
  </Section>;
}

/** Lagen som är ute, grupperade per sträcka. */
export function teamsOutByLeg(relay: RelayOverview) {
  return relay.classes.map(raceClass => ({ raceClass, legs: raceClass.legs.map(leg => ({ leg: leg.leg,
    teams: relay.teams.filter(team => team.classId === raceClass.id && team.currentLeg === leg.leg) })) }))
    .filter(row => row.legs.some(leg => leg.teams.length > 0));
}

/**
 * Steg 47: omstarterna per växling – tiden (vid flygande omstart: ledarens växling plus gränsen) och lagen som ännu
 * inte växlat till sträckan och alltså går i omstarten.
 */
export function relayRestartsByLeg(relay: RelayOverview) {
  return relay.classes.flatMap(raceClass => raceClass.restarts.map(restart => ({ raceClass, restart,
    waiting: relay.teams.filter(team => team.classId === raceClass.id &&
      team.legs.find(leg => leg.leg === restart.leg - 1)?.finishTime === null &&
      team.legs.find(leg => leg.leg === restart.leg - 1)?.status !== "DNS") })));
}

function RelayRestarts({ relay }: { relay: RelayOverview }) {
  const rows = relayRestartsByLeg(relay);
  if (rows.length === 0) return null;
  const clock = (time: string) => formatClockTime(time, relay.timeZone).slice(0, 5);
  return <div data-testid="relay-restarts">
    <h4>{text.controlRestarts}</h4>
    <p className={styles.workflowHelp}>{text.controlRestartsHelp}</p>
    <ul className={relayStyles.controlLegs}>{rows.map(({ raceClass, restart, waiting }) => <li key={`${raceClass.id}:${restart.leg}`}>
      <h4>{raceClass.name} · {restart.restartAfterMinutes === null
        ? text.controlRestartFixed(restart.leg, restart.time ? clock(restart.time) : "–")
        : restart.time && restart.leaderChangeover
          ? text.controlRestartFlying(restart.leg, clock(restart.time), clock(restart.leaderChangeover), restart.restartAfterMinutes)
          : text.controlRestartWaiting(restart.leg, restart.restartAfterMinutes)}</h4>
      {waiting.length === 0 ? <p>{text.controlAllChanged}</p> : <><p>{text.controlNotChanged(waiting.length)}</p>
        <ul>{waiting.map(team => <li key={team.id}>{text.teamHeading(team.number, team.name)}</li>)}</ul></>}
    </li>)}</ul>
  </div>;
}

/** Avläsning: lag ute per sträcka med sträckans löpare och starttid, och omstarterna. */
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
    <RelayRestarts relay={relay} />
  </section>;
}
