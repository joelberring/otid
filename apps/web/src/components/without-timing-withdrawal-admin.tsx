"use client";
import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  withoutTimingWithdrawalAdminLoginRequestSchema,
  withoutTimingWithdrawalAdminLoginResponseSchema,
  type WithoutTimingWithdrawalResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  createWithoutTimingWithdrawalAttempt,
  isDefinitiveWithoutTimingWithdrawalRejection,
  parseWithoutTimingWithdrawalResponse,
  parseWithoutTimingWithdrawals,
  readWithoutTimingWithdrawalAdminCsrf,
  type WithoutTimingWithdrawalAttempt,
  type WithoutTimingWithdrawals
} from "../lib/without-timing-withdrawal-admin-client";

type AttemptPhase = "CONFIRM" | "UNKNOWN" | "REAUTH";
async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; }
  catch { throw new Error(sv.withoutTimingWithdrawalInvalidResponse); }
}
function messageFrom(error: unknown): string { return error instanceof TypeError ? sv.withoutTimingWithdrawalUnconfirmedResponse : error instanceof Error ? error.message : sv.withoutTimingWithdrawalUnknownError; }
function stateText(value: WithoutTimingWithdrawals["entries"][number]["state"]): string {
  return value === "WITHDRAWABLE" ? `✓ ${sv.withoutTimingWithdrawalWithdrawable}` : `△ ${sv.withoutTimingWithdrawalWithdrawn}`;
}

function FrozenProvenance({ attempt, showRequestId = false }: { attempt: WithoutTimingWithdrawalAttempt; showRequestId?: boolean }) {
  const request = attempt.request;
  return <dl className="without-timing-withdrawal-provenance">
    <dt>{sv.withoutTimingWithdrawalPendingEntry}</dt><dd>{attempt.displayName}</dd>
    <dt>{sv.withoutTimingWithdrawalClass}</dt><dd>{attempt.className}</dd>
    <dt>{sv.withoutTimingWithdrawalEntryVersion}</dt><dd>{request.expectedEntryVersion}</dd>
    <dt>{sv.withoutTimingWithdrawalDecision}</dt><dd className="pairing-grant-id">{request.expectedWithoutTimingDecisionId}</dd>
    <dt>{sv.withoutTimingWithdrawalDecisionRevision}</dt><dd>{request.expectedWithoutTimingResultRevision.revision}</dd>
    <dt>{sv.withoutTimingWithdrawalAbsoluteHead}</dt><dd>{request.expectedAbsoluteResultRevision.revision}</dd>
    <dt>{sv.withoutTimingWithdrawalPendingSource}</dt><dd><span className="without-timing-withdrawal-source-status" data-status={request.expectedRestorationSourceResultRevision.status}>{request.expectedRestorationSourceResultRevision.revision} · {request.expectedRestorationSourceResultRevision.status} · {sv.publicResultsStatusLabels[request.expectedRestorationSourceResultRevision.status]}</span><small>{sv.publicResultsReasonLabels[request.expectedRestorationSourceResultRevision.reason]}</small></dd>
    <dt>{sv.withoutTimingWithdrawalPendingSnapshot}</dt><dd>{request.expectedSnapshotVersion}</dd>
    {showRequestId && <><dt>{sv.withoutTimingWithdrawalPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd></>}
  </dl>;
}

export function WithoutTimingWithdrawalAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [withdrawals, setWithdrawals] = useState<WithoutTimingWithdrawals>();
  const [attempt, setAttempt] = useState<WithoutTimingWithdrawalAttempt>();
  const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>();
  const [lastResult, setLastResult] = useState<WithoutTimingWithdrawalResponse>();
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean>();
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState<string>(sv.withoutTimingWithdrawalCheckingSession);
  const sessionUrl = `/api/admin/races/${raceId}/without-timing-withdrawal-session`;
  const listUrl = `/api/admin/races/${raceId}/without-timing-withdrawals`;

  const load = useCallback(async () => {
    const response = await fetch(listUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false); setWithdrawals(undefined); setMessage(sv.withoutTimingWithdrawalLoginRequired); return false;
    }
    if (!response.ok) throw new Error(`${sv.withoutTimingWithdrawalSessionFailed} (${response.status})`);
    setWithdrawals(parseWithoutTimingWithdrawals(await responseJson(response), raceId));
    setAuthenticated(true); setMessage(""); return true;
  }, [listUrl, raceId]);
  useEffect(() => { void load().catch((error: unknown) => { setWithdrawals(undefined); setMessage(messageFrom(error)); }); }, [load]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => { window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline); };
  }, []);
  useEffect(() => {
    if (!attempt || busy) return;
    const heading = attemptPhase === "CONFIRM" ? confirmRef.current : attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH" ? retryRef.current : null;
    heading?.scrollIntoView({ block: "start", behavior: "instant" });
    heading?.focus({ preventScroll: true });
  }, [attempt, attemptPhase, busy]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(sv.withoutTimingWithdrawalLoggingIn);
    try {
      const parsed = withoutTimingWithdrawalAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.withoutTimingWithdrawalLoginRejected);
      const response = await fetch(sessionUrl, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (!response.ok) throw new Error(response.status === 401 ? sv.withoutTimingWithdrawalLoginRejected : `${sv.withoutTimingWithdrawalSessionFailed} (${response.status})`);
      const session = withoutTimingWithdrawalAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId || session.data.capability !== "WITHDRAW_WITHOUT_TIMING") throw new Error(sv.withoutTimingWithdrawalInvalidResponse);
      const loaded = await load(); if (loaded && attempt !== undefined) setMessage(sv.withoutTimingWithdrawalAttemptRetained);
    } catch (error) { setMessage(messageFrom(error)); } finally { setAccessCredential(""); setBusy(false); }
  }

  async function submit(current: WithoutTimingWithdrawalAttempt) {
    let csrf: string;
    try { csrf = readWithoutTimingWithdrawalAdminCsrf(document.cookie, new URL(window.location.href)); }
    catch (error) { setAuthenticated(false); setWithdrawals(undefined); setAttemptPhase("REAUTH"); setMessage(`${messageFrom(error)} ${sv.withoutTimingWithdrawalAttemptRetained}`); return; }
    setBusy(true); setMessage(sv.withoutTimingWithdrawalWorking);
    try {
      const response = await fetch(`/api/admin/races/${raceId}/entries/${current.entryId}/without-timing-withdrawal`, {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": `without-timing-withdrawal:${current.requestId}`, "x-otid-csrf": csrf },
        body: JSON.stringify(current.request)
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setAuthenticated(false); setWithdrawals(undefined); setAttemptPhase("REAUTH"); setMessage(`${sv.withoutTimingWithdrawalFailed} (${response.status}). ${sv.withoutTimingWithdrawalLoginAgain} ${sv.withoutTimingWithdrawalAttemptRetained}`); return; }
        if (isDefinitiveWithoutTimingWithdrawalRejection(response.status)) { setAttempt(undefined); setAttemptPhase(undefined); if (response.status === 409) try { await load(); } catch { setWithdrawals(undefined); } setMessage(response.status === 409 ? sv.withoutTimingWithdrawalConflict : `${sv.withoutTimingWithdrawalFailed} (${response.status}).`); return; }
        throw new Error(`${sv.withoutTimingWithdrawalFailed} (${response.status}). ${sv.withoutTimingWithdrawalUnknownCommitHelp}`);
      }
      const result = parseWithoutTimingWithdrawalResponse(await responseJson(response), current, raceId);
      setLastResult(result); setAttempt(undefined); setAttemptPhase(undefined);
      const success = result.replayed ? sv.withoutTimingWithdrawalReplayRecovered : sv.withoutTimingWithdrawalCreated;
      try { await load(); setMessage(success); } catch { setWithdrawals(undefined); setMessage(`${success} ${sv.withoutTimingWithdrawalSessionFailed}.`); }
    } catch (error) { setAttemptPhase("UNKNOWN"); setMessage(`${messageFrom(error)} ${sv.withoutTimingWithdrawalAttemptRetained}`); }
    finally { setBusy(false); }
  }

  function begin(candidate: WithoutTimingWithdrawals["entries"][number]) {
    if (!withdrawals || candidate.state !== "WITHDRAWABLE") return;
    setLastResult(undefined);
    try { setAttempt(createWithoutTimingWithdrawalAttempt(candidate, withdrawals)); setAttemptPhase("CONFIRM"); setMessage(sv.withoutTimingWithdrawalConfirmHelp); }
    catch (error) { setMessage(messageFrom(error)); }
  }
  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, { method: "DELETE", credentials: "same-origin", headers: { "x-otid-csrf": readWithoutTimingWithdrawalAdminCsrf(document.cookie, new URL(window.location.href)) } });
      if (!response.ok && response.status !== 401) throw new Error(`${sv.withoutTimingWithdrawalLogoutFailed} (${response.status})`);
      setAuthenticated(false); setWithdrawals(undefined); setLastResult(undefined); setMessage(attempt === undefined ? sv.withoutTimingWithdrawalLoggedOut : `${sv.withoutTimingWithdrawalLoggedOut} ${sv.withoutTimingWithdrawalAttemptRetained}`);
    } catch (error) { setMessage(messageFrom(error)); } finally { setAccessCredential(""); setBusy(false); }
  }

  const readyCount = withdrawals?.entries.filter((candidate) => candidate.state === "WITHDRAWABLE").length ?? 0;
  return <div className="stack without-timing-withdrawal-admin">
    <div className="without-timing-withdrawal-state-strip" aria-label={sv.withoutTimingWithdrawalStateHeading}>
      <span><strong>{sv.withoutTimingWithdrawalInternetLabel}:</strong> {online === undefined ? sv.withoutTimingWithdrawalChecking : online ? sv.withoutTimingWithdrawalOnline : sv.withoutTimingWithdrawalOffline}</span>
      <span><strong>{sv.withoutTimingWithdrawalSessionLabel}:</strong> {authenticated === undefined ? sv.withoutTimingWithdrawalSessionUnverified : authenticated ? sv.withoutTimingWithdrawalSessionActive : sv.withoutTimingWithdrawalSessionRequired}</span>
      <span><strong>{sv.withoutTimingWithdrawalReadyCountLabel}:</strong> {authenticated && withdrawals ? readyCount : "–"}</span>
    </div>
    <section className="without-timing-withdrawal-security-note" aria-label={sv.withoutTimingWithdrawalSecurityHeading}><strong>{sv.withoutTimingWithdrawalSecurityHeading}.</strong> {sv.withoutTimingWithdrawalSecurityBoundary} <strong>{sv.withoutTimingWithdrawalActionWarning}</strong></section>
    {authenticated !== true && <form className="panel stack without-timing-withdrawal-login" onSubmit={(event) => void login(event)}><h2>{sv.withoutTimingWithdrawalLoginHeading}</h2><p className="muted">{sv.withoutTimingWithdrawalLoginHelp}</p><label>{sv.withoutTimingWithdrawalAccessCredential}<input type="password" autoComplete="off" spellCheck={false} value={accessCredential} onChange={(event) => setAccessCredential(event.target.value)} required /></label><button type="submit" disabled={busy || accessCredential.length === 0}>{sv.withoutTimingWithdrawalLogin}</button></form>}
    {authenticated === true && withdrawals && <section className="panel stack without-timing-withdrawal-data" aria-labelledby="without-timing-withdrawal-data-heading"><div className="without-timing-withdrawal-heading"><div><h2 id="without-timing-withdrawal-data-heading">{sv.withoutTimingWithdrawalDataHeading}</h2><p className="muted">{sv.withoutTimingWithdrawalDataHelp}</p><p className="without-timing-withdrawal-snapshot">{sv.withoutTimingWithdrawalSnapshotVersion}: <strong>{withdrawals.snapshotVersion}</strong></p></div><button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>{sv.withoutTimingWithdrawalLogout}</button></div><div className="without-timing-withdrawal-list">
      <div className="without-timing-withdrawal-list-head" aria-hidden="true"><span>{sv.withoutTimingWithdrawalParticipantHeading}</span><span>{sv.withoutTimingWithdrawalClass}</span><span>{sv.withoutTimingWithdrawalEntryVersion}</span><span>{sv.withoutTimingWithdrawalDecisionRevision}</span><span>{sv.withoutTimingWithdrawalAbsoluteHead}</span><span>{sv.withoutTimingWithdrawalSourceRevision}</span><span>{sv.withoutTimingWithdrawalStatusHeading}</span><span>{sv.withoutTimingWithdrawalActionHeading}</span></div>
      {withdrawals.entries.map((candidate) => <article className="without-timing-withdrawal-entry" key={candidate.id}>
        <div className="without-timing-withdrawal-person"><h3>{candidate.displayName}</h3><p>{candidate.organisationName ?? "–"}</p></div>
        <p><span className="without-timing-withdrawal-mobile-label">{sv.withoutTimingWithdrawalClass}: </span>{candidate.className}</p>
        <p><span className="without-timing-withdrawal-mobile-label">{sv.withoutTimingWithdrawalEntryVersion}: </span>{candidate.entryVersion}</p>
        <p><span className="without-timing-withdrawal-mobile-label">{sv.withoutTimingWithdrawalDecisionRevision}: </span>{candidate.withoutTimingResultRevision.revision}</p>
        <p><span className="without-timing-withdrawal-mobile-label">{sv.withoutTimingWithdrawalAbsoluteHead}: </span>{candidate.absoluteResultRevision.revision}</p>
        <p className="without-timing-withdrawal-source"><span className="without-timing-withdrawal-mobile-label">{sv.withoutTimingWithdrawalSourceRevision}: </span><span className="without-timing-withdrawal-source-status" data-status={candidate.restorationSourceResultRevision.status}>{candidate.restorationSourceResultRevision.revision} · {candidate.restorationSourceResultRevision.status} · {sv.publicResultsStatusLabels[candidate.restorationSourceResultRevision.status]}</span><small>{sv.publicResultsReasonLabels[candidate.restorationSourceResultRevision.reason]}</small></p>
        <p className="without-timing-withdrawal-status"><strong>{stateText(candidate.state)}</strong></p>
        <button type="button" disabled={busy || attempt !== undefined || candidate.state !== "WITHDRAWABLE"} onClick={() => begin(candidate)}>{sv.withoutTimingWithdrawalBegin}</button>
      </article>)}
      {withdrawals.entries.length === 0 && <p className="without-timing-withdrawal-empty muted">{sv.withoutTimingWithdrawalNoEntries}</p>}
    </div></section>}
    {attempt && attemptPhase === "CONFIRM" && <section className="panel without-timing-withdrawal-confirm stack" role="alert"><h2 ref={confirmRef} tabIndex={-1}>△ {sv.withoutTimingWithdrawalConfirmHeading}</h2><p>{sv.withoutTimingWithdrawalConfirmHelp}</p><p><strong>{sv.withoutTimingWithdrawalConfirmWarning}</strong></p><FrozenProvenance attempt={attempt} /><div className="pairing-actions"><button type="button" disabled={busy} onClick={() => void submit(attempt)}>{sv.withoutTimingWithdrawalConfirm}</button><button type="button" className="secondary danger" disabled={busy} onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.withoutTimingWithdrawalCancel}</button></div></section>}
    {attempt && (attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH") && <section className="panel without-timing-withdrawal-retry stack" role="alert"><h2 ref={retryRef} tabIndex={-1}>△ {attemptPhase === "UNKNOWN" ? sv.withoutTimingWithdrawalUnknownCommit : sv.withoutTimingWithdrawalLoginRequired}</h2><p>{attemptPhase === "UNKNOWN" ? sv.withoutTimingWithdrawalUnknownCommitHelp : sv.withoutTimingWithdrawalLoginAgain}</p><FrozenProvenance attempt={attempt} showRequestId /><div className="pairing-actions">{authenticated === true && <button type="button" disabled={busy} onClick={() => void submit(attempt)}>{sv.withoutTimingWithdrawalRetrySame}</button>}<button type="button" className="secondary danger" disabled={busy} onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>{sv.withoutTimingWithdrawalClearAttempt}</button></div></section>}
    {lastResult && <section className="panel without-timing-withdrawal-result" aria-label={sv.withoutTimingWithdrawalCreated}><p><strong>✓ {lastResult.replayed ? sv.withoutTimingWithdrawalReplayRecovered : sv.withoutTimingWithdrawalCreated}</strong></p><p>{sv.withoutTimingWithdrawalId}: <span className="pairing-grant-id">{lastResult.withoutTimingWithdrawalId}</span></p><p>{sv.withoutTimingWithdrawalRestoredRevision}: <span className="pairing-grant-id">{lastResult.restorationResultRevisionId}</span></p></section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
