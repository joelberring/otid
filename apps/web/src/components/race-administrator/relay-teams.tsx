"use client";

import type { RelayOverview } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import relayStyles from "./relay.module.css";
import { relaySv as text } from "../../i18n/relay-sv";
import { sv } from "../../i18n/sv";
import { formatClockTime } from "../../lib/clock-time";
import { resultDuration } from "./types";
import { RelayMessages, useRelayLoad } from "./relay-panels";
import { Notice } from "../ui";
import { RelayErrorSummary, RelayField } from "./relay-fields";
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
      const numberOf = (teamId: string) => teams.find(team => team.id === teamId)?.number ?? 0;
      return <section key={raceClass.id} aria-label={raceClass.name}>
        <h3>{raceClass.name} · {text.publicLegCount(raceClass.legs.length)}</h3>
        {raceClass.unfairTeams.length > 0 && (raceClass.forking === "EVEN"
          ? <Notice tone="attention" role="status"><p><strong>{text.unfairTitle(raceClass.name)}</strong></p>
            <ul>{raceClass.unfairTeams.map(team => <li key={team.teamId}>{text.unfairTeam(numberOf(team.teamId), team.missing, team.extra)}</li>)}</ul>
            <p>{text.unfairHelp}</p></Notice>
          : <Notice role="status">{text.unevenInfo(raceClass.name)}</Notice>)}
        {teams.length === 0 ? <p>{text.noTeams}</p> : <div className={styles.tableScroll}><table className={relayStyles.teamTable}>
          <thead><tr><th scope="col">{text.columnNumber}</th><th scope="col">{text.columnTeam}</th>
            <th scope="col">{text.columnLegs}</th><th scope="col">{text.columnStatus}</th></tr></thead>
          <tbody>{teams.map(team => <tr key={team.id} data-selected={team.id === selectedTeamId ? "true" : undefined}
            onClick={event => { if (!disabled && !(event.target as HTMLElement).closest("button")) openTeam(team.id); }}>
            <td className={relayStyles.teamNumber}>{team.number}</td>
            <td><button type="button" className={styles.participant} disabled={disabled} aria-label={text.openTeam(team.number, team.name)}
              aria-pressed={team.id === selectedTeamId} onClick={() => openTeam(team.id)}>{team.name}</button>
              <span className={relayStyles.muted}>{team.organisationName ?? ""}</span></td>
            <td><ol className={relayStyles.legList}>{team.legs.map(leg => <li key={`${leg.leg}:${leg.legOrder}`}>
              <span className={relayStyles.legNumber}>{leg.legOrder > 1 ? `${leg.leg}:${leg.legOrder}` : `${leg.leg}.`}</span>
              <span>{leg.givenName} {leg.familyName}</span>
              <span className={relayStyles.muted}>{leg.cardNumber ?? text.noCard}{leg.variantCode ? ` · ${leg.variantCode}` : ""}</span>
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

/** Lagkortet: sträckorna med löpare, bricka, bana, variant, start och resultat; byt löpare, byt variant och ändra laget. */
function TeamCard({ ws, team }: { ws: Workspace; team: Team }) {
  const { busy, cancelRunnerChange, cancelVariantChange, chooseVariant, relay, removeTeam, runnerChange, saveRunnerChange,
    saveVariantChange, setRunnerChange, setSelectedTeamId, startRunnerChange, startTeamEdit, teamDidNotStart, teamEdit, variantChange,
    variantPreview, workflowLocked } = ws;
  const timeZone = relay?.timeZone ?? "UTC";
  const raceClass = relay?.classes.find(row => row.id === team.classId);
  const locked = busy || workflowLocked || !!runnerChange || !!teamEdit;
  // Steg 56: sträckans bana visas när klassens sträckor springer olika banor.
  const severalCourses = new Set(raceClass?.legCourses.map(row => row.courseId)).size > 1;
  return <section className={`${styles.panel} ${relayStyles.card}`} aria-label={text.teamCard}>
    <h3>{text.teamHeading(team.number, team.name)}</h3>
    <p>{team.organisationName ?? ""} · <span className={relayStyles.status} data-status={team.status}>{teamStatusText(team)}</span>
      {team.restarted ? ` · ${text.restartedTeam}` : ""}</p>
    <div className={styles.tableScroll}><table className={relayStyles.cardLegs}>
      <thead><tr><th scope="col">{text.columnLegs}</th><th scope="col">{text.publicRunner}</th><th scope="col">{text.runnerCard}</th>
        <th scope="col">{text.legStart}</th><th scope="col">{text.legResult}</th><th scope="col"><span className={styles.visuallyHidden}>{text.actions}</span></th></tr></thead>
      <tbody>{team.legs.map(leg => {
        const course = raceClass?.legCourses.find(row => row.leg === leg.leg);
        const parallel = (raceClass?.legs.find(row => row.leg === leg.leg)?.runners ?? 1) > 1;
        const choosing = variantChange?.teamId === team.id && variantChange.leg === leg.leg && variantChange.legOrder === leg.legOrder;
        return <tr key={`${leg.leg}:${leg.legOrder}`}>
          <th scope="row">{parallel ? text.legRunner(leg.leg, leg.legOrder) : text.leg(leg.leg)}
            <span className={relayStyles.muted}>{course && severalCourses ? ` · ${course.courseName}` : ""}{leg.variantCode ? ` · ${leg.variantCode}` : ""}
            {leg.sameAsLeg !== null ? ` · ${text.sameRunnerAs(leg.sameAsLeg)}` : ""}{parallel && leg.changedOver ? ` · ${text.changedOver}` : ""}</span></th>
          <td>{leg.givenName} {leg.familyName}<span className={relayStyles.muted}> {leg.organisationName ?? ""}</span></td>
          <td>{leg.cardNumber ?? text.noCard}</td>
          <td>{leg.startTime ? formatClockTime(leg.startTime, timeZone) : text.waitingStart}{leg.restarted ? ` · ${text.restarted}` : ""}</td>
          <td>{leg.status ? <span className={relayStyles.status} data-status={leg.status}>{sv.publicResultsStatusLabels[leg.status]}
            {leg.elapsedMs !== null ? ` · ${resultDuration(leg.elapsedMs)}` : ""}</span> : "–"}
            {leg.changeoverMissing && <strong className={relayStyles.status} data-status="MP"> · {text.changeoverMissing}</strong>}
            {/* Steg 50: utläsningen som sträckan bygger på (teamsprint: en per sträcka) och en utläsning som saknas. */}
            {leg.readout && <span className={relayStyles.muted} data-testid="leg-readout"> · {text.legReadout(formatClockTime(leg.readout.readAt, timeZone),
              leg.readout.finishTime ? formatClockTime(leg.readout.finishTime, timeZone) : null)}</span>}
            {leg.readoutMissing && <strong className={relayStyles.status} data-status="MP"> · {text.readoutMissing(leg.leg)}</strong>}</td>
          <td className={relayStyles.legActions}>
            <button type="button" className="secondary" disabled={locked} onClick={() => startRunnerChange(team.id, leg.leg, leg.legOrder)}>
              {parallel ? text.changeRunnerOrder(leg.leg, leg.legOrder) : text.changeRunner(leg.leg)}</button>
            {course && course.variants.length > 1 && <label>{parallel ? text.legRunnerVariant(leg.leg, leg.legOrder) : text.legVariant(leg.leg)}<select disabled={locked || (!!variantChange && !choosing)}
              value={choosing ? variantChange.code : leg.variantCode ?? ""} onChange={event => chooseVariant(team.id, leg.leg, leg.legOrder, event.target.value)}>
              {leg.variantCode === null && <option value="">–</option>}
              {course.variants.map(code => <option key={code} value={code}>{code}</option>)}
            </select></label>}
            {choosing && variantChange.code !== (leg.variantCode ?? "") && !variantPreview && <span>
              <button type="button" disabled={busy} onClick={() => void saveVariantChange(false)}>{text.saveVariant}</button>
              <button type="button" className="secondary" disabled={busy} onClick={cancelVariantChange}>{text.cancel}</button></span>}
          </td>
        </tr>;
      })}</tbody>
    </table></div>
    {variantPreview && variantChange?.teamId === team.id && <Notice tone="attention" role="alert">
      <p><strong>{text.editConfirmTitle}</strong></p>
      <ul>{variantPreview.changes.map(change => <li key={`${change.teamNumber}:${change.leg}`}>
        {text.editConfirmChange(change.teamNumber, change.leg, change.displayName, text.statusWord[change.before], text.statusWord[change.after])}
      </li>)}</ul>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => void saveVariantChange(true)}>{text.variantConfirm}</button>
        <button type="button" className="secondary" disabled={busy} onClick={cancelVariantChange}>{text.cancel}</button>
      </div>
    </Notice>}
    {runnerChange && runnerChange.teamId === team.id && <form noValidate className={relayStyles.runnerForm} aria-label={text.changeRunner(runnerChange.leg)}
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
    {teamEdit && teamEdit.teamId === team.id && <TeamEditForm ws={ws} />}
    <p className={styles.workflowHelp}>{text.removeTeamHelp}</p>
    <div className={styles.actions}>
      <button type="button" className="secondary" disabled={locked} onClick={() => startTeamEdit(team.id)}>{text.editTeam}</button>
      {team.status === "RUNNING" && team.legs.some(leg => !leg.hasResult) && <button type="button" className="secondary" disabled={locked}
        onClick={() => void teamDidNotStart(team.id)}>{text.teamDidNotStart}</button>}
      <button type="button" className="secondary" disabled={locked} onClick={() => void removeTeam(team.id, team.hasResult ? "STRIKE" : "DELETE")}>
        {team.hasResult ? text.strikeTeam : text.removeTeam}</button>
      <button type="button" className="secondary" disabled={busy || !!runnerChange} onClick={() => setSelectedTeamId("")}>{text.close}</button>
    </div>
  </section>;
}

/** "Ändra lag": lagnummer, namn och klubb. */
function TeamEditForm({ ws }: { ws: Workspace }) {
  const { busy, saveTeamEdit, setTeamEdit, teamEdit } = ws;
  if (!teamEdit) return null;
  return <form noValidate className={relayStyles.runnerForm} aria-label={text.editTeam} onSubmit={event => { event.preventDefault(); void saveTeamEdit(); }}>
    <h4>{text.editTeam}</h4>
    <div className={relayStyles.fields}>
      <label>{text.teamNumberEdit}<input value={teamEdit.number} inputMode="numeric" autoComplete="off" disabled={busy}
        onChange={event => setTeamEdit({ ...teamEdit, number: event.target.value })} /></label>
      <label>{text.teamName}<input value={teamEdit.name} maxLength={160} required autoComplete="off" disabled={busy}
        onChange={event => setTeamEdit({ ...teamEdit, name: event.target.value })} /></label>
      <label>{text.teamClub}<input value={teamEdit.club} maxLength={200} autoComplete="off" disabled={busy}
        onChange={event => setTeamEdit({ ...teamEdit, club: event.target.value })} /></label>
    </div>
    <div className={styles.actions}>
      <button type="submit" disabled={busy}>{text.saveTeamEdit}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => setTeamEdit(undefined)}>{text.cancel}</button>
    </div>
  </form>;
}

/** "Nytt lag": klass, nummer (tomt = nästa lediga), namn, klubb och en löpare med bricka per sträcka. */
function NewTeam({ ws, relay }: { ws: Workspace; relay: RelayOverview }) {
  const { changeTeamRunner, chooseTeamClass, clearTeamError, raceId, registerTeam, setTeamClub, setTeamName, setTeamNumber, teamAttempt,
    teamClassId, teamClub, teamError, teamErrors: errors, teamForm, teamName, teamNumber, teamRunners, workflowLocked } = ws;
  const locked = workflowLocked || !!teamAttempt;
  const id = `relay-team-${raceId}`;
  const order = ["class", "number", "name", "club", ...teamRunners.flatMap((_, index) => [`given-${index}`, `family-${index}`, `card-${index}`])];
  return <details className={styles.disclosure} open={teamAttempt || teamClassId ? true : undefined}>
    <summary>{text.newTeam}</summary>
    <form ref={teamForm} noValidate className={styles.disclosureBody} aria-label={text.newTeam}
      onSubmit={event => { event.preventDefault(); void registerTeam(); }}>
      <RelayErrorSummary errors={errors} order={order} />
      <div className={relayStyles.fields}>
        <RelayField id={`${id}-class`} label={text.teamClass} error={errors.class}>
          <select value={teamClassId} disabled={locked} onChange={event => { chooseTeamClass(event.target.value); clearTeamError("class"); }}>
            <option value="">{text.chooseClass}</option>
            {relay.classes.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></RelayField>
        <RelayField id={`${id}-number`} label={text.teamNumber} error={errors.number}>
          <input value={teamNumber} inputMode="numeric" autoComplete="off" disabled={locked}
            onChange={event => { setTeamNumber(event.target.value); clearTeamError("number"); }} /></RelayField>
        <RelayField id={`${id}-name`} label={text.teamName} error={errors.name}>
          <input value={teamName} maxLength={160} autoComplete="off" disabled={locked}
            onChange={event => { setTeamName(event.target.value); clearTeamError("name"); }} /></RelayField>
        <RelayField id={`${id}-club`} label={text.teamClub} error={errors.club}>
          <input value={teamClub} maxLength={200} autoComplete="off" disabled={locked}
            onChange={event => { setTeamClub(event.target.value); clearTeamError("club"); }} /></RelayField>
      </div>
      {teamRunners.length > 0 && <div className={relayStyles.runners}>{teamRunners.map((runner, index) => {
        // Steg 48: sträcka (och löpare inom sträckan) eller teamsprintens person med sina sträckor.
        const parallel = !runner.person && teamRunners.some(other => other.leg === runner.leg && other.legOrder > 1);
        const slot = runner.person ? text.personSlot(runner.person) : parallel ? text.legRunnerSlot(runner.leg, runner.legOrder) : text.legSlot(runner.leg);
        return <div key={index} className={relayStyles.runner}>
          <span className={relayStyles.legName}>{runner.person ? text.personHeading(runner.person, runner.personLegs ?? [])
            : parallel ? text.legRunner(runner.leg, runner.legOrder) : text.leg(runner.leg)}</span>
          <RelayField id={`${id}-given-${index}`} label={text.givenNameOf(slot)} error={errors[`given-${index}`]}>
            <input value={runner.givenName} maxLength={160} autoComplete="off" disabled={locked}
              onChange={event => changeTeamRunner(index, { givenName: event.target.value })} /></RelayField>
          <RelayField id={`${id}-family-${index}`} label={text.familyNameOf(slot)} error={errors[`family-${index}`]}>
            <input value={runner.familyName} maxLength={160} autoComplete="off" disabled={locked}
              onChange={event => changeTeamRunner(index, { familyName: event.target.value })} /></RelayField>
          <RelayField id={`${id}-card-${index}`} label={text.cardOf(slot)} error={errors[`card-${index}`]}>
            <input value={runner.card} inputMode="numeric" autoComplete="off" disabled={locked}
              onChange={event => changeTeamRunner(index, { card: event.target.value })} /></RelayField>
        </div>;
      })}</div>}
      {teamError && <Notice tone="error" role="alert">{teamError}</Notice>}
      <div className={styles.actions}><button type="submit" disabled={workflowLocked}>{text.saveTeam}</button></div>
    </form>
  </details>;
}
