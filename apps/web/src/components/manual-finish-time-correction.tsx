"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  manualFinishTimeCorrectionCandidateSchema,
  manualFinishTimeCorrectionRequestSchema,
  manualFinishTimeCorrectionResponseSchema,
  type ManualFinishTimeCorrectionCandidate,
  type ManualFinishTimeCorrectionRequest
} from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";
import { formatClockTime, parseRaceClock, zonedDate } from "../lib/clock-time";
import { fetchWithRetry } from "../lib/retrying-fetch";
import { sv } from "../i18n/sv";
import styles from "./race-administrator-workspace.module.css";

type Attempt = { candidate: ManualFinishTimeCorrectionCandidate; request: ManualFinishTimeCorrectionRequest };
type Entry = { id: string; displayName: string };

function duration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${String(milliseconds % 1_000).padStart(3, "0")}`;
}

/** Klockslaget skrivs på samma dag som den avlästa tiden, i tävlingens tidszon. */
function inputInstant(reference: string, clock: string, timeZone: string): string | null {
  return parseRaceClock(zonedDate(reference, timeZone), clock, timeZone);
}

export function ManualFinishTimeCorrection({ raceId, entries, timeZone, onPendingChange }: {
  raceId: string;
  entries: readonly Entry[];
  timeZone: string;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [entryId, setEntryId] = useState(""), [candidate, setCandidate] = useState<ManualFinishTimeCorrectionCandidate>();
  const [correctedFinishLocal, setCorrectedFinishLocal] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>(), [error, setError] = useState(""), [saved, setSaved] = useState(""), [busy, setBusy] = useState(false), [outcomeUncertain, setOutcomeUncertain] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const pending = busy || Boolean(candidate) || Boolean(attempt);
  useEffect(() => { onPendingChange?.(pending); }, [onPendingChange, pending]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const base = `/api/admin/races/${encodeURIComponent(raceId)}/administrator/entries`;

  async function loadCandidate() {
    if (!entryId || busy) return;
    setBusy(true); setError(""); setSaved(""); setCandidate(undefined); setAttempt(undefined); setCorrectedFinishLocal(""); setAcknowledged(false);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(entryId)}/finish-time-correction`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("candidate");
      const value = manualFinishTimeCorrectionCandidateSchema.parse(await response.json());
      if (value.raceId !== raceId || value.entryId !== entryId) throw new Error("scope");
      setCandidate(value);
    } catch { setError(text.finishTimeCorrectionLoadError); }
    finally { setBusy(false); }
  }

  function inspect(event: FormEvent) {
    event.preventDefault();
    if (!candidate || busy || !acknowledged) return;
    const correctedFinishTime = inputInstant(candidate.source.finishTime, correctedFinishLocal, timeZone);
    const source = candidate.source;
    if (!correctedFinishTime || Date.parse(correctedFinishTime) === Date.parse(source.finishTime) ||
        Date.parse(correctedFinishTime) <= Date.parse(source.startTime) ||
        (source.latestMatchedSplitElapsedMs !== null && Date.parse(correctedFinishTime) - Date.parse(source.startTime) < source.latestMatchedSplitElapsedMs)) {
      setError(text.finishTimeCorrectionInvalid); return;
    }
    const parsed = manualFinishTimeCorrectionRequestSchema.safeParse({ formatVersion: 1, requestId: crypto.randomUUID(),
      entryId: candidate.entryId, expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
      expectedCourseVersionId: source.courseVersionId, expectedSnapshotVersion: candidate.snapshotVersion,
      expectedBasisHash: candidate.basisHash, expectedSourceResultRevisionId: source.resultRevisionId,
      expectedSourceResultRevision: source.resultRevision, expectedReadoutId: source.readoutId,
      expectedSourceFinishTime: source.finishTime, correctedFinishTime, acknowledgedCorrection: true });
    if (!parsed.success) { setError(text.finishTimeCorrectionInvalid); return; }
    setAttempt({ candidate, request: parsed.data }); setError(""); setSaved("");
  }

  async function commit() {
    if (!attempt || busy) return;
    setBusy(true); setError("");
    try {
      const csrf = readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
      if (!csrf) throw new Error("csrf");
      setOutcomeUncertain(true);
      const response = await fetchWithRetry(`${base}/${encodeURIComponent(attempt.candidate.entryId)}/finish-time-correction`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-otid-csrf": csrf,
          "idempotency-key": `manual-finish-time-correction:${attempt.request.requestId}` }, body: JSON.stringify(attempt.request)
      });
      if (response.status === 409) {
        setOutcomeUncertain(false);
        setAttempt(undefined); setCandidate(undefined); setCorrectedFinishLocal(""); setAcknowledged(false); setError(text.finishTimeCorrectionConflict); return;
      }
      if (!response.ok) throw new Error("commit");
      const receipt = manualFinishTimeCorrectionResponseSchema.parse(await response.json());
      if (receipt.raceId !== raceId || receipt.entryId !== attempt.candidate.entryId || receipt.requestId !== attempt.request.requestId ||
          receipt.correctedFinishTime !== attempt.request.correctedFinishTime || JSON.stringify(receipt.request) !== JSON.stringify(attempt.request)) {
        throw new Error("receipt");
      }
      setOutcomeUncertain(false);
      setAttempt(undefined); setCandidate(undefined); setCorrectedFinishLocal(""); setAcknowledged(false); setSaved(text.finishTimeCorrectionSaved);
    } catch { setError(text.unreachable); }
    finally { setBusy(false); }
  }

  const source = candidate?.source;
  const newElapsed = attempt ? Date.parse(attempt.request.correctedFinishTime) - Date.parse(attempt.candidate.source.startTime) : undefined;
  return <details className={styles.disclosure} open={isOpen || pending} onToggle={(event) => {
    if (pending && !event.currentTarget.open) event.currentTarget.open = true;
    else if (!pending) setIsOpen(event.currentTarget.open);
  }}>
    <summary>{text.finishTimeCorrectionTitle}</summary>
    <form className={styles.disclosureBody} onSubmit={inspect}>
      <p>{text.finishTimeCorrectionHelp}</p>
      <label>{text.finishTimeCorrectionParticipant}<select value={entryId} disabled={busy || !!attempt}
        onChange={(event) => { setEntryId(event.target.value); setCandidate(undefined); setAttempt(undefined); setError(""); setSaved(""); }}>
        <option value="">{text.chooseEntry}</option>{entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
      </select></label>
      {!candidate && !attempt && <button type="button" disabled={!entryId || busy} onClick={() => void loadCandidate()}>{text.finishTimeCorrectionLoad}</button>}
      {source && !attempt && <>
        <div className={styles.summaryBox}>
          <p><strong>{candidate.entryName}</strong> · {candidate.className}</p>
          <p><strong>{text.finishTimeCorrectionSource}:</strong> {sv.publicResultsStatusLabels[source.outcome.status]}</p>
          <p><strong>{text.finishTimeCorrectionStart}:</strong> {formatClockTime(source.startTime, timeZone)}</p>
          <p><strong>{text.finishTimeCorrectionFinish}:</strong> {formatClockTime(source.finishTime, timeZone)} · <strong>{text.finishTimeCorrectionElapsed}:</strong> {duration(source.elapsedMs)}</p>
          <p><strong>{text.finishTimeCorrectionLastSplit}:</strong> {source.latestMatchedSplitElapsedMs === null ? text.finishTimeCorrectionNoSplit : duration(source.latestMatchedSplitElapsedMs)}</p>
        </div>
        <label>{text.finishTimeCorrectionNewFinish}<input type="text" inputMode="numeric" autoComplete="off" placeholder="19:42:05" value={correctedFinishLocal} disabled={busy}
          onChange={(event) => setCorrectedFinishLocal(event.target.value)} required /></label>
        <p>{text.finishTimeCorrectionTimeHelp}</p>
        <label className={styles.confirmPerson}><input type="checkbox" checked={acknowledged} disabled={busy}
          onChange={(event) => setAcknowledged(event.target.checked)} />{text.finishTimeCorrectionAcknowledge}</label>
        <button type="submit" disabled={!correctedFinishLocal || !acknowledged || busy}>{text.finishTimeCorrectionInspect}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { setCandidate(undefined); setCorrectedFinishLocal(""); setAcknowledged(false); setError(""); }}>{text.cancel}</button>
      </>}
      {attempt && <section className={styles.review} role="alert" aria-live="polite">
        <h2>{text.finishTimeCorrectionReview}</h2>
        <p><strong>{attempt.candidate.entryName}</strong> · {attempt.candidate.className}</p>
        <p><strong>{text.finishTimeCorrectionFinish}:</strong> {formatClockTime(attempt.candidate.source.finishTime, timeZone)} → {formatClockTime(attempt.request.correctedFinishTime, timeZone)}</p>
        <p><strong>{text.finishTimeCorrectionElapsed}:</strong> {duration(attempt.candidate.source.elapsedMs)} → {newElapsed === undefined ? "–" : duration(newElapsed)}</p>
        {!outcomeUncertain && <p>{text.finishTimeCorrectionNotSaved}</p>}
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void commit()}>{text.finishTimeCorrectionConfirm}</button>
          {!outcomeUncertain && <button type="button" className="secondary" disabled={busy} onClick={() => setAttempt(undefined)}>{text.finishTimeCorrectionCancel}</button>}</div>
      </section>}
      {error && <p className={styles.warning} role="alert">{error}</p>}
      {saved && <p role="status">{saved}</p>}
    </form>
  </details>;
}
