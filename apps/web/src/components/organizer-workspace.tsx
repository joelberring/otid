"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  organizerEventCreateRequestSchema,
  organizerAdminGrantRequestSchema,
  organizerAdminRevokeRequestSchema,
  type OrganizerEventCreateResponse,
  type OrganizerMyEventsResponse
} from "@o-tid/contracts";
import {
  clearOrganizerAttempt,
  clearOrganizerAdminAttempt,
  createOrganizerAttempt,
  parseOrganizerCreateResponse,
  parseOrganizerAdminGrantResponse,
  parseOrganizerAdminList,
  parseOrganizerAdminRevokeResponse,
  parseOrganizerEnterResponse,
  parseOrganizerEvents,
  parseOrganizerLoginRequest,
  parseOrganizerSession,
  readOrganizerCsrf,
  restoreOrganizerAttempt,
  restoreOrganizerAdminAttempt,
  saveOrganizerAdminAttempt,
  saveOrganizerAttempt,
  type OrganizerCreateAttempt,
  type OrganizerAdminMutationAttempt
} from "../lib/organizer-client";
import { organizerSv as copy } from "../i18n/organizer-sv";
import { raceTypeSv } from "../i18n/race-type-sv";
import { RaceTypeChoice } from "./race-type-choice";
import styles from "./organizer-workspace.module.css";

type Session = { accountId: string; email: string; displayName: string; superadmin: boolean; expiresAt: string };

function EventAdministrators({ eventId, eventName, accountId }: { eventId: string; eventName: string; accountId: string }) {
  const [grants, setGrants] = useState<ReturnType<typeof parseOrganizerAdminList>["grants"]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [attempt, setAttempt] = useState<OrganizerAdminMutationAttempt>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reviewRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoaded(false);
    setError("");
    try {
      const response = await fetch(`/api/organizer/events/${encodeURIComponent(eventId)}/administrators`, {
        credentials: "same-origin", cache: "no-store"
      });
      if (!response.ok) throw new Error(`Kunde inte hämta administratörer (${response.status}).`);
      const result = parseOrganizerAdminList(await responseJson(response));
      if (result.eventId !== eventId) throw new Error(copy.invalidServerResponse);
      setGrants(result.grants);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setLoaded(true); }
  }

  useEffect(() => {
    const pending = restoreOrganizerAdminAttempt(accountId, eventId);
    if (pending) setAttempt(pending);
    void load();
  }, [accountId, eventId]);

  async function submit(current: OrganizerAdminMutationAttempt) {
    if (current.accountId !== accountId || current.eventId !== eventId) {
      setError(copy.adminAttemptOtherAccount);
      return;
    }
    setBusy(true);
    setError("");
    setNotice(copy.adminSending);
    try {
      const isGrant = current.action === "grant";
      const response = await fetch(isGrant
        ? `/api/organizer/events/${encodeURIComponent(eventId)}/administrators`
        : `/api/organizer/events/${encodeURIComponent(eventId)}/administrators/${encodeURIComponent(String(current.request.grantId))}/revoke`, {
        method: "POST", credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `organizer-admin-${current.action}:${current.requestId}`,
          "x-otid-csrf": readOrganizerCsrf(document.cookie, new URL(window.location.href))
        },
        body: JSON.stringify(current.request)
      });
      if (response.status === 404 && isGrant) {
        clearOrganizerAdminAttempt(accountId, eventId);
        setAttempt(undefined);
        setNotice("");
        setError(copy.adminNotFound);
        return;
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error(copy.adminSessionRenewal(response.status));
        if (response.status === 409) throw new Error(copy.adminRequestConflict);
        throw new Error(copy.adminUncertain(response.status));
      }
      const value = await responseJson(response);
      const confirmed = isGrant
        ? parseOrganizerAdminGrantResponse(value, current)
        : parseOrganizerAdminRevokeResponse(value, current);
      clearOrganizerAdminAttempt(accountId, eventId);
      setAttempt(undefined);
      setNotice(confirmed.replayed ? copy.adminRetryConfirmed : isGrant ? copy.adminGranted : copy.adminRevoked);
      setEmail("");
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
      setNotice(copy.adminPendingNotice);
    } finally { setBusy(false); }
  }

  function createGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const requestId = crypto.randomUUID();
      const request = organizerAdminGrantRequestSchema.parse({
        formatVersion: 1, requestId, eventId, email, role: "ADMIN"
      });
      const current = { accountId, action: "grant" as const, eventId, requestId, request };
      saveOrganizerAdminAttempt(current);
      setAttempt(current);
      void submit(current);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function revoke(grantId: string, displayName: string) {
    if (!window.confirm(copy.adminConfirmRevoke(displayName))) return;
    try {
      const requestId = crypto.randomUUID();
      const request = organizerAdminRevokeRequestSchema.parse({ formatVersion: 1, requestId, eventId, grantId });
      const current = { accountId, action: "revoke" as const, eventId, requestId, request };
      saveOrganizerAdminAttempt(current);
      setAttempt(current);
      void submit(current);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function abandon() {
    clearOrganizerAdminAttempt(accountId, eventId);
    setAttempt(undefined);
    setNotice(copy.adminAbandoned);
  }

  const activeCount = grants.filter((grant) => !grant.revokedAt).length;
  const revokedCount = grants.length - activeCount;

  return <section className={styles.adminPanel} aria-label={copy.adminPanel}>
    <div className={styles.adminHeading}><h4>{copy.adminPanel}</h4>
      <button className={styles.secondary} type="button" disabled={busy} onClick={() => void load()}>{copy.refresh}</button>
    </div>
    <p className={styles.adminContext}>{copy.adminForEvent} <strong>{eventName}</strong> <span>({eventId})</span></p>
    <p className={styles.muted}>{copy.adminHint}</p>
    {!loaded && <p aria-live="polite">{copy.adminLoading}</p>}
    {error && <p role="alert">{error}</p>}
    {loaded && !error && <p className={styles.adminSummary}>{copy.adminSummary(activeCount, revokedCount)}</p>}
    {loaded && !error && grants.length === 0 && <p>{copy.adminEmpty}</p>}
    {loaded && grants.length > 0 && <ul className={styles.adminList}>{grants.map((grant) => <li key={grant.grantId}>
      <div><strong>{grant.displayName}</strong><span>{grant.email}</span>
        <span>{copy.adminGrantedAt} {new Date(grant.grantedAt).toLocaleString("sv-SE")}</span></div>
      <span className={styles.adminStatus}>{grant.revokedAt ? copy.adminRevokedLabel : copy.adminActiveLabel}
        {grant.revokedAt && <small>{copy.adminRevokedAt} {new Date(grant.revokedAt).toLocaleString("sv-SE")}</small>}</span>
      {!grant.revokedAt && <button className={styles.secondary} type="button" disabled={busy}
        onClick={() => revoke(grant.grantId, grant.displayName)}>{copy.adminRevoke}</button>}
    </li>)}</ul>}
    {!attempt && <form className={styles.adminForm} onSubmit={(event) => void createGrant(event)}>
      <label>{copy.adminEmail}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)}
        autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={254} required disabled={busy || !!attempt} /></label>
      <div ref={reviewRef} tabIndex={-1} className={styles.adminReview}>
        <p>{email ? copy.adminReview(email.trim().toLowerCase()) : copy.adminReviewHint}</p>
        <p>{copy.adminReviewEvent(eventName)}</p>
      </div>
      <button type="submit" disabled={busy || !!attempt || !email}>{copy.adminGrant}</button>
    </form>}
    {attempt && <div className={styles.uncertain} role="alert">
      <h5>{copy.adminPendingTitle}</h5>
      <p>{copy.adminPendingHint}</p>
      <dl><dt>{copy.adminAction}</dt><dd>{attempt.action === "grant" ? copy.adminGrantAction : copy.adminRevokeAction}</dd>
        <dt>{copy.adminEvent}</dt><dd>{eventName} · {attempt.eventId}</dd>
        <dt>{copy.adminRequestId}</dt><dd>{attempt.requestId}</dd>
        <dt>{copy.adminTarget}</dt><dd>{String(attempt.request.email ?? attempt.request.grantId)}</dd></dl>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => void submit(attempt)}>{copy.retrySameAttempt}</button>
        <button className={styles.secondary} type="button" disabled={busy} onClick={abandon}>{copy.adminAbandonAttempt}</button>
      </div>
    </div>}
    <p className={styles.message} role="status" aria-live="polite">{notice}</p>
  </section>;
}


function EventAdministratorsDisclosure({ eventId, eventName, accountId }: { eventId: string; eventName: string; accountId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [hasExpanded, setHasExpanded] = useState(false);
  const panelId = `event-administrators-${eventId}`;
  return <div className={styles.adminDisclosure}>
    <button className={styles.secondary} type="button" aria-expanded={expanded} aria-controls={panelId}
      onClick={() => { if (!expanded) setHasExpanded(true); setExpanded(!expanded); }}>
      {expanded ? copy.adminHide : copy.adminShow}
    </button>
    {hasExpanded && <div id={panelId} hidden={!expanded}><EventAdministrators eventId={eventId} eventName={eventName} accountId={accountId} /></div>}
  </div>;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(copy.invalidServerResponse);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : copy.genericError;
}

/** Besked vid inloggning som är fel (läses upp direkt); övriga är lägesbesked. */
const loginProblems = new Set<string>([copy.invalidCredentials, copy.loginRateLimited, copy.accountBlocked]);

export function OrganizerWorkspace() {
  const [session, setSession] = useState<Session>();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [events, setEvents] = useState<OrganizerMyEventsResponse["events"]>([]);
  const [eventSearch, setEventSearch] = useState("");
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [attempt, setAttempt] = useState<OrganizerCreateAttempt>();
  const [created, setCreated] = useState<OrganizerEventCreateResponse>();
  const [showAnotherForm, setShowAnotherForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enteringRaceId, setEnteringRaceId] = useState<string>();
  const [message, setMessage] = useState("");
  const createHeadingRef = useRef<HTMLHeadingElement>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const receiptFocusPendingRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!session || !attempt) return;
    createHeadingRef.current?.focus({ preventScroll: true });
    createHeadingRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [session?.accountId, attempt?.requestId]);

  useEffect(() => {
    if (!session || !created || !eventsLoaded || receiptFocusPendingRef.current !== created.requestId) return;
    receiptFocusPendingRef.current = undefined;
    createHeadingRef.current?.focus({ preventScroll: true });
    createHeadingRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [session?.accountId, created?.requestId, eventsLoaded]);

  useEffect(() => {
    if (!session || !created || !showAnotherForm) return;
    createNameRef.current?.focus({ preventScroll: true });
    createNameRef.current?.scrollIntoView({ behavior: "auto", block: "nearest" });
  }, [session?.accountId, created?.requestId, showAnotherForm]);

  async function loadEvents() {
    setEventsLoaded(false);
    setEventsError("");
    try {
      const response = await fetch("/api/organizer/events", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSession(undefined);
        setEvents([]);
        setEventSearch("");
        setCreated(undefined);
        setShowAnotherForm(false);
        throw new Error(copy.sessionExpired);
      }
      if (!response.ok) throw new Error(copy.eventsLoadError(response.status));
      const parsed = parseOrganizerEvents(await responseJson(response));
      setEvents(parsed.events);
    } catch (error) {
      setEventsError(errorMessage(error));
      throw error;
    } finally {
      setEventsLoaded(true);
    }
  }

  async function checkSession() {
    try {
      const response = await fetch("/api/organizer/session", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSession(undefined);
        setEventSearch("");
        setCreated(undefined);
        setShowAnotherForm(false);
        return;
      }
      if (!response.ok) throw new Error(copy.sessionCheckError(response.status));
      const current = parseOrganizerSession(await responseJson(response));
      setSession(current);
      await loadEvents();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSessionChecked(true);
    }
  }

  useEffect(() => {
    setAttempt(restoreOrganizerAttempt());
    void checkSession();
  }, []);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(copy.registering);
    try {
      const response = await fetch("/api/organizer/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ formatVersion: 1, email: email.trim(), displayName: displayName.trim(), password })
      });
      if (!response.ok) throw new Error(response.status === 409 ? copy.emailTaken : response.status === 429 ? copy.registerRateLimited
        : response.status === 400 ? copy.registerInvalid : copy.registerError(response.status));
      setSession(parseOrganizerSession(await responseJson(response)));
      setMessage("");
      try {
        await loadEvents();
      } catch (error) {
        setMessage(errorMessage(error));
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(copy.loggingIn);
    try {
      const request = parseOrganizerLoginRequest(email, password);
      const response = await fetch("/api/organizer/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request)
      });
      if (!response.ok) throw new Error(response.status === 401 ? copy.invalidCredentials
        : response.status === 429 ? copy.loginRateLimited : response.status === 403 ? copy.accountBlocked
          : copy.loginError(response.status));
      setSession(parseOrganizerSession(await responseJson(response)));
      setMessage("");
      try {
        await loadEvents();
      } catch (error) {
        setMessage(errorMessage(error));
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  async function submitCreate(current: OrganizerCreateAttempt) {
    setBusy(true);
    setMessage(copy.creatingEvent);
    try {
      if (!session || session.accountId !== current.accountId) {
        throw new Error(copy.attemptBelongsToOtherAccount);
      }
      const response = await fetch("/api/organizer/events", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `organizer-event-create:${current.requestId}`,
          "x-otid-csrf": readOrganizerCsrf(document.cookie, new URL(window.location.href))
        },
        body: JSON.stringify(current.request)
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setSession(undefined);
        if (response.status === 409) throw new Error(copy.requestIdConflict);
        if (response.status === 400) {
          clearOrganizerAttempt();
          setAttempt(undefined);
          throw new Error(copy.invalidEvent);
        }
        throw new Error(response.status === 401 || response.status === 403
          ? copy.sessionNeedsRenewal(response.status)
          : copy.uncertainResponse(response.status));
      }
      const result = parseOrganizerCreateResponse(await responseJson(response), current);
      clearOrganizerAttempt();
      setAttempt(undefined);
      receiptFocusPendingRef.current = result.requestId;
      const refreshedEvents = loadEvents();
      setCreated(result);
      setShowAnotherForm(false);
      setMessage("");
      try {
        await refreshedEvents;
      } catch (error) {
        setMessage(copy.eventCreatedButListFailed(errorMessage(error)));
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const request = organizerEventCreateRequestSchema.parse({
        formatVersion: 1,
        eventName: form.get("eventName"),
        raceName: form.get("raceName"),
        raceDate: form.get("raceDate"),
        timeZone: form.get("timeZone"),
        raceType: form.get("raceType")
      });
      if (!session) throw new Error(copy.sessionExpired);
      const current = createOrganizerAttempt(request, session.accountId, () => crypto.randomUUID());
      saveOrganizerAttempt(current);
      setAttempt(current);
      setCreated(undefined);
      await submitCreate(current);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function cancelAttempt() {
    clearOrganizerAttempt();
    setAttempt(undefined);
    setMessage(copy.attemptAbandoned);
  }

  async function logout() {
    setBusy(true);
    setMessage(copy.loggingOut);
    try {
      const response = await fetch("/api/organizer/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-otid-csrf": readOrganizerCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) throw new Error(copy.logoutError(response.status));
      setSession(undefined);
      setEvents([]);
      setEventSearch("");
      setEventsLoaded(false);
      setCreated(undefined);
      setShowAnotherForm(false);
      setMode("login");
      setMessage(copy.loggedOut);
    } catch (error) {
      setMessage(copy.checkSessionBeforeContinue(errorMessage(error)));
    } finally {
      setBusy(false);
    }
  }

  async function enterRace(raceId: string) {
    setEnteringRaceId(raceId);
    setMessage(copy.openingRace);
    try {
      const response = await fetch(`/api/organizer/races/${encodeURIComponent(raceId)}/enter`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-otid-csrf": readOrganizerCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok) throw new Error(copy.enterRaceError(response.status));
      parseOrganizerEnterResponse(await responseJson(response), raceId);
      window.location.assign(`/admin/${encodeURIComponent(raceId)}/manage`);
    } catch (error) {
      setMessage(errorMessage(error));
      setEnteringRaceId(undefined);
    }
  }

  const attemptMatchesSession = !!session && !!attempt && attempt.accountId === session.accountId;
  const attemptBelongsToOtherAccount = !!session && !!attempt && attempt.accountId !== session.accountId;
  const searchTerm = eventSearch.trim().normalize("NFC").toLocaleLowerCase("sv-SE");
  const visibleEvents = searchTerm
    ? events.filter((event) => event.eventName.normalize("NFC").toLocaleLowerCase("sv-SE").includes(searchTerm)
      || event.races.some((race) => race.raceName.normalize("NFC").toLocaleLowerCase("sv-SE").includes(searchTerm)))
    : events;

  return <main className={styles.main}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>O-Tid · Arrangör</p><h1>{copy.yourEvents}</h1>
        {session && events.length > 0 && <a className={styles.createJump} href="#organizer-create-event">{copy.createJump}</a>}</div>
      {session && <div className={styles.account}><span>{session.displayName}</span>
        {session.superadmin && <Link href="/superadmin">{copy.superadmin}</Link>}
        <Link href="/konto">{copy.myAccount}</Link>
        <button className={styles.secondary} type="button" disabled={busy} onClick={() => void logout()}>{copy.logout}</button>
      </div>}
    </header>

    {!sessionChecked && <section className={styles.panel} aria-live="polite"><p>{copy.checkSession}</p></section>}

    {sessionChecked && !session && mode === "login" && <section className={`${styles.panel} ${styles.narrow} ${styles.loginPanel}`}>
      <h2>{copy.login}</h2>
      <p className={styles.muted}>{copy.loginHint}</p>
      <form className={styles.form} onSubmit={(event) => void login(event)}>
        <label>{copy.email}
          <input type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email}
            onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>{copy.password}
          <input type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button type="submit" disabled={busy || !email || !password} aria-busy={busy}>{copy.login}</button>
        {message && <p className={styles.loginMessage} role={loginProblems.has(message) ? "alert" : "status"} aria-live="polite">{message}</p>}
      </form>
      <nav className={styles.loginLinks} aria-label={copy.accountHelp}>
        <button type="button" className={styles.secondary} onClick={() => { setMode("register"); setMessage(""); }}>{copy.toRegister}</button>
        <Link href="/recover">{copy.forgotPassword}</Link>
      </nav>
    </section>}

    {sessionChecked && !session && mode === "register" && <section className={`${styles.panel} ${styles.narrow} ${styles.loginPanel}`}>
      <h2>{copy.register}</h2>
      <p className={styles.muted}>{copy.registerHint}</p>
      <form className={styles.form} onSubmit={(event) => void register(event)}>
        <label>{copy.displayName}
          <input autoComplete="name" value={displayName} maxLength={120}
            onChange={(event) => setDisplayName(event.target.value)} required />
        </label>
        <label>{copy.email}
          <input type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} maxLength={254}
            onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>{copy.password}
          <input type="password" autoComplete="new-password" minLength={8} value={password} aria-describedby="register-password-rule"
            onChange={(event) => setPassword(event.target.value)} required />
          <small id="register-password-rule" className={styles.muted}>{copy.passwordRule}</small>
        </label>
        <p className={styles.muted}>{copy.registerPrivacy} <Link href="/integritet">{copy.privacyLink}</Link></p>
        <button type="submit" disabled={busy || !email || !displayName.trim() || password.length < 8} aria-busy={busy}>{copy.register}</button>
        {message && <p className={styles.loginMessage} role={message === copy.registering ? "status" : "alert"} aria-live="polite">{message}</p>}
      </form>
      <nav className={styles.loginLinks} aria-label={copy.accountHelp}>
        <button type="button" className={styles.secondary} onClick={() => { setMode("login"); setMessage(""); }}>{copy.toLogin}</button>
      </nav>
    </section>}

    {session && <div className={styles.columns}>
      <section className={`${styles.panel} ${styles.events}`}>
        <div className={styles.sectionHeading}><div><h2>{copy.eventsSection}</h2><p className={styles.muted}>{copy.eventsHint}</p></div>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void loadEvents().catch((error) => setMessage(errorMessage(error)))}>{copy.refresh}</button>
        </div>
        {!eventsLoaded && <p aria-live="polite">{copy.loadingEvents}</p>}
        {eventsLoaded && eventsError && <p role="alert">{eventsError}</p>}
        {eventsLoaded && !eventsError && events.length === 0 && <div className={styles.empty}><strong>{copy.noEvents}</strong><p>{copy.noEventsHint}</p><a href="#organizer-create-event">{copy.noEventsCreateLink}</a></div>}
        {eventsLoaded && !eventsError && events.length > 0 && <div className={styles.eventFinder}>
          <label htmlFor="organizer-event-search">{copy.eventSearchLabel}</label>
          <div className={styles.eventFinderControls}>
            <input id="organizer-event-search" type="search" value={eventSearch}
              onChange={(event) => setEventSearch(event.target.value)} autoComplete="off" />
            {eventSearch && <button type="button" className={styles.secondary} onClick={() => setEventSearch("")}>{copy.clearEventSearch}</button>}
          </div>
        </div>}
        {eventsLoaded && !eventsError && events.length > 0 && visibleEvents.length === 0 && <p className={styles.noEventMatches} role="status">{copy.noEventMatches}</p>}
        {eventsLoaded && !eventsError && visibleEvents.length > 0 && <ul className={styles.eventList}>
          {visibleEvents.map((event) => <li className={styles.event} key={event.eventId}>
            <div className={styles.eventHeading}>
              <h3>{event.eventName}</h3>
              <span className={styles.eventRole}>{copy.eventRole[event.role]}</span>
            </div>
            <p className={styles.eventMeta}>{event.startsOn} · {event.timeZone} · {event.races.length} {copy.raceCountLabel}</p>
            {event.role === "OWNER" && <EventAdministratorsDisclosure eventId={event.eventId} eventName={event.eventName} accountId={session.accountId} />}
            <ul className={styles.raceList}>{event.races.map((race) => <li key={race.raceId}>
              <div><strong>{race.raceName}</strong><span>{race.raceDate} · {raceTypeSv.types[race.raceType].name}</span></div>
              <button type="button" className={styles.secondary} disabled={busy || enteringRaceId !== undefined} aria-busy={enteringRaceId === race.raceId}
                onClick={() => void enterRace(race.raceId)}>{enteringRaceId === race.raceId ? copy.opening : copy.openRace}</button>
            </li>)}</ul>
          </li>)}
        </ul>}
      </section>

      <section id="organizer-create-event" className={`${styles.panel} ${styles.createPanel}`}>
        <h2 ref={createHeadingRef} tabIndex={-1}>{copy.createEvent}</h2>
        {!attempt && (!created || showAnotherForm) && <><p className={styles.muted}>{copy.createHint}</p>
          <form className={`${styles.form} ${styles.createForm}`} onSubmit={(event) => void create(event)}>
            <label>{copy.eventName}<input ref={createNameRef} name="eventName" required minLength={2} maxLength={160} disabled={busy} /></label>
            <label>{copy.raceName}<input name="raceName" required minLength={2} maxLength={160} disabled={busy} /></label>
            <div className={styles.createDateZone}>
              <label>{copy.date}<input name="raceDate" type="date" required disabled={busy} /></label>
              <label>{copy.timeZone}<input name="timeZone" defaultValue="Europe/Stockholm" required maxLength={100} disabled={busy} /></label>
            </div>
            <RaceTypeChoice name="raceType" defaultValue="STANDARD" disabled={busy} />
            <button type="submit" disabled={busy} aria-busy={busy}>{copy.createEvent}</button>
          </form></>}
        {attempt && <div className={styles.uncertain} role="alert">
          <h3>{attemptMatchesSession ? copy.createUnconfirmed : copy.savedAttemptOtherAccountTitle}</h3>
          <p>{attemptBelongsToOtherAccount ? copy.attemptBelongsToOtherAccount : copy.createUnconfirmedHint}</p>
          <dl><dt>{copy.requestId}</dt><dd>{attempt.requestId}</dd>
            <dt>{copy.eventName}</dt><dd>{attempt.request.eventName}</dd>
            <dt>{copy.raceName}</dt><dd>{attempt.request.raceName}</dd>
            <dt>{copy.date}</dt><dd>{attempt.request.raceDate}</dd>
            <dt>{raceTypeSv.typeLegend}</dt><dd>{raceTypeSv.types[attempt.request.raceType ?? "STANDARD"].name}</dd>
            <dt>{copy.timeZone}</dt><dd>{attempt.request.timeZone}</dd></dl>
          <div className={styles.actions}>
            {attemptMatchesSession && <button type="button" disabled={busy || !session} onClick={() => void submitCreate(attempt)}>{copy.retrySameAttempt}</button>}
            <button type="button" className={styles.secondary} disabled={busy} onClick={cancelAttempt}>{attemptBelongsToOtherAccount ? copy.abandonSavedAttempt : copy.abandonAttempt}</button>
          </div>
        </div>}
        {created && !attempt && !showAnotherForm && <div className={styles.confirmed} role="status">
          <strong>{created.replayed ? copy.createdOnRetry : copy.created}</strong>
          <p>{copy.nowInYourEvents}</p>
          <dl className={styles.createReceipt}><dt>{copy.createdAt}</dt><dd><time dateTime={created.createdAt}>{new Date(created.createdAt).toLocaleString("sv-SE")}</time></dd></dl>
          <div className={styles.actions}>
            <button type="button" disabled={busy || enteringRaceId !== undefined} aria-busy={enteringRaceId === created.raceId}
              onClick={() => void enterRace(created.raceId)}>{enteringRaceId === created.raceId ? copy.opening : copy.openRace}</button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setShowAnotherForm(true); setMessage(""); }}>{copy.createAnotherEvent}</button>
          </div>
        </div>}
      </section>
    </div>}

    {session && <p className={styles.message} role="status" aria-live="polite">{message}</p>}
  </main>;
}
