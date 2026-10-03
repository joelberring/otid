"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  resultDisqualificationAdminLoginRequestSchema,
  resultDisqualificationAdminLoginResponseSchema,
  type ResultDisqualificationResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  createResultDisqualificationAttempt,
  isDefinitiveResultDisqualificationRejection,
  parseResultDisqualificationCandidates,
  parseResultDisqualificationResponse,
  readResultDisqualificationAdminCsrf,
  type ResultDisqualificationAttempt,
  type ResultDisqualificationCandidates
} from "../lib/result-disqualification-admin-client";

type AttemptPhase = "CONFIRM" | "UNKNOWN" | "REAUTH";

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; }
  catch { throw new Error(sv.resultDisqualificationInvalidResponse); }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.resultDisqualificationUnknownError;
}

function readinessText(readiness: ResultDisqualificationCandidates["entries"][number]["readiness"]): string {
  if (readiness === "READY") return `✓ ${sv.resultDisqualificationReady}`;
  const reasons = {
    NO_ACTIVE_RESULT: sv.resultDisqualificationNoActiveResult,
    UNSUPPORTED_RESULT: sv.resultDisqualificationUnsupportedResult,
    UNPUBLISHED_RESULT: sv.resultDisqualificationUnpublishedResult,
    STALE_RESULT: sv.resultDisqualificationStaleResult,
    ACTIVE_DISQUALIFICATION: sv.resultDisqualificationActiveDisqualification,
    ACTIVE_APPROVAL: sv.resultDisqualificationActiveApproval,
    ACTIVE_DID_NOT_FINISH: sv.resultDisqualificationActiveDidNotFinish,
    ACTIVE_OUT_OF_COMPETITION: sv.resultDisqualificationActiveOutOfCompetition,
    ACTIVE_WITHOUT_TIMING: sv.resultDisqualificationActiveWithoutTiming
  } as const;
  return `△ ${sv.resultDisqualificationBlocked}: ${reasons[readiness]}`;
}

export function ResultDisqualificationAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [candidates, setCandidates] = useState<ResultDisqualificationCandidates>();
  const [attempt, setAttempt] = useState<ResultDisqualificationAttempt>();
  const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>();
  const [lastResult, setLastResult] = useState<ResultDisqualificationResponse>();
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean>();
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState<string>(sv.resultDisqualificationCheckingSession);
  const sessionUrl = `/api/admin/races/${raceId}/result-disqualification-session`;
  const candidatesUrl = `/api/admin/races/${raceId}/result-disqualification-candidates`;

  const loadCandidates = useCallback(async () => {
    const response = await fetch(candidatesUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false);
      setCandidates(undefined);
      setMessage(sv.resultDisqualificationLoginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${sv.resultDisqualificationSessionFailed} (${response.status})`);
    setCandidates(parseResultDisqualificationCandidates(await responseJson(response), raceId));
    setAuthenticated(true);
    setMessage("");
    return true;
  }, [candidatesUrl, raceId]);

  useEffect(() => {
    void loadCandidates().catch((error: unknown) => {
      setCandidates(undefined);
      setMessage(messageFrom(error));
    });
  }, [loadCandidates]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (!attempt || busy) return;
    const heading = attemptPhase === "CONFIRM" ? confirmRef.current
      : attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH" ? retryRef.current : null;
    heading?.scrollIntoView({ block: "start" });
    heading?.focus({ preventScroll: true });
  }, [attempt, attemptPhase, busy]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(sv.resultDisqualificationLoggingIn);
    try {
      const parsed = resultDisqualificationAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.resultDisqualificationLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data)
      });
      if (!response.ok) throw new Error(response.status === 401
        ? sv.resultDisqualificationLoginRejected
        : `${sv.resultDisqualificationSessionFailed} (${response.status})`);
      const session = resultDisqualificationAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId || session.data.capability !== "DISQUALIFY_RESULT") {
        throw new Error(sv.resultDisqualificationInvalidResponse);
      }
      const loaded = await loadCandidates();
      if (loaded && attempt !== undefined) setMessage(sv.resultDisqualificationAttemptRetained);
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setAccessCredential(""); setBusy(false); }
  }

  async function submitAttempt(current: ResultDisqualificationAttempt) {
    let csrf: string;
    try { csrf = readResultDisqualificationAdminCsrf(document.cookie, new URL(window.location.href)); }
    catch (error) {
      setAuthenticated(false); setCandidates(undefined); setAttemptPhase("REAUTH");
      setMessage(`${messageFrom(error)} ${sv.resultDisqualificationAttemptRetained}`);
      return;
    }
    setBusy(true);
    setMessage(sv.resultDisqualificationWorking);
    try {
      const response = await fetch(
        `/api/admin/races/${raceId}/entries/${current.entryId}/result-disqualification`,
        {
          method: "POST", credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `manual-disqualification:${current.requestId}`,
            "x-otid-csrf": csrf
          },
          body: JSON.stringify(current.request)
        }
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAuthenticated(false); setCandidates(undefined); setAttemptPhase("REAUTH");
          setMessage(`${sv.resultDisqualificationFailed} (${response.status}). ${sv.resultDisqualificationLoginAgain} ${sv.resultDisqualificationAttemptRetained}`);
          return;
        }
        if (isDefinitiveResultDisqualificationRejection(response.status)) {
          setAttempt(undefined); setAttemptPhase(undefined);
          if (response.status === 409) try { await loadCandidates(); } catch { setCandidates(undefined); }
          setMessage(response.status === 409
            ? sv.resultDisqualificationConflict
            : `${sv.resultDisqualificationFailed} (${response.status}).`);
          return;
        }
        throw new Error(`${sv.resultDisqualificationFailed} (${response.status}). ${sv.resultDisqualificationUnknownCommitHelp}`);
      }
      const result = parseResultDisqualificationResponse(await responseJson(response), current, raceId);
      const successMessage = result.replayed
        ? sv.resultDisqualificationReplayRecovered : sv.resultDisqualificationCreated;
      setLastResult(result); setAttempt(undefined); setAttemptPhase(undefined);
      try { await loadCandidates(); setMessage(successMessage); }
      catch { setCandidates(undefined); setMessage(`${successMessage} ${sv.resultDisqualificationSessionFailed}.`); }
    } catch (error) {
      setAttemptPhase("UNKNOWN");
      setMessage(`${messageFrom(error)} ${sv.resultDisqualificationAttemptRetained}`);
    } finally { setBusy(false); }
  }

  function begin(candidate: ResultDisqualificationCandidates["entries"][number]) {
    if (!candidates || candidate.readiness !== "READY") return;
    setLastResult(undefined);
    try {
      setAttempt(createResultDisqualificationAttempt(candidate, candidates));
      setAttemptPhase("CONFIRM");
      setMessage(sv.resultDisqualificationConfirmHelp);
    } catch (error) { setMessage(messageFrom(error)); }
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE", credentials: "same-origin",
        headers: { "x-otid-csrf": readResultDisqualificationAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`${sv.resultDisqualificationLogoutFailed} (${response.status})`);
      }
      setAuthenticated(false); setCandidates(undefined); setLastResult(undefined);
      setMessage(attempt === undefined ? sv.resultDisqualificationLoggedOut
        : `${sv.resultDisqualificationLoggedOut} ${sv.resultDisqualificationAttemptRetained}`);
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setAccessCredential(""); setBusy(false); }
  }

  const readyCount = candidates?.entries.filter((candidate) => candidate.readiness === "READY").length ?? 0;

  return <div className="stack result-disqualification-admin">
    <div className="result-disqualification-state-strip" aria-label={sv.resultDisqualificationStateHeading}>
      <span><strong>{sv.resultDisqualificationInternetLabel}:</strong> {online === undefined ? sv.resultDisqualificationChecking : online ? sv.resultDisqualificationOnline : sv.resultDisqualificationOffline}</span>
      <span><strong>{sv.resultDisqualificationSessionLabel}:</strong> {authenticated === undefined ? sv.resultDisqualificationChecking : authenticated ? sv.resultDisqualificationSessionActive : sv.resultDisqualificationSessionRequired}</span>
      <span><strong>{sv.resultDisqualificationReadyCountLabel}:</strong> {authenticated && candidates ? readyCount : "–"}</span>
    </div>
    <section className="result-disqualification-security-note" aria-label={sv.resultDisqualificationSecurityHeading}>
      <strong>{sv.resultDisqualificationSecurityHeading}.</strong> {sv.resultDisqualificationSecurityBoundary} <strong>{sv.resultDisqualificationActionWarning}</strong>
    </section>
    {authenticated !== true && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <h2>{sv.resultDisqualificationLoginHeading}</h2>
      <p className="muted">{sv.resultDisqualificationLoginHelp}</p>
      <label>{sv.resultDisqualificationAccessCredential}<input type="password" autoComplete="off"
        spellCheck={false} value={accessCredential} onChange={(event) => setAccessCredential(event.target.value)} required /></label>
      <button type="submit" disabled={busy || accessCredential.length === 0}>{sv.resultDisqualificationLogin}</button>
    </form>}
    {authenticated === true && candidates && <section className="panel stack" aria-labelledby="result-disqualification-data-heading">
      <div className="result-disqualification-heading"><div>
        <h2 id="result-disqualification-data-heading">{sv.resultDisqualificationDataHeading}</h2>
        <p className="muted">{sv.resultDisqualificationDataHelp}</p>
        <p><strong>{sv.resultDisqualificationSnapshotVersion}: {candidates.snapshotVersion}</strong></p>
      </div><button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>
        {sv.resultDisqualificationLogout}</button></div>
      <div className="result-disqualification-list">
        <div className="result-disqualification-list-head" aria-hidden="true">
          <span>{sv.resultDisqualificationParticipantHeading}</span><span>{sv.resultDisqualificationClass}</span>
          <span>{sv.resultDisqualificationVersionHeading}</span><span>{sv.resultDisqualificationReadinessHeading}</span>
          <span>{sv.resultDisqualificationTargetRevision}</span><span>{sv.resultDisqualificationActionHeading}</span>
        </div>
        {candidates.entries.map((candidate) =>
        <article className="result-disqualification-entry" key={candidate.id}>
          <div className="result-disqualification-person"><h3>{candidate.displayName}</h3><p>{candidate.organisationName ?? "–"}</p></div>
          <p className="result-disqualification-class"><span className="result-disqualification-mobile-label">{sv.resultDisqualificationClass}: </span>{candidate.className}</p>
          <p className="result-disqualification-version"><span className="result-disqualification-mobile-label">{sv.resultDisqualificationEntryVersion}: </span>{candidate.entryVersion}</p>
          <p className="result-disqualification-readiness"><strong>{readinessText(candidate.readiness)}</strong></p>
          <p className="result-disqualification-revision"><span className="result-disqualification-mobile-label">{sv.resultDisqualificationTargetRevision}: </span>{candidate.targetResultRevision ? `${candidate.targetResultRevision.revision} · ${candidate.targetResultRevision.status}` : "–"}</p>
          <button type="button" disabled={busy || attempt !== undefined || candidate.readiness !== "READY"}
            onClick={() => begin(candidate)}>{sv.resultDisqualificationBegin}</button>
        </article>)}
        {candidates.entries.length === 0 && <p className="muted">{sv.resultDisqualificationNoEntries}</p>}
      </div>
    </section>}
    {attempt && attemptPhase === "CONFIRM" && <section className="panel result-disqualification-confirm stack" role="alert">
      <h2 ref={confirmRef} tabIndex={-1}>△ {sv.resultDisqualificationConfirmHeading}</h2><p>{sv.resultDisqualificationConfirmWarning}</p>
      <dl><dt>{sv.resultDisqualificationPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.resultDisqualificationClass}</dt><dd>{attempt.className}</dd>
        <dt>{sv.resultDisqualificationPendingRevision}</dt><dd>{attempt.request.expectedResultRevision.revision} · {attempt.request.expectedResultRevision.status}</dd>
        <dt>{sv.resultDisqualificationPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd></dl>
      <div className="pairing-actions"><button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>
        {sv.resultDisqualificationConfirm}</button><button type="button" className="secondary danger" disabled={busy}
        onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.resultDisqualificationCancel}</button></div>
    </section>}
    {attempt && (attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH") && <section className="panel result-disqualification-retry stack" role="alert">
      <h2 ref={retryRef} tabIndex={-1}>△ {attemptPhase === "UNKNOWN" ? sv.resultDisqualificationUnknownCommit : sv.resultDisqualificationLoginRequired}</h2>
      <p>{attemptPhase === "UNKNOWN" ? sv.resultDisqualificationUnknownCommitHelp : sv.resultDisqualificationLoginAgain}</p>
      <dl><dt>{sv.resultDisqualificationPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.resultDisqualificationPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd>
        <dt>{sv.resultDisqualificationPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd></dl>
      <div className="pairing-actions">{authenticated === true && <button type="button" disabled={busy}
        onClick={() => void submitAttempt(attempt)}>{sv.resultDisqualificationRetrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy}
          onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.resultDisqualificationClearAttempt}</button></div>
    </section>}
    {lastResult && <section className="panel result-disqualification-result" aria-label={sv.resultDisqualificationCreated}>
      <p><strong>✓ {lastResult.replayed ? sv.resultDisqualificationReplayRecovered : sv.resultDisqualificationCreated}</strong></p>
      <p>{sv.resultDisqualificationDecisionId}: <span className="pairing-grant-id">{lastResult.resultDisqualificationDecisionId}</span></p>
    </section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
