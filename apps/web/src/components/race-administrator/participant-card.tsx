"use client";

import type { AdministratorEffectiveResultResponse } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as adminText } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { participantCardSv as text } from "../../i18n/participant-card-sv";
import { sv } from "../../i18n/sv";
import { formatClockTime } from "../../lib/clock-time";
import { availableStatusChoices, isStatusChoice } from "../../lib/participant-status-choices";
import { RaceParticipantFacts } from "../race-participant-facts";
import { RaceResultControls } from "../race-result-controls";
import { ParticipantEntryClaimAdmin } from "../participant-entry-claim-admin";
import { AdministratorEntryChanges } from "../administrator-entry-changes";
import { resultDuration } from "./types";
import { EntryActionForms, RegistrationForm } from "./entry-action-forms";
import type { StatusAttempt } from "./result-decisions";
import type { Workspace } from "./workspace-state";

/**
 * Deltagarkortet (ADR-0169 beslut 4): allt om en löpare på ett ställe – namn, klubb,
 * klass, bricka, starttid, resultat med sträcktider, historik och "Ändra status".
 */
export function ParticipantCard({ ws }: { ws: Workspace }) {
  const { action, authenticated, cardAttempt, classesById, data, disabled, effectiveResult, effectiveResultError, filtered,
    identityAttempt, navigateParticipantSequence, participantActionPending, paymentStatusAttempt, raceId, rentalAttempt,
    rentalReturnAttempt, rentalReuseAttempt, selected, selectedClass, selectedIndex, setParticipantActionPending,
    timeAttempt, transferAttempt, workPanel, workflowLocked, chooseAction } = ws;
  const entryEditing = !!(transferAttempt || cardAttempt || rentalAttempt || rentalReturnAttempt || rentalReuseAttempt ||
    paymentStatusAttempt || timeAttempt || identityAttempt);
  const result = effectiveResult?.entryId === selected?.id ? effectiveResult : undefined;
  return <section className={styles.panel} aria-label={text.title} data-panel="WORK" ref={workPanel} tabIndex={-1} id={`participant-work-${raceId}`}>
    {selected && selectedClass && action !== "REGISTRATION" && <>
      <header className={styles.selectedParticipantContext}>
        <span className={styles.selectedParticipantLabel}>{text.title}</span>
        <h2>{selected.displayName}</h2>
        <span className={styles.selectedParticipantClass}>{selected.organisationName ?? adminText.none} · {selectedClass.name}</span>
      </header>
      <nav className={styles.participantSequence} aria-label={navigationText.participantSequence}>
        <button type="button" className="secondary" disabled={workflowLocked || selectedIndex <= 0}
          onClick={() => navigateParticipantSequence(-1)}>{navigationText.previousParticipant}</button>
        <span>{selectedIndex < 0 ? navigationText.participantOutsideSequence
          : navigationText.participantPosition(selectedIndex + 1, filtered.length)}</span>
        <button type="button" className="secondary"
          disabled={workflowLocked || selectedIndex < 0 || selectedIndex >= filtered.length - 1}
          onClick={() => navigateParticipantSequence(1)}>{navigationText.nextParticipant}</button>
      </nav>
      {data && <RaceParticipantFacts entry={selected} raceClass={classesById.get(selected.classId)!} timeZone={data.timeZone}
        disabled={disabled} activeAction={action} onEdit={chooseAction} />}
    </>}
    {!selected && action !== "REGISTRATION" && <p>{navigationText.selectedHelp}</p>}
    <EntryActionForms ws={ws} />
    {selected && action !== "REGISTRATION" && !entryEditing && <>
      <CardResult ws={ws} result={result} error={effectiveResultError} />
      <StatusChange ws={ws} result={result} />
      {data && <RaceResultControls result={result} resultError={effectiveResultError} timeZone={data.timeZone} />}
      {result && data && <ResultHistory result={result} timeZone={data.timeZone} />}
      <EntryChanges ws={ws} />
    </>}
    <RegistrationForm ws={ws} />
    {authenticated && selected && <details className={styles.claimPanel} open={participantActionPending || undefined}
      onToggle={event => { if (participantActionPending && !event.currentTarget.open) event.currentTarget.open = true; }}>
      <summary>{adminText.claimOptionalSummary}</summary>
      <ParticipantEntryClaimAdmin key={`${raceId}:${selected.id}`} raceId={raceId} entryId={selected.id}
        displayName={selected.displayName} onPendingChange={setParticipantActionPending} />
    </details>}
  </section>;
}

/** Resultatet i ord: status, löptid, orsak och gällande beslut. */
function CardResult({ ws, result, error }: { ws: Workspace; result: AdministratorEffectiveResultResponse | undefined; error: boolean }) {
  const { chooseStatusChange, disabled } = ws;
  return <section className={styles.resultSummary} aria-label={text.result}>
    <h3>{text.result}</h3>
    {!result ? <p>{error ? text.resultError : text.resultLoading}</p>
      : result.state !== "ACTIVE_RESULT" ? <p><strong>{result.state === "NO_ACTIVE_RESULT" ? adminText.noActiveResult : text.noResult}</strong></p>
        : <>
          <p><strong className={result.result.status === "MP" || result.result.status === "DSQ" ? styles.rosterCritical : undefined}>
            {sv.publicResultsStatusLabels[result.result.status]}</strong>
            {"elapsedMs" in result.result && result.result.elapsedMs !== undefined && <> · {text.runningTime} {resultDuration(result.result.elapsedMs)}</>}</p>
          <p>{sv.publicResultsReasonLabels[result.result.reason]}
            {result.governingDecision !== "NONE" && <> · {text.decision}: <strong>{adminText.governingDecisions[result.governingDecision]}</strong></>}</p>
          {!result.resultCurrent && <>
            <p className={styles.resultStale}>{adminText.resultStale}</p>
            <button type="button" className="secondary" disabled={disabled} onClick={() => void chooseStatusChange("RECALCULATION")}>
              {text.choices.RECALCULATION}</button>
          </>}
        </>}
  </section>;
}

function consequence(attempt: StatusAttempt): string {
  switch (attempt.kind) {
    case "APPROVAL_WITHDRAWAL": case "DSQ_WITHDRAWAL": case "NT_WITHDRAWAL": case "OOC_WITHDRAWAL": case "DNF_WITHDRAWAL":
      return text.withdrawalConsequence(sv.publicResultsStatusLabels[attempt.value.request.expectedRestorationSourceResultRevision.status]);
    case "DNS_WITHDRAWAL": return text.dnsWithdrawalConsequence;
    default: return text.consequences[attempt.kind];
  }
}

/** "Ändra status": ett val, ett besked i en mening och en bekräftelse. */
function StatusChange({ ws, result }: { ws: Workspace; result: AdministratorEffectiveResultResponse | undefined }) {
  const { approvalAttempt, busy, cancelStatusChange, chooseStatusChange, confirmStatusChange, disabled, dnfAttempt, dnsAttempt,
    dsqAttempt, ntAttempt, oocAttempt, raceId, recalculationAttempt, statusBlocked, statusChoice, unknown } = ws;
  const attempt: StatusAttempt | undefined = approvalAttempt ?? dsqAttempt ?? ntAttempt ?? oocAttempt ?? dnfAttempt ?? dnsAttempt ??
    recalculationAttempt;
  const choices = availableStatusChoices(result);
  const id = `status-change-${raceId}`;
  return <section className={styles.workspace}>
    <label htmlFor={id}>{text.changeStatus}</label>
    <select id={id} value={statusChoice} disabled={disabled || choices.length === 0}
      onChange={event => void chooseStatusChange(isStatusChoice(event.target.value) ? event.target.value : "")}>
      <option value="">{text.chooseStatus}</option>
      {choices.map(choice => <option key={choice} value={choice}>{text.choices[choice]}</option>)}
    </select>
    {statusBlocked && <p className={styles.warning} role="status">{statusBlocked}</p>}
    {attempt && <div className={styles.review} role="alert">
      <p><strong>{consequence(attempt)}</strong></p>
      {unknown && <p>{text.unknown}</p>}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => void confirmStatusChange(attempt)}>{unknown ? text.retry : text.confirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => cancelStatusChange(attempt)}>{text.cancel}</button>}
      </div>
    </div>}
  </section>;
}

/** Kort historik över resultatändringar, nyaste först, med klockslag i tävlingens tidszon. */
function ResultHistory({ result, timeZone }: { result: AdministratorEffectiveResultResponse; timeZone: string }) {
  return <section className={styles.workspace} aria-label={text.history}>
    <h3>{text.history}</h3>
    {result.history.length === 0 ? <p>{text.historyEmpty}</p> : <ul className={styles.courseEditChanges}>
      {result.history.map(row => <li key={row.revision}>{text.historyLine(formatClockTime(row.at, timeZone),
        text.historyCauses[row.cause], sv.publicResultsStatusLabels[row.status])}</li>)}
    </ul>}
  </section>;
}

/** Ändringar i anmälan (namn, klubb, klass, bricka, starttid), läses in på begäran. */
function EntryChanges({ ws }: { ws: Workspace }) {
  const { action, chooseAction, disabled, entryChanges, loadHistory, selected } = ws;
  if (!selected) return null;
  return <details className={styles.resultActions} open={action === "HISTORY" || undefined}
    onToggle={event => { if (event.currentTarget.open && action !== "HISTORY") chooseAction("HISTORY"); }}>
    <summary>{text.entryChanges}</summary>
    {entryChanges?.entryId === selected.id ? <>
      <AdministratorEntryChanges data={entryChanges} />
      {entryChanges.nextBeforeVersion !== null && <button type="button" className="secondary" disabled={disabled}
        onClick={() => void loadHistory(selected.id, entryChanges.nextBeforeVersion ?? undefined)}>{adminText.historyOlder}</button>}
    </> : <p>{adminText.historyNotLoaded}</p>}
  </details>;
}
