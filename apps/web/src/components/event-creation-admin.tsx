"use client";

import Link from "next/link";
import React, { useEffect, useRef, useState, type FormEvent } from "react";
import {
  eventCreationLoginRequestSchema,
  eventCreationLoginResponseSchema,
  type EventCreationResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import {
  createEventCreationAttempt,
  isDefinitiveEventCreationRejection,
  parseEventCreationResponse,
  readEventCreationCsrf,
  type EventCreationAttempt
} from "../lib/event-creation-admin-client";

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(sv.eventCreationInvalidResponse);
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.eventCreationUnknownError;
}

export function EventCreationAdmin() {
  const attemptHeadingRef = useRef<HTMLHeadingElement>(null);
  const receiptHeadingRef = useRef<HTMLHeadingElement>(null);
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [online, setOnline] = useState<boolean>();
  const [attempt, setAttempt] = useState<EventCreationAttempt>();
  const [created, setCreated] = useState<EventCreationResponse>();
  const [busy, setBusy] = useState(false);
  const [logoutUnconfirmed, setLogoutUnconfirmed] = useState(false);
  const [message, setMessage] = useState<string>(sv.eventCreationCheckingSession);
  const sessionUrl = "/api/admin/event-creation-session";

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
    void fetch(sessionUrl, { credentials: "same-origin", cache: "no-store" }).then(async (response) => {
      if (response.status === 401 || response.status === 403) {
        setAuthenticated(false);
        setMessage(sv.eventCreationLoginRequired);
        return;
      }
      if (!response.ok) throw new Error(`${sv.eventCreationSessionFailed} (${response.status})`);
      const parsed = eventCreationLoginResponseSchema.safeParse(await responseJson(response));
      if (!parsed.success || parsed.data.capability !== "CREATE_EVENT") {
        throw new Error(sv.eventCreationInvalidResponse);
      }
      setAuthenticated(true);
      setMessage("");
    }).catch((error: unknown) => setMessage(messageFrom(error)));
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setLogoutUnconfirmed(false);
    setMessage(sv.eventCreationLoggingIn);
    try {
      const parsed = eventCreationLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.eventCreationLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data)
      });
      if (!response.ok) {
        throw new Error(response.status === 401
          ? sv.eventCreationLoginRejected
          : `${sv.eventCreationSessionFailed} (${response.status})`);
      }
      const session = eventCreationLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.capability !== "CREATE_EVENT") {
        throw new Error(sv.eventCreationInvalidResponse);
      }
      setAuthenticated(true);
      setMessage(attempt ? sv.eventCreationAttemptReadyAfterLogin : "");
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setAccessCredential("");
      setBusy(false);
    }
  }

  async function submitAttempt(current: EventCreationAttempt) {
    setBusy(true);
    setMessage(sv.eventCreationWorking);
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `event-create:${current.requestId}`,
          "x-otid-csrf": readEventCreationCsrf(document.cookie, new URL(window.location.href))
        },
        body: JSON.stringify(current.request)
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setAuthenticated(false);
        if (isDefinitiveEventCreationRejection(response.status)) {
          setAttempt(undefined);
          setMessage(response.status === 409
            ? sv.eventCreationConflict
            : `${sv.eventCreationFailed} (${response.status}).`);
          return;
        }
        const help = response.status === 401 || response.status === 403
          ? sv.eventCreationLoginAgain
          : sv.eventCreationUnknownCommitHelp;
        throw new Error(`${sv.eventCreationFailed} (${response.status}). ${help}`);
      }
      const result = parseEventCreationResponse(await responseJson(response), current);
      setCreated(result);
      setAttempt(undefined);
      setMessage(result.replayed ? sv.eventCreationReplayRecovered : sv.eventCreationCreated);
    } catch (error) {
      setMessage(`${messageFrom(error)} ${sv.eventCreationAttemptRetained}`);
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setCreated(undefined);
    try {
      const current = createEventCreationAttempt({
        formatVersion: 1,
        eventName: form.get("eventName"),
        raceName: form.get("raceName"),
        raceDate: form.get("raceDate"),
        timeZone: form.get("timeZone")
      }, () => crypto.randomUUID());
      setAttempt(current);
      await submitAttempt(current);
    } catch (error) {
      setMessage(messageFrom(error));
    }
  }

  function discardAttempt() {
    setAttempt(undefined);
    setMessage("");
  }

  async function requestLogout() {
    setAccessCredential("");
    setAttempt(undefined);
    setCreated(undefined);
    setBusy(true);
    setMessage(sv.eventCreationLoggingOut);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "x-otid-csrf": readEventCreationCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`${sv.eventCreationLogoutFailed} (${response.status})`);
      }
      setAuthenticated(false);
      setLogoutUnconfirmed(false);
      setMessage(sv.eventCreationLoggedOut);
    } catch (error) {
      setAuthenticated(undefined);
      setLogoutUnconfirmed(true);
      setMessage(`${messageFrom(error)} ${sv.eventCreationLogoutUnknown}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!attempt || busy) return;
    attemptHeadingRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    attemptHeadingRef.current?.focus({ preventScroll: true });
  }, [attempt, busy]);
  useEffect(() => {
    if (!created?.requestId) return;
    receiptHeadingRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    receiptHeadingRef.current?.focus({ preventScroll: true });
  }, [created?.requestId]);

  const onlineText = online === true
    ? `✓ ${sv.eventCreationInternetOnline}`
    : online === false
      ? `△ ${sv.eventCreationInternetOffline}`
      : `… ${sv.eventCreationInternetChecking}`;
  const sessionText = authenticated === true
    ? `✓ ${sv.eventCreationSessionActive}`
    : authenticated === false
      ? `△ ${sv.eventCreationSessionRequired}`
      : `… ${sv.eventCreationSessionChecking}`;
  const attemptText = attempt
    ? `△ ${sv.eventCreationAttemptPending}`
    : created
      ? `✓ ${sv.eventCreationAttemptConfirmed}`
      : `– ${sv.eventCreationAttemptNone}`;

  return <div className="stack event-creation-admin">
    <section className="panel event-creation-security-note">
      <h1>{sv.eventCreationPageHeading}</h1>
      <p>{sv.eventCreationPageLead}</p>
      <p className="muted">{sv.eventCreationCapabilityBoundary}</p>
    </section>

    <section className="status-grid event-creation-state-strip" aria-label={sv.eventCreationOperationalStatus}>
      <div className="status"><strong>{sv.eventCreationInternetLabel}</strong><span>{onlineText}</span></div>
      <div className="status"><strong>{sv.eventCreationSessionLabel}</strong><span>{sessionText}</span></div>
      <div className="status"><strong>{sv.eventCreationAttemptLabel}</strong><span>{attemptText}</span></div>
    </section>

    {logoutUnconfirmed && <section className="panel event-creation-warning event-creation-logout-warning stack" role="alert">
      <h2>△ {sv.eventCreationLogoutUnconfirmedHeading}</h2>
      <p>{sv.eventCreationLogoutUnknown}</p>
      <button type="button" disabled={busy} onClick={() => void requestLogout()}>{sv.eventCreationRetryLogout}</button>
    </section>}

    {authenticated !== true && !logoutUnconfirmed && <form className="panel stack event-creation-login" onSubmit={(event) => void login(event)}>
      <h2>{sv.eventCreationLoginHeading}</h2>
      <p className="muted">{sv.eventCreationLoginHelp}</p>
      <label>{sv.eventCreationAccessCredential}
        <input type="password" autoComplete="off" spellCheck={false} value={accessCredential}
          onChange={(event) => setAccessCredential(event.target.value)} required />
      </label>
      <button type="submit" disabled={busy || accessCredential.length === 0} aria-busy={busy}>
        {sv.eventCreationLogin}
      </button>
    </form>}

    {attempt && <section className={`panel event-creation-warning stack${busy ? "" : " is-uncertain"}`} role="alert">
      <h2 ref={attemptHeadingRef} tabIndex={-1}>△ {sv.eventCreationUnknownCommit}</h2>
      <dl className="event-creation-attempt"><dt>{sv.eventCreationPendingRequest}</dt><dd>{attempt.requestId}</dd>
        <dt>{sv.eventCreationEventName}</dt><dd>{attempt.request.eventName}</dd>
        <dt>{sv.eventCreationRaceName}</dt><dd>{attempt.request.raceName}</dd>
        <dt>{sv.eventCreationDate}</dt><dd>{attempt.request.raceDate}</dd>
        <dt>{sv.eventCreationTimeZone}</dt><dd>{attempt.request.timeZone}</dd></dl>
      <div className="pairing-actions">
        {authenticated === true && <button type="button" disabled={busy}
          onClick={() => void submitAttempt(attempt)}>{sv.eventCreationRetrySame}</button>}
        <button type="button" className="secondary danger" disabled={busy}
          onClick={discardAttempt}>{sv.eventCreationDiscardAttempt}</button>
      </div>
      <p className="muted">{sv.eventCreationUnknownCommitHelp}</p>
    </section>}

    {authenticated === true && <section className="panel stack event-creation-form-panel">
      <div className="event-creation-heading"><div><h2>{sv.eventCreationFormHeading}</h2>
        <p className="muted">{sv.eventCreationFormHelp}</p></div>
        <button type="button" className="secondary" disabled={busy} onClick={() => void requestLogout()}>
          {sv.eventCreationLogout}
        </button></div>
      {created ? <div className="stack"><p className="muted">{sv.eventCreationCreated}</p>
        <button type="button" className="secondary" onClick={() => setCreated(undefined)}>{sv.eventCreationCreateAnother}</button>
      </div> : <form className="event-creation-fields" onSubmit={(event) => void create(event)}>
        <label>{sv.eventCreationEventName}<input name="eventName" required minLength={2} maxLength={160} /></label>
        <label>{sv.eventCreationRaceName}<input name="raceName" required minLength={2} maxLength={160} /></label>
        <label>{sv.eventCreationDate}<input name="raceDate" type="date" required /></label>
        <label>{sv.eventCreationTimeZone}<input name="timeZone" defaultValue="Europe/Stockholm" required maxLength={100} /></label>
        <button type="submit" disabled={busy || attempt !== undefined} aria-busy={busy}>
          {sv.eventCreationCreate}
        </button>
      </form>}
    </section>}

    {created && <section className="panel event-creation-result stack">
      <h2 ref={receiptHeadingRef} tabIndex={-1}>✓ {created.replayed ? sv.eventCreationReplayRecovered : sv.eventCreationCreated}</h2>
      <dl className="event-creation-attempt"><dt>{sv.eventCreationEventId}</dt><dd>{created.eventId}</dd>
        <dt>{sv.eventCreationRaceId}</dt><dd>{created.raceId}</dd>
        <dt>{sv.eventCreationCreatedAt}</dt><dd>{new Date(created.createdAt).toLocaleString("sv-SE")}</dd></dl>
      <p><Link href={`/admin/${created.raceId}`}>{sv.eventCreationOpenOverview}</Link></p>
      <p className="muted">{sv.eventCreationNoAutomaticCredential}</p>
    </section>}

    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
