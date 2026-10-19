"use client";

import { useState } from "react";
import type { AdministratorEffectiveResultResponse } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv as adminText } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv as navigationText } from "../../i18n/race-workspace-navigation-sv";
import { participantCardSv as text } from "../../i18n/participant-card-sv";
import { courseVariantsSv as variantText } from "../../i18n/course-variants-sv";
import { sv } from "../../i18n/sv";
import { formatClockTime } from "../../lib/clock-time";
import { availableStatusChoices, isStatusChoice } from "../../lib/participant-status-choices";
import { RaceParticipantFacts } from "../race-participant-facts";
import { RaceResultControls } from "../race-result-controls";
import { AdministratorEntryChanges } from "../administrator-entry-changes";
import { resultDuration } from "./types";
import { startPunchText } from "../../lib/start-punch-text";
import { EntryActionForms, RegistrationForm } from "./entry-action-forms";
import { CardPunches } from "./card-punches";
import { RemovalReview } from "./removal-review";
import { removalSv as removalText } from "../../i18n/removal-sv";
import { Button } from "../ui";
import type { StatusAttempt } from "./result-decisions";
import type { Workspace } from "./workspace-state";

/**
 * Deltagarkortet (ADR-0169 beslut 4): allt om en löpare på ett ställe – namn, klubb,
 * klass, bricka, starttid, resultat med sträcktider, historik och "Ändra status".
 */
export function ParticipantCard({ ws }: { ws: Workspace }) {
  const { action, cardAttempt, classesById, data, disabled, effectiveResult, effectiveResultError, filtered,
    identityAttempt, navigateParticipantSequence, raceId, rentalAttempt,
    rentalReturnAttempt, rentalReuseAttempt, selected, selectedClass, selectedIndex,
    timeAttempt, transferAttempt, workPanel, workflowLocked, chooseAction, navigateMobile } = ws;
  const entryEditing = !!(transferAttempt || cardAttempt || rentalAttempt || rentalReturnAttempt || rentalReuseAttempt ||
    timeAttempt || identityAttempt);
  const result = effectiveResult?.entryId === selected?.id ? effectiveResult : undefined;
  return <section className={styles.panel} aria-label={text.title} data-panel="WORK" ref={workPanel} tabIndex={-1} id={`participant-work-${raceId}`}>
    {/* Mobil: kortet ersätter listan; vägen tillbaka står först (PLAN.md steg 24). */}
    <button type="button" className={`secondary ${styles.backToList}`} onClick={() => navigateMobile("LIST")}>{adminText.backToList}</button>
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
      {selectedClass && selectedClass.courseVariants.length > 0 && <ParticipantVariant ws={ws} />}
      <CardResult ws={ws} result={result} error={effectiveResultError} />
      {/* PLAN.md steg 27: brickans alla stämplingar, även från en annan dag eller bana. */}
      {result?.cardPunches && data && <CardPunches punches={result.cardPunches} timeZone={data.timeZone} />}
      <StatusChange ws={ws} result={result} />
      {data && <RaceResultControls result={result} resultError={effectiveResultError} timeZone={data.timeZone} />}
      {result && data && <ResultHistory result={result} timeZone={data.timeZone} />}
      <EntryChanges ws={ws} />
      <EntryRemoval ws={ws} result={result} />
    </>}
    <RegistrationForm ws={ws} />
  </section>;
}

/**
 * Gafflad klass: löparens variant och "Byt variant". Bytet sparas direkt om resultatet inte
 * ändras; annars visas beskedet och arrangören bekräftar (ADR-0169 beslut 2).
 */
function ParticipantVariant({ ws }: { ws: Workspace }) {
  const { busy, cancelEntryVariant, chooseEntryVariant, confirmEntryVariant, disabled, entryVariantError, entryVariantMessage,
    entryVariantPreview, raceId, selected, selectedClass } = ws;
  if (!selected || !selectedClass) return null;
  const id = `entry-variant-${raceId}`;
  const current = selected.courseVariantCode !== null && selectedClass.courseVariants.includes(selected.courseVariantCode)
    ? selected.courseVariantCode : null;
  return <section className={styles.workspace} aria-label={variantText.variant}>
    <h3>{current ? variantText.variantShort(current) : variantText.variant}</h3>
    {current === null && <p><strong>{variantText.noVariant}</strong></p>}
    <label htmlFor={id}>{variantText.chooseVariant}</label>
    <select id={id} value={current ?? ""} disabled={disabled}
      onChange={event => void chooseEntryVariant(event.target.value)}>
      {current === null && <option value="">–</option>}
      {selectedClass.courseVariants.map(code => <option key={code} value={code}>{code}</option>)}
    </select>
    {entryVariantMessage && <p role="status" className={styles.saved}>{entryVariantMessage}</p>}
    {entryVariantError && <p role="alert" className={styles.warning}>{entryVariantError}</p>}
    {entryVariantPreview && <div className={styles.review} role="alert">
      <p><strong>{variantText.variantConfirmTitle}</strong></p>
      <ul className={styles.changeList}>{entryVariantPreview.changes.map(change => <li key={change.entryId}>
        {variantText.variantResultChange(change.displayName, adminText.courseEditStatus[change.before], adminText.courseEditStatus[change.after])}
      </li>)}</ul>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => void confirmEntryVariant()}>
          {variantText.variantConfirm} {entryVariantPreview.variantCode}</button>
        <button type="button" className="secondary" disabled={busy} onClick={cancelEntryVariant}>{variantText.variantCancel}</button>
      </div>
    </div>}
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
          <p><strong className={result.result.status === "MP" || result.result.status === "DSQ" || result.result.status === "OVERTIME"
            ? styles.rosterCritical : undefined}>
            {sv.publicResultsStatusLabels[result.result.status]}</strong>
            {"elapsedMs" in result.result && result.result.elapsedMs !== undefined && <> · {text.runningTime} {resultDuration(result.result.elapsedMs)}</>}</p>
          <p>{sv.publicResultsReasonLabels[result.result.reason]}
            {result.governingDecision !== "NONE" && <> · {text.decision}: <strong>{adminText.governingDecisions[result.governingDecision]}</strong></>}</p>
          {/* PLAN.md steg 25: diskens orsak och startstämplingen vid minutstart, bara i arbetsytan. */}
          {result.notes?.disqualificationReason && <p data-testid="dsq-reason">{text.dsqReasonShown(result.notes.disqualificationReason)}</p>}
          {result.notes?.startPunch && <p className={result.notes.startPunch.kind === "FROM_PUNCH" ? styles.muted : styles.warning} role="note"
            data-testid="start-punch-note">
            {result.notes.startPunch.kind === "FROM_PUNCH" ? "" : "! "}{startPunchText(result.notes.startPunch, result.timeZone)}</p>}
          {!result.resultCurrent && <>
            <p className={styles.resultStale}>{adminText.resultStale}</p>
            <button type="button" className="secondary" disabled={disabled} onClick={() => void chooseStatusChange("RECALCULATION")}>
              {text.choices.RECALCULATION}</button>
          </>}
        </>}
  </section>;
}

function consequence(attempt: StatusAttempt): string {
  if (attempt.kind === "RECALCULATION") return text.consequences.RECALCULATION;
  switch (attempt.choice) {
    case "APPROVAL_WITHDRAWAL": case "DSQ_WITHDRAWAL": case "NT_WITHDRAWAL": case "OOC_WITHDRAWAL": case "DNF_WITHDRAWAL":
      return attempt.restores ? text.withdrawalConsequence(sv.publicResultsStatusLabels[attempt.restores.status]) : text.notAvailable;
    case "DNS_WITHDRAWAL": return text.dnsWithdrawalConsequence;
    default: return text.consequences[attempt.choice];
  }
}

/** "Ändra status": ett val, ett besked i en mening och en bekräftelse. */
function StatusChange({ ws, result }: { ws: Workspace; result: AdministratorEffectiveResultResponse | undefined }) {
  const { busy, cancelStatusChange, chooseStatusChange, confirmStatusChange, decisionAttempt, disabled, raceId,
    recalculationAttempt, statusBlocked, statusChoice, unknown } = ws;
  const attempt: StatusAttempt | undefined = decisionAttempt ?? recalculationAttempt;
  const choices = availableStatusChoices(result);
  const id = `status-change-${raceId}`;
  const [reason, setReason] = useState("");
  const asksReason = attempt?.kind === "DECISION" && attempt.choice === "DSQ";
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
      {/* Disk med orsak (PLAN.md steg 25): orsaken visas bara i arbetsytan, aldrig publikt. */}
      {asksReason && <label className={styles.narrowField} htmlFor={`${id}-reason`}>{text.dsqReason}
        <input id={`${id}-reason`} value={reason} maxLength={240} disabled={busy || unknown} autoComplete="off"
          onChange={event => setReason(event.target.value)} /></label>}
      {unknown && <p>{text.unknown}</p>}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => { void confirmStatusChange(attempt, reason); setReason(""); }}>
          {unknown ? text.retry : text.confirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => cancelStatusChange(attempt)}>{text.cancel}</button>}
      </div>
    </div>}
  </section>;
}

/** Kort historik över resultatändringar, nyaste först, med klockslag i tävlingens tidszon. */
function ResultHistory({ result, timeZone }: { result: AdministratorEffectiveResultResponse; timeZone: string }) {
  return <section className={styles.workspace} aria-label={text.history}>
    <h3>{text.history}</h3>
    {result.history.length === 0 ? <p>{text.historyEmpty}</p> : <ul className={styles.changeList}>
      {result.history.map(row => <li key={row.revision}>{text.historyLine(formatClockTime(row.at, timeZone),
        text.historyCauses[row.cause], sv.publicResultsStatusLabels[row.status])}</li>)}
    </ul>}
  </section>;
}

/** Ändringar i anmälan (namn, klubb, klass, bricka, starttid), läses in på begäran. */
function EntryChanges({ ws }: { ws: Workspace }) {
  const { action, chooseAction, disabled, entryChanges, loadHistory, selected } = ws;
  if (!selected) return null;
  return <details className={styles.disclosure} open={action === "HISTORY" || undefined}
    onToggle={event => { if (event.currentTarget.open && action !== "HISTORY") chooseAction("HISTORY"); }}>
    <summary>{text.entryChanges}</summary>
    {entryChanges?.entryId === selected.id ? <>
      <AdministratorEntryChanges data={entryChanges} />
      {entryChanges.nextBeforeVersion !== null && <button type="button" className="secondary" disabled={disabled}
        onClick={() => void loadHistory(selected.id, entryChanges.nextBeforeVersion ?? undefined)}>{adminText.historyOlder}</button>}
    </> : <p>{adminText.historyNotLoaded}</p>}
  </details>;
}

/**
 * "Ta bort deltagare" för den som inte läst ut och saknar resultat, annars "Stryk" (PLAN.md steg 27): döljs i alla listor
 * men avläsningen och historiken sparas. Bekräftas i kortet.
 */
function EntryRemoval({ ws, result }: { ws: Workspace; result: AdministratorEffectiveResultResponse | undefined }) {
  const { disabled, prepareEntryRemoval, removalAttempt, selected } = ws;
  if (!selected || !result) return null;
  const strike = result.state !== "NO_PUBLISHED_RESULT" || result.history.length > 0 || !!result.cardPunches;
  const open = removalAttempt?.kind === "ENTRY" && removalAttempt.id === selected.id;
  return <section className={styles.workspace} aria-label={removalText.entryHeading}>
    {!open && <>
      <p className={styles.workflowHelp}>{strike ? removalText.entryStrikeHelp : removalText.entryDeleteHelp}</p>
      <div><Button variant="secondary" disabled={disabled} onClick={prepareEntryRemoval}>
        {strike ? removalText.entryStrike : removalText.entryDelete}</Button></div>
    </>}
    <RemovalReview ws={ws} kind="ENTRY" id={selected.id} />
  </section>;
}
