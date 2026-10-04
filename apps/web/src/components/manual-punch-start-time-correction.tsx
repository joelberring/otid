"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  manualPunchStartTimeCorrectionCandidateSchema,
  manualPunchStartTimeCorrectionRequestSchema,
  manualPunchStartTimeCorrectionResponseSchema,
  type ManualPunchStartTimeCorrectionCandidate,
  type ManualPunchStartTimeCorrectionRequest
} from "@o-tid/contracts";
import { raceAdministratorSv as text } from "../i18n/race-administrator-sv";
import { readRaceAdministratorCsrfCookie } from "../lib/race-administrator-cookies";
import { formatClockTime, parseRaceClock, zonedDate } from "../lib/clock-time";
import { fetchWithRetry } from "../lib/retrying-fetch";
import { sv } from "../i18n/sv";
import styles from "./race-administrator-workspace.module.css";

type Attempt = { candidate: ManualPunchStartTimeCorrectionCandidate; request: ManualPunchStartTimeCorrectionRequest };
type Entry = { id: string; displayName: string };

function duration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${String(milliseconds % 1_000).padStart(3, "0")}`;
}
/** Klockslaget skrivs på samma dag som den avlästa tiden, i tävlingens tidszon. */
function inputInstant(reference: string, clock: string, timeZone: string): string | null {
  return parseRaceClock(zonedDate(reference, timeZone), clock, timeZone);
}

export function ManualPunchStartTimeCorrection({ raceId, entries, timeZone, onPendingChange }: { raceId: string; entries: readonly Entry[]; timeZone: string; onPendingChange?: (pending: boolean) => void }) {
  const [entryId, setEntryId] = useState(""), [candidate, setCandidate] = useState<ManualPunchStartTimeCorrectionCandidate>();
  const [startLocal, setStartLocal] = useState(""), [acknowledged, setAcknowledged] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>(), [error, setError] = useState(""), [saved, setSaved] = useState(""), [busy, setBusy] = useState(false), [outcomeUncertain, setOutcomeUncertain] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const pending = busy || Boolean(candidate) || Boolean(attempt);
  useEffect(() => { onPendingChange?.(pending); }, [onPendingChange, pending]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const base = `/api/admin/races/${encodeURIComponent(raceId)}/administrator/entries`;
  function clear() { setCandidate(undefined); setAttempt(undefined); setStartLocal(""); setAcknowledged(false); }
  async function loadCandidate() {
    if (!entryId || busy) return;
    setBusy(true); setError(""); setSaved(""); clear();
    try {
      const response = await fetch(`${base}/${encodeURIComponent(entryId)}/punch-start-time-correction`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("candidate");
      const value = manualPunchStartTimeCorrectionCandidateSchema.parse(await response.json());
      if (value.raceId !== raceId || value.entryId !== entryId) throw new Error("scope");
      setCandidate(value);
    } catch { setError(text.punchStartTimeCorrectionLoadError); } finally { setBusy(false); }
  }
  function inspect(event: FormEvent) {
    event.preventDefault();
    if (!candidate || busy || !acknowledged) return;
    const correctedStartTime = inputInstant(candidate.source.startTime, startLocal, timeZone), source = candidate.source;
    const absoluteSplits = source.splits.map((split) => Date.parse(source.startTime) + split.elapsedMs);
    if (!correctedStartTime || Date.parse(correctedStartTime) === Date.parse(source.startTime) ||
      Date.parse(correctedStartTime) >= Date.parse(source.finishTime) || absoluteSplits.some((value) => Date.parse(correctedStartTime) > value)) {
      setError(text.punchStartTimeCorrectionInvalid); return;
    }
    const parsed = manualPunchStartTimeCorrectionRequestSchema.safeParse({ formatVersion: 1, requestId: crypto.randomUUID(),
      entryId: candidate.entryId, expectedEntryVersion: candidate.entryVersion, expectedClassId: candidate.classId,
      expectedCourseVersionId: source.courseVersionId, expectedSnapshotVersion: candidate.snapshotVersion,
      expectedBasisHash: candidate.basisHash, expectedSourceResultRevisionId: source.resultRevisionId,
      expectedSourceResultRevision: source.resultRevision, expectedReadoutId: source.readoutId,
      expectedSourceStartTime: source.startTime, correctedStartTime, acknowledgedCorrection: true });
    if (!parsed.success) { setError(text.punchStartTimeCorrectionInvalid); return; }
    setAttempt({ candidate, request: parsed.data }); setError(""); setSaved("");
  }
  async function commit() {
    if (!attempt || busy) return;
    setBusy(true); setError("");
    try {
      const csrf = readRaceAdministratorCsrfCookie(document.cookie, new URL(window.location.href));
      if (!csrf) throw new Error("csrf");
      setOutcomeUncertain(true);
      const response = await fetchWithRetry(`${base}/${encodeURIComponent(attempt.candidate.entryId)}/punch-start-time-correction`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-otid-csrf": csrf,
          "idempotency-key": `manual-punch-start-time-correction:${attempt.request.requestId}` }, body: JSON.stringify(attempt.request) });
      if (response.status === 409) { setOutcomeUncertain(false); clear(); setError(text.punchStartTimeCorrectionConflict); return; }
      if (!response.ok) throw new Error("commit");
      const receipt = manualPunchStartTimeCorrectionResponseSchema.parse(await response.json());
      if (receipt.raceId !== raceId || receipt.entryId !== attempt.candidate.entryId || receipt.requestId !== attempt.request.requestId ||
          receipt.correctedStartTime !== attempt.request.correctedStartTime || JSON.stringify(receipt.request) !== JSON.stringify(attempt.request)) throw new Error("receipt");
      setOutcomeUncertain(false);
      clear(); setSaved(text.punchStartTimeCorrectionSaved);
    } catch { setError(text.unreachable); } finally { setBusy(false); }
  }
  const source = candidate?.source;
  const newElapsed = attempt ? Date.parse(attempt.candidate.source.finishTime) - Date.parse(attempt.request.correctedStartTime) : undefined;
  const firstControl = source?.splits[0];
  return <details className={styles.courseClassPanel} open={isOpen || pending} onToggle={(event) => {
    if (pending && !event.currentTarget.open) event.currentTarget.open = true;
    else if (!pending) setIsOpen(event.currentTarget.open);
  }}>
    <summary>{text.punchStartTimeCorrectionTitle}</summary><form className={styles.panel} onSubmit={inspect}>
      <p>{text.punchStartTimeCorrectionHelp}</p><label>{text.finishTimeCorrectionParticipant}<select value={entryId} disabled={busy || !!attempt}
        onChange={(event) => { setEntryId(event.target.value); clear(); setError(""); setSaved(""); }}><option value="">{text.chooseEntry}</option>
        {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}</select></label>
      {!candidate && !attempt && <button type="button" disabled={!entryId || busy} onClick={() => void loadCandidate()}>{text.punchStartTimeCorrectionLoad}</button>}
      {source && !attempt && <><div className={styles.courseRelinkSummary}><p><strong>{candidate.entryName}</strong> · {candidate.className}</p>
        <p><strong>{text.finishTimeCorrectionSource}:</strong> {sv.publicResultsStatusLabels[source.outcome.status]}</p>
        <p><strong>{text.finishTimeCorrectionStart}:</strong> {formatClockTime(source.startTime, timeZone)} · <strong>{text.finishTimeCorrectionFinish}:</strong> {formatClockTime(source.finishTime, timeZone)}</p>
        <p><strong>{text.finishTimeCorrectionElapsed}:</strong> {duration(source.elapsedMs)} · <strong>{text.punchStartTimeCorrectionFirstControl}:</strong> {firstControl ? `${firstControl.controlCode} · ${duration(firstControl.elapsedMs)}` : text.finishTimeCorrectionNoSplit}</p></div>
        <label>{text.punchStartTimeCorrectionNewStart}<input type="text" inputMode="numeric" autoComplete="off" placeholder="19:42:05" value={startLocal} disabled={busy} onChange={(event) => setStartLocal(event.target.value)} required /></label>
        <p>{text.punchStartTimeCorrectionTimeHelp}</p><label className={styles.confirmPerson}><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />{text.punchStartTimeCorrectionAcknowledge}</label>
        <button type="submit" disabled={!startLocal || !acknowledged || busy}>{text.punchStartTimeCorrectionInspect}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { clear(); setError(""); }}>{text.cancel}</button></>}
      {attempt && <section className={styles.review} role="alert" aria-live="polite"><h2>{text.punchStartTimeCorrectionReview}</h2><p><strong>{attempt.candidate.entryName}</strong> · {attempt.candidate.className}</p>
        <p><strong>{text.finishTimeCorrectionStart}:</strong> {formatClockTime(attempt.candidate.source.startTime, timeZone)} → {formatClockTime(attempt.request.correctedStartTime, timeZone)}</p>
        <p><strong>{text.finishTimeCorrectionElapsed}:</strong> {duration(attempt.candidate.source.elapsedMs)} → {newElapsed === undefined ? "–" : duration(newElapsed)}</p>{!outcomeUncertain && <p>{text.finishTimeCorrectionNotSaved}</p>}
        <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void commit()}>{text.punchStartTimeCorrectionConfirm}</button>{!outcomeUncertain && <button type="button" className="secondary" disabled={busy} onClick={() => setAttempt(undefined)}>{text.finishTimeCorrectionCancel}</button>}</div></section>}
      {error && <p className={styles.warning} role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}
    </form></details>;
}
