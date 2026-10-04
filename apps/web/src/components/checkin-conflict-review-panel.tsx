import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { formatClockTime } from "../lib/clock-time";
import type { StartCheckinConflictReviewCandidate, StartCheckinConflictReviewRequest, StartCheckinRosterResponse } from "@o-tid/contracts";
import { CheckinConflictReviewClientError, loadCheckinConflictReview, submitCheckinConflictReview } from "../lib/checkin-conflict-review-client";
import { readFinishForestWatchCsrfCookie } from "../lib/start-checkin-admin-cookies";
import { checkinConflictReviewSv as text } from "../i18n/checkin-conflict-review-sv";
import { forestWatchSv as forest } from "../i18n/forest-watch-sv";
import styles from "./forest-watch.module.css";

export function CheckinConflictReviewPanel({ raceId, entries, timeZone, onUnauthorized, onReviewed }: {
  timeZone: string;
  raceId: string; entries: StartCheckinRosterResponse["entries"]; onUnauthorized: () => void; onReviewed: () => void
}) {
  const [entryId, setEntryId] = useState("");
  const [candidate, setCandidate] = useState<StartCheckinConflictReviewCandidate>();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<StartCheckinConflictReviewRequest>();
  const [message, setMessage] = useState("");
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => { current.current?.abort(); }, []);

  function authFailure(error: unknown): boolean {
    if (error instanceof CheckinConflictReviewClientError && (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")) {
      onUnauthorized(); return true;
    }
    return false;
  }
  async function load() {
    if (current.current || pending || !entryId) return;
    const controller = new AbortController(); current.current = controller;
    setBusy(true); setCandidate(undefined); setConfirmed(false); setReason(""); setMessage("");
    try {
      const value = await loadCheckinConflictReview(raceId, entryId, controller.signal);
      if (!controller.signal.aborted) setCandidate(value);
    } catch (error) {
      if (!controller.signal.aborted && !authFailure(error)) setMessage(text.failedRead);
    } finally {
      if (!controller.signal.aborted) { current.current = null; setBusy(false); }
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (current.current || !candidate || (!pending && (!confirmed || !reason.trim() || !candidate.source.conflicts.length))) return;
    const controller = new AbortController(); current.current = controller; setBusy(true);
    // Never regenerate request identity or rebase evidence after an unknown commit.
    const intent = pending ?? { formatVersion: 1, requestId: crypto.randomUUID(), entryId: candidate.source.entryId,
      sourceHash: candidate.sourceHash, conflictRequestIds: candidate.source.conflicts.map(row => row.operation.requestId),
      decision: "KEEP_CURRENT_STATE", reason: reason.trim() } satisfies StartCheckinConflictReviewRequest;
    setPending(intent);
    try {
      const csrf = readFinishForestWatchCsrfCookie(document.cookie, new URL(window.location.href));
      if (!csrf) throw new CheckinConflictReviewClientError("UNAUTHORIZED");
      await submitCheckinConflictReview(raceId, intent, csrf, controller.signal);
      if (controller.signal.aborted) return;
      setPending(undefined); setCandidate(undefined); setReason(""); setConfirmed(false); setMessage(text.saved);
      onReviewed();
    } catch (error) {
      if (controller.signal.aborted || authFailure(error)) return;
      if (error instanceof CheckinConflictReviewClientError && ["CONFLICT", "NOT_FOUND", "INVALID_REQUEST", "TOO_LARGE"].includes(error.code)) {
        setPending(undefined); setCandidate(undefined); setConfirmed(false);
        setMessage(error.code === "TOO_LARGE" ? text.tooLarge : text.stale);
      } else setMessage(text.pending);
    } finally {
      if (!controller.signal.aborted) { current.current = null; setBusy(false); }
    }
  }
  const options = entries.filter(entry => entry.conflictingReports);
  const source = candidate?.source;
  return <section className={`${styles.screenOnly} panel stack`} aria-label={text.title}>
    <h2>{text.title}</h2><p>{text.help}</p>
    <label>{text.entry}<select value={entryId} disabled={busy || !!pending} onChange={event => {
      setEntryId(event.target.value); setCandidate(undefined); setConfirmed(false); setReason(""); setMessage("");
    }}><option value="">{text.choose}</option>{options.map(entry => <option key={entry.entryId} value={entry.entryId}>
      {entry.displayName} – {entry.className}
    </option>)}</select></label>
    <button disabled={busy || !!pending || !entryId} onClick={() => void load()}>{text.load}</button>
    {source && <>
      <h3>{source.displayName} – {source.className}</h3><p>{source.organisationName}</p>
      <p>{text.generated}: {formatClockTime(candidate.generatedAt, timeZone)}</p>
      <h3>{text.current}</h3><p>{forest.reports[source.startState]}</p>
      <p>{source.manualReturnRegistered ? forest.manualReturn : text.returnNo}</p>
      <p>{source.readoutReturnRegistered ? forest.readoutReturn : (!source.manualReturnRegistered ? forest.noReturn : "")}</p>
      {source.activeDns && <p>{forest.activeDns}</p>}
      <h3>{text.reports} ({source.conflicts.length})</h3>
      {source.conflicts.map(row => <article className="panel stack" key={row.operation.requestId}>
        <h4>{row.deviceLabel}</h4><p>{row.operation.action.kind === "MARK_START" ? text.mark : text.correction}</p>
        <p>{forest.reports[row.operation.action.state]}</p>
        {row.operation.action.kind === "FINISH_CORRECTION" && <p>{row.operation.action.manualReturnRegistered ? text.returnYes : text.returnNo}</p>}
        <p>{text.observed}: {formatClockTime(row.operation.observedAt, timeZone)}</p><p>{text.received}: {formatClockTime(row.receipt.receivedAt, timeZone)}</p>
        {row.receipt.effect.kind === "CONFLICT" && <p>{text.errors[row.receipt.effect.reason]}</p>}
      </article>)}
      {!source.conflicts.length ? <p>{text.noReports}</p> : <form className="stack" onSubmit={event => void submit(event)}>
        <label>{text.reason}<textarea required maxLength={500} rows={3} value={reason} disabled={busy || !!pending}
          onChange={event => setReason(event.target.value)} /></label>
        <label><input type="checkbox" checked={confirmed} disabled={busy || !!pending}
          onChange={event => setConfirmed(event.target.checked)} />{text.confirm}</label>
        <button disabled={busy || (!pending && (!confirmed || !reason.trim()))}>{pending ? text.retry : text.submit}</button>
      </form>}
    </>}
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
