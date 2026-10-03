"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { resultApprovalAdminLoginRequestSchema, resultApprovalAdminLoginResponseSchema, type ResultApprovalResponse } from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { createResultApprovalAttempt, isDefinitiveResultApprovalRejection, parseResultApprovalCandidates, parseResultApprovalResponse, readResultApprovalAdminCsrf, type ResultApprovalAttempt, type ResultApprovalCandidates } from "../lib/result-approval-admin-client";

type AttemptPhase = "CONFIRM" | "UNKNOWN" | "REAUTH";
type Readiness = ResultApprovalCandidates["entries"][number]["readiness"];
type ApprovableReason = "MISSING_CONTROL" | "WRONG_ORDER";

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; }
  catch { throw new Error(sv.resultApprovalInvalidResponse); }
}
function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.resultApprovalUnknownError;
}
function reasonText(reason: ApprovableReason): string {
  return reason === "MISSING_CONTROL" ? sv.resultApprovalMissingControl : sv.resultApprovalWrongOrder;
}
function readinessText(readiness: Readiness): string {
  if (readiness === "READY") return `✓ ${sv.resultApprovalReady}`;
  const reasons: Record<Exclude<Readiness, "READY">, string> = {
    NO_ACTIVE_RESULT: sv.resultApprovalNoActiveResult,
    UNSUPPORTED_RESULT: sv.resultApprovalUnsupportedResult,
    UNPUBLISHED_RESULT: sv.resultApprovalUnpublishedResult,
    STALE_RESULT: sv.resultApprovalStaleResult,
    ACTIVE_APPROVAL: sv.resultApprovalActiveApproval,
    ACTIVE_DISQUALIFICATION: sv.resultApprovalActiveDisqualification,
    ACTIVE_DID_NOT_FINISH: sv.resultApprovalActiveDidNotFinish,
    ACTIVE_OUT_OF_COMPETITION: sv.resultApprovalActiveOutOfCompetition,
    ACTIVE_WITHOUT_TIMING: sv.resultApprovalActiveWithoutTiming
  };
  return `○ ${sv.resultApprovalBlocked}: ${reasons[readiness]}`;
}

export function ResultApprovalAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [candidates, setCandidates] = useState<ResultApprovalCandidates>();
  const [attempt, setAttempt] = useState<ResultApprovalAttempt>();
  const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>();
  const [lastResult, setLastResult] = useState<ResultApprovalResponse>();
  const [busy, setBusy] = useState(false);
  const [browserOnline, setBrowserOnline] = useState<boolean>();
  const [message, setMessage] = useState<string>(sv.resultApprovalCheckingSession);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const sessionUrl = `/api/admin/races/${raceId}/result-approval-session`;
  const candidatesUrl = `/api/admin/races/${raceId}/result-approval-candidates`;

  const loadCandidates = useCallback(async () => {
    const response = await fetch(candidatesUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false); setCandidates(undefined);
      setMessage(sv.resultApprovalLoginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${sv.resultApprovalSessionFailed} (${response.status})`);
    setCandidates(parseResultApprovalCandidates(await responseJson(response), raceId));
    setAuthenticated(true); setMessage("");
    return true;
  }, [candidatesUrl, raceId]);

  useEffect(() => {
    void loadCandidates().catch((error: unknown) => {
      setCandidates(undefined); setMessage(messageFrom(error));
    });
  }, [loadCandidates]);

  useEffect(() => {
    const updateOnline = () => setBrowserOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (!attempt || !attemptPhase) return;
    reviewHeadingRef.current?.focus({ preventScroll: true });
    reviewHeadingRef.current?.scrollIntoView({ block: "start" });
  }, [attempt, attemptPhase]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(sv.resultApprovalLoggingIn);
    try {
      const parsed = resultApprovalAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.resultApprovalLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data)
      });
      if (!response.ok) throw new Error(response.status === 401
        ? sv.resultApprovalLoginRejected : `${sv.resultApprovalSessionFailed} (${response.status})`);
      const session = resultApprovalAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId || session.data.capability !== "APPROVE_RESULT") {
        throw new Error(sv.resultApprovalInvalidResponse);
      }
      const loaded = await loadCandidates();
      if (loaded && attempt !== undefined) setMessage(sv.resultApprovalAttemptRetained);
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setAccessCredential(""); setBusy(false); }
  }

  async function submitAttempt(current: ResultApprovalAttempt) {
    let csrf: string;
    try { csrf = readResultApprovalAdminCsrf(document.cookie, new URL(window.location.href)); }
    catch (error) {
      setAuthenticated(false); setCandidates(undefined); setAttemptPhase("REAUTH");
      setMessage(`${messageFrom(error)} ${sv.resultApprovalAttemptRetained}`);
      return;
    }
    setBusy(true); setMessage(sv.resultApprovalWorking);
    try {
      const response = await fetch(`/api/admin/races/${raceId}/entries/${current.entryId}/result-approval`, {
        method: "POST", credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `manual-result-approval:${current.requestId}`,
          "x-otid-csrf": csrf
        }, body: JSON.stringify(current.request)
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAuthenticated(false); setCandidates(undefined); setAttemptPhase("REAUTH");
          setMessage(`${sv.resultApprovalFailed} (${response.status}). ${sv.resultApprovalLoginAgain} ${sv.resultApprovalAttemptRetained}`);
          return;
        }
        if (isDefinitiveResultApprovalRejection(response.status)) {
          setAttempt(undefined); setAttemptPhase(undefined);
          if (response.status === 409) try { await loadCandidates(); } catch { setCandidates(undefined); }
          setMessage(response.status === 409 ? sv.resultApprovalConflict : `${sv.resultApprovalFailed} (${response.status}).`);
          return;
        }
        throw new Error(`${sv.resultApprovalFailed} (${response.status}). ${sv.resultApprovalUnknownCommitHelp}`);
      }
      const result = parseResultApprovalResponse(await responseJson(response), current, raceId);
      const success = result.replayed ? sv.resultApprovalReplayRecovered : sv.resultApprovalCreated;
      setLastResult(result); setAttempt(undefined); setAttemptPhase(undefined);
      try { await loadCandidates(); setMessage(success); }
      catch { setCandidates(undefined); setMessage(`${success} ${sv.resultApprovalSessionFailed}.`); }
    } catch (error) {
      setAttemptPhase("UNKNOWN");
      setMessage(`${messageFrom(error)} ${sv.resultApprovalAttemptRetained}`);
    } finally { setBusy(false); }
  }

  function begin(candidate: ResultApprovalCandidates["entries"][number]) {
    if (!candidates || candidate.readiness !== "READY") return;
    setLastResult(undefined);
    try {
      setAttempt(createResultApprovalAttempt(candidate, candidates));
      setAttemptPhase("CONFIRM"); setMessage(sv.resultApprovalConfirmHelp);
    } catch (error) { setMessage(messageFrom(error)); }
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE", credentials: "same-origin",
        headers: { "x-otid-csrf": readResultApprovalAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) throw new Error(`${sv.resultApprovalLogoutFailed} (${response.status})`);
      setAuthenticated(false); setCandidates(undefined); setLastResult(undefined);
      setMessage(attempt === undefined ? sv.resultApprovalLoggedOut
        : `${sv.resultApprovalLoggedOut} ${sv.resultApprovalAttemptRetained}`);
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setAccessCredential(""); setBusy(false); }
  }

  const readyCount = candidates?.entries.filter((candidate) => candidate.readiness === "READY").length;
  return <div className="stack result-approval-admin">
    <div className="result-approval-status-strip" aria-label={sv.resultApprovalOverviewStatus}>
      <span><strong>{sv.resultApprovalInternetLabel}</strong> {browserOnline === undefined ? sv.resultApprovalCheckingInternet : browserOnline ? sv.resultApprovalBrowserOnline : sv.resultApprovalBrowserOffline}</span>
      <span><strong>{sv.resultApprovalSessionLabel}</strong> {authenticated === undefined ? sv.resultApprovalCheckingSessionShort : authenticated ? sv.resultApprovalSessionActive : sv.resultApprovalSessionInactive}</span>
      <span><strong>{sv.resultApprovalReadyCountLabel}</strong> {readyCount === undefined ? "–" : readyCount}</span>
    </div>

    <section className="result-approval-security-note" aria-labelledby="result-approval-security-heading">
      <h2 id="result-approval-security-heading">{sv.resultApprovalSecurityHeading}</h2>
      <p>{sv.resultApprovalSecurityBoundary}</p>
      <p className="result-approval-consequence"><strong>{sv.resultApprovalActionWarning}</strong></p>
    </section>

    {authenticated !== true && <form className="panel stack result-approval-login" onSubmit={(event) => void login(event)}>
      <h2>{sv.resultApprovalLoginHeading}</h2>
      <p className="muted">{sv.resultApprovalLoginHelp}</p>
      <label>{sv.resultApprovalAccessCredential}
        <input type="password" autoComplete="off" spellCheck={false} value={accessCredential}
          onChange={(event) => setAccessCredential(event.target.value)} required />
      </label>
      <button type="submit" disabled={busy || accessCredential.length === 0}>{sv.resultApprovalLogin}</button>
    </form>}

    {authenticated === true && candidates && <section className="panel stack result-approval-data" aria-labelledby="result-approval-data-heading">
      <div className="result-approval-heading">
        <div>
          <h2 id="result-approval-data-heading">{sv.resultApprovalDataHeading}</h2>
          <p className="muted">{sv.resultApprovalDataHelp}</p>
          <p className="result-approval-snapshot">{sv.resultApprovalSnapshotVersion}: <strong>{candidates.snapshotVersion}</strong></p>
        </div>
        <button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>{sv.resultApprovalLogout}</button>
      </div>
      <div className="result-approval-list">
        <div className="result-approval-list-head" aria-hidden="true">
          <span>{sv.resultApprovalPendingEntry}</span><span>{sv.resultApprovalOrganisation}</span>
          <span>{sv.resultApprovalClass}</span><span>{sv.resultApprovalEntryVersion}</span>
          <span>{sv.resultApprovalReadinessLabel}</span><span>{sv.resultApprovalTargetRevision}</span><span>{sv.resultApprovalActionLabel}</span>
        </div>
        {candidates.entries.map((candidate) => <article className="result-approval-entry" key={candidate.id}>
          <div className="result-approval-person"><h3>{candidate.displayName}</h3></div>
          <div className="result-approval-organisation"><span className="result-approval-mobile-label">{sv.resultApprovalOrganisation}: </span>{candidate.organisationName ?? "–"}</div>
          <div className="result-approval-class"><span className="result-approval-mobile-label">{sv.resultApprovalClass}: </span>{candidate.className}</div>
          <div className="result-approval-version"><span className="result-approval-mobile-label">{sv.resultApprovalEntryVersion}: </span>{candidate.entryVersion}</div>
          <div className={`result-approval-readiness${candidate.readiness === "READY" ? " is-ready" : " is-blocked"}`}>
            <span className="result-approval-mobile-label">{sv.resultApprovalReadinessLabel}: </span>{readinessText(candidate.readiness)}
          </div>
          <div className="result-approval-source">
            <span className="result-approval-mobile-label">{sv.resultApprovalTargetRevision}: </span>
            {candidate.targetResultRevision
              ? <><strong>{sv.resultApprovalRevisionShort} {candidate.targetResultRevision.revision}</strong> · {reasonText(candidate.targetResultRevision.reason)} <small>({candidate.targetResultRevision.status}/{candidate.targetResultRevision.reason})</small></>
              : "–"}
          </div>
          <button type="button" disabled={busy || attempt !== undefined || candidate.readiness !== "READY"} onClick={() => begin(candidate)}>{sv.resultApprovalBegin}</button>
        </article>)}
        {candidates.entries.length === 0 && <p className="muted">{sv.resultApprovalNoEntries}</p>}
      </div>
    </section>}

    {attempt && attemptPhase === "CONFIRM" && <section className="panel result-approval-confirm stack" role="alert">
      <h2 ref={reviewHeadingRef} tabIndex={-1}>△ {sv.resultApprovalConfirmHeading}</h2>
      <p>{sv.resultApprovalConfirmWarning}</p>
      <dl>
        <dt>{sv.resultApprovalPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.resultApprovalClass}</dt><dd>{attempt.className}</dd>
        <dt>{sv.resultApprovalPendingRevision}</dt><dd>{sv.resultApprovalRevisionShort} {attempt.request.expectedResultRevision.revision} · {reasonText(attempt.request.expectedResultRevision.reason)} <small>({attempt.request.expectedResultRevision.status}/{attempt.request.expectedResultRevision.reason})</small></dd>
        <dt>{sv.resultApprovalPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd>
      </dl>
      <div className="pairing-actions">
        <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.resultApprovalConfirm}</button>
        <button type="button" className="secondary danger" disabled={busy} onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.resultApprovalCancel}</button>
      </div>
    </section>}

    {attempt && (attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH") && <section className="panel result-approval-retry stack" role="alert">
      <h2 ref={reviewHeadingRef} tabIndex={-1}>△ {attemptPhase === "UNKNOWN" ? sv.resultApprovalUnknownCommit : sv.resultApprovalLoginRequired}</h2>
      <p>{attemptPhase === "UNKNOWN" ? sv.resultApprovalUnknownCommitHelp : sv.resultApprovalLoginAgain}</p>
      <dl>
        <dt>{sv.resultApprovalPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.resultApprovalPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd>
        <dt>{sv.resultApprovalPendingRevision}</dt><dd>{sv.resultApprovalRevisionShort} {attempt.request.expectedResultRevision.revision} · {reasonText(attempt.request.expectedResultRevision.reason)} <small>({attempt.request.expectedResultRevision.status}/{attempt.request.expectedResultRevision.reason})</small></dd>
        <dt>{sv.resultApprovalPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd>
      </dl>
      <div className="pairing-actions">
        {authenticated === true && <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.resultApprovalRetrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy} onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.resultApprovalClearAttempt}</button>
      </div>
    </section>}

    {lastResult && <section className="panel result-approval-result" aria-label={sv.resultApprovalCreated}>
      <p><strong>✓ {lastResult.replayed ? sv.resultApprovalReplayRecovered : sv.resultApprovalCreated}</strong></p>
      <p>{sv.resultApprovalDecisionId}: <span className="pairing-grant-id">{lastResult.resultApprovalDecisionId}</span></p>
    </section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
