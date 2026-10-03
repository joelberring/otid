"use client";
import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { didNotFinishAdminLoginRequestSchema, didNotFinishAdminLoginResponseSchema, type DidNotFinishResponse } from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { createDidNotFinishAttempt, isDefinitiveDidNotFinishRejection, parseDidNotFinishCandidates, parseDidNotFinishResponse, readDidNotFinishAdminCsrf, type DidNotFinishAttempt, type DidNotFinishCandidates } from "../lib/did-not-finish-admin-client";

type AttemptPhase = "CONFIRM" | "UNKNOWN" | "REAUTH";
async function responseJson(response: Response): Promise<unknown> { try { return await response.json() as unknown; } catch { throw new Error(sv.didNotFinishInvalidResponse); } }
function messageFrom(error: unknown): string {
  if (error instanceof TypeError) return sv.didNotFinishNetworkError;
  return error instanceof Error ? error.message : sv.didNotFinishUnknownError;
}
function readinessText(readiness: DidNotFinishCandidates["entries"][number]["readiness"]): string {
  if (readiness === "READY") return `✓ ${sv.didNotFinishReady}`;
  const reasons = {
    NO_ACTIVE_RESULT: sv.didNotFinishNoActiveResult, UNSUPPORTED_RESULT: sv.didNotFinishUnsupportedResult,
    UNPUBLISHED_RESULT: sv.didNotFinishUnpublishedResult, STALE_RESULT: sv.didNotFinishStaleResult,
    ACTIVE_DID_NOT_START: sv.didNotFinishActiveDidNotStart, ACTIVE_DISQUALIFICATION: sv.didNotFinishActiveDisqualification,
    ACTIVE_APPROVAL: sv.didNotFinishActiveApproval, ACTIVE_DID_NOT_FINISH: sv.didNotFinishActiveDidNotFinish,
    ACTIVE_OUT_OF_COMPETITION: sv.didNotFinishActiveOutOfCompetition,
    ACTIVE_WITHOUT_TIMING: sv.didNotFinishActiveWithoutTiming
  } as const;
  return `△ ${sv.didNotFinishBlocked}: ${reasons[readiness]}`;
}

export function DidNotFinishAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState(""); const [authenticated, setAuthenticated] = useState<boolean>(); const [candidates, setCandidates] = useState<DidNotFinishCandidates>(); const [attempt, setAttempt] = useState<DidNotFinishAttempt>(); const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>(); const [lastResult, setLastResult] = useState<DidNotFinishResponse>(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string>(sv.didNotFinishCheckingSession);
  const [online, setOnline] = useState<boolean>();
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLHeadingElement>(null);
  const sessionUrl = `/api/admin/races/${raceId}/did-not-finish-session`; const candidatesUrl = `/api/admin/races/${raceId}/did-not-finish-candidates`;
  const loadCandidates = useCallback(async () => { const response = await fetch(candidatesUrl, { credentials: "same-origin", cache: "no-store" }); if (response.status === 401 || response.status === 403) { setAuthenticated(false); setCandidates(undefined); setMessage(sv.didNotFinishLoginRequired); return false; } if (!response.ok) throw new Error(`${sv.didNotFinishSessionFailed} (${response.status})`); setCandidates(parseDidNotFinishCandidates(await responseJson(response), raceId)); setAuthenticated(true); setMessage(""); return true; }, [candidatesUrl, raceId]);
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
    heading?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, [attempt, attemptPhase, busy]);

  async function login(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setMessage(sv.didNotFinishLoggingIn); try { const parsed = didNotFinishAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential }); if (!parsed.success) throw new Error(sv.didNotFinishLoginRejected); const response = await fetch(sessionUrl, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) }); if (!response.ok) throw new Error(response.status === 401 ? sv.didNotFinishLoginRejected : `${sv.didNotFinishSessionFailed} (${response.status})`); const session = didNotFinishAdminLoginResponseSchema.safeParse(await responseJson(response)); if (!session.success || session.data.raceId !== raceId || session.data.capability !== "DECIDE_DID_NOT_FINISH") throw new Error(sv.didNotFinishInvalidResponse); const loaded = await loadCandidates(); if (loaded && attempt !== undefined) setMessage(sv.didNotFinishAttemptRetained); } catch (error) { setMessage(messageFrom(error)); } finally { setAccessCredential(""); setBusy(false); } }

  async function submitAttempt(current: DidNotFinishAttempt) { let csrf: string; try { csrf = readDidNotFinishAdminCsrf(document.cookie, new URL(window.location.href)); } catch (error) { setAuthenticated(false); setCandidates(undefined); setAttemptPhase("REAUTH"); setMessage(`${messageFrom(error)} ${sv.didNotFinishAttemptRetained}`); return; } setBusy(true); setMessage(sv.didNotFinishWorking); try { const response = await fetch(`/api/admin/races/${raceId}/entries/${current.entryId}/did-not-finish`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": `did-not-finish:${current.requestId}`, "x-otid-csrf": csrf }, body: JSON.stringify(current.request) }); if (!response.ok) { if (response.status === 401 || response.status === 403) { setAuthenticated(false); setCandidates(undefined); setAttemptPhase("REAUTH"); setMessage(`${sv.didNotFinishFailed} (${response.status}). ${sv.didNotFinishLoginAgain} ${sv.didNotFinishAttemptRetained}`); return; } if (isDefinitiveDidNotFinishRejection(response.status)) { setAttempt(undefined); setAttemptPhase(undefined); if (response.status === 409) try { await loadCandidates(); } catch { setCandidates(undefined); } setMessage(response.status === 409 ? sv.didNotFinishConflict : `${sv.didNotFinishFailed} (${response.status}).`); return; } throw new Error(`${sv.didNotFinishFailed} (${response.status}). ${sv.didNotFinishUnknownCommitHelp}`); } const result = parseDidNotFinishResponse(await responseJson(response), current, raceId); const success = result.replayed ? sv.didNotFinishReplayRecovered : sv.didNotFinishCreated; setLastResult(result); setAttempt(undefined); setAttemptPhase(undefined); try { await loadCandidates(); setMessage(success); } catch { setCandidates(undefined); setMessage(`${success} ${sv.didNotFinishSessionFailed}.`); } } catch (error) { setAttemptPhase("UNKNOWN"); setMessage(`${messageFrom(error)} ${sv.didNotFinishAttemptRetained}`); } finally { setBusy(false); } }
  function begin(candidate: DidNotFinishCandidates["entries"][number]) { if (!candidates || candidate.readiness !== "READY") return; setLastResult(undefined); try { setAttempt(createDidNotFinishAttempt(candidate, candidates)); setAttemptPhase("CONFIRM"); setMessage(sv.didNotFinishConfirmHelp); } catch (error) { setMessage(messageFrom(error)); } }
  async function logout() { setBusy(true); try { const response = await fetch(sessionUrl, { method: "DELETE", credentials: "same-origin", headers: { "x-otid-csrf": readDidNotFinishAdminCsrf(document.cookie, new URL(window.location.href)) } }); if (!response.ok && response.status !== 401) throw new Error(`${sv.didNotFinishLogoutFailed} (${response.status})`); setAuthenticated(false); setCandidates(undefined); setLastResult(undefined); setMessage(attempt === undefined ? sv.didNotFinishLoggedOut : `${sv.didNotFinishLoggedOut} ${sv.didNotFinishAttemptRetained}`); } catch (error) { setMessage(messageFrom(error)); } finally { setAccessCredential(""); setBusy(false); } }

  const readyCount = candidates?.entries.filter((candidate) => candidate.readiness === "READY").length ?? 0;

  return <div className="stack did-not-finish-admin">
    <div className="did-not-finish-state-strip" aria-label={sv.didNotFinishStateHeading}>
      <span><strong>{sv.didNotFinishInternetLabel}:</strong> {online === undefined ? sv.didNotFinishChecking : online ? sv.didNotFinishOnline : sv.didNotFinishOffline}</span>
      <span><strong>{sv.didNotFinishSessionLabel}:</strong> {authenticated === undefined ? sv.didNotFinishChecking : authenticated ? sv.didNotFinishSessionActive : sv.didNotFinishSessionRequired}</span>
      <span><strong>{sv.didNotFinishReadyCountLabel}:</strong> {authenticated && candidates ? readyCount : "–"}</span>
    </div>
    <section className="did-not-finish-security-note" aria-label={sv.didNotFinishSecurityHeading}>
      <strong>{sv.didNotFinishSecurityHeading}.</strong> {sv.didNotFinishSecurityBoundary} <strong>{sv.didNotFinishActionWarning}</strong>
    </section>
    {authenticated !== true && <form className="panel stack did-not-finish-login" onSubmit={(event) => void login(event)}>
      <h2>{sv.didNotFinishLoginHeading}</h2><p className="muted">{sv.didNotFinishLoginHelp}</p>
      <label>{sv.didNotFinishAccessCredential}<input type="password" autoComplete="off" spellCheck={false} value={accessCredential} onChange={(event) => setAccessCredential(event.target.value)} required /></label>
      <button type="submit" disabled={busy || accessCredential.length === 0}>{sv.didNotFinishLogin}</button>
    </form>}
    {authenticated === true && candidates && <section className="panel stack did-not-finish-data" aria-labelledby="did-not-finish-data-heading">
      <div className="did-not-finish-heading"><div><h2 id="did-not-finish-data-heading">{sv.didNotFinishDataHeading}</h2><p className="muted">{sv.didNotFinishDataHelp}</p><p className="did-not-finish-snapshot">{sv.didNotFinishSnapshotVersion}: <strong>{candidates.snapshotVersion}</strong></p></div>
        <button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>{sv.didNotFinishLogout}</button></div>
      <div className="did-not-finish-list">
        <div className="did-not-finish-list-head" aria-hidden="true"><span>{sv.didNotFinishParticipantHeading}</span><span>{sv.didNotFinishClass}</span><span>{sv.didNotFinishEntryVersion}</span><span>{sv.didNotFinishTargetRevision}</span><span>{sv.didNotFinishReadinessHeading}</span><span>{sv.didNotFinishActionHeading}</span></div>
        {candidates.entries.map((candidate) => <article className="did-not-finish-entry" key={candidate.id}>
          <div className="did-not-finish-person"><h3>{candidate.displayName}</h3><p>{candidate.organisationName ?? "–"}</p></div>
          <p className="did-not-finish-class"><span className="did-not-finish-mobile-label">{sv.didNotFinishClass}: </span>{candidate.className}</p>
          <p className="did-not-finish-version"><span className="did-not-finish-mobile-label">{sv.didNotFinishEntryVersion}: </span>{candidate.entryVersion}</p>
          <p className="did-not-finish-target"><span className="did-not-finish-mobile-label">{sv.didNotFinishTargetRevision}: </span>{candidate.targetResultRevision ? <>{candidate.targetResultRevision.revision} · {candidate.targetResultRevision.status}<small>{sv.publicResultsReasonLabels[candidate.targetResultRevision.reason]}</small></> : "–"}</p>
          <p className={`did-not-finish-readiness ${candidate.readiness === "READY" ? "is-ready" : "is-blocked"}`}><strong>{readinessText(candidate.readiness)}</strong></p>
          <button type="button" disabled={busy || attempt !== undefined || candidate.readiness !== "READY"} onClick={() => begin(candidate)}>{sv.didNotFinishBegin}</button>
        </article>)}
        {candidates.entries.length === 0 && <p className="did-not-finish-empty muted">{sv.didNotFinishNoEntries}</p>}
      </div>
    </section>}
    {attempt && attemptPhase === "CONFIRM" && <section className="panel did-not-finish-confirm stack" role="alert"><h2 ref={confirmRef} tabIndex={-1}>△ {sv.didNotFinishConfirmHeading}</h2><p>{sv.didNotFinishConfirmWarning}</p><dl><dt>{sv.didNotFinishPendingEntry}</dt><dd>{attempt.displayName}</dd><dt>{sv.didNotFinishClass}</dt><dd>{attempt.className}</dd><dt>{sv.didNotFinishPendingRevision}</dt><dd>{attempt.request.expectedResultRevision.revision} · {attempt.request.expectedResultRevision.status}</dd><dt>{sv.didNotFinishPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd></dl><div className="pairing-actions"><button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.didNotFinishConfirm}</button><button type="button" className="secondary danger" disabled={busy} onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.didNotFinishCancel}</button></div></section>}
    {attempt && (attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH") && <section className="panel did-not-finish-retry stack" role="alert"><h2 ref={retryRef} tabIndex={-1}>△ {attemptPhase === "UNKNOWN" ? sv.didNotFinishUnknownCommit : sv.didNotFinishLoginRequired}</h2><p>{attemptPhase === "UNKNOWN" ? sv.didNotFinishUnknownCommitHelp : sv.didNotFinishLoginAgain}</p><dl><dt>{sv.didNotFinishPendingEntry}</dt><dd>{attempt.displayName}</dd><dt>{sv.didNotFinishPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd></dl><div className="pairing-actions">{authenticated === true && <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.didNotFinishRetrySame}</button>}<button type="button" className="secondary danger" disabled={busy} onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.didNotFinishClearAttempt}</button></div></section>}
    {lastResult && <section className="panel did-not-finish-result" aria-label={sv.didNotFinishCreated}><p><strong>✓ {lastResult.replayed ? sv.didNotFinishReplayRecovered : sv.didNotFinishCreated}</strong></p><p>{sv.didNotFinishDecisionId}: <span className="pairing-grant-id">{lastResult.didNotFinishDecisionId}</span></p></section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
