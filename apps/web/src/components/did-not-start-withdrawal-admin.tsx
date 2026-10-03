"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  didNotStartWithdrawalAdminLoginRequestSchema,
  didNotStartWithdrawalAdminLoginResponseSchema,
  type DidNotStartWithdrawalResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  createDidNotStartWithdrawalAttempt,
  isDefinitiveDidNotStartWithdrawalRejection,
  parseDidNotStartWithdrawalResponse,
  parseDidNotStartWithdrawals,
  readDidNotStartWithdrawalAdminCsrf,
  type DidNotStartWithdrawalAttempt,
  type DidNotStartWithdrawals
} from "../lib/did-not-start-withdrawal-admin-client";

type AttemptPhase = "CONFIRM" | "UNKNOWN" | "REAUTH";

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json() as unknown; }
  catch { throw new Error(sv.didNotStartWithdrawalInvalidResponse); }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.didNotStartWithdrawalUnknownError;
}

function stateText(state: DidNotStartWithdrawals["entries"][number]["state"]): string {
  if (state === "WITHDRAWABLE") return `✓ ${sv.didNotStartWithdrawalWithdrawable}`;
  if (state === "WITHDRAWN") return `○ ${sv.didNotStartWithdrawalWithdrawn}`;
  return `△ ${sv.didNotStartWithdrawalSuperseded}`;
}

export function DidNotStartWithdrawalAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [withdrawals, setWithdrawals] = useState<DidNotStartWithdrawals>();
  const [attempt, setAttempt] = useState<DidNotStartWithdrawalAttempt>();
  const [attemptPhase, setAttemptPhase] = useState<AttemptPhase>();
  const [lastResult, setLastResult] = useState<DidNotStartWithdrawalResponse>();
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean>();
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const retryHeadingRef = useRef<HTMLHeadingElement>(null);
  const [message, setMessage] = useState<string>(sv.didNotStartWithdrawalCheckingSession);
  const sessionUrl = `/api/admin/races/${raceId}/did-not-start-withdrawal-session`;
  const listUrl = `/api/admin/races/${raceId}/did-not-start-withdrawals`;

  const loadWithdrawals = useCallback(async () => {
    const response = await fetch(listUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false);
      setWithdrawals(undefined);
      setMessage(sv.didNotStartWithdrawalLoginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${sv.didNotStartWithdrawalSessionFailed} (${response.status})`);
    setWithdrawals(parseDidNotStartWithdrawals(await responseJson(response), raceId));
    setAuthenticated(true);
    setMessage("");
    return true;
  }, [listUrl, raceId]);

  useEffect(() => {
    void loadWithdrawals().catch((error: unknown) => {
      setWithdrawals(undefined);
      setMessage(messageFrom(error));
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
    if (busy) return;
    if (attemptPhase === "CONFIRM") {
      confirmRef.current?.scrollIntoView({ block: "start" });
      confirmRef.current?.focus({ preventScroll: true });
    }
    if (attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH") {
      (retryRef.current ?? retryHeadingRef.current)?.focus();
    }
  }, [attemptPhase, busy]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(sv.didNotStartWithdrawalLoggingIn);
    try {
      const parsed = didNotStartWithdrawalAdminLoginRequestSchema.safeParse({
        formatVersion: 1,
        accessCredential
      });
      if (!parsed.success) throw new Error(sv.didNotStartWithdrawalLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data)
      });
      if (!response.ok) {
        throw new Error(response.status === 401
          ? sv.didNotStartWithdrawalLoginRejected
          : `${sv.didNotStartWithdrawalSessionFailed} (${response.status})`);
      }
      const session = didNotStartWithdrawalAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId ||
          session.data.capability !== "WITHDRAW_DID_NOT_START") {
        throw new Error(sv.didNotStartWithdrawalInvalidResponse);
      }
      const loaded = await loadWithdrawals();
      if (loaded && attempt !== undefined) setMessage(sv.didNotStartWithdrawalAttemptRetained);
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setAccessCredential("");
      setBusy(false);
    }
  }

  async function submitAttempt(current: DidNotStartWithdrawalAttempt) {
    let csrf: string;
    try {
      csrf = readDidNotStartWithdrawalAdminCsrf(document.cookie, new URL(window.location.href));
    } catch (error) {
      setAuthenticated(false);
      setWithdrawals(undefined);
      setAttemptPhase("REAUTH");
      setMessage(`${messageFrom(error)} ${sv.didNotStartWithdrawalAttemptRetained}`);
      return;
    }

    setBusy(true);
    setMessage(sv.didNotStartWithdrawalWorking);
    try {
      const response = await fetch(
        `/api/admin/races/${raceId}/entries/${current.entryId}/did-not-start-withdrawal`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `did-not-start-withdrawal:${current.requestId}`,
            "x-otid-csrf": csrf
          },
          body: JSON.stringify(current.request)
        }
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAuthenticated(false);
          setWithdrawals(undefined);
          setAttemptPhase("REAUTH");
          setMessage(`${sv.didNotStartWithdrawalFailed} (${response.status}). ${sv.didNotStartWithdrawalLoginAgain} ${sv.didNotStartWithdrawalAttemptRetained}`);
          return;
        }
        if (isDefinitiveDidNotStartWithdrawalRejection(response.status)) {
          setAttempt(undefined);
          setAttemptPhase(undefined);
          if (response.status === 409) {
            try { await loadWithdrawals(); } catch { setWithdrawals(undefined); }
          }
          setMessage(response.status === 409
            ? sv.didNotStartWithdrawalConflict
            : `${sv.didNotStartWithdrawalFailed} (${response.status}).`);
          return;
        }
        throw new Error(
          `${sv.didNotStartWithdrawalFailed} (${response.status}). ${sv.didNotStartWithdrawalUnknownCommitHelp}`
        );
      }
      const result = parseDidNotStartWithdrawalResponse(await responseJson(response), current, raceId);
      const successMessage = result.replayed
        ? sv.didNotStartWithdrawalReplayRecovered
        : sv.didNotStartWithdrawalCreated;
      setLastResult(result);
      setAttempt(undefined);
      setAttemptPhase(undefined);
      try {
        await loadWithdrawals();
        setMessage(successMessage);
      } catch {
        setWithdrawals(undefined);
        setMessage(`${successMessage} ${sv.didNotStartWithdrawalSessionFailed}.`);
      }
    } catch (error) {
      setAttemptPhase("UNKNOWN");
      setMessage(`${messageFrom(error)} ${sv.didNotStartWithdrawalAttemptRetained}`);
    } finally {
      setBusy(false);
    }
  }

  function beginWithdrawal(entry: DidNotStartWithdrawals["entries"][number]) {
    if (!withdrawals || entry.state !== "WITHDRAWABLE") return;
    setLastResult(undefined);
    try {
      const created = createDidNotStartWithdrawalAttempt(entry, withdrawals);
      setAttempt(created);
      setAttemptPhase("CONFIRM");
      setMessage(sv.didNotStartWithdrawalConfirmHelp);
    } catch (error) {
      setMessage(messageFrom(error));
    }
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          "x-otid-csrf": readDidNotStartWithdrawalAdminCsrf(
            document.cookie,
            new URL(window.location.href)
          )
        }
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`${sv.didNotStartWithdrawalLogoutFailed} (${response.status})`);
      }
      setAuthenticated(false);
      setWithdrawals(undefined);
      setLastResult(undefined);
      setMessage(attempt === undefined
        ? sv.didNotStartWithdrawalLoggedOut
        : `${sv.didNotStartWithdrawalLoggedOut} ${sv.didNotStartWithdrawalAttemptRetained}`);
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setAccessCredential("");
      setBusy(false);
    }
  }

  const withdrawableCount = withdrawals?.entries.filter((entry) => entry.state === "WITHDRAWABLE").length ?? 0;

  return <div className="stack did-not-start-withdrawal-admin">
    <div className="did-not-start-withdrawal-state-strip" aria-label={sv.didNotStartWithdrawalStateHeading}>
      <span><strong>{sv.didNotStartWithdrawalInternetLabel}:</strong> {online === undefined ? sv.didNotStartWithdrawalChecking : online ? sv.didNotStartWithdrawalOnline : sv.didNotStartWithdrawalOffline}</span>
      <span><strong>{sv.didNotStartWithdrawalSessionLabel}:</strong> {authenticated === undefined ? sv.didNotStartWithdrawalChecking : authenticated ? sv.didNotStartWithdrawalSessionActive : sv.didNotStartWithdrawalSessionRequired}</span>
      <span><strong>{sv.didNotStartWithdrawalAvailableCountLabel}:</strong> {authenticated && withdrawals ? withdrawableCount : "–"}</span>
    </div>
    <section className="did-not-start-withdrawal-security-note" aria-label={sv.didNotStartWithdrawalSecurityHeading}>
      <strong>{sv.didNotStartWithdrawalSecurityHeading}.</strong> {sv.didNotStartWithdrawalSecurityBoundary} <strong>{sv.didNotStartWithdrawalActionWarning}</strong>
    </section>

    {authenticated !== true && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <h2>{sv.didNotStartWithdrawalLoginHeading}</h2>
      <p className="muted">{sv.didNotStartWithdrawalLoginHelp}</p>
      <label>{sv.didNotStartWithdrawalAccessCredential}
        <input type="password" autoComplete="off" spellCheck={false} value={accessCredential}
          onChange={(event) => setAccessCredential(event.target.value)} required />
      </label>
      <button type="submit" disabled={busy || accessCredential.length === 0}>
        {sv.didNotStartWithdrawalLogin}
      </button>
    </form>}

    {authenticated === true && withdrawals && <section className="panel stack"
      aria-labelledby="did-not-start-withdrawal-data-heading">
      <div className="did-not-start-withdrawal-heading">
        <div>
          <h2 id="did-not-start-withdrawal-data-heading">{sv.didNotStartWithdrawalDataHeading}</h2>
          <p className="muted">{sv.didNotStartWithdrawalDataHelp}</p>
          <p><strong>{sv.didNotStartWithdrawalSnapshotVersion}: {withdrawals.snapshotVersion}</strong></p>
        </div>
        <button type="button" className="secondary" disabled={busy} onClick={() => void logout()}>
          {sv.didNotStartWithdrawalLogout}
        </button>
      </div>
      <div className="did-not-start-withdrawal-list">
        <div className="did-not-start-withdrawal-list-head" aria-hidden="true">
          <span>{sv.didNotStartWithdrawalParticipantHeading}</span>
          <span>{sv.didNotStartWithdrawalClass}</span>
          <span>{sv.didNotStartWithdrawalVersionHeading}</span>
          <span>{sv.didNotStartWithdrawalStatusHeading}</span>
          <span>{sv.didNotStartWithdrawalRevisionHeading}</span>
          <span>{sv.didNotStartWithdrawalActionHeading}</span>
        </div>
        {withdrawals.entries.map((entry) => <article className="did-not-start-withdrawal-entry"
          key={`${entry.didNotStartDecisionId}:${entry.state}`}>
          <div className="did-not-start-withdrawal-person">
            <h3>{entry.displayName}</h3>
            <p>{entry.organisationName ?? "–"}</p>
          </div>
          <p className="did-not-start-withdrawal-class"><span className="did-not-start-withdrawal-mobile-label">{sv.didNotStartWithdrawalClass}: </span>{entry.className}</p>
          <p className="did-not-start-withdrawal-version"><span className="did-not-start-withdrawal-mobile-label">{sv.didNotStartWithdrawalEntryVersion}: </span>{entry.entryVersion}</p>
          <p className="did-not-start-withdrawal-status"><strong>{stateText(entry.state)}</strong></p>
          <div className="did-not-start-withdrawal-revision">
            <p><span className="did-not-start-withdrawal-mobile-label">{sv.didNotStartWithdrawalTargetRevision}: </span>{entry.targetResultRevision.revision} · DNS</p>
            {entry.state === "SUPERSEDED" && <p>{sv.didNotStartWithdrawalLatestRevision}: {entry.latestResultRevision.revision} · {entry.latestResultRevision.status}</p>}
            {entry.withdrawal && <p>{sv.didNotStartWithdrawalWithdrawnAt}: {new Date(entry.withdrawal.withdrawnAt).toLocaleString("sv-SE")}</p>}
          </div>
          <button type="button" disabled={busy || attempt !== undefined || entry.state !== "WITHDRAWABLE"}
            onClick={() => beginWithdrawal(entry)}>{sv.didNotStartWithdrawalBegin}</button>
        </article>)}
        {withdrawals.entries.length === 0 && <p className="muted">{sv.didNotStartWithdrawalNoEntries}</p>}
      </div>
    </section>}

    {attempt && attemptPhase === "CONFIRM" && <section
      className="panel did-not-start-withdrawal-confirm stack" role="alert">
      <h2 ref={confirmRef} tabIndex={-1}>△ {sv.didNotStartWithdrawalConfirmHeading}</h2>
      <p>{sv.didNotStartWithdrawalConfirmWarning}</p>
      <dl>
        <dt>{sv.didNotStartWithdrawalPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.didNotStartWithdrawalClass}</dt><dd>{attempt.className}</dd>
        <dt>{sv.didNotStartWithdrawalPendingRevision}</dt><dd>{attempt.request.expectedResultRevision.revision}</dd>
        <dt>{sv.didNotStartWithdrawalPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd>
      </dl>
      <div className="pairing-actions">
        <button type="button" disabled={busy} onClick={() => void submitAttempt(attempt)}>
          {sv.didNotStartWithdrawalConfirm}
        </button>
        <button type="button" className="secondary danger" disabled={busy}
          onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>
          {sv.didNotStartWithdrawalCancel}
        </button>
      </div>
    </section>}

    {attempt && (attemptPhase === "UNKNOWN" || attemptPhase === "REAUTH") && <section
      className="panel did-not-start-withdrawal-retry stack" role="alert">
      <h2 ref={retryHeadingRef} tabIndex={-1}>△ {attemptPhase === "UNKNOWN"
        ? sv.didNotStartWithdrawalUnknownCommit
        : sv.didNotStartWithdrawalLoginRequired}</h2>
      <p>{attemptPhase === "UNKNOWN"
        ? sv.didNotStartWithdrawalUnknownCommitHelp
        : sv.didNotStartWithdrawalLoginAgain}</p>
      <dl>
        <dt>{sv.didNotStartWithdrawalPendingEntry}</dt><dd>{attempt.displayName}</dd>
        <dt>{sv.didNotStartWithdrawalPendingRequest}</dt><dd className="pairing-grant-id">{attempt.requestId}</dd>
        <dt>{sv.didNotStartWithdrawalPendingSnapshot}</dt><dd>{attempt.request.expectedSnapshotVersion}</dd>
      </dl>
      <div className="pairing-actions">
        {authenticated === true && <button ref={retryRef} type="button" disabled={busy}
          onClick={() => void submitAttempt(attempt)}>{sv.didNotStartWithdrawalRetrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy}
          onClick={() => { setAttempt(undefined); setAttemptPhase(undefined); setMessage(""); }}>
          {sv.didNotStartWithdrawalClearAttempt}
        </button>
      </div>
    </section>}

    {lastResult && <section className="panel did-not-start-withdrawal-result"
      aria-label={sv.didNotStartWithdrawalCreated}>
      <p><strong>✓ {lastResult.replayed
        ? sv.didNotStartWithdrawalReplayRecovered
        : sv.didNotStartWithdrawalCreated}</strong></p>
      <p>{sv.didNotStartWithdrawalWithdrawalId}: <span className="pairing-grant-id">{lastResult.withdrawalId}</span></p>
    </section>}

    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
