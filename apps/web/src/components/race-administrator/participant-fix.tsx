"use client";

import type { Texts } from "../../lib/language";
import { publicResultEn, publicResultSv } from "../../i18n/public-en";
import { useState } from "react";
import { correctionEn } from "../../i18n/workspace-small-en";
import { courseVariantsEn } from "../../i18n/workspace-tools-en";
import { participantCardEn, type CardTexts } from "../../i18n/workspace-admin-en";
import { raceAdministratorEn } from "../../i18n/workspace-admin-en";
import { useTexts } from "../language-provider";
import type { AdministratorEffectiveResultResponse } from "@o-tid/contracts";
import styles from "../race-administrator-workspace.module.css";
import { raceAdministratorSv } from "../../i18n/race-administrator-sv";
import { participantCardSv } from "../../i18n/participant-card-sv";
import { courseVariantsSv } from "../../i18n/course-variants-sv";
import { correctionSv } from "../../i18n/correction-sv";
import { availableStatusChoices, isStatusChoice } from "../../lib/participant-status-choices";
import { ManualFinishTimeCorrection, ManualFinishTimeCorrectionWithdrawal, ManualPunchStartTimeCorrection,
  ManualPunchStartTimeCorrectionWithdrawal } from "../manual-time-correction";
import { ParticipantReadoutReread } from "../readout-reread";
import { ManualResult } from "./manual-result";
import { Button, Disclosure } from "../ui";
import type { StatusAttempt } from "./result-decisions";
import { participantFixId } from "./types";
import type { Workspace } from "./workspace-state";

/**
 * ADR-0191 beslut 1: deltagarkortets "Rätta" – alla rättelser för en löpare på ett ställe. Status (ej start, brutit,
 * felstämplad, disk, utom tävlan, deltog utan tid, godkänn), manuell tid, godkända kontroller, omläsning, variant, bricka
 * och klass. De sällsynta tidsrättningarna av en enstaka stämpling ligger under Mer. Varje val går genom samma statusflöde
 * eller anmälningsflöde som förut, med förhandsbesked, bekräftelse och journal.
 */
export function ParticipantFix({ ws, result }: { ws: Workspace; result: AdministratorEffectiveResultResponse | undefined }) {
  const fixText = useTexts(correctionSv, correctionEn);
  const { chooseAction, data, disabled, functionary, raceId, selected, selectedClass } = ws;
  if (!selected || !data) return null;
  const id = participantFixId(raceId);
  const refreshKey = result ? `${result.history[0]?.revision ?? 0}:${result.snapshotVersion}` : "";
  return <section className={`${styles.workspace} ${styles.fixPanel}`} id={id} tabIndex={-1} aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{fixText.title}</h3>
    <p className={styles.workflowHelp}>{fixText.help}</p>
    <div className={styles.fixGroup}>
      <h4>{fixText.status}</h4>
      <StatusChange ws={ws} result={result} />
    </div>
    <div className={styles.fixGroup}>
      <h4>{fixText.timeAndControls}</h4>
      <ManualResult key={selected.id} ws={ws} result={result} />
      {/* PLAN.md steg 36: avläsningen blir annorlunda om den läses om från rådata (bara administratören). */}
      {/* Står kvar medan kortet läses in på nytt, så att beskedet efter sparandet syns. */}
      {!functionary && <ParticipantReadoutReread key={`reread-${selected.id}`} raceId={raceId} entryId={selected.id} disabled={disabled}
        active={!!result?.cardPunches} refreshKey={refreshKey} onChanged={ws.reloadQuietly} />}
    </div>
    <div className={styles.fixGroup}>
      <h4>{fixText.courseAndCard}</h4>
      <p className={styles.workflowHelp}>{fixText.courseAndCardHelp}</p>
      <div className={styles.actions}>
        <Button variant="secondary" disabled={disabled} onClick={() => chooseAction("CARD")}>{fixText.changeCard}</Button>
        <Button variant="secondary" disabled={disabled} onClick={() => chooseAction("TRANSFER")}>{fixText.changeClass}</Button>
      </div>
      {selectedClass && selectedClass.courseVariants.length > 0 && <ParticipantVariant ws={ws} />}
    </div>
    {!functionary && <Disclosure className={styles.disclosure} summary={fixText.more}>
      <div className={styles.disclosureBody}>
        <p className={styles.workflowHelp}>{fixText.moreHelp}</p>
        <div className={styles.disclosureList}>
          <ManualFinishTimeCorrection key={`finish-${selected.id}`} raceId={raceId} entryId={selected.id} timeZone={data.timeZone}
            onPendingChange={ws.setFinishCorrectionPending} onSaved={ws.reloadQuietly} />
          <ManualPunchStartTimeCorrection key={`start-${selected.id}`} raceId={raceId} entryId={selected.id} timeZone={data.timeZone}
            onPendingChange={ws.setStartCorrectionPending} onSaved={ws.reloadQuietly} />
          <ManualFinishTimeCorrectionWithdrawal key={`finish-w-${selected.id}`} raceId={raceId} entryId={selected.id}
            timeZone={data.timeZone} onPendingChange={ws.setFinishWithdrawalPending} onSaved={ws.reloadQuietly} />
          <ManualPunchStartTimeCorrectionWithdrawal key={`start-w-${selected.id}`} raceId={raceId} entryId={selected.id}
            timeZone={data.timeZone} onPendingChange={ws.setStartWithdrawalPending} onSaved={ws.reloadQuietly} />
        </div>
      </div>
    </Disclosure>}
  </section>;
}

/**
 * Gafflad klass: löparens variant och "Byt variant". Bytet sparas direkt om resultatet inte
 * ändras; annars visas beskedet och arrangören bekräftar (ADR-0169 beslut 2).
 */
function ParticipantVariant({ ws }: { ws: Workspace }) {
  const variantText = useTexts(courseVariantsSv, courseVariantsEn);
  const adminText = useTexts(raceAdministratorSv, raceAdministratorEn);
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


function consequence(attempt: StatusAttempt, text: CardTexts, statusLabels: Texts<typeof publicResultSv>["statusLabels"]): string {
  if (attempt.kind === "RECALCULATION") return text.consequences.RECALCULATION;
  switch (attempt.choice) {
    case "APPROVAL_WITHDRAWAL": case "DSQ_WITHDRAWAL": case "NT_WITHDRAWAL": case "OOC_WITHDRAWAL": case "DNF_WITHDRAWAL":
    case "MANUAL_TIME_WITHDRAWAL": case "CONTROL_APPROVAL_WITHDRAWAL":
      return attempt.restores ? text.withdrawalConsequence(statusLabels[attempt.restores.status])
        : text.noDecisionWithdrawalConsequence;
    case "DNS_WITHDRAWAL": return text.dnsWithdrawalConsequence;
    default: return text.consequences[attempt.choice];
  }
}

/** "Ändra status": ett val, ett besked i en mening och en bekräftelse. */
function StatusChange({ ws, result }: { ws: Workspace; result: AdministratorEffectiveResultResponse | undefined }) {
  const text = useTexts(participantCardSv, participantCardEn), resultText = useTexts(publicResultSv, publicResultEn);
  const { busy, cancelStatusChange, chooseStatusChange, confirmStatusChange, decisionAttempt, disabled, raceId,
    recalculationAttempt, statusBlocked, statusChoice, unknown } = ws;
  const attempt: StatusAttempt | undefined = decisionAttempt ?? recalculationAttempt;
  const choices = availableStatusChoices(result);
  const id = `status-change-${raceId}`;
  const [reason, setReason] = useState("");
  const asksReason = attempt?.kind === "DECISION" && (attempt.choice === "DSQ" || attempt.choice === "APPROVAL" ||
    attempt.choice === "CONFIRM_MP");
  const reasonLabel = attempt?.kind === "DECISION" && attempt.choice === "APPROVAL" ? text.approvalReason
    : attempt?.kind === "DECISION" && attempt.choice === "CONFIRM_MP" ? text.confirmMpReason : text.dsqReason;
  return <section className={styles.workspace}>
    <label htmlFor={id}>{text.changeStatus}</label>
    <select id={id} value={statusChoice} disabled={disabled || choices.length === 0}
      onChange={event => void chooseStatusChange(isStatusChoice(event.target.value) ? event.target.value : "")}>
      <option value="">{text.chooseStatus}</option>
      {choices.map(choice => <option key={choice} value={choice}>{text.choices[choice]}</option>)}
    </select>
    {statusBlocked && <p className={styles.warning} role="status">{statusBlocked}</p>}
    {attempt && <div className={styles.review} role="alert">
      <p><strong>{consequence(attempt, text, resultText.statusLabels)}</strong></p>
      {/* Disk med orsak (PLAN.md steg 25): orsaken visas bara i arbetsytan, aldrig publikt. */}
      {asksReason && <label className={styles.narrowField} htmlFor={`${id}-reason`}>{reasonLabel}
        <input id={`${id}-reason`} value={reason} maxLength={240} disabled={busy || unknown} autoComplete="off"
          onChange={event => setReason(event.target.value)} /></label>}
      {unknown && <p>{text.unknown}</p>}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => {
          void confirmStatusChange(attempt, reason).then(() => { if (!ws.pending.current) setReason(""); }); }}>
          {unknown ? text.retry : text.confirm}</button>
        {!unknown && <button type="button" className="secondary" disabled={busy} onClick={() => cancelStatusChange(attempt)}>{text.cancel}</button>}
      </div>
    </div>}
  </section>;
}

