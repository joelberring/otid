"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  organizerEventCreateRequestSchema,
  type OrganizerEventCreateResponse,
  type OrganizerMyEventsResponse
} from "@o-tid/contracts";
import {
  clearOrganizerAttempt,
  createOrganizerAttempt,
  parseOrganizerCreateResponse,
  parseOrganizerEnterResponse,
  parseOrganizerEvents,
  parseOrganizerLoginRequest,
  parseOrganizerSession,
  readOrganizerCsrf,
  restoreOrganizerAttempt,
  saveOrganizerAttempt,
  type OrganizerCreateAttempt
} from "../lib/organizer-client";
import { organizerSv as copy } from "../i18n/organizer-sv";
import { raceTypeSv } from "../i18n/race-type-sv";
import { RaceTypeChoice } from "./race-type-choice";
import { CopyRaceDialog, type CopySource } from "./copy-race-dialog";
import { raceCopySv } from "../i18n/race-copy-sv";
import styles from "./organizer-workspace.module.css";

type Session = { accountId: string; email: string; displayName: string; superadmin: boolean; expiresAt: string };

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
  const [copySource, setCopySource] = useState<CopySource>();
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
            <ul className={styles.raceList}>{event.races.map((race) => <li key={race.raceId}>
              <div><strong>{race.raceName}</strong><span>{race.raceDate} · {raceTypeSv.types[race.raceType].name}</span></div>
              <div className={styles.raceActions}>
                {event.role !== "FUNCTIONARY" && <button type="button" className={styles.secondary} disabled={busy || enteringRaceId !== undefined}
                  aria-label={raceCopySv.actionLabel(race.raceName)} onClick={() => setCopySource({ raceId: race.raceId, eventName: event.eventName,
                    raceName: race.raceName, raceDate: race.raceDate })}>{raceCopySv.action}</button>}
                <button type="button" className={styles.secondary} disabled={busy || enteringRaceId !== undefined} aria-busy={enteringRaceId === race.raceId}
                  onClick={() => void enterRace(race.raceId)}>{enteringRaceId === race.raceId ? copy.opening : copy.openRace}</button>
              </div>
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
    <CopyRaceDialog source={copySource} onClose={() => setCopySource(undefined)}
      onCopied={() => void loadEvents().catch((error) => setMessage(errorMessage(error)))} />
  </main>;
}
