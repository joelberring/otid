"use client";
import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  withoutTimingAdminLoginRequestSchema,
  withoutTimingAdminLoginResponseSchema,
  type WithoutTimingResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  createWithoutTimingAttempt,
  isDefinitiveWithoutTimingRejection,
  parseWithoutTimingCandidates,
  parseWithoutTimingResponse,
  readWithoutTimingAdminCsrf,
  type WithoutTimingAttempt,
  type WithoutTimingCandidates
} from "../lib/without-timing-admin-client";

type AttemptPhase = "CONFIRM" | "UNKNOWN" | "REAUTH";
async function responseJson(response: Response): Promise<unknown> { try { return await response.json() as unknown; } catch { throw new Error(sv.withoutTimingInvalidResponse); } }
function messageFrom(error: unknown): string {
  if (error instanceof TypeError) return sv.withoutTimingUnconfirmedResponse;
  return error instanceof Error ? error.message : sv.withoutTimingUnknownError;
}
function readinessText(readiness: WithoutTimingCandidates["entries"][number]["readiness"]): string {
  if (readiness === "READY") return `✓ ${sv.withoutTimingReady}`;
  const reasons = {
    NO_ACTIVE_RESULT: sv.withoutTimingNoActiveResult,
    UNSUPPORTED_RESULT: sv.withoutTimingUnsupportedResult,
    UNPUBLISHED_RESULT: sv.withoutTimingUnpublishedResult,
    STALE_RESULT: sv.withoutTimingStaleResult,
    ACTIVE_DID_NOT_START: sv.withoutTimingActiveDidNotStart,
    ACTIVE_DISQUALIFICATION: sv.withoutTimingActiveDisqualification,
    ACTIVE_APPROVAL: sv.withoutTimingActiveApproval,
    ACTIVE_DID_NOT_FINISH: sv.withoutTimingActiveDidNotFinish,
    ACTIVE_OUT_OF_COMPETITION: sv.withoutTimingActiveOutOfCompetition,
    ACTIVE_WITHOUT_TIMING: sv.withoutTimingActiveWithoutTiming
  } as const;
  return `△ ${sv.withoutTimingBlocked}: ${reasons[readiness]}`;
}

export function WithoutTimingAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [candidates, setCandidates] = useState<WithoutTimingCandidates>();
  const [attempt, setAttempt] = useState<WithoutTimingAttempt>();
  const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>();
  const [lastResult, setLastResult] = useState<WithoutTimingResponse>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(sv.withoutTimingCheckingSession);
  const [online, setOnline] = useState<boolean>();
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLHeadingElement>(null);
  const sessionUrl = `/api/admin/races/${raceId}/without-timing-session`;
  const candidatesUrl = `/api/admin/races/${raceId}/without-timing-candidates`;

  const loadCandidates = useCallback(async () => {
    const response = await fetch(candidatesUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false); setCandidates(undefined); setMessage(sv.withoutTimingLoginRequired); return false;
    }
    if (!response.ok) throw new Error(`${sv.withoutTimingSessionFailed} (${response.status})`);
    setCandidates(parseWithoutTimingCandidates(await responseJson(response), raceId));
    setAuthenticated(true); setMessage(""); return true;
  }, [candidatesUrl, raceId]);
  useEffect(() => { void loadCandidates().catch((error: unknown) => { setCandidates(undefined); setMessage(messageFrom(error)); }); }, [loadCandidates]);
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => { window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline); };
  }, []);
  useEffect(() => {
    if (!attempt || busy) return;
    const heading = attemptPhase === "CONFIRM" ? confirmRef.current
      : attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH" ? retryRef.current : null;
    heading?.scrollIntoView({ block: "start", behavior: "instant" });
    heading?.focus({ preventScroll: true });
  }, [attempt, attemptPhase, busy]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(sv.withoutTimingLoggingIn);
    try {
      const parsed = withoutTimingAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.withoutTimingLoginRejected);
      const response = await fetch(sessionUrl, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (!response.ok) throw new Error(response.status === 401 ? sv.withoutTimingLoginRejected : `${sv.withoutTimingSessionFailed} (${response.status})`);
      const session = withoutTimingAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId || session.data.capability !== "DECIDE_WITHOUT_TIMING") throw new Error(sv.withoutTimingInvalidResponse);
      const loaded = await loadCandidates(); if (loaded && attempt !== undefined) setMessage(sv.withoutTimingAttemptRetained);
    } catch (error) { setMessage(messageFrom(error)); } finally { setAccessCredential(""); setBusy(false); }
  }

  async function submitAttempt(current: WithoutTimingAttempt) {
    let csrf: string;
    try { csrf = readWithoutTimingAdminCsrf(document.cookie, new URL(window.location.href)); }
    catch (error) { setAuthenticated(false); setCandidates(undefined); setAttemptPhase("REAUTH"); setMessage(`${messageFrom(error)} ${sv.withoutTimingAttemptRetained}`); return; }
    setBusy(true); setMessage(sv.withoutTimingWorking);
    try {
      const response = await fetch(`/api/admin/races/${raceId}/entries/${current.entryId}/without-timing`, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": `without-timing:${current.requestId}`, "x-otid-csrf": csrf },
        body: JSON.stringify(current.request)
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setAuthenticated(false); setCandidates(undefined); setAttemptPhase("REAUTH"); setMessage(`${sv.withoutTimingFailed} (${response.status}). ${sv.withoutTimingLoginAgain} ${sv.withoutTimingAttemptRetained}`); return; }
        if (isDefinitiveWithoutTimingRejection(response.status)) { setAttempt(undefined); setAttemptPhase(undefined); if (response.status === 409) try { await loadCandidates(); } catch { setCandidates(undefined); } setMessage(response.status === 409 ? sv.withoutTimingConflict : `${sv.withoutTimingFailed} (${response.status}).`); return; }
        throw new Error(`${sv.withoutTimingFailed} (${response.status}). ${sv.withoutTimingUnknownCommitHelp}`);
      }
      const result = parseWithoutTimingResponse(await responseJson(response), current, raceId);
      const success = result.replayed ? sv.withoutTimingReplayRecovered : sv.withoutTimingCreated;
      setLastResult(result); setAttempt(undefined); setAttemptPhase(undefined);
      try { await loadCandidates(); setMessage(success); }
      catch { setCandidates(undefined); setMessage(`${success} ${sv.withoutTimingSessionFailed}.`); }
    } catch (error) { setAttemptPhase("UNKNOWN"); setMessage(`${messageFrom(error)} ${sv.withoutTimingAttemptRetained}`); }
    finally { setBusy(false); }
  }

  function begin(candidate: WithoutTimingCandidates["entries"][number]) {
    if (!candidates || candidate.readiness !== "READY") return;
    setLastResult(undefined);
    try { setAttempt(createWithoutTimingAttempt(candidate, candidates)); setAttemptPhase("CONFIRM"); setMessage(sv.withoutTimingConfirmHelp); }
    catch (error) { setMessage(messageFrom(error)); }
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, { method: "DELETE", credentials: "same-origin", headers: { "x-otid-csrf": readWithoutTimingAdminCsrf(document.cookie, new URL(window.location.href)) } });
      if (!response.ok && response.status !== 401) throw new Error(`${sv.withoutTimingLogoutFailed} (${response.status})`);
      setAuthenticated(false); setCandidates(undefined); setLastResult(undefined); setMessage(attempt === undefined ? sv.withoutTimingLoggedOut : `${sv.withoutTimingLoggedOut} ${sv.withoutTimingAttemptRetained}`);
    } catch (error) { setMessage(messageFrom(error)); } finally { setAccessCredential(""); setBusy(false); }
  }

  const readyCount = candidates?.entries.filter((candidate) => candidate.readiness === "READY").length ?? 0;
  return <div className="stack without-timing-admin">
    <div className="without-timing-state-strip" aria-label={sv.withoutTimingStateHeading}>
      <span><strong>{sv.withoutTimingNetworkLabel}:</strong> {online === undefined ? sv.withoutTimingChecking : online ? sv.withoutTimingOnline : sv.withoutTimingOffline}</span>
      <span><strong>{sv.withoutTimingSessionLabel}:</strong> {authenticated === undefined ? sv.withoutTimingSessionUnverified : authenticated ? sv.withoutTimingSessionActive : sv.withoutTimingSessionRequired}</span>
      <span><strong>{sv.withoutTimingReadyCountLabel}:</strong> {authenticated && candidates ? readyCount : "–"}</span>
    </div>
    <section className="without-timing-security-note" aria-label={sv.withoutTimingSecurityHeading}><strong>{sv.withoutTimingSecurityHeading}.</strong> {sv.withoutTimingSecurityBoundary} <strong>{sv.withoutTimingActionWarning}</strong></section>
    {authenticated !== true && <form className="panel stack without-timing-login" onSubmit={(event) => void login(event)}><h2>{sv.withoutTimingLoginHeading}</h2><p className="muted">{sv.withoutTimingLoginHelp}</p><label>{sv.withoutTimingAccessCredential}<input type="password" autoComplete="off" spellCheck={false} value={accessCredential} onChange={(event) => setAccessCredential(event.target.value)} required /></label><button type="submit" disabled={busy || accessCredential.length === 0}>{sv.withoutTimingLogin}</button></form>}
    {authenticated === true && candidates && <section className="panel stack without-timing-data" aria-labelledby="without-timing-data-heading"><div className="without-timing-heading"><div><h2 id="without-timing-data-heading">{sv.withoutTimingDataHeading}</h2><p className="muted">{sv.withoutTimingDataHelp}</p><p className="without-timing-snapshot">{sv.withoutTimingSnapshotVersion}: <strong>{candidates.snapshotVersion}</strong></p></div><button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>{sv.withoutTimingLogout}</button></div><div className="without-timing-list">
      <div className="without-timing-list-head" aria-hidden="true"><span>{sv.withoutTimingParticipantHeading}</span><span>{sv.withoutTimingClass}</span><span>{sv.withoutTimingEntryVersion}</span><span>{sv.withoutTimingTargetRevision}</span><span>{sv.withoutTimingReadinessHeading}</span><span>{sv.withoutTimingActionHeading}</span></div>
      {candidates.entries.map((candidate) => <article className="without-timing-entry" key={candidate.id}>
        <div className="without-timing-person"><h3>{candidate.displayName}</h3><p>{candidate.organisationName ?? "–"}</p></div>
        <p className="without-timing-class"><span className="without-timing-mobile-label">{sv.withoutTimingClass}: </span>{candidate.className}</p>
        <p className="without-timing-version"><span className="without-timing-mobile-label">{sv.withoutTimingEntryVersion}: </span>{candidate.entryVersion}</p>
        <p className="without-timing-target"><span className="without-timing-mobile-label">{sv.withoutTimingTargetRevision}: </span>{candidate.targetResultRevision ? <>{candidate.targetResultRevision.revision} · {candidate.targetResultRevision.status}<small>{sv.publicResultsReasonLabels[candidate.targetResultRevision.reason]}</small></> : "–"}</p>
        <p className="without-timing-readiness"><strong>{readinessText(candidate.readiness)}</strong></p>
        <button type="button" disabled={busy || attempt !== undefined || candidate.readiness !== "READY"} onClick={() => begin(candidate)}>{sv.withoutTimingBegin}</button>
      </article>)}
      {candidates.entries.length === 0 && <p className="without-timing-empty muted">{sv.withoutTimingNoEntries}</p>}
    </div></section>}
    {attempt && attemptPhase === "CONFIRM" && <section className="panel without-timing-confirm stack" role="alert"><h2 ref={confirmRef} tabIndex={-1}>△ {sv.withoutTimingConfirmHeading}</h2><p>{sv.withoutTimingConfirmWarning}</p><dl><dt>{sv.withoutTimingPendingEntry}</dt><dd>{attempt.displayName}</dd><dt>{sv.withoutTimingClass}</dt><dd>{attempt.className}</dd><dt>{sv.withoutTimingPendingRevision}</dt><dd>{attempt.request.expectedResultRevision.revision} · {attempt.request.expectedResultRevision.status} · {sv.publicResultsReasonLabels[attempt.request.expectedResultRevision.reason]}</dd><dt>{sv.withoutTimingPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd></dl><div className="pairing-actions"><button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.withoutTimingConfirm}</button><button type="button" className="secondary danger" disabled={busy} onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.withoutTimingCancel}</button></div></section>}
    {attempt && (attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH") && <section className="panel without-timing-retry stack" role="alert"><h2 ref={retryRef} tabIndex={-1}>△ {attemptPhase === "UNKNOWN" ? sv.withoutTimingUnknownCommit : sv.withoutTimingLoginRequired}</h2><p>{attemptPhase === "UNKNOWN" ? sv.withoutTimingUnknownCommitHelp : sv.withoutTimingLoginAgain}</p><dl><dt>{sv.withoutTimingPendingEntry}</dt><dd>{attempt.displayName}</dd><dt>{sv.withoutTimingClass}</dt><dd>{attempt.className}</dd><dt>{sv.withoutTimingPendingRevision}</dt><dd>{attempt.request.expectedResultRevision.revision} · {attempt.request.expectedResultRevision.status} · {sv.publicResultsReasonLabels[attempt.request.expectedResultRevision.reason]}</dd><dt>{sv.withoutTimingPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd><dt>{sv.withoutTimingPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd></dl><div className="pairing-actions">{authenticated === true && <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.withoutTimingRetrySame}</button>}<button type="button" className="secondary danger" disabled={busy} onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.withoutTimingClearAttempt}</button></div></section>}
    {lastResult && <section className="panel without-timing-result" aria-label={sv.withoutTimingCreated}><p><strong>✓ {lastResult.replayed ? sv.withoutTimingReplayRecovered : sv.withoutTimingCreated}</strong></p><p>{sv.withoutTimingDecisionId}: <span className="pairing-grant-id">{lastResult.withoutTimingDecisionId}</span></p></section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
