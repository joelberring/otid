"use client";

import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  resultFinalizationAdminLoginRequestSchema,
  resultFinalizationAdminLoginResponseSchema,
  type ResultFinalizationBlockerCode,
  type ResultFinalizationResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  createClassFinalizationAttempt,
  createRaceFinalizationAttempt,
  isDefinitiveResultFinalizationRejection,
  parseResultFinalizationCandidates,
  parseResultFinalizationResponse,
  readResultFinalizationAdminCsrf,
  type ResultFinalizationAttempt,
  type ResultFinalizationCandidates
} from "../lib/result-finalization-admin-client";

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; } catch { throw new Error(sv.resultFinalizationInvalidResponse); }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.resultFinalizationUnknownError;
}

function Blockers({ codes }: { codes: readonly ResultFinalizationBlockerCode[] }) {
  if (codes.length === 0) return null;
  return <ul className="result-finalization-blockers">
    {codes.map((code) => <li key={code}>{sv.resultFinalizationBlockers[code]}</li>)}
  </ul>;
}

export function ResultFinalizationAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [online, setOnline] = useState<boolean>();
  const [candidates, setCandidates] = useState<ResultFinalizationCandidates>();
  const [attempt, setAttempt] = useState<ResultFinalizationAttempt>();
  const [lastResult, setLastResult] = useState<ResultFinalizationResponse>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(sv.resultFinalizationCheckingSession);
  const sessionUrl = `/api/admin/races/${raceId}/result-finalization-session`;
  const candidatesUrl = `/api/admin/races/${raceId}/result-finalizations/candidates`;
  const finalizationsUrl = `/api/admin/races/${raceId}/result-finalizations`;

  const loadCandidates = useCallback(async () => {
    const response = await fetch(candidatesUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false); setCandidates(undefined); setMessage(sv.resultFinalizationLoginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${sv.resultFinalizationSessionFailed} (${response.status})`);
    setCandidates(parseResultFinalizationCandidates(await responseJson(response), raceId));
    setAuthenticated(true); setMessage("");
    return true;
  }, [candidatesUrl, raceId]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline(); window.addEventListener("online", updateOnline); window.addEventListener("offline", updateOnline);
    return () => { window.removeEventListener("online", updateOnline); window.removeEventListener("offline", updateOnline); };
  }, []);

  useEffect(() => {
    void loadCandidates().catch((error: unknown) => { setCandidates(undefined); setMessage(messageFrom(error)); });
  }, [loadCandidates]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(sv.resultFinalizationLoggingIn);
    try {
      const body = resultFinalizationAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!body.success) throw new Error(sv.resultFinalizationLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify(body.data)
      });
      if (!response.ok) throw new Error(response.status === 401
        ? sv.resultFinalizationLoginRejected : `${sv.resultFinalizationSessionFailed} (${response.status})`);
      const session = resultFinalizationAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId || session.data.capability !== "FINALIZE_RESULTS") {
        throw new Error(sv.resultFinalizationInvalidResponse);
      }
      const loaded = await loadCandidates();
      if (loaded && attempt) setMessage(sv.resultFinalizationAttemptRetained);
    } catch (error) { setMessage(messageFrom(error)); } finally { setAccessCredential(""); setBusy(false); }
  }

  async function submitAttempt(current: ResultFinalizationAttempt) {
    setBusy(true); setMessage(sv.resultFinalizationWorking);
    try {
      const response = await fetch(finalizationsUrl, {
        method: "POST", credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `result-finalization:${current.requestId}`,
          "x-otid-csrf": readResultFinalizationAdminCsrf(document.cookie, new URL(window.location.href))
        },
        body: JSON.stringify(current.request)
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAuthenticated(false); setCandidates(undefined);
          throw new Error(`${sv.resultFinalizationFailed} (${response.status}). ${sv.resultFinalizationLoginAgain}`);
        }
        if (isDefinitiveResultFinalizationRejection(response.status)) {
          setAttempt(undefined);
          if (response.status === 409) {
            try { await loadCandidates(); } catch { setCandidates(undefined); }
          }
          setMessage(response.status === 409
            ? sv.resultFinalizationConflict : `${sv.resultFinalizationFailed} (${response.status}).`);
          return;
        }
        throw new Error(`${sv.resultFinalizationFailed} (${response.status}). ${sv.resultFinalizationUnknownCommitHelp}`);
      }
      const result = parseResultFinalizationResponse(await responseJson(response), current, raceId);
      setLastResult(result); setAttempt(undefined);
      const confirmed = result.replayed ? sv.resultFinalizationReplayRecovered : sv.resultFinalizationCreated;
      setMessage(confirmed);
      try { await loadCandidates(); setMessage(confirmed); } catch {
        setCandidates(undefined); setMessage(`${confirmed} ${sv.resultFinalizationSessionFailed}.`);
      }
    } catch (error) {
      setMessage(`${messageFrom(error)} ${sv.resultFinalizationAttemptRetained}`);
    } finally { setBusy(false); }
  }

  async function beginClass(classId: string) {
    if (!candidates) return;
    setLastResult(undefined);
    try {
      const created = createClassFinalizationAttempt(candidates, classId);
      setAttempt(created); await submitAttempt(created);
    } catch (error) { setMessage(messageFrom(error)); }
  }

  async function beginRace() {
    if (!candidates) return;
    setLastResult(undefined);
    try {
      const created = createRaceFinalizationAttempt(candidates);
      setAttempt(created); await submitAttempt(created);
    } catch (error) { setMessage(messageFrom(error)); }
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE", credentials: "same-origin",
        headers: { "x-otid-csrf": readResultFinalizationAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`${sv.resultFinalizationLogoutFailed} (${response.status})`);
      }
      setAuthenticated(false); setCandidates(undefined); setLastResult(undefined);
      setMessage(attempt ? `${sv.resultFinalizationLoggedOut} ${sv.resultFinalizationAttemptRetained}` : sv.resultFinalizationLoggedOut);
    } catch (error) { setMessage(messageFrom(error)); } finally { setAccessCredential(""); setBusy(false); }
  }

  async function copyPublicRaceFinalizationLink(finalizationId: string) {
    const path = `/results/${encodeURIComponent(raceId)}/finalizations/${encodeURIComponent(finalizationId)}`;
    if (!navigator.clipboard?.writeText) {
      setMessage(sv.resultFinalizationPublicLinkCopyFailed);
      return;
    }
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setMessage(sv.resultFinalizationPublicLinkCopied);
    } catch {
      setMessage(sv.resultFinalizationPublicLinkCopyFailed);
    }
  }

  const raceReady = candidates?.race.blockerCodes.length === 0;
  const onlineText = online === true ? `✓ ${sv.resultFinalizationInternetOnline}`
    : online === false ? `△ ${sv.resultFinalizationInternetOffline}` : `… ${sv.resultFinalizationInternetChecking}`;
  const sessionText = authenticated === true ? `✓ ${sv.resultFinalizationSessionActive}`
    : authenticated === false ? `△ ${sv.resultFinalizationSessionRequired}` : `… ${sv.resultFinalizationSessionChecking}`;
  const readinessText = candidates ? `${raceReady ? "✓" : "△"} ${raceReady
    ? sv.resultFinalizationReady : sv.resultFinalizationBlocked}` : `… ${sv.resultFinalizationReadinessUnknown}`;

  return <div className="stack result-finalization-admin">
    <section className="panel result-finalization-security-note">
      <h2>{sv.resultFinalizationSecurityHeading}</h2><p>{sv.resultFinalizationSecurityBoundary}</p>
      <p><strong>{sv.resultFinalizationActionWarning}</strong></p>
    </section>
    <section className="status-grid" aria-label={sv.resultFinalizationOperationalStatus}>
      <div className="status"><strong>{sv.resultFinalizationInternetLabel}</strong><span>{onlineText}</span></div>
      <div className="status"><strong>{sv.resultFinalizationSessionLabel}</strong><span>{sessionText}</span></div>
      <div className="status"><strong>{sv.resultFinalizationReadinessLabel}</strong><span>{readinessText}</span></div>
    </section>

    {authenticated !== true && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <h2>{sv.resultFinalizationLoginHeading}</h2><p className="muted">{sv.resultFinalizationLoginHelp}</p>
      <label>{sv.resultFinalizationAccessCredential}<input type="password" autoComplete="off" spellCheck={false}
        value={accessCredential} onChange={(event) => setAccessCredential(event.target.value)} required /></label>
      <button type="submit" disabled={busy || accessCredential.length === 0}>{sv.resultFinalizationLogin}</button>
    </form>}

    {authenticated === true && candidates && <>
      <section className="panel stack">
        <div className="result-finalization-heading"><div><h2>{sv.resultFinalizationDataHeading}</h2>
          <p className="muted">{sv.resultFinalizationDataHelp}</p>
          <p><strong>{sv.resultFinalizationSnapshotVersion}: {candidates.snapshotVersion}</strong></p></div>
          <button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>
            {sv.resultFinalizationLogout}
          </button></div>
        <div className="result-finalization-list">
          {candidates.classes.map((candidate) => <article className="result-finalization-scope" key={candidate.classId}>
            <div className="result-finalization-scope-name"><h3>{sv.resultFinalizationClassScope}: {candidate.className}</h3>
              <p>{sv.resultFinalizationEntries}: <strong>{candidate.entryCount}</strong></p>
            </div>
            <div className="result-finalization-scope-state">
              <p><strong>{candidate.blockerCodes.length === 0
                ? `✓ ${sv.resultFinalizationClassReady}` : `△ ${sv.resultFinalizationClassBlocked}`}</strong></p>
              <Blockers codes={candidate.blockerCodes} />
              <p className="muted">{sv.resultFinalizationLatest}: {candidate.latestFinalization
                ? `${sv.resultFinalizationRevision} ${candidate.latestFinalization.scopeRevision}, ${new Date(candidate.latestFinalization.finalizedAt).toLocaleString("sv-SE")}`
                : sv.resultFinalizationNoPrevious}</p>
            </div>
            <button type="button" disabled={busy || attempt !== undefined || candidate.blockerCodes.length > 0}
              onClick={() => void beginClass(candidate.classId)}>{sv.resultFinalizationFinalizeClass}</button>
          </article>)}
        </div>
      </section>
      <section className="panel stack result-finalization-race">
        <div className="result-finalization-race-heading"><h2>{sv.resultFinalizationRaceScope}</h2>
          <p>{sv.resultFinalizationEntries}: <strong>{candidates.race.entryCount}</strong> · {sv.resultFinalizationClasses}: <strong>{candidates.race.nonEmptyClassCount}</strong></p></div>
        <div className="result-finalization-race-state">
          <p><strong>{raceReady ? `✓ ${sv.resultFinalizationRaceReady}` : `△ ${sv.resultFinalizationRaceBlocked}`}</strong></p>
          <Blockers codes={candidates.race.blockerCodes} />
          <p className="muted">{sv.resultFinalizationLatest}: {candidates.race.latestFinalization
            ? `${sv.resultFinalizationRevision} ${candidates.race.latestFinalization.scopeRevision}, ${new Date(candidates.race.latestFinalization.finalizedAt).toLocaleString("sv-SE")}`
            : sv.resultFinalizationNoPrevious}</p>
        </div>
        <button type="button" disabled={busy || attempt !== undefined || !raceReady}
          onClick={() => void beginRace()}>{sv.resultFinalizationFinalizeRace}</button>
      </section>
    </>}

    {attempt && <section className="panel result-finalization-retry stack" role="alert">
      <h2>△ {sv.resultFinalizationUnknownCommit}</h2><p>{sv.resultFinalizationUnknownCommitHelp}</p>
      <dl><dt>{sv.resultFinalizationPendingScope}</dt><dd>{attempt.label}</dd>
        <dt>{sv.resultFinalizationPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd>
        <dt>{sv.resultFinalizationPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd></dl>
      <div className="pairing-actions">
        {authenticated === true && <button type="button" disabled={busy}
          onClick={() => void submitAttempt(attempt)}>{sv.resultFinalizationRetrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy}
          onClick={() => { setAttempt(undefined); setMessage(""); }}>{sv.resultFinalizationClearAttempt}</button>
      </div>
    </section>}

    {lastResult && <section className="panel" aria-label={sv.resultFinalizationCreated}>
      <p><strong>✓ {lastResult.replayed ? sv.resultFinalizationReplayRecovered : sv.resultFinalizationCreated}</strong></p>
      <p>{lastResult.finalization.scope === "CLASS" ? sv.resultFinalizationClassScope : sv.resultFinalizationRaceScope}: {lastResult.finalization.scopeRevision}</p>
      {lastResult.finalization.scope === "RACE" && <div className="pairing-actions">
        <a className="result-finalization-public-link" href={`/results/${raceId}/finalizations/${lastResult.finalization.id}`} target="_blank" rel="noreferrer">
          {sv.resultFinalizationPublicLinkOpen}
        </a>
        <button type="button" className="secondary" disabled={busy}
          onClick={() => void copyPublicRaceFinalizationLink(lastResult.finalization.id)}>
          {sv.resultFinalizationPublicLinkCopy}
        </button>
      </div>}
    </section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
