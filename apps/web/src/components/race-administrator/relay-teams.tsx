"use client";

import type { RelayOverview } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import relayStyles from "./relay.module.css";
import { relaySv as text } from "../../i18n/relay-sv";
import { sv } from "../../i18n/sv";
import { formatClockTime } from "../../lib/clock-time";
import { resultDuration } from "./types";
import { RelayMessages, useRelayLoad } from "./relay-panels";
import type { Workspace } from "./workspace-state";

type Team = RelayOverview["teams"][number];

/** Lagets status i ord: placering och tid, ute på sträcka N eller underkänt. */
export function teamStatusText(team: Pick<Team, "status" | "position" | "elapsedMs" | "currentLeg">): string {
  if (team.status === "OK") return [team.position ? text.placed(team.position) : text.status.OK,
    team.elapsedMs !== null ? resultDuration(team.elapsedMs) : ""].filter(Boolean).join(" · ");
  if (team.status === "RUNNING") return team.currentLeg ? text.outOnLeg(team.currentLeg) : text.status.RUNNING;
  return `${text.status[team.status]}${team.currentLeg ? ` · ${text.outOnLeg(team.currentLeg)}` : ""}`;
}

/** Anmälda: lagvyn för stafettklasserna med lagkort, byte av sträcklöpare och "Nytt lag". */
export function RelayTeams({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const { disabled, openTeam, raceId, relay, selectedTeamId } = ws;
  useRelayLoad(ws, visible);
  if (!relay || relay.classes.length === 0) return null;
  const selected = relay.teams.find(team => team.id === selectedTeamId);
  return <section className={styles.panel} aria-labelledby={`relay-teams-${raceId}`}>
    <h2 id={`relay-teams-${raceId}`}>{text.teams}</h2>
    <p className={styles.workflowHelp}>{text.teamsHelp}</p>
    {visible && <RelayMessages ws={ws} />}
    {relay.classes.map(raceClass => {
      const teams = relay.teams.filter(team => team.classId === raceClass.id);
      return <section key={raceClass.id} aria-label={raceClass.name}>
        <h3>{raceClass.name} · {text.publicLegCount(raceClass.legs.length)}</h3>
        {teams.length === 0 ? <p>{text.noTeams}</p> : <div className={styles.tableScroll}><table className={relayStyles.teamTable}>
          <thead><tr><th scope="col">{text.columnNumber}</th><th scope="col">{text.columnTeam}</th>
            <th scope="col">{text.columnLegs}</th><th scope="col">{text.columnStatus}</th></tr></thead>
          <tbody>{teams.map(team => <tr key={team.id} data-selected={team.id === selectedTeamId ? "true" : undefined}
            onClick={event => { if (!disabled && !(event.target as HTMLElement).closest("button")) openTeam(team.id); }}>
            <td className={relayStyles.teamNumber}>{team.number}</td>
            <td><button type="button" className={styles.participant} disabled={disabled} aria-label={text.openTeam(team.number, team.name)}
              aria-pressed={team.id === selectedTeamId} onClick={() => openTeam(team.id)}>{team.name}</button>
              <span className={relayStyles.muted}>{team.organisationName ?? ""}</span></td>
            <td><ol className={relayStyles.legList}>{team.legs.map(leg => <li key={leg.leg}>
              <span className={relayStyles.legNumber}>{leg.leg}.</span><span>{leg.givenName} {leg.familyName}</span>
              <span className={relayStyles.muted}>{leg.cardNumber ?? text.noCard}</span>
            </li>)}</ol></td>
            <td><span className={relayStyles.status} data-status={team.status}>{teamStatusText(team)}</span></td>
          </tr>)}</tbody>
        </table></div>}
      </section>;
    })}
    {selected && <TeamCard ws={ws} team={selected} />}
    <NewTeam ws={ws} relay={relay} />
  </section>;
}

/** Lagkortet: sträckorna med löpare, bricka, start och resultat, och "Byt löpare på sträcka N". */
function TeamCard({ ws, team }: { ws: Workspace; team: Team }) {
  const { busy, cancelRunnerChange, relay, runnerChange, saveRunnerChange, setRunnerChange, setSelectedTeamId, startRunnerChange,
    workflowLocked } = ws;
  const timeZone = relay?.timeZone ?? "UTC";
  return <section className={`${styles.panel} ${relayStyles.card}`} aria-label={text.teamCard}>
    <h3>{text.teamHeading(team.number, team.name)}</h3>
    <p>{team.organisationName ?? ""} · <span className={relayStyles.status} data-status={team.status}>{teamStatusText(team)}</span></p>
    <div className={styles.tableScroll}><table className={relayStyles.cardLegs}>
      <thead><tr><th scope="col">{text.columnLegs}</th><th scope="col">{text.publicRunner}</th><th scope="col">{text.runnerCard}</th>
        <th scope="col">{text.legStart}</th><th scope="col">{text.legResult}</th><th scope="col"><span className={styles.visuallyHidden}>{text.actions}</span></th></tr></thead>
      <tbody>{team.legs.map(leg => <tr key={leg.leg}>
        <th scope="row">{text.leg(leg.leg)}{leg.variantCode ? <span className={relayStyles.muted}> · {leg.variantCode}</span> : null}</th>
        <td>{leg.givenName} {leg.familyName}<span className={relayStyles.muted}> {leg.organisationName ?? ""}</span></td>
        <td>{leg.cardNumber ?? text.noCard}</td>
        <td>{leg.startTime ? formatClockTime(leg.startTime, timeZone) : text.waitingStart}{leg.restarted ? ` · ${text.restarted}` : ""}</td>
        <td>{leg.status ? <span className={relayStyles.status} data-status={leg.status}>{sv.publicResultsStatusLabels[leg.status]}
          {leg.elapsedMs !== null ? ` · ${resultDuration(leg.elapsedMs)}` : ""}</span> : "–"}</td>
        <td><button type="button" className="secondary" disabled={busy || workflowLocked || !!runnerChange}
          onClick={() => startRunnerChange(team.id, leg.leg)}>{text.changeRunner(leg.leg)}</button></td>
      </tr>)}</tbody>
    </table></div>
    {runnerChange && runnerChange.teamId === team.id && <form className={relayStyles.runnerForm} aria-label={text.changeRunner(runnerChange.leg)}
      onSubmit={event => { event.preventDefault(); void saveRunnerChange(); }}>
      <h4>{text.changeRunner(runnerChange.leg)}</h4>
      <div className={relayStyles.fields}>
        <label>{text.runnerGivenName}<input value={runnerChange.givenName} maxLength={160} required disabled={busy}
          onChange={event => setRunnerChange({ ...runnerChange, givenName: event.target.value })} /></label>
        <label>{text.runnerFamilyName}<input value={runnerChange.familyName} maxLength={160} required disabled={busy}
          onChange={event => setRunnerChange({ ...runnerChange, familyName: event.target.value })} /></label>
        <label>{text.runnerClub}<input value={runnerChange.club} maxLength={200} disabled={busy}
          onChange={event => setRunnerChange({ ...runnerChange, club: event.target.value })} /></label>
        <label>{text.runnerCard}<input value={runnerChange.card} inputMode="numeric" autoComplete="off" disabled={busy}
          onChange={event => setRunnerChange({ ...runnerChange, card: event.target.value })} /></label>
      </div>
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>{text.saveRunner}</button>
        <button type="button" className="secondary" disabled={busy} onClick={cancelRunnerChange}>{text.cancel}</button>
      </div>
    </form>}
    <div className={styles.actions}><button type="button" className="secondary" disabled={busy || !!runnerChange}
      onClick={() => setSelectedTeamId("")}>{text.close}</button></div>
  </section>;
}

/** "Nytt lag": klass, nummer (tomt = nästa lediga), namn, klubb och en löpare med bricka per sträcka. */
function NewTeam({ ws, relay }: { ws: Workspace; relay: RelayOverview }) {
  const { changeTeamRunner, chooseTeamClass, raceId, registerTeam, setTeamClub, setTeamName, setTeamNumber, teamAttempt, teamClassId,
    teamClub, teamName, teamNumber, teamRunners, workflowLocked } = ws;
  const locked = workflowLocked || !!teamAttempt;
  const id = `relay-team-${raceId}`;
  return <details className={styles.disclosure} open={teamAttempt || teamClassId ? true : undefined}>
    <summary>{text.newTeam}</summary>
    <form className={styles.disclosureBody} aria-label={text.newTeam} onSubmit={event => { event.preventDefault(); void registerTeam(); }}>
      <div className={relayStyles.fields}>
        <label htmlFor={`${id}-class`}>{text.teamClass}<select id={`${id}-class`} value={teamClassId} required disabled={locked}
          onChange={event => chooseTeamClass(event.target.value)}>
          <option value="">{text.chooseClass}</option>
          {relay.classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></label>
        <label htmlFor={`${id}-number`}>{text.teamNumber}<input id={`${id}-number`} value={teamNumber} inputMode="numeric" autoComplete="off"
          disabled={locked} onChange={event => setTeamNumber(event.target.value)} /></label>
        <label htmlFor={`${id}-name`}>{text.teamName}<input id={`${id}-name`} value={teamName} maxLength={160} required autoComplete="off"
          disabled={locked} onChange={event => setTeamName(event.target.value)} /></label>
        <label htmlFor={`${id}-club`}>{text.teamClub}<input id={`${id}-club`} value={teamClub} maxLength={200} autoComplete="off"
          disabled={locked} onChange={event => setTeamClub(event.target.value)} /></label>
      </div>
      {teamRunners.length > 0 && <div className={relayStyles.runners}>{teamRunners.map((runner, index) => <div key={index} className={relayStyles.runner}>
        <span className={relayStyles.legName}>{text.leg(index + 1)}</span>
        <label>{text.givenName(index + 1)}<input value={runner.givenName} maxLength={160} required autoComplete="off" disabled={locked}
          onChange={event => changeTeamRunner(index, { givenName: event.target.value })} /></label>
        <label>{text.familyName(index + 1)}<input value={runner.familyName} maxLength={160} required autoComplete="off" disabled={locked}
          onChange={event => changeTeamRunner(index, { familyName: event.target.value })} /></label>
        <label>{text.card(index + 1)}<input value={runner.card} inputMode="numeric" autoComplete="off" disabled={locked}
          onChange={event => changeTeamRunner(index, { card: event.target.value })} /></label>
      </div>)}</div>}
      <div className={styles.actions}><button type="submit" disabled={workflowLocked || !teamClassId}>{text.saveTeam}</button></div>
    </form>
  </details>;
}
