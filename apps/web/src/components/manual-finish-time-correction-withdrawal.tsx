"use client";

import { useEffect, useState } from "react";
import {
  manualFinishTimeCorrectionWithdrawalCandidateSchema,
  manualFinishTimeCorrectionWithdrawalRequestSchema,
  manualFinishTimeCorrectionWithdrawalResponseSchema,
  type ManualFinishTimeCorrectionWithdrawalCandidate,
  type ManualFinishTimeCorrectionWithdrawalRequest
} from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";
import { fetchWithRetry } from "../lib/retrying-fetch";
import { formatClockTime } from "../lib/clock-time";
import styles from "./race-administrator-workspace.module.css";

type Entry = { id: string; displayName: string };
type Attempt = { candidate: ManualFinishTimeCorrectionWithdrawalCandidate; request: ManualFinishTimeCorrectionWithdrawalRequest };

export function ManualFinishTimeCorrectionWithdrawal({ raceId, entries, timeZone, onPendingChange }: { raceId: string; entries: readonly Entry[]; timeZone: string; onPendingChange?: (pending: boolean) => void }) {
  const [entryId, setEntryId] = useState(""), [candidate, setCandidate] = useState<ManualFinishTimeCorrectionWithdrawalCandidate>();
  const [acknowledged, setAcknowledged] = useState(false), [attempt, setAttempt] = useState<Attempt>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(""), [outcomeUncertain, setOutcomeUncertain] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const pending = busy || Boolean(candidate) || Boolean(attempt);
  useEffect(() => { onPendingChange?.(pending); }, [onPendingChange, pending]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const base = `/api/admin/races/${encodeURIComponent(raceId)}/administrator/entries`;
  async function load() {
    if (!entryId || busy) return;
    setBusy(true); setError(""); setSaved(""); setCandidate(undefined); setAttempt(undefined); setAcknowledged(false);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(entryId)}/finish-time-correction-withdrawal`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("candidate");
      const value = manualFinishTimeCorrectionWithdrawalCandidateSchema.parse(await response.json());
      if (value.raceId !== raceId || value.entryId !== entryId) throw new Error("scope");
      setCandidate(value);
    } catch { setError(text.finishTimeCorrectionWithdrawalLoadError); } finally { setBusy(false); }
  }
  function inspect() {
    if (!candidate || !acknowledged || busy) return;
    const parsed = manualFinishTimeCorrectionWithdrawalRequestSchema.safeParse({ formatVersion: 1, requestId: crypto.randomUUID(),
      entryId: candidate.entryId, expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
      expectedCourseVersionId: candidate.courseVersionId, expectedSnapshotVersion: candidate.snapshotVersion, expectedBasisHash: candidate.basisHash,
      expectedCorrectionId: candidate.correctionId, expectedSource: { id: candidate.source.id, revision: candidate.source.revision },
      expectedCorrected: { id: candidate.corrected.id, revision: candidate.corrected.revision },
      expectedAbsoluteHead: candidate.absoluteHead, acknowledgedWithdrawal: true });
    if (!parsed.success) { setError(text.finishTimeCorrectionWithdrawalConflict); return; }
    setAttempt({ candidate, request: parsed.data }); setError(""); setSaved("");
  }
  async function commit() {
    if (!attempt || busy) return;
    setBusy(true); setError("");
    try {
      const csrf = readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
      if (!csrf) throw new Error("csrf");
      setOutcomeUncertain(true);
      const response = await fetchWithRetry(`${base}/${encodeURIComponent(attempt.candidate.entryId)}/finish-time-correction-withdrawal`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-otid-csrf": csrf,
          "idempotency-key": `manual-finish-time-correction-withdrawal:${attempt.request.requestId}` }, body: JSON.stringify(attempt.request) });
      if (response.status === 409) { setOutcomeUncertain(false); setAttempt(undefined); setCandidate(undefined); setAcknowledged(false); setError(text.finishTimeCorrectionWithdrawalConflict); return; }
      if (!response.ok) throw new Error("commit");
      const receipt = manualFinishTimeCorrectionWithdrawalResponseSchema.parse(await response.json());
      if (receipt.raceId !== raceId || receipt.entryId !== attempt.candidate.entryId || receipt.requestId !== attempt.request.requestId ||
          receipt.created.finishTime !== attempt.candidate.source.finishTime || JSON.stringify(receipt.request) !== JSON.stringify(attempt.request)) throw new Error("receipt");
      setOutcomeUncertain(false);
      setAttempt(undefined); setCandidate(undefined); setAcknowledged(false); setSaved(text.finishTimeCorrectionWithdrawalSaved);
    } catch { setError(text.unreachable); } finally { setBusy(false); }
  }
  return <details className={styles.courseClassPanel} open={isOpen || pending} onToggle={(event) => {
    if (pending && !event.currentTarget.open) event.currentTarget.open = true;
    else if (!pending) setIsOpen(event.currentTarget.open);
  }}><summary>{text.finishTimeCorrectionWithdrawalTitle}</summary><section className={styles.panel}>
    <p>{text.finishTimeCorrectionWithdrawalHelp}</p>
    <label>{text.finishTimeCorrectionParticipant}<select value={entryId} disabled={busy || !!attempt} onChange={(event) => { setEntryId(event.target.value); setCandidate(undefined); setAttempt(undefined); setError(""); setSaved(""); }}>
      <option value="">{text.chooseEntry}</option>{entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}</select></label>
    {!candidate && !attempt && <button type="button" disabled={!entryId || busy} onClick={() => void load()}>{text.finishTimeCorrectionWithdrawalLoad}</button>}
    {candidate && !attempt && <><div className={styles.courseRelinkSummary}><p><strong>{candidate.entryName}</strong> · {candidate.className}</p>
      <p><strong>{text.finishTimeCorrectionWithdrawalSource}:</strong> {formatClockTime(candidate.source.finishTime, timeZone)}</p>
      <p><strong>{text.finishTimeCorrectionWithdrawalCorrected}:</strong> {formatClockTime(candidate.corrected.finishTime, timeZone)}</p>
      <p><strong>{text.finishTimeCorrectionWithdrawalRestored}:</strong> {formatClockTime(candidate.source.finishTime, timeZone)}</p></div>
      <label className={styles.confirmPerson}><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />{text.finishTimeCorrectionWithdrawalAcknowledge}</label>
      <button type="button" disabled={!acknowledged || busy} onClick={inspect}>{text.finishTimeCorrectionWithdrawalInspect}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { setCandidate(undefined); setAcknowledged(false); setError(""); }}>{text.cancel}</button></>}
    {attempt && <section className={styles.review} role="alert" aria-live="polite"><h2>{text.finishTimeCorrectionWithdrawalReview}</h2>
      <p>{text.finishTimeCorrectionWithdrawalConfirmText}</p><p><strong>{text.finishTimeCorrectionWithdrawalCorrected}:</strong> {formatClockTime(attempt.candidate.corrected.finishTime, timeZone)} → {formatClockTime(attempt.candidate.source.finishTime, timeZone)}</p>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void commit()}>{text.finishTimeCorrectionWithdrawalConfirm}</button>{!outcomeUncertain && <><button type="button" className="secondary" disabled={busy} onClick={() => setAttempt(undefined)}>{text.finishTimeCorrectionCancel}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setAttempt(undefined); setCandidate(undefined); setAcknowledged(false); }}>{text.cancel}</button></>}</div></section>}
    {error && <p className={styles.warning} role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}
  </section></details>;
}
