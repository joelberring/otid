"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { didNotStartAdminLoginRequestSchema, didNotStartAdminLoginResponseSchema, type DidNotStartResponse } from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  createDidNotStartAttempt,
  didNotStartBody,
  isDefinitiveDidNotStartRejection,
  parseDidNotStartCandidates,
  parseDidNotStartResponse,
  readDidNotStartAdminCsrf,
  type DidNotStartAttempt,
  type DidNotStartCandidates
} from "../lib/did-not-start-admin-client";

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; }
  catch { throw new Error(sv.didNotStartInvalidResponse); }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.didNotStartUnknownError;
}

export function DidNotStartAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [candidates, setCandidates] = useState<DidNotStartCandidates>();
  const [attempt, setAttempt] = useState<DidNotStartAttempt>();
  const [lastResult, setLastResult] = useState<DidNotStartResponse>();
  const [busy, setBusy] = useState(false);
  const [unknownCommit, setUnknownCommit] = useState(false);
  const [online, setOnline] = useState<boolean>();
  const retryRef = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState<string>(sv.didNotStartCheckingSession);
  const sessionUrl = `/api/admin/races/${raceId}/did-not-start-session`;
  const candidatesUrl = `/api/admin/races/${raceId}/did-not-start-candidates`;

  const loadCandidates = useCallback(async () => {
    const response = await fetch(candidatesUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false); setCandidates(undefined); setMessage(sv.didNotStartLoginRequired); return false;
    }
    if (!response.ok) throw new Error(`${sv.didNotStartSessionFailed} (${response.status})`);
    setCandidates(parseDidNotStartCandidates(await responseJson(response), raceId));
    setAuthenticated(true); setMessage(""); return true;
  }, [candidatesUrl, raceId]);

  useEffect(() => {
    void loadCandidates().catch((error: unknown) => { setAuthenticated(false); setCandidates(undefined); setMessage(messageFrom(error)); });
  }, [loadCandidates]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => { window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline); };
  }, []);

  useEffect(() => { if (unknownCommit && !busy) retryRef.current?.focus(); }, [unknownCommit, busy]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(sv.didNotStartLoggingIn);
    try {
      const parsed = didNotStartAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.didNotStartLoginRejected);
      const response = await fetch(sessionUrl, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (!response.ok) throw new Error(response.status === 401 ? sv.didNotStartLoginRejected : `${sv.didNotStartSessionFailed} (${response.status})`);
      const session = didNotStartAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId || session.data.capability !== "DECIDE_DID_NOT_START") throw new Error(sv.didNotStartInvalidResponse);
      const loaded = await loadCandidates();
      if (loaded && attempt !== undefined) setMessage(sv.didNotStartAttemptRetained);
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setAccessCredential(""); setBusy(false); }
  }

  async function submitAttempt(current: DidNotStartAttempt) {
    setBusy(true); setUnknownCommit(false); setMessage(sv.didNotStartWorking);
    try {
      const response = await fetch(`/api/admin/races/${raceId}/entries/${current.entryId}/did-not-start`, {
        method: "POST", credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `did-not-start:${current.requestId}`,
          "x-otid-csrf": readDidNotStartAdminCsrf(document.cookie, new URL(window.location.href))
        },
        body: JSON.stringify(didNotStartBody(current))
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setAuthenticated(false); setCandidates(undefined); throw new Error(`${sv.didNotStartFailed} (${response.status}). ${sv.didNotStartLoginAgain}`); }
        if (isDefinitiveDidNotStartRejection(response.status)) {
          setAttempt(undefined);
          if (response.status === 409) { try { await loadCandidates(); } catch { setCandidates(undefined); } }
          setMessage(response.status === 409 ? sv.didNotStartConflict : `${sv.didNotStartFailed} (${response.status}).`); return;
        }
        throw new Error(`${sv.didNotStartFailed} (${response.status}). ${sv.didNotStartUnknownCommitHelp}`);
      }
      const result = parseDidNotStartResponse(await responseJson(response), current, raceId);
      const successMessage = result.replayed ? sv.didNotStartReplayRecovered : sv.didNotStartCreated;
      setLastResult(result); setAttempt(undefined); setUnknownCommit(false);
      try { await loadCandidates(); } catch { setCandidates(undefined); }
      setMessage(successMessage);
    } catch (error) { setUnknownCommit(true); setMessage(`${messageFrom(error)} ${sv.didNotStartAttemptRetained}`); }
    finally { setBusy(false); }
  }

  function beginDecision(entry: DidNotStartCandidates["entries"][number]) {
    if (!candidates || entry.readiness !== "READY") return;
    setLastResult(undefined);
    try {
      const created = createDidNotStartAttempt(entry, candidates);
      setAttempt(created); setUnknownCommit(false); void submitAttempt(created);
    } catch (error) { setMessage(messageFrom(error)); }
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, { method: "DELETE", credentials: "same-origin", headers: { "x-otid-csrf": readDidNotStartAdminCsrf(document.cookie, new URL(window.location.href)) } });
      if (!response.ok && response.status !== 401) throw new Error(`${sv.didNotStartLogoutFailed} (${response.status})`);
      setAuthenticated(false); setCandidates(undefined); setLastResult(undefined);
      setMessage(attempt === undefined ? sv.didNotStartLoggedOut : `${sv.didNotStartLoggedOut} ${sv.didNotStartAttemptRetained}`);
    } catch (error) { setMessage(messageFrom(error)); }
    finally { setAccessCredential(""); setBusy(false); }
  }

  const readyCount = candidates?.entries.filter((entry) => entry.readiness === "READY").length ?? 0;

  return <div className="stack did-not-start-admin">
    <div className="did-not-start-state-strip" aria-label={sv.didNotStartStateHeading}>
      <span><strong>{sv.didNotStartInternetLabel}:</strong> {online === undefined ? sv.didNotStartChecking : online ? sv.didNotStartOnline : sv.didNotStartOffline}</span>
      <span><strong>{sv.didNotStartSessionLabel}:</strong> {authenticated === undefined ? sv.didNotStartChecking : authenticated ? sv.didNotStartSessionActive : sv.didNotStartSessionRequired}</span>
      <span><strong>{sv.didNotStartReadyCountLabel}:</strong> {authenticated && candidates ? readyCount : "–"}</span>
    </div>
    <section className="did-not-start-boundary" aria-label={sv.didNotStartSecurityHeading}><strong>{sv.didNotStartSecurityHeading}.</strong> {sv.didNotStartSecurityBoundary} <strong>{sv.didNotStartActionWarning}</strong></section>
    {authenticated !== true && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <h2>{sv.didNotStartLoginHeading}</h2><p className="muted">{sv.didNotStartLoginHelp}</p>
      <label>{sv.didNotStartAccessCredential}<input type="password" autoComplete="off" spellCheck={false} value={accessCredential} onChange={(event) => setAccessCredential(event.target.value)} required /></label>
      <button type="submit" disabled={busy || accessCredential.length === 0}>{sv.didNotStartLogin}</button>
    </form>}
    {authenticated === true && candidates && <section className="panel stack" aria-labelledby="did-not-start-data-heading">
      <div className="did-not-start-heading"><div><h2 id="did-not-start-data-heading">{sv.didNotStartDataHeading}</h2><p className="muted">{sv.didNotStartDataHelp}</p><p><strong>{sv.didNotStartSnapshotVersion}: {candidates.snapshotVersion}</strong></p></div>
        <button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>{sv.didNotStartLogout}</button></div>
      <div className="did-not-start-list"><div className="did-not-start-list-head" aria-hidden="true"><span>{sv.didNotStartParticipantHeading}</span><span>{sv.didNotStartClass}</span><span>{sv.didNotStartEntryVersion}</span><span>{sv.didNotStartStatusHeading}</span><span>{sv.didNotStartExistingRevision}</span><span>{sv.didNotStartActionHeading}</span></div>{candidates.entries.map((entry) => <article className="did-not-start-entry" key={`${entry.id}:${entry.entryVersion}`}>
        <div className="did-not-start-person"><h3>{entry.displayName}</h3><p>{entry.organisationName ?? "–"}</p></div>
        <p className="did-not-start-class"><span className="did-not-start-mobile-label">{sv.didNotStartClass}: </span>{entry.className}</p>
        <p className="did-not-start-version"><span className="did-not-start-mobile-label">{sv.didNotStartEntryVersion}: </span>{entry.entryVersion}</p>
        <p className="did-not-start-status"><strong>{entry.readiness === "READY" ? sv.didNotStartReady : sv.didNotStartHasResult}</strong></p>
        <p className="did-not-start-revision"><span className="did-not-start-mobile-label">{sv.didNotStartExistingRevision}: </span>{entry.latestResultRevision ? `${entry.latestResultRevision.revision} · ${entry.latestResultRevision.status}` : "–"}</p>
        <button type="button" disabled={busy || attempt !== undefined || entry.readiness !== "READY"} onClick={() => beginDecision(entry)}>{sv.didNotStartMark}</button>
      </article>)}
      {candidates.entries.length === 0 && <p className="muted">{sv.didNotStartNoEntries}</p>}</div>
    </section>}
    {attempt && <section className="panel did-not-start-retry stack" role={unknownCommit ? "alert" : "status"}><h2>{unknownCommit ? sv.didNotStartUnknownCommit : sv.didNotStartWorking}</h2><p>{unknownCommit ? sv.didNotStartUnknownCommitHelp : sv.didNotStartPendingHelp}</p>
      <dl><dt>{sv.didNotStartPendingEntry}</dt><dd>{attempt.displayName}</dd><dt>{sv.didNotStartPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd><dt>{sv.didNotStartPendingSnapshot}</dt><dd>{attempt.expectedSnapshotVersion}</dd></dl>
      {unknownCommit && <div className="pairing-actions">{authenticated === true && <button ref={retryRef} type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>{sv.didNotStartRetrySame}</button>}<button type="button" className="secondary danger" disabled={busy} onClick={() => { setAttempt(undefined); setUnknownCommit(false); setMessage(""); }}>{sv.didNotStartClearAttempt}</button></div>}
    </section>}
    {lastResult && <section className="panel" aria-label={sv.didNotStartCreated}><p><strong>✓ {lastResult.replayed ? sv.didNotStartReplayRecovered : sv.didNotStartCreated}</strong></p><p>{sv.didNotStartRevision}: {lastResult.revision}</p></section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
