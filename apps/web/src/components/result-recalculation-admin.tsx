"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  resultRecalculationAdminLoginRequestSchema,
  resultRecalculationAdminLoginResponseSchema,
  type ResultRecalculationReadiness,
  type ResultRecalculationResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  createResultRecalculationAttempt,
  isDefinitiveResultRecalculationRejection,
  parseResultRecalculationCandidates,
  parseResultRecalculationResponse,
  readResultRecalculationAdminCsrf,
  resultRecalculationBody,
  type ResultRecalculationAttempt,
  type ResultRecalculationCandidates
} from "../lib/result-recalculation-admin-client";

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(sv.resultRecalculationInvalidResponse);
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.resultRecalculationUnknownError;
}

function readinessText(readiness: ResultRecalculationReadiness): string {
  switch (readiness) {
    case "READY": return `✓ ${sv.resultRecalculationReady}`;
    case "NO_ACTIVE_ASSIGNMENT": return `△ ${sv.resultRecalculationNoActiveAssignment}`;
    case "MULTIPLE_ACTIVE_ASSIGNMENTS": return `△ ${sv.resultRecalculationMultipleAssignments}`;
    case "NO_READOUT": return `△ ${sv.resultRecalculationNoReadout}`;
  }
}

export function ResultRecalculationAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [online, setOnline] = useState<boolean>();
  const [candidates, setCandidates] = useState<ResultRecalculationCandidates>();
  const [attempt, setAttempt] = useState<ResultRecalculationAttempt>();
  const pendingAlertRef = useRef<HTMLElement>(null);
  const [lastResult, setLastResult] = useState<ResultRecalculationResponse>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(sv.resultRecalculationCheckingSession);
  const sessionUrl = `/api/admin/races/${raceId}/recalculation-session`;
  const candidatesUrl = `/api/admin/races/${raceId}/recalculation-candidates`;

  const loadCandidates = useCallback(async () => {
    const response = await fetch(candidatesUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false);
      setCandidates(undefined);
      setMessage(sv.resultRecalculationLoginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${sv.resultRecalculationSessionFailed} (${response.status})`);
    const parsed = parseResultRecalculationCandidates(await responseJson(response), raceId);
    setCandidates(parsed);
    setAuthenticated(true);
    setMessage("");
    return true;
  }, [candidatesUrl, raceId]);

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
    void loadCandidates().catch((error: unknown) => {
      setCandidates(undefined);
      setMessage(messageFrom(error));
    });
  }, [loadCandidates]);

  useEffect(() => {
    if (attempt === undefined || busy) return;
    pendingAlertRef.current?.focus({ preventScroll: true });
    pendingAlertRef.current?.scrollIntoView({ block: "start" });
  }, [attempt, busy]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(sv.resultRecalculationLoggingIn);
    try {
      const parsed = resultRecalculationAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.resultRecalculationLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data)
      });
      if (!response.ok) {
        throw new Error(response.status === 401
          ? sv.resultRecalculationLoginRejected
          : `${sv.resultRecalculationSessionFailed} (${response.status})`);
      }
      const loginResponse = resultRecalculationAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!loginResponse.success || loginResponse.data.raceId !== raceId ||
          loginResponse.data.capability !== "RECALCULATE_RESULT") {
        throw new Error(sv.resultRecalculationInvalidResponse);
      }
      const loaded = await loadCandidates();
      if (loaded && attempt !== undefined) setMessage(sv.resultRecalculationAttemptRetained);
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setAccessCredential("");
      setBusy(false);
    }
  }

  async function submitAttempt(current: ResultRecalculationAttempt) {
    setBusy(true);
    setMessage(sv.resultRecalculationWorking);
    try {
      const response = await fetch(`/api/races/${raceId}/entries/${current.entryId}/recalculate`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `result-recalculation:${current.requestId}`,
          "x-otid-csrf": readResultRecalculationAdminCsrf(document.cookie, new URL(window.location.href))
        },
        body: JSON.stringify(resultRecalculationBody(current))
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAuthenticated(false);
          setCandidates(undefined);
        }
        if (isDefinitiveResultRecalculationRejection(response.status)) {
          setAttempt(undefined);
          if (response.status === 409) {
            try {
              await loadCandidates();
            } catch {
              setCandidates(undefined);
            }
          }
          setMessage(response.status === 409
            ? sv.resultRecalculationConflict
            : `${sv.resultRecalculationFailed} (${response.status}).`);
          return;
        }
        const detail = response.status === 401 || response.status === 403
          ? sv.resultRecalculationLoginAgain
          : sv.resultRecalculationUnknownCommitHelp;
        throw new Error(`${sv.resultRecalculationFailed} (${response.status}). ${detail}`);
      }
      const result = parseResultRecalculationResponse(await responseJson(response), current, raceId);
      setLastResult(result);
      setAttempt(undefined);
      const confirmedMessage = result.replayed
        ? sv.resultRecalculationReplayRecovered
        : sv.resultRecalculationCreated;
      setMessage(confirmedMessage);
      try {
        await loadCandidates();
        setMessage(confirmedMessage);
      } catch {
        setMessage(`${confirmedMessage} ${sv.resultRecalculationSessionFailed}.`);
      }
    } catch (error) {
      setMessage(`${messageFrom(error)} ${sv.resultRecalculationAttemptRetained}`);
    } finally {
      setBusy(false);
    }
  }

  async function beginRecalculation(entryId: string) {
    if (!candidates) return;
    const candidate = candidates.entries.find((item) => item.id === entryId);
    if (!candidate) return;
    setLastResult(undefined);
    try {
      const created = createResultRecalculationAttempt(candidate, candidates);
      setAttempt(created);
      await submitAttempt(created);
    } catch (error) {
      setMessage(messageFrom(error));
    }
  }

  function clearAttempt() {
    setAttempt(undefined);
    setMessage("");
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "x-otid-csrf": readResultRecalculationAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`${sv.resultRecalculationLogoutFailed} (${response.status})`);
      }
      setAuthenticated(false);
      setCandidates(undefined);
      setLastResult(undefined);
      setMessage(attempt === undefined
        ? sv.resultRecalculationLoggedOut
        : `${sv.resultRecalculationLoggedOut} ${sv.resultRecalculationAttemptRetained}`);
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setAccessCredential("");
      setBusy(false);
    }
  }

  const readyCount = candidates?.entries.filter((candidate) => candidate.readiness === "READY").length;
  const onlineText = online === true
    ? `✓ ${sv.resultRecalculationInternetOnline}`
    : online === false
      ? `△ ${sv.resultRecalculationInternetOffline}`
      : `… ${sv.resultRecalculationInternetChecking}`;
  const sessionText = authenticated === true
    ? `✓ ${sv.resultRecalculationSessionActive}`
    : authenticated === false
      ? `△ ${sv.resultRecalculationSessionRequired}`
      : `… ${sv.resultRecalculationSessionChecking}`;

  return <div className="stack result-recalculation-admin">
    <section className="panel result-recalculation-security-note" aria-labelledby="result-recalculation-security-heading">
      <h2 id="result-recalculation-security-heading">{sv.resultRecalculationSecurityHeading}</h2>
      <p>{sv.resultRecalculationSecurityBoundary}</p>
      <p><strong>{sv.resultRecalculationActionWarning}</strong></p>
    </section>

    <section className="status-grid" aria-label={sv.resultRecalculationOperationalStatus}>
      <div className="status"><strong>{sv.resultRecalculationInternetLabel}</strong><span>{onlineText}</span></div>
      <div className="status"><strong>{sv.resultRecalculationSessionLabel}</strong><span>{sessionText}</span></div>
      <div className="status"><strong>{sv.resultRecalculationReadinessLabel}</strong><span>{candidates && readyCount !== undefined
        ? `${readyCount > 0 ? "✓" : "△"} ${sv.resultRecalculationReadinessCount(readyCount, candidates.entries.length)}`
        : `… ${sv.resultRecalculationReadinessUnknown}`}</span></div>
    </section>

    {authenticated !== true && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <h2>{sv.resultRecalculationLoginHeading}</h2>
      <p className="muted">{sv.resultRecalculationLoginHelp}</p>
      <label>{sv.resultRecalculationAccessCredential}
        <input type="password" autoComplete="off" spellCheck={false} value={accessCredential}
          onChange={(event) => setAccessCredential(event.target.value)} required />
      </label>
      <button type="submit" disabled={busy || accessCredential.length === 0} aria-busy={busy}>
        {sv.resultRecalculationLogin}
      </button>
    </form>}

    {authenticated === true && candidates !== undefined && <section className="panel stack"
      aria-labelledby="result-recalculation-candidates-heading">
      <div className="result-recalculation-heading"><div>
        <h2 id="result-recalculation-candidates-heading">{sv.resultRecalculationDataHeading}</h2>
        <p className="muted">{sv.resultRecalculationDataHelp}</p>
        <p><strong>{sv.resultRecalculationSnapshotVersion}: {candidates.snapshotVersion}</strong><br />
          {sv.resultRecalculationEngineVersion}: {candidates.engineVersion}</p>
      </div><button type="button" className="secondary" disabled={busy}
        onClick={() => void logout()}>{sv.resultRecalculationLogout}</button></div>
      <div className="result-recalculation-list">
        {candidates.entries.map((candidate) => <article className="result-recalculation-entry" key={candidate.id}>
          <div className="result-recalculation-identity"><h3>{candidate.displayName}</h3><p>{candidate.organisationName ?? "–"}</p>
            <p>{sv.resultRecalculationCurrentClass}: <strong>{candidate.className}</strong> · {sv.resultRecalculationEntryVersion}: {candidate.entryVersion}</p></div>
          <div className="result-recalculation-evidence">
            <p className="recalculation-readiness"><strong>{readinessText(candidate.readiness)}</strong></p>
            {candidate.latestReadout && <p>{sv.resultRecalculationLatestReadout}: {new Date(candidate.latestReadout.readAt).toLocaleString("sv-SE")}</p>}
            <p>{sv.resultRecalculationLatestRevision}: {candidate.latestResultRevision
              ? `${candidate.latestResultRevision.revision} · ${candidate.latestResultRevision.status}/${candidate.latestResultRevision.reason}`
              : sv.resultRecalculationNoRevision}</p></div>
          <button type="button" disabled={busy || attempt !== undefined || candidate.readiness !== "READY"}
            onClick={() => void beginRecalculation(candidate.id)}>{sv.resultRecalculationButton}</button>
        </article>)}
        {candidates.entries.length === 0 && <p className="muted">{sv.resultRecalculationNoEntries}</p>}
      </div>
    </section>}

    {attempt !== undefined && <section ref={pendingAlertRef} className="panel result-recalculation-retry stack" role="alert" tabIndex={-1}
      aria-labelledby="result-recalculation-retry-heading">
      <h2 id="result-recalculation-retry-heading">△ {sv.resultRecalculationUnknownCommit}</h2>
      <p>{sv.resultRecalculationUnknownCommitHelp}</p>
      <dl><dt>{sv.resultRecalculationPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.resultRecalculationPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd>
        <dt>{sv.resultRecalculationPendingSnapshot}</dt><dd>{attempt.expectedSnapshotVersion}</dd></dl>
      <div className="pairing-actions">
        {authenticated === true && <button type="button" disabled={busy}
          onClick={() => void submitAttempt(attempt)}>{sv.resultRecalculationRetrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy}
          onClick={clearAttempt}>{sv.resultRecalculationClearAttempt}</button>
      </div>
    </section>}

    {lastResult !== undefined && <section className="panel result-recalculation-result"
      aria-label={sv.resultRecalculationCreated}>
      <p><strong>✓ {lastResult.replayed
        ? sv.resultRecalculationReplayRecovered
        : sv.resultRecalculationCreated}</strong></p>
      <p>{sv.resultRecalculationRevisionLabel} {lastResult.revision} · {lastResult.status}/{lastResult.reason}</p>
    </section>}
    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
