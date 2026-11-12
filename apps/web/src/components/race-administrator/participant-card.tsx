"use client";

import type { AdministratorEffectiveResultResponse } from "@o-tid/contracts";
import { publicResultEn, publicResultSv } from "../../i18n/public-en";
import { removalEn } from "../../i18n/workspace-tools-en";
import { courseVariantsEn } from "../../i18n/workspace-tools-en";
import { participantCardEn, startRuleEn } from "../../i18n/workspace-admin-en";
import { raceAdministratorEn } from "../../i18n/workspace-admin-en";
import { raceWorkspaceNavigationEn } from "../../i18n/workspace-en";
import { useTexts } from "../language-provider";
import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv } from "../../i18n/race-administrator-sv";
import { raceWorkspaceNavigationSv } from "../../i18n/race-workspace-navigation-sv";
import { startRuleSv } from "../../i18n/start-rule-sv";
import { participantCardSv } from "../../i18n/participant-card-sv";
import { courseVariantsSv } from "../../i18n/course-variants-sv";
import { formatClockTime } from "../../lib/clock-time";
import { RaceParticipantFacts } from "../race-participant-facts";
import { RaceResultControls } from "../race-result-controls";
import { AdministratorEntryChanges } from "../administrator-entry-changes";
import { resultDuration } from "./types";
import { startPunchText } from "../../lib/start-punch-text";
import { EntryActionForms, RegistrationForm } from "./entry-action-forms";
import { CardPunches } from "./card-punches";
import { ParticipantControlMap } from "../control-map/runner-control-map";
import { RemovalReview } from "./removal-review";
import { DecisionReviewNotice } from "./decision-review";
import { ParticipantFix } from "./participant-fix";
import { removalSv } from "../../i18n/removal-sv";
import { Button, Disclosure } from "../ui";
import type { Workspace } from "./workspace-state";

/**
 * Deltagarkortet (ADR-0169 beslut 4): allt om en löpare på ett ställe – namn, klubb,
 * klass, bricka, starttid, resultat med sträcktider, Rätta (ADR-0191) och historik.
 */
export function ParticipantCard({ ws }: { ws: Workspace }) {
  const text = useTexts(participantCardSv, participantCardEn);
  const adminText = useTexts(raceAdministratorSv, raceAdministratorEn);
  const navigationText = useTexts(raceWorkspaceNavigationSv, raceWorkspaceNavigationEn);
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
      <CardResult ws={ws} result={result} error={effectiveResultError} />
      {/* Steg 45: ett beslut gäller men en senare avläsning ger något annat. */}
      {selected.decisionReview && !ws.functionary && <DecisionReviewNotice ws={ws} review={selected.decisionReview} />}
      {/* PLAN.md steg 27: brickans alla stämplingar, även från en annan dag eller bana. */}
      {result?.cardPunches && data && <CardPunches punches={result.cardPunches} timeZone={data.timeZone} />}
      {/* Steg 52: löparens bana på kartan med stämplade, saknade och i fel ordning. */}
      {!ws.functionary && <ParticipantControlMap key={`map-${selected.id}`} raceId={raceId} entryId={selected.id}
        refreshKey={result ? `${result.history[0]?.revision ?? 0}:${result.snapshotVersion}` : ""} />}
      {/* ADR-0191 beslut 1: alla rättelser för löparen på ett ställe. */}
      <ParticipantFix ws={ws} result={result} />
      {data && <RaceResultControls result={result} resultError={effectiveResultError} timeZone={data.timeZone} />}
      {result && data && <ResultHistory result={result} timeZone={data.timeZone} />}
      <EntryChanges ws={ws} />
      <EntryRemoval ws={ws} result={result} />
    </>}
    <RegistrationForm ws={ws} />
  </section>;
}

/** Steg 61: "Felstämplad mot AC, men stämplingarna passar BD. Fick löparen fel karta?" med "Godkänn på BD". */
function WrongMap({ ws, wrongMap }: { ws: Workspace; wrongMap: { assignedCode: string; fittingCodes: readonly string[] } }) {
  const variantText = useTexts(courseVariantsSv, courseVariantsEn);
  const { chooseEntryVariant, disabled, functionary } = ws;
  return <div className={styles.warning} role="note" data-testid="wrong-map">
    <p>{variantText.wrongMap(wrongMap.assignedCode, wrongMap.fittingCodes)}</p>
    {!functionary && <><div className={styles.actions}>{wrongMap.fittingCodes.map(code => <button key={code} type="button" className="secondary"
      disabled={disabled} onClick={() => void chooseEntryVariant(code, "WRONG_MAP")}>{variantText.approveOn(code)}</button>)}</div>
      <p className={styles.muted}>{variantText.approveOnHelp}</p></>}
  </div>;
}

/** Resultatet i ord: status, löptid, orsak och gällande beslut. */
function CardResult({ ws, result, error }: { ws: Workspace; result: AdministratorEffectiveResultResponse | undefined; error: boolean }) {
  const resultText = useTexts(publicResultSv, publicResultEn);
  const variantText = useTexts(courseVariantsSv, courseVariantsEn);
  const startRule = useTexts(startRuleSv, startRuleEn);
  const text = useTexts(participantCardSv, participantCardEn);
  const adminText = useTexts(raceAdministratorSv, raceAdministratorEn);
  const { chooseStatusChange, disabled } = ws;
  return <section className={styles.resultSummary} aria-label={text.result}>
    <h3>{text.result}</h3>
    {!result ? <p>{error ? text.resultError : text.resultLoading}</p>
      : result.state !== "ACTIVE_RESULT" ? <p><strong>{result.state === "NO_ACTIVE_RESULT" ? adminText.noActiveResult : text.noResult}</strong></p>
        : <>
          <p><strong className={result.result.status === "MP" || result.result.status === "DSQ" || result.result.status === "OVERTIME"
            ? styles.rosterCritical : undefined}>
            {resultText.statusLabels[result.result.status]}</strong>
            {"elapsedMs" in result.result && result.result.elapsedMs !== undefined && <> · {text.runningTime} {resultDuration(result.result.elapsedMs)}</>}</p>
          <p>{resultText.reasonLabels[result.result.reason]}
            {result.governingDecision !== "NONE" && <> · {text.decision}: <strong>{adminText.governingDecisions[result.governingDecision]}</strong></>}</p>
          {/* PLAN.md steg 25: diskens orsak och startstämplingen vid minutstart, bara i arbetsytan. */}
          {result.notes?.disqualificationReason && <p data-testid="dsq-reason">{text.dsqReasonShown(result.notes.disqualificationReason)}</p>}
          {result.decisionNote && !result.notes?.disqualificationReason && <p data-testid="decision-note">{text.decisionNoteShown(result.decisionNote)}</p>}
          {result.notes?.startPunch && <p className={result.notes.startPunch.kind === "FROM_PUNCH" ? styles.muted : styles.warning} role="note"
            data-testid="start-punch-note">
            {result.notes.startPunch.kind === "FROM_PUNCH" ? "" : "! "}{startPunchText(result.notes.startPunch, result.timeZone, startRule)}</p>}
          {/* Steg 61: fel karta vid starten. Inget byts förrän arrangören väljer "Godkänn på …". */}
          {result.notes?.wrongMap && <WrongMap ws={ws} wrongMap={result.notes.wrongMap} />}
          {/* ADR-0198: stämplingarna passar en variant som banläggningen valt bort; inget byts. */}
          {result.notes?.excludedVariant && <p className={styles.warning} role="note" data-testid="excluded-variant">
            {variantText.excludedVariant(result.notes.excludedVariant.codes)}</p>}
          {!result.resultCurrent && <>
            <p className={styles.resultStale}>{adminText.resultStale}</p>
            <button type="button" className="secondary" disabled={disabled} onClick={() => void chooseStatusChange("RECALCULATION")}>
              {text.choices.RECALCULATION}</button>
          </>}
        </>}
  </section>;
}

/** Kort historik över resultatändringar, nyaste först, med klockslag i tävlingens tidszon. */
function ResultHistory({ result, timeZone }: { result: AdministratorEffectiveResultResponse; timeZone: string }) {
  const resultText = useTexts(publicResultSv, publicResultEn);
  const text = useTexts(participantCardSv, participantCardEn);
  return <section className={styles.workspace} aria-label={text.history}>
    <h3>{text.history}</h3>
    {result.history.length === 0 ? <p>{text.historyEmpty}</p> : <ul className={styles.changeList}>
      {result.history.map(row => <li key={row.revision}>{text.historyLine(formatClockTime(row.at, timeZone),
        text.historyCauses[row.cause], resultText.statusLabels[row.status])}
        {/* Användartestet 2026-11-12: en kopplad okänd bricka säger vad som ersattes. */}
        {row.link && <span data-testid="history-link">{[` · ${text.historyCard(row.link.cardBefore, row.link.cardAfter)}`,
          row.link.replacedResult ? text.historyReplaced([resultText.statusLabels[row.link.replacedResult.status],
            row.link.replacedResult.elapsedMs !== undefined ? resultDuration(row.link.replacedResult.elapsedMs) : ""].filter(Boolean).join(" ")) : ""]
          .filter(Boolean).join(", ")}</span>}</li>)}
    </ul>}
  </section>;
}

/** Ändringar i anmälan (namn, klubb, klass, bricka, starttid), läses in på begäran. */
function EntryChanges({ ws }: { ws: Workspace }) {
  const text = useTexts(participantCardSv, participantCardEn);
  const adminText = useTexts(raceAdministratorSv, raceAdministratorEn);
  const { action, chooseAction, disabled, entryChanges, loadHistory, selected } = ws;
  if (!selected) return null;
  return <Disclosure className={styles.disclosure} open={action === "HISTORY" || undefined}
    onToggle={open => { if (open && action !== "HISTORY") chooseAction("HISTORY"); }} summary={text.entryChanges}>
    {entryChanges?.entryId === selected.id ? <>
      <AdministratorEntryChanges data={entryChanges} />
      {entryChanges.nextBeforeVersion !== null && <button type="button" className="secondary" disabled={disabled}
        onClick={() => void loadHistory(selected.id, entryChanges.nextBeforeVersion ?? undefined)}>{adminText.historyOlder}</button>}
    </> : <p>{adminText.historyNotLoaded}</p>}
  </Disclosure>;
}

/**
 * "Ta bort deltagare" för den som inte läst ut och saknar resultat, annars "Stryk" (PLAN.md steg 27): döljs i alla listor
 * men avläsningen och historiken sparas. Bekräftas i kortet.
 */
function EntryRemoval({ ws, result }: { ws: Workspace; result: AdministratorEffectiveResultResponse | undefined }) {
  const removalText = useTexts(removalSv, removalEn);
  const { disabled, prepareEntryRemoval, removalAttempt, selected } = ws;
  if (!selected || !result) return null;
  const strike = result.state !== "NO_PUBLISHED_RESULT" || result.history.length > 0 || !!result.cardPunches;
  const open = removalAttempt?.kind === "ENTRY" && removalAttempt.id === selected.id;
  return <section className={styles.workspace} aria-label={removalText.entryHeading}>
    {!open && <>
      <p className={styles.workflowHelp}>{strike ? removalText.entryStrikeHelp : removalText.entryDeleteHelp}</p>
      <p className={styles.workflowHelp}>{removalText.entryAnonymizeHelp}</p>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={disabled} onClick={() => prepareEntryRemoval()}>
          {strike ? removalText.entryStrike : removalText.entryDelete}</Button>
        <Button variant="secondary" disabled={disabled} onClick={() => prepareEntryRemoval(true)}>{removalText.entryAnonymize}</Button>
      </div>
    </>}
    <RemovalReview ws={ws} kind="ENTRY" id={selected.id} />
  </section>;
}
