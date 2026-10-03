"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  resultDisqualificationWithdrawalAdminLoginRequestSchema,
  resultDisqualificationWithdrawalAdminLoginResponseSchema,
  type ResultDisqualificationWithdrawalResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  createResultDisqualificationWithdrawalAttempt,
  isDefinitiveResultDisqualificationWithdrawalRejection,
  parseResultDisqualificationWithdrawalResponse,
  parseResultDisqualificationWithdrawals,
  readResultDisqualificationWithdrawalAdminCsrf,
  type ResultDisqualificationWithdrawalAttempt,
  type ResultDisqualificationWithdrawals
} from "../lib/result-disqualification-withdrawal-admin-client";

type AttemptPhase = "CONFIRM" | "UNKNOWN" | "REAUTH";

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; }
  catch { throw new Error(sv.resultDisqualificationWithdrawalInvalidResponse); }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.resultDisqualificationWithdrawalUnknownError;
}

function stateText(state: ResultDisqualificationWithdrawals["entries"][number]["state"]): string {
  return state === "WITHDRAWABLE"
    ? `✓ ${sv.resultDisqualificationWithdrawalWithdrawable}`
    : `○ ${sv.resultDisqualificationWithdrawalWithdrawn}`;
}

export function ResultDisqualificationWithdrawalAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [withdrawals, setWithdrawals] = useState<ResultDisqualificationWithdrawals>();
  const [attempt, setAttempt] = useState<ResultDisqualificationWithdrawalAttempt>();
  const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>();
  const [lastResult, setLastResult] = useState<ResultDisqualificationWithdrawalResponse>();
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean>();
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState<string>(sv.resultDisqualificationWithdrawalCheckingSession);
  const sessionUrl = `/api/admin/races/${raceId}/result-disqualification-withdrawal-session`;
  const listUrl = `/api/admin/races/${raceId}/result-disqualification-withdrawals`;

  const loadWithdrawals = useCallback(async () => {
    const response = await fetch(listUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false); setWithdrawals(undefined);
      setMessage(sv.resultDisqualificationWithdrawalLoginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${sv.resultDisqualificationWithdrawalSessionFailed} (${response.status})`);
    setWithdrawals(parseResultDisqualificationWithdrawals(await responseJson(response), raceId));
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
    event.preventDefault(); setBusy(true); setMessage(sv.resultDisqualificationWithdrawalLoggingIn);
    try {
      const parsed = resultDisqualificationWithdrawalAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.resultDisqualificationWithdrawalLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data)
      });
      if (!response.ok) throw new Error(response.status === 401
        ? sv.resultDisqualificationWithdrawalLoginRejected
        : `${sv.resultDisqualificationWithdrawalSessionFailed} (${response.status})`);
      const session = resultDisqualificationWithdrawalAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId || session.data.capability !== "WITHDRAW_DISQUALIFICATION") {
        throw new Error(sv.resultDisqualificationWithdrawalInvalidResponse);
      }
      const loaded = await loadWithdrawals();
      if (loaded && attempt !== undefined) setMessage(sv.resultDisqualificationWithdrawalAttemptRetained);
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setAccessCredential(""); setBusy(false); }
  }

  async function submitAttempt(current: ResultDisqualificationWithdrawalAttempt) {
    let csrf: string;
    try { csrf = readResultDisqualificationWithdrawalAdminCsrf(document.cookie, new URL(window.location.href)); }
    catch (error) {
      setAuthenticated(false); setWithdrawals(undefined); setAttemptPhase("REAUTH");
      setMessage(`${messageFrom(error)} ${sv.resultDisqualificationWithdrawalAttemptRetained}`);
      return;
    }
    setBusy(true); setMessage(sv.resultDisqualificationWithdrawalWorking);
    try {
      const response = await fetch(
        `/api/admin/races/${raceId}/entries/${current.entryId}/result-disqualification-withdrawal`,
        {
          method: "POST", credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `manual-disqualification-withdrawal:${current.requestId}`,
            "x-otid-csrf": csrf
          },
          body: JSON.stringify(current.request)
        }
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAuthenticated(false); setWithdrawals(undefined); setAttemptPhase("REAUTH");
          setMessage(`${sv.resultDisqualificationWithdrawalFailed} (${response.status}). ${sv.resultDisqualificationWithdrawalLoginAgain} ${sv.resultDisqualificationWithdrawalAttemptRetained}`);
          return;
        }
        if (isDefinitiveResultDisqualificationWithdrawalRejection(response.status)) {
          setAttempt(undefined); setAttemptPhase(undefined);
          if (response.status === 409) try { await loadWithdrawals(); } catch { setWithdrawals(undefined); }
          setMessage(response.status === 409
            ? sv.resultDisqualificationWithdrawalConflict
            : `${sv.resultDisqualificationWithdrawalFailed} (${response.status}).`);
          return;
        }
        throw new Error(`${sv.resultDisqualificationWithdrawalFailed} (${response.status}). ${sv.resultDisqualificationWithdrawalUnknownCommitHelp}`);
      }
      const result = parseResultDisqualificationWithdrawalResponse(await responseJson(response), current, raceId);
      const successMessage = result.replayed
        ? sv.resultDisqualificationWithdrawalReplayRecovered : sv.resultDisqualificationWithdrawalCreated;
      setLastResult(result); setAttempt(undefined); setAttemptPhase(undefined);
      try { await loadWithdrawals(); setMessage(successMessage); }
      catch { setWithdrawals(undefined); setMessage(`${successMessage} ${sv.resultDisqualificationWithdrawalSessionFailed}.`); }
    } catch (error) {
      setAttemptPhase("UNKNOWN");
      setMessage(`${messageFrom(error)} ${sv.resultDisqualificationWithdrawalAttemptRetained}`);
    } finally { setBusy(false); }
  }

  function begin(candidate: ResultDisqualificationWithdrawals["entries"][number]) {
    if (!withdrawals || candidate.state !== "WITHDRAWABLE") return;
    setLastResult(undefined);
    try {
      setAttempt(createResultDisqualificationWithdrawalAttempt(candidate, withdrawals));
      setAttemptPhase("CONFIRM"); setMessage(sv.resultDisqualificationWithdrawalConfirmHelp);
    } catch (error) { setMessage(messageFrom(error)); }
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE", credentials: "same-origin",
        headers: { "x-otid-csrf": readResultDisqualificationWithdrawalAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`${sv.resultDisqualificationWithdrawalLogoutFailed} (${response.status})`);
      }
      setAuthenticated(false); setWithdrawals(undefined); setLastResult(undefined);
      setMessage(attempt === undefined ? sv.resultDisqualificationWithdrawalLoggedOut
        : `${sv.resultDisqualificationWithdrawalLoggedOut} ${sv.resultDisqualificationWithdrawalAttemptRetained}`);
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setAccessCredential(""); setBusy(false); }
  }

  const readyCount = withdrawals?.entries.filter((candidate) => candidate.state === "WITHDRAWABLE").length ?? 0;

  return <div className="stack result-disqualification-withdrawal-admin">
    <div className="result-disqualification-withdrawal-state-strip" aria-label={sv.resultDisqualificationWithdrawalStateHeading}>
      <span><strong>{sv.resultDisqualificationWithdrawalInternetLabel}:</strong> {online === undefined ? sv.resultDisqualificationWithdrawalChecking : online ? sv.resultDisqualificationWithdrawalOnline : sv.resultDisqualificationWithdrawalOffline}</span>
      <span><strong>{sv.resultDisqualificationWithdrawalSessionLabel}:</strong> {authenticated === undefined ? sv.resultDisqualificationWithdrawalChecking : authenticated ? sv.resultDisqualificationWithdrawalSessionActive : sv.resultDisqualificationWithdrawalSessionRequired}</span>
      <span><strong>{sv.resultDisqualificationWithdrawalReadyCountLabel}:</strong> {authenticated && withdrawals ? readyCount : "–"}</span>
    </div>
    <section className="result-disqualification-withdrawal-security-note" aria-label={sv.resultDisqualificationWithdrawalSecurityHeading}>
      <strong>{sv.resultDisqualificationWithdrawalSecurityHeading}.</strong> {sv.resultDisqualificationWithdrawalSecurityBoundary} <strong>{sv.resultDisqualificationWithdrawalActionWarning}</strong>
    </section>
    {authenticated !== true && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <h2>{sv.resultDisqualificationWithdrawalLoginHeading}</h2>
      <p className="muted">{sv.resultDisqualificationWithdrawalLoginHelp}</p>
      <label>{sv.resultDisqualificationWithdrawalAccessCredential}<input type="password" autoComplete="off"
        spellCheck={false} value={accessCredential} onChange={(event) => setAccessCredential(event.target.value)} required /></label>
      <button type="submit" disabled={busy || accessCredential.length === 0}>{sv.resultDisqualificationWithdrawalLogin}</button>
    </form>}
    {authenticated === true && withdrawals && <section className="panel stack" aria-labelledby="result-disqualification-withdrawal-data-heading">
      <div className="result-disqualification-withdrawal-heading"><div>
        <h2 id="result-disqualification-withdrawal-data-heading">{sv.resultDisqualificationWithdrawalDataHeading}</h2>
        <p className="muted">{sv.resultDisqualificationWithdrawalDataHelp}</p>
        <p><strong>{sv.resultDisqualificationWithdrawalSnapshotVersion}: {withdrawals.snapshotVersion}</strong></p>
      </div><button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>
        {sv.resultDisqualificationWithdrawalLogout}</button></div>
      <div className="result-disqualification-withdrawal-list">
        <div className="result-disqualification-withdrawal-list-head" aria-hidden="true">
          <span>{sv.resultDisqualificationWithdrawalParticipantHeading}</span>
          <span>{sv.resultDisqualificationWithdrawalClass} / {sv.resultDisqualificationWithdrawalEntryVersion}</span>
          <span>{sv.resultDisqualificationWithdrawalDsqRevision}</span>
          <span>{sv.resultDisqualificationWithdrawalAbsoluteHead}</span>
          <span>{sv.resultDisqualificationWithdrawalSourceRevision}</span>
          <span>{sv.resultDisqualificationWithdrawalStateColumn}</span>
          <span>{sv.resultDisqualificationWithdrawalActionHeading}</span>
        </div>
        {withdrawals.entries.map((candidate) =>
        <article className="result-disqualification-withdrawal-entry"
          key={`${candidate.resultDisqualificationDecisionId}:${candidate.state}`}>
          <div className="result-disqualification-withdrawal-person"><h3>{candidate.displayName}</h3><p>{candidate.organisationName ?? "–"}</p></div>
          <p className="result-disqualification-withdrawal-class"><span className="result-disqualification-withdrawal-mobile-label">{sv.resultDisqualificationWithdrawalClass}: </span>{candidate.className}<span className="result-disqualification-withdrawal-entry-version"> · {sv.resultDisqualificationWithdrawalEntryVersion}: {candidate.entryVersion}</span></p>
          <p><span className="result-disqualification-withdrawal-mobile-label">{sv.resultDisqualificationWithdrawalDsqRevision}: </span>{candidate.disqualifiedResultRevision.revision}</p>
          <p><span className="result-disqualification-withdrawal-mobile-label">{sv.resultDisqualificationWithdrawalAbsoluteHead}: </span>{candidate.absoluteResultRevision.revision}</p>
          <p><span className="result-disqualification-withdrawal-mobile-label">{sv.resultDisqualificationWithdrawalSourceRevision}: </span>{candidate.restorationSourceResultRevision.revision} · {candidate.restorationSourceResultRevision.status}</p>
          <div className="result-disqualification-withdrawal-state"><strong>{stateText(candidate.state)}</strong>
            {candidate.withdrawal && <small>{sv.resultDisqualificationWithdrawalWithdrawnAt}: {new Date(candidate.withdrawal.withdrawnAt).toLocaleString("sv-SE")}</small>}
          </div>
          <button type="button" disabled={busy || attempt !== undefined || candidate.state !== "WITHDRAWABLE"}
            onClick={() => begin(candidate)}>{sv.resultDisqualificationWithdrawalBegin}</button>
        </article>)}
        {withdrawals.entries.length === 0 && <p className="muted">{sv.resultDisqualificationWithdrawalNoEntries}</p>}
      </div>
    </section>}
    {attempt && attemptPhase === "CONFIRM" && <section className="panel result-disqualification-withdrawal-confirm stack" role="alert">
      <h2 ref={confirmRef} tabIndex={-1}>△ {sv.resultDisqualificationWithdrawalConfirmHeading}</h2><p>{sv.resultDisqualificationWithdrawalConfirmWarning}</p>
      <dl><dt>{sv.resultDisqualificationWithdrawalPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.resultDisqualificationWithdrawalClass}</dt><dd>{attempt.className}</dd>
        <dt>{sv.resultDisqualificationWithdrawalPendingSource}</dt><dd>{attempt.request.expectedRestorationSourceResultRevision.revision} · {attempt.request.expectedRestorationSourceResultRevision.status}</dd>
        <dt>{sv.resultDisqualificationWithdrawalPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd></dl>
      <div className="pairing-actions"><button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>
        {sv.resultDisqualificationWithdrawalConfirm}</button><button type="button" className="secondary danger" disabled={busy}
        onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.resultDisqualificationWithdrawalCancel}</button></div>
    </section>}
    {attempt && (attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH") && <section className="panel result-disqualification-withdrawal-retry stack" role="alert">
      <h2 ref={retryRef} tabIndex={-1}>△ {attemptPhase === "UNKNOWN" ? sv.resultDisqualificationWithdrawalUnknownCommit : sv.resultDisqualificationWithdrawalLoginRequired}</h2>
      <p>{attemptPhase === "UNKNOWN" ? sv.resultDisqualificationWithdrawalUnknownCommitHelp : sv.resultDisqualificationWithdrawalLoginAgain}</p>
      <dl><dt>{sv.resultDisqualificationWithdrawalPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.resultDisqualificationWithdrawalPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd>
        <dt>{sv.resultDisqualificationWithdrawalPendingSource}</dt><dd>{attempt.request.expectedRestorationSourceResultRevision.revision} · {attempt.request.expectedRestorationSourceResultRevision.status}</dd>
        <dt>{sv.resultDisqualificationWithdrawalPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd></dl>
      <div className="pairing-actions">{authenticated === true && <button type="button" disabled={busy}
        onClick={() => void submitAttempt(attempt)}>{sv.resultDisqualificationWithdrawalRetrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy}
          onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.resultDisqualificationWithdrawalClearAttempt}</button></div>
    </section>}
    {lastResult && <section className="panel result-disqualification-withdrawal-result" aria-label={sv.resultDisqualificationWithdrawalCreated}>
      <p><strong>✓ {lastResult.replayed ? sv.resultDisqualificationWithdrawalReplayRecovered : sv.resultDisqualificationWithdrawalCreated}</strong></p>
      <p>{sv.resultDisqualificationWithdrawalId}: <span className="pairing-grant-id">{lastResult.resultDisqualificationWithdrawalId}</span></p>
      <p>{sv.resultDisqualificationWithdrawalRestoredRevision}: {lastResult.revision} · {lastResult.status}</p>
    </section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
