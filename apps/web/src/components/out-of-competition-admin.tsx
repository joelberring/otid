"use client";
import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { outOfCompetitionAdminLoginRequestSchema, outOfCompetitionAdminLoginResponseSchema, type OutOfCompetitionResponse } from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { createOutOfCompetitionAttempt, isDefinitiveOutOfCompetitionRejection, parseOutOfCompetitionCandidates, parseOutOfCompetitionResponse, readOutOfCompetitionAdminCsrf, type OutOfCompetitionAttempt, type OutOfCompetitionCandidates } from "../lib/out-of-competition-admin-client";

type AttemptPhase = "CONFIRM" | "UNKNOWN" | "REAUTH";
async function responseJson(response: Response): Promise<unknown> { try { return await response.json() as unknown; } catch { throw new Error(sv.outOfCompetitionInvalidResponse); } }
function messageFrom(error: unknown): string { return error instanceof Error ? error.message : sv.outOfCompetitionUnknownError; }
function readinessText(readiness: OutOfCompetitionCandidates["entries"][number]["readiness"]): string {
  if (readiness === "READY") return `✓ ${sv.outOfCompetitionReady}`;
  const reasons = {
    NO_ACTIVE_RESULT: sv.outOfCompetitionNoActiveResult, UNSUPPORTED_RESULT: sv.outOfCompetitionUnsupportedResult,
    UNPUBLISHED_RESULT: sv.outOfCompetitionUnpublishedResult, STALE_RESULT: sv.outOfCompetitionStaleResult,
    ACTIVE_DID_NOT_START: sv.outOfCompetitionActiveDidNotStart, ACTIVE_DISQUALIFICATION: sv.outOfCompetitionActiveDisqualification,
    ACTIVE_APPROVAL: sv.outOfCompetitionActiveApproval, ACTIVE_DID_NOT_FINISH: sv.outOfCompetitionActiveDidNotFinish,
    ACTIVE_OUT_OF_COMPETITION: sv.outOfCompetitionActiveOutOfCompetition,
    ACTIVE_WITHOUT_TIMING: sv.outOfCompetitionActiveWithoutTiming
  } as const;
  return `△ ${sv.outOfCompetitionBlocked}: ${reasons[readiness]}`;
}

export function OutOfCompetitionAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState(""); const [authenticated, setAuthenticated] = useState<boolean>(); const [candidates, setCandidates] = useState<OutOfCompetitionCandidates>(); const [attempt, setAttempt] = useState<OutOfCompetitionAttempt>(); const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>(); const [lastResult, setLastResult] = useState<OutOfCompetitionResponse>(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string>(sv.outOfCompetitionCheckingSession);
  const [online, setOnline] = useState<boolean>();
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLHeadingElement>(null);
  const sessionUrl = `/api/admin/races/${raceId}/out-of-competition-session`; const candidatesUrl = `/api/admin/races/${raceId}/out-of-competition-candidates`;
  const loadCandidates = useCallback(async () => { const response = await fetch(candidatesUrl, { credentials: "same-origin", cache: "no-store" }); if (response.status === 401 || response.status === 403) { setAuthenticated(false); setCandidates(undefined); setMessage(sv.outOfCompetitionLoginRequired); return false; } if (!response.ok) throw new Error(`${sv.outOfCompetitionSessionFailed} (${response.status})`); setCandidates(parseOutOfCompetitionCandidates(await responseJson(response), raceId)); setAuthenticated(true); setMessage(""); return true; }, [candidatesUrl, raceId]);
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

  async function login(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setMessage(sv.outOfCompetitionLoggingIn); try { const parsed = outOfCompetitionAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential }); if (!parsed.success) throw new Error(sv.outOfCompetitionLoginRejected); const response = await fetch(sessionUrl, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) }); if (!response.ok) throw new Error(response.status === 401 ? sv.outOfCompetitionLoginRejected : `${sv.outOfCompetitionSessionFailed} (${response.status})`); const session = outOfCompetitionAdminLoginResponseSchema.safeParse(await responseJson(response)); if (!session.success || session.data.raceId !== raceId || session.data.capability !== "DECIDE_OUT_OF_COMPETITION") throw new Error(sv.outOfCompetitionInvalidResponse); const loaded = await loadCandidates(); if (loaded && attempt !== undefined) setMessage(sv.outOfCompetitionAttemptRetained); } catch (error) { setMessage(messageFrom(error)); } finally { setAccessCredential(""); setBusy(false); } }

  async function submitAttempt(current: OutOfCompetitionAttempt) { let csrf: string; try { csrf = readOutOfCompetitionAdminCsrf(document.cookie, new URL(window.location.href)); } catch (error) { setAuthenticated(false); setCandidates(undefined); setAttemptPhase("REAUTH"); setMessage(`${messageFrom(error)} ${sv.outOfCompetitionAttemptRetained}`); return; } setBusy(true); setMessage(sv.outOfCompetitionWorking); try { const response = await fetch(`/api/admin/races/${raceId}/entries/${current.entryId}/out-of-competition`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "idempotency-key": `out-of-competition:${current.requestId}`, "x-otid-csrf": csrf }, body: JSON.stringify(current.request) }); if (!response.ok) { if (response.status === 401 || response.status === 403) { setAuthenticated(false); setCandidates(undefined); setAttemptPhase("REAUTH"); setMessage(`${sv.outOfCompetitionFailed} (${response.status}). ${sv.outOfCompetitionLoginAgain} ${sv.outOfCompetitionAttemptRetained}`); return; } if (isDefinitiveOutOfCompetitionRejection(response.status)) { setAttempt(undefined); setAttemptPhase(undefined); if (response.status === 409) try { await loadCandidates(); } catch { setCandidates(undefined); } setMessage(response.status === 409 ? sv.outOfCompetitionConflict : `${sv.outOfCompetitionFailed} (${response.status}).`); return; } throw new Error(`${sv.outOfCompetitionFailed} (${response.status}). ${sv.outOfCompetitionUnknownCommitHelp}`); } const result = parseOutOfCompetitionResponse(await responseJson(response), current, raceId); const success = result.replayed ? sv.outOfCompetitionReplayRecovered : sv.outOfCompetitionCreated; setLastResult(result); setAttempt(undefined); setAttemptPhase(undefined); try { await loadCandidates(); setMessage(success); } catch { setCandidates(undefined); setMessage(`${success} ${sv.outOfCompetitionSessionFailed}.`); } } catch (error) { setAttemptPhase("UNKNOWN"); setMessage(`${messageFrom(error)} ${sv.outOfCompetitionAttemptRetained}`); } finally { setBusy(false); } }
  function begin(candidate: OutOfCompetitionCandidates["entries"][number]) { if (!candidates || candidate.readiness !== "READY") return; setLastResult(undefined); try { setAttempt(createOutOfCompetitionAttempt(candidate, candidates)); setAttemptPhase("CONFIRM"); setMessage(sv.outOfCompetitionConfirmHelp); } catch (error) { setMessage(messageFrom(error)); } }
  async function logout() { setBusy(true); try { const response = await fetch(sessionUrl, { method: "DELETE", credentials: "same-origin", headers: { "x-otid-csrf": readOutOfCompetitionAdminCsrf(document.cookie, new URL(window.location.href)) } }); if (!response.ok && response.status !== 401) throw new Error(`${sv.outOfCompetitionLogoutFailed} (${response.status})`); setAuthenticated(false); setCandidates(undefined); setLastResult(undefined); setMessage(attempt === undefined ? sv.outOfCompetitionLoggedOut : `${sv.outOfCompetitionLoggedOut} ${sv.outOfCompetitionAttemptRetained}`); } catch (error) { setMessage(messageFrom(error)); } finally { setAccessCredential(""); setBusy(false); } }

  const readyCount = candidates?.entries.filter((candidate) => candidate.readiness === "READY").length ?? 0;
  return <div className="stack out-of-competition-admin">
    <div className="out-of-competition-state-strip" aria-label={sv.outOfCompetitionStateHeading}>
      <span><strong>{sv.outOfCompetitionInternetLabel}:</strong> {online === undefined ? sv.outOfCompetitionChecking : online ? sv.outOfCompetitionOnline : sv.outOfCompetitionOffline}</span>
      <span><strong>{sv.outOfCompetitionSessionLabel}:</strong> {authenticated === undefined ? sv.outOfCompetitionChecking : authenticated ? sv.outOfCompetitionSessionActive : sv.outOfCompetitionSessionRequired}</span>
      <span><strong>{sv.outOfCompetitionReadyCountLabel}:</strong> {authenticated && candidates ? readyCount : "–"}</span>
    </div>
    <section className="out-of-competition-security-note" aria-label={sv.outOfCompetitionSecurityHeading}><strong>{sv.outOfCompetitionSecurityHeading}.</strong> {sv.outOfCompetitionSecurityBoundary} <strong>{sv.outOfCompetitionActionWarning}</strong></section>
    {authenticated !== true && <form className="panel stack out-of-competition-login" onSubmit={(event) => void login(event)}><h2>{sv.outOfCompetitionLoginHeading}</h2><p className="muted">{sv.outOfCompetitionLoginHelp}</p><label>{sv.outOfCompetitionAccessCredential}<input type="password" autoComplete="off" spellCheck={false} value={accessCredential} onChange={(event) => setAccessCredential(event.target.value)} required /></label><button type="submit" disabled={busy || accessCredential.length === 0}>{sv.outOfCompetitionLogin}</button></form>}
    {authenticated === true && candidates && <section className="panel stack out-of-competition-data" aria-labelledby="out-of-competition-data-heading"><div className="out-of-competition-heading"><div><h2 id="out-of-competition-data-heading">{sv.outOfCompetitionDataHeading}</h2><p className="muted">{sv.outOfCompetitionDataHelp}</p><p className="out-of-competition-snapshot">{sv.outOfCompetitionSnapshotVersion}: <strong>{candidates.snapshotVersion}</strong></p></div><button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>{sv.outOfCompetitionLogout}</button></div><div className="out-of-competition-list">
      <div className="out-of-competition-list-head" aria-hidden="true"><span>{sv.outOfCompetitionParticipantHeading}</span><span>{sv.outOfCompetitionClass}</span><span>{sv.outOfCompetitionEntryVersion}</span><span>{sv.outOfCompetitionTargetRevision}</span><span>{sv.outOfCompetitionReadinessHeading}</span><span>{sv.outOfCompetitionActionHeading}</span></div>
      {candidates.entries.map((candidate) => <article className="out-of-competition-entry" key={candidate.id}>
        <div className="out-of-competition-person"><h3>{candidate.displayName}</h3><p>{candidate.organisationName ?? "–"}</p></div>
        <p className="out-of-competition-class"><span className="out-of-competition-mobile-label">{sv.outOfCompetitionClass}: </span>{candidate.className}</p>
        <p className="out-of-competition-version"><span className="out-of-competition-mobile-label">{sv.outOfCompetitionEntryVersion}: </span>{candidate.entryVersion}</p>
        <p className="out-of-competition-target"><span className="out-of-competition-mobile-label">{sv.outOfCompetitionTargetRevision}: </span>{candidate.targetResultRevision ? <>{candidate.targetResultRevision.revision} · {candidate.targetResultRevision.status}<small>{sv.publicResultsReasonLabels[candidate.targetResultRevision.reason]}</small></> : "–"}</p>
        <p className={`out-of-competition-readiness ${candidate.readiness === "READY" ? "is-ready" : "is-blocked"}`}><strong>{readinessText(candidate.readiness)}</strong></p>
        <button type="button" disabled={busy || attempt !== undefined || candidate.readiness !== "READY"} onClick={() => begin(candidate)}>{sv.outOfCompetitionBegin}</button>
      </article>)}
      {candidates.entries.length === 0 && <p className="out-of-competition-empty muted">{sv.outOfCompetitionNoEntries}</p>}
    </div></section>}
    {attempt && attemptPhase === "CONFIRM" && <section className="panel out-of-competition-confirm stack" role="alert"><h2 ref={confirmRef} tabIndex={-1}>△ {sv.outOfCompetitionConfirmHeading}</h2><p>{sv.outOfCompetitionConfirmWarning}</p><dl><dt>{sv.outOfCompetitionPendingEntry}</dt><dd>{attempt.displayName}</dd><dt>{sv.outOfCompetitionClass}</dt><dd>{attempt.className}</dd><dt>{sv.outOfCompetitionPendingRevision}</dt><dd>{attempt.request.expectedResultRevision.revision} · {attempt.request.expectedResultRevision.status}</dd><dt>{sv.outOfCompetitionPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd></dl><div className="pairing-actions"><button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.outOfCompetitionConfirm}</button><button type="button" className="secondary danger" disabled={busy} onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.outOfCompetitionCancel}</button></div></section>}
    {attempt && (attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH") && <section className="panel out-of-competition-retry stack" role="alert"><h2 ref={retryRef} tabIndex={-1}>△ {attemptPhase === "UNKNOWN" ? sv.outOfCompetitionUnknownCommit : sv.outOfCompetitionLoginRequired}</h2><p>{attemptPhase === "UNKNOWN" ? sv.outOfCompetitionUnknownCommitHelp : sv.outOfCompetitionLoginAgain}</p><dl><dt>{sv.outOfCompetitionPendingEntry}</dt><dd>{attempt.displayName}</dd><dt>{sv.outOfCompetitionClass}</dt><dd>{attempt.className}</dd><dt>{sv.outOfCompetitionPendingRevision}</dt><dd>{attempt.request.expectedResultRevision.revision} · {attempt.request.expectedResultRevision.status}</dd><dt>{sv.outOfCompetitionPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd><dt>{sv.outOfCompetitionPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd></dl><div className="pairing-actions">{authenticated === true && <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.outOfCompetitionRetrySame}</button>}<button type="button" className="secondary danger" disabled={busy} onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.outOfCompetitionClearAttempt}</button></div></section>}
    {lastResult && <section className="panel out-of-competition-result" aria-label={sv.outOfCompetitionCreated}><p><strong>✓ {lastResult.replayed ? sv.outOfCompetitionReplayRecovered : sv.outOfCompetitionCreated}</strong></p><p>{sv.outOfCompetitionDecisionId}: <span className="pairing-grant-id">{lastResult.notCompetingDecisionId}</span></p></section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
