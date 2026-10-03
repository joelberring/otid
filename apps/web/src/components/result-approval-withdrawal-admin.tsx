"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  resultApprovalWithdrawalAdminLoginRequestSchema,
  resultApprovalWithdrawalAdminLoginResponseSchema,
  type ResultApprovalWithdrawalResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  createResultApprovalWithdrawalAttempt,
  isDefinitiveResultApprovalWithdrawalRejection,
  parseResultApprovalWithdrawalResponse,
  parseResultApprovalWithdrawals,
  readResultApprovalWithdrawalAdminCsrf,
  type ResultApprovalWithdrawalAttempt,
  type ResultApprovalWithdrawals
} from "../lib/result-approval-withdrawal-admin-client";

type AttemptPhase = "CONFIRM" | "UNKNOWN" | "REAUTH";

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; }
  catch { throw new Error(sv.resultApprovalWithdrawalInvalidResponse); }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.resultApprovalWithdrawalUnknownError;
}

function stateText(state: ResultApprovalWithdrawals["entries"][number]["state"]): string {
  return state === "WITHDRAWABLE"
    ? `✓ ${sv.resultApprovalWithdrawalWithdrawable}`
    : `○ ${sv.resultApprovalWithdrawalWithdrawn}`;
}

export function ResultApprovalWithdrawalAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [withdrawals, setWithdrawals] = useState<ResultApprovalWithdrawals>();
  const [attempt, setAttempt] = useState<ResultApprovalWithdrawalAttempt>();
  const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>();
  const [lastResult, setLastResult] = useState<ResultApprovalWithdrawalResponse>();
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean>();
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState<string>(sv.resultApprovalWithdrawalCheckingSession);
  const sessionUrl = `/api/admin/races/${raceId}/result-approval-withdrawal-session`;
  const listUrl = `/api/admin/races/${raceId}/result-approval-withdrawals`;

  const loadWithdrawals = useCallback(async () => {
    const response = await fetch(listUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false); setWithdrawals(undefined);
      setMessage(sv.resultApprovalWithdrawalLoginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${sv.resultApprovalWithdrawalSessionFailed} (${response.status})`);
    setWithdrawals(parseResultApprovalWithdrawals(await responseJson(response), raceId));
    setAuthenticated(true); setMessage("");
    return true;
  }, [listUrl, raceId]);

  useEffect(() => {
    void loadWithdrawals().catch((error: unknown) => {
      setWithdrawals(undefined); setMessage(messageFrom(error));
    });
  }, [loadWithdrawals]);

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
    event.preventDefault(); setBusy(true); setMessage(sv.resultApprovalWithdrawalLoggingIn);
    try {
      const parsed = resultApprovalWithdrawalAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.resultApprovalWithdrawalLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data)
      });
      if (!response.ok) throw new Error(response.status === 401
        ? sv.resultApprovalWithdrawalLoginRejected
        : `${sv.resultApprovalWithdrawalSessionFailed} (${response.status})`);
      const session = resultApprovalWithdrawalAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId || session.data.capability !== "WITHDRAW_RESULT_APPROVAL") {
        throw new Error(sv.resultApprovalWithdrawalInvalidResponse);
      }
      const loaded = await loadWithdrawals();
      if (loaded && attempt !== undefined) setMessage(sv.resultApprovalWithdrawalAttemptRetained);
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setAccessCredential(""); setBusy(false); }
  }

  async function submitAttempt(current: ResultApprovalWithdrawalAttempt) {
    let csrf: string;
    try { csrf = readResultApprovalWithdrawalAdminCsrf(document.cookie, new URL(window.location.href)); }
    catch (error) {
      setAuthenticated(false); setWithdrawals(undefined); setAttemptPhase("REAUTH");
      setMessage(`${messageFrom(error)} ${sv.resultApprovalWithdrawalAttemptRetained}`);
      return;
    }
    setBusy(true); setMessage(sv.resultApprovalWithdrawalWorking);
    try {
      const response = await fetch(
        `/api/admin/races/${raceId}/entries/${current.entryId}/result-approval-withdrawal`,
        {
          method: "POST", credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `manual-result-approval-withdrawal:${current.requestId}`,
            "x-otid-csrf": csrf
          },
          body: JSON.stringify(current.request)
        }
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAuthenticated(false); setWithdrawals(undefined); setAttemptPhase("REAUTH");
          setMessage(`${sv.resultApprovalWithdrawalFailed} (${response.status}). ${sv.resultApprovalWithdrawalLoginAgain} ${sv.resultApprovalWithdrawalAttemptRetained}`);
          return;
        }
        if (isDefinitiveResultApprovalWithdrawalRejection(response.status)) {
          setAttempt(undefined); setAttemptPhase(undefined);
          if (response.status === 409) try { await loadWithdrawals(); } catch { setWithdrawals(undefined); }
          setMessage(response.status === 409
            ? sv.resultApprovalWithdrawalConflict
            : `${sv.resultApprovalWithdrawalFailed} (${response.status}).`);
          return;
        }
        throw new Error(`${sv.resultApprovalWithdrawalFailed} (${response.status}). ${sv.resultApprovalWithdrawalUnknownCommitHelp}`);
      }
      const result = parseResultApprovalWithdrawalResponse(await responseJson(response), current, raceId);
      const successMessage = result.replayed
        ? sv.resultApprovalWithdrawalReplayRecovered : sv.resultApprovalWithdrawalCreated;
      setLastResult(result); setAttempt(undefined); setAttemptPhase(undefined);
      try { await loadWithdrawals(); setMessage(successMessage); }
      catch { setWithdrawals(undefined); setMessage(`${successMessage} ${sv.resultApprovalWithdrawalSessionFailed}.`); }
    } catch (error) {
      setAttemptPhase("UNKNOWN");
      setMessage(`${messageFrom(error)} ${sv.resultApprovalWithdrawalAttemptRetained}`);
    } finally { setBusy(false); }
  }

  function begin(candidate: ResultApprovalWithdrawals["entries"][number]) {
    if (!withdrawals || candidate.state !== "WITHDRAWABLE") return;
    setLastResult(undefined);
    try {
      setAttempt(createResultApprovalWithdrawalAttempt(candidate, withdrawals));
      setAttemptPhase("CONFIRM"); setMessage(sv.resultApprovalWithdrawalConfirmHelp);
    } catch (error) { setMessage(messageFrom(error)); }
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE", credentials: "same-origin",
        headers: { "x-otid-csrf": readResultApprovalWithdrawalAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`${sv.resultApprovalWithdrawalLogoutFailed} (${response.status})`);
      }
      setAuthenticated(false); setWithdrawals(undefined); setLastResult(undefined);
      setMessage(attempt === undefined ? sv.resultApprovalWithdrawalLoggedOut
        : `${sv.resultApprovalWithdrawalLoggedOut} ${sv.resultApprovalWithdrawalAttemptRetained}`);
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setAccessCredential(""); setBusy(false); }
  }

  const readyCount = withdrawals?.entries.filter((candidate) => candidate.state === "WITHDRAWABLE").length ?? 0;

  return <div className="stack result-approval-withdrawal-admin">
    <div className="result-approval-withdrawal-state-strip" aria-label={sv.resultApprovalWithdrawalStateHeading}>
      <span><strong>{sv.resultApprovalWithdrawalInternetLabel}:</strong> {online === undefined ? sv.resultApprovalWithdrawalChecking : online ? sv.resultApprovalWithdrawalOnline : sv.resultApprovalWithdrawalOffline}</span>
      <span><strong>{sv.resultApprovalWithdrawalSessionLabel}:</strong> {authenticated === undefined ? sv.resultApprovalWithdrawalChecking : authenticated ? sv.resultApprovalWithdrawalSessionActive : sv.resultApprovalWithdrawalSessionRequired}</span>
      <span><strong>{sv.resultApprovalWithdrawalReadyCountLabel}:</strong> {authenticated && withdrawals ? readyCount : "–"}</span>
    </div>
    <section className="result-approval-withdrawal-security-note" aria-label={sv.resultApprovalWithdrawalSecurityHeading}>
      <strong>{sv.resultApprovalWithdrawalSecurityHeading}.</strong> {sv.resultApprovalWithdrawalSecurityBoundary} <strong>{sv.resultApprovalWithdrawalActionWarning}</strong>
    </section>
    {authenticated !== true && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <h2>{sv.resultApprovalWithdrawalLoginHeading}</h2>
      <p className="muted">{sv.resultApprovalWithdrawalLoginHelp}</p>
      <label>{sv.resultApprovalWithdrawalAccessCredential}<input type="password" autoComplete="off"
        spellCheck={false} value={accessCredential} onChange={(event) => setAccessCredential(event.target.value)} required /></label>
      <button type="submit" disabled={busy || accessCredential.length === 0}>{sv.resultApprovalWithdrawalLogin}</button>
    </form>}
    {authenticated === true && withdrawals && <section className="panel stack" aria-labelledby="result-approval-withdrawal-data-heading">
      <div className="result-approval-withdrawal-heading"><div>
        <h2 id="result-approval-withdrawal-data-heading">{sv.resultApprovalWithdrawalDataHeading}</h2>
        <p className="muted">{sv.resultApprovalWithdrawalDataHelp}</p>
        <p><strong>{sv.resultApprovalWithdrawalSnapshotVersion}: {withdrawals.snapshotVersion}</strong></p>
      </div><button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>
        {sv.resultApprovalWithdrawalLogout}</button></div>
      <div className="result-approval-withdrawal-list">
        <div className="result-approval-withdrawal-list-head" aria-hidden="true">
          <span>{sv.resultApprovalWithdrawalParticipantHeading}</span>
          <span>{sv.resultApprovalWithdrawalClass} / {sv.resultApprovalWithdrawalEntryVersion}</span>
          <span>{sv.resultApprovalWithdrawalApprovedRevision}</span>
          <span>{sv.resultApprovalWithdrawalAbsoluteHead}</span>
          <span>{sv.resultApprovalWithdrawalSourceRevision}</span>
          <span>{sv.resultApprovalWithdrawalStateColumn}</span>
          <span>{sv.resultApprovalWithdrawalActionHeading}</span>
        </div>
        {withdrawals.entries.map((candidate) =>
        <article className="result-approval-withdrawal-entry"
          key={`${candidate.resultApprovalDecisionId}:${candidate.state}`}>
          <div className="result-approval-withdrawal-person"><h3>{candidate.displayName}</h3><p>{candidate.organisationName ?? "–"}</p></div>
          <p className="result-approval-withdrawal-class"><span className="result-approval-withdrawal-mobile-label">{sv.resultApprovalWithdrawalClass}: </span>{candidate.className}<span className="result-approval-withdrawal-entry-version">{sv.resultApprovalWithdrawalEntryVersion}: {candidate.entryVersion}</span></p>
          <p><span className="result-approval-withdrawal-mobile-label">{sv.resultApprovalWithdrawalApprovedRevision}: </span>{candidate.approvedResultRevision.revision}</p>
          <p><span className="result-approval-withdrawal-mobile-label">{sv.resultApprovalWithdrawalAbsoluteHead}: </span>{candidate.absoluteResultRevision.revision}</p>
          <p><span className="result-approval-withdrawal-mobile-label">{sv.resultApprovalWithdrawalSourceRevision}: </span>{candidate.restorationSourceResultRevision.revision} · {candidate.restorationSourceResultRevision.status}</p>
          <div className="result-approval-withdrawal-state"><strong>{stateText(candidate.state)}</strong>
            {candidate.withdrawal && <small>{sv.resultApprovalWithdrawalWithdrawnAt}: {new Date(candidate.withdrawal.withdrawnAt).toLocaleString("sv-SE")}</small>}
          </div>
          <button type="button" disabled={busy || attempt !== undefined || candidate.state !== "WITHDRAWABLE"}
          onClick={() => begin(candidate)}>{sv.resultApprovalWithdrawalBegin}</button></article>)}
        {withdrawals.entries.length === 0 && <p className="muted">{sv.resultApprovalWithdrawalNoEntries}</p>}
      </div>
    </section>}
    {attempt && attemptPhase === "CONFIRM" && <section className="panel result-approval-withdrawal-confirm stack" role="alert">
      <h2 ref={confirmRef} tabIndex={-1}>△ {sv.resultApprovalWithdrawalConfirmHeading}</h2><p>{sv.resultApprovalWithdrawalConfirmWarning}</p>
      <dl><dt>{sv.resultApprovalWithdrawalPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.resultApprovalWithdrawalClass}</dt><dd>{attempt.className}</dd>
        <dt>{sv.resultApprovalWithdrawalAbsoluteHead}</dt><dd>{attempt.request.expectedAbsoluteResultRevision.revision}</dd>
        <dt>{sv.resultApprovalWithdrawalPendingSource}</dt><dd>{attempt.request.expectedRestorationSourceResultRevision.revision} · {attempt.request.expectedRestorationSourceResultRevision.status}</dd>
        <dt>{sv.resultApprovalWithdrawalPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd></dl>
      <div className="pairing-actions"><button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>
        {sv.resultApprovalWithdrawalConfirm}</button><button type="button" className="secondary danger" disabled={busy}
        onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.resultApprovalWithdrawalCancel}</button></div>
    </section>}
    {attempt && (attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH") && <section className="panel result-approval-withdrawal-retry stack" role="alert">
      <h2 ref={retryRef} tabIndex={-1}>△ {attemptPhase === "UNKNOWN" ? sv.resultApprovalWithdrawalUnknownCommit : sv.resultApprovalWithdrawalLoginRequired}</h2>
      <p>{attemptPhase === "UNKNOWN" ? sv.resultApprovalWithdrawalUnknownCommitHelp : sv.resultApprovalWithdrawalLoginAgain}</p>
      <dl><dt>{sv.resultApprovalWithdrawalPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.resultApprovalWithdrawalPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd>
        <dt>{sv.resultApprovalWithdrawalPendingSource}</dt><dd>{attempt.request.expectedRestorationSourceResultRevision.revision}</dd></dl>
      <div className="pairing-actions">{authenticated === true && <button type="button" disabled={busy}
        onClick={() => void submitAttempt(attempt)}>{sv.resultApprovalWithdrawalRetrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy}
          onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.resultApprovalWithdrawalClearAttempt}</button></div>
    </section>}
    {lastResult && <section className="panel result-approval-withdrawal-result" aria-label={sv.resultApprovalWithdrawalCreated}>
      <p><strong>✓ {lastResult.replayed ? sv.resultApprovalWithdrawalReplayRecovered : sv.resultApprovalWithdrawalCreated}</strong></p>
      <p>{sv.resultApprovalWithdrawalId}: <span className="pairing-grant-id">{lastResult.resultApprovalWithdrawalId}</span></p>
      <p>{sv.resultApprovalWithdrawalRestoredRevision}: {lastResult.revision} · {lastResult.status}</p>
    </section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
