"use client";

import { takeAfterLogin } from "../lib/after-login";
import { raceBackupEn } from "../i18n/workspace-small-en";
import { raceCopyEn } from "../i18n/workspace-tools-en";
import { raceTypeEn } from "../i18n/workspace-en";
import { ClubStep } from "./club-affiliation/club-step";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { organizerEventCreateRequestSchema, type OrganizerMyEventsResponse } from "@o-tid/contracts";
import {
  clearOrganizerAttempt,
  createOrganizerAttempt,
  parseOrganizerCreateResponse,
  parseOrganizerEvents,
  parseOrganizerLoginRequest,
  parseOrganizerSession,
  parseOrganizerSessionStatus,
  readOrganizerCsrf,
  restoreOrganizerAttempt,
  saveOrganizerAttempt,
  type OrganizerCreateAttempt
} from "../lib/organizer-client";
import { organizerSv } from "../i18n/organizer-sv";
import { organizerEn } from "../i18n/organizer-en";
import { useTexts } from "./language-provider";
import type { Texts } from "../lib/language";

type Copy = Texts<typeof organizerSv>;
import { raceTypeSv } from "../i18n/race-type-sv";
import { RaceTypeChoice } from "./race-type-choice";
import { HelpButton } from "./help/help-panel";
import { CopyRaceDialog, type CopySource } from "./copy-race-dialog";
import { RestoreRaceDialog } from "./restore-race-dialog";
import { raceBackupSv } from "../i18n/race-backup-sv";
import { raceCopySv } from "../i18n/race-copy-sv";
import { hasErrors, validateCreateRace, type CreateRaceInput, type FieldErrors } from "../lib/form-validation";
import { DateInput, Field, focusFirstError } from "./ui";
import { splitMyEvents } from "../lib/my-events-order";
import { raceListName } from "../lib/race-list-name";
import { MyPlacesStrip } from "./my-places-strip";
import { AccountMenu } from "./account-menu";
import { applyClubMap, ClubMapChoiceField, type ClubMapChoice } from "./club-archive/club-map-picker";
import { clubMapDuplicatesSv } from "../i18n/club-map-duplicates-sv";
import { readInvitationHandoff, takeInvitationNext } from "../lib/invitation-handoff";
import { NewPasswordFields, PasswordInput, passwordsReady } from "./password-field";
import styles from "./organizer-workspace.module.css";

type Session = { accountId: string; email: string; displayName: string; superadmin: boolean; expiresAt: string; emailVerified?: boolean | undefined };

async function responseJson(copy: Copy, response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(copy.invalidServerResponse);
  }
}

function errorMessage(copy: Copy, error: unknown): string {
  return error instanceof Error ? error.message : copy.genericError;
}

/** Besked vid inloggning som är fel (läses upp direkt); övriga är lägesbesked. */
const loginProblems = (copy: Copy) => new Set<string>([copy.invalidCredentialsOrUnverified, copy.loginRateLimited, copy.accountBlocked,
  ...Object.values(copy.googleProblem)]);

/** ADR-0205: beskedet efter en misslyckad Google-inloggning (`/organizer?google=…`), som sedan tas bort ur adressen. */
function takeGoogleProblem(copy: Copy): string | undefined {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("google");
  if (code === null) return undefined;
  url.searchParams.delete("google");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return Object.hasOwn(copy.googleProblem, code) ? copy.googleProblem[code as keyof typeof copy.googleProblem] : copy.googleProblem.fel;
}

/** ADR-0205 tillägg: beskedet efter utloggningen (`/organizer?utloggad=1|alla`), som sedan tas bort ur adressen. */
function takeLoggedOut(copy: Copy): string | undefined {
  const url = new URL(window.location.href);
  const value = url.searchParams.get("utloggad");
  if (value === null) return undefined;
  url.searchParams.delete("utloggad");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return value === "alla" ? copy.loggedOutEverywhere : copy.loggedOut;
}

/**
 * ADR-0205: "Logga in med Google" när servern har en Google-klient (en vanlig länk; servern skickar vidare till Google).
 * "Kom ihåg mig på den här datorn" följer med (`?remember=1`).
 */
function GoogleLogin({ remember, copy }: { remember: boolean; copy: Copy }) {
  return <div className={styles.googleLogin}>
    <p className={styles.googleOr}><span>{copy.googleOr}</span></p>
    <a className={styles.googleButton} href={remember ? "/api/account/google/start?remember=1" : "/api/account/google/start"}>{copy.googleLogin}</a>
    <p className={styles.muted}>{copy.googleHint}</p>
  </div>;
}

export function OrganizerWorkspace({ googleEnabled = false }: { googleEnabled?: boolean }) {
  const backupText = useTexts(raceBackupSv, raceBackupEn);
  const raceCopyText = useTexts(raceCopySv, raceCopyEn);
  const raceTypeText = useTexts(raceTypeSv, raceTypeEn);
  const copy = useTexts(organizerSv, organizerEn);
  const [session, setSession] = useState<Session>();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  /** ADR-0205 tillägg: "Kom ihåg mig på den här datorn", av som förval (en kort inloggning och en sessionskaka). */
  const [remember, setRemember] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  /** ADR-0206: "Skapa konto" från en inbjudan låser adressen till inbjudans. */
  const [lockedEmail, setLockedEmail] = useState(false);
  const [events, setEvents] = useState<OrganizerMyEventsResponse["events"]>([]);
  const [eventSearch, setEventSearch] = useState("");
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [attempt, setAttempt] = useState<OrganizerCreateAttempt>();
  const [createErrors, setCreateErrors] = useState<FieldErrors<keyof CreateRaceInput>>({});
  const [busy, setBusy] = useState(false);
  const [enteringRaceId, setEnteringRaceId] = useState<string>();
  const [copySource, setCopySource] = useState<CopySource>();
  const [restoreOpen, setRestoreOpen] = useState(false);
  /** ADR-0210: kartan ur klubbarkivet som den nya tävlingen får (valfritt). */
  const [clubMap, setClubMap] = useState<ClubMapChoice>();
  const [message, setMessage] = useState("");
  const createHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!session || !attempt) return;
    createHeadingRef.current?.focus({ preventScroll: true });
    createHeadingRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [session?.accountId, attempt?.requestId]);

  async function loadEvents() {
    setEventsLoaded(false);
    setEventsError("");
    try {
      const response = await fetch("/api/organizer/events", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setSession(undefined);
        setEvents([]);
        setEventSearch("");
        throw new Error(copy.sessionExpired);
      }
      if (!response.ok) throw new Error(copy.eventsLoadError(response.status));
      const parsed = parseOrganizerEvents(await responseJson(copy, response));
      setEvents(parsed.events);
    } catch (error) {
      setEventsError(errorMessage(copy, error));
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
        return;
      }
      if (!response.ok) throw new Error(copy.sessionCheckError(response.status));
      const current = parseOrganizerSessionStatus(await responseJson(copy, response));
      if (!current) {
        setSession(undefined);
        setEventSearch("");
        return;
      }
      setSession(current);
      // ADR-0206: redan inloggad med inbjudans adress – direkt till klubben eller tävlingen.
      const next = takeInvitationNext(current.email) ?? takeAfterLogin();
      if (next) { window.location.assign(next); return; }
      await loadEvents();
    } catch (error) {
      setMessage(errorMessage(copy, error));
    } finally {
      setSessionChecked(true);
    }
  }

  useEffect(() => {
    setAttempt(restoreOrganizerAttempt());
    const invitation = readInvitationHandoff();
    if (invitation) { setMode(invitation.mode); setEmail(invitation.email); setLockedEmail(invitation.mode === "register"); }
    const googleProblem = takeGoogleProblem(copy);
    if (googleProblem) setMessage(googleProblem);
    const loggedOut = takeLoggedOut(copy);
    if (loggedOut) setMessage(loggedOut);
    void checkSession();
  }, []);

  /** ADR-0206: efter inloggningen till sidan i inbjudan (om kontot har dess adress). */
  function followInvitation(accountEmail: string): boolean {
    const next = takeInvitationNext(accountEmail) ?? takeAfterLogin();
    if (next) window.location.assign(next);
    return next !== undefined;
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordsReady(password, repeat)) return;
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
      // ADR-0186: med e-post på servern kommer länken med e-post (samma besked oavsett om adressen redan hade ett konto).
      if (response.status === 202) {
        setMode("login");
        setMessage(copy.checkEmail(email.trim()));
        return;
      }
      const signedIn = parseOrganizerSession(await responseJson(copy, response));
      if (followInvitation(signedIn.email)) return;
      setSession(signedIn);
      setMessage("");
      try {
        await loadEvents();
      } catch (error) {
        setMessage(errorMessage(copy, error));
      }
    } catch (error) {
      setMessage(errorMessage(copy, error));
    } finally {
      setPassword("");
      setRepeat("");
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
        body: JSON.stringify({ ...request, remember })
      });
      if (!response.ok) throw new Error(response.status === 401 ? copy.invalidCredentialsOrUnverified
        : response.status === 429 ? copy.loginRateLimited : response.status === 403 ? copy.accountBlocked
          : copy.loginError(response.status));
      const signedIn = parseOrganizerSession(await responseJson(copy, response));
      if (followInvitation(signedIn.email)) return;
      setSession(signedIn);
      setMessage("");
      try {
        await loadEvents();
      } catch (error) {
        setMessage(errorMessage(copy, error));
      }
    } catch (error) {
      setMessage(errorMessage(copy, error));
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
      const result = parseOrganizerCreateResponse(await responseJson(copy, response), current);
      clearOrganizerAttempt();
      setAttempt(undefined);
      // ADR-0210: kartan ur klubbarkivet blir tävlingens kartfil, och banläggningen öppnas med den.
      if (clubMap) {
        const problem = await applyClubMap(clubMap, result.raceId, stage => setMessage(clubMapDuplicatesSv.picker.working[stage]));
        setClubMap(undefined);
        if (problem) {
          setMessage(problem);
          window.setTimeout(() => enterRace(result.raceId, "course-setting"), 2500);
          return;
        }
        enterRace(result.raceId, "course-setting");
        return;
      }
      // PLAN.md steg 24: direkt in i den nya tävlingens arbetsyta.
      setMessage(copy.created);
      enterRace(result.raceId);
    } catch (error) {
      setMessage(errorMessage(copy, error));
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const value = (name: string) => { const field = form.get(name); return typeof field === "string" ? field : ""; };
    const input = { eventName: value("eventName"), stageName: value("raceName"), raceDate: value("raceDate").trim(), timeZone: value("timeZone") };
    // Svenska fältfel i stället för webbläsarens (PLAN.md steg 24).
    const errors = validateCreateRace(input);
    setCreateErrors(errors);
    if (hasErrors(errors)) { focusFirstError(element); return; }
    try {
      const request = organizerEventCreateRequestSchema.parse({
        formatVersion: 1,
        eventName: input.eventName,
        raceName: input.stageName.trim(),
        raceDate: input.raceDate,
        timeZone: input.timeZone.trim(),
        raceType: form.get("raceType")
      });
      if (!session) throw new Error(copy.sessionExpired);
      const current = createOrganizerAttempt(request, session.accountId, () => crypto.randomUUID());
      saveOrganizerAttempt(current);
      setAttempt(current);
      await submitCreate(current);
    } catch (error) {
      setMessage(errorMessage(copy, error));
    }
  }

  function cancelAttempt() {
    clearOrganizerAttempt();
    setAttempt(undefined);
    setMessage(copy.attemptAbandoned);
  }

  /** Kontots session gäller tävlingen direkt (ADR-0173 beslut 4): arbetsytan öppnas utan eget steg. */
  function enterRace(raceId: string, page: "manage" | "course-setting" | "course-setting/map-errors" = "manage") {
    setEnteringRaceId(raceId);
    setMessage(copy.openingRace);
    window.location.assign(`/admin/${encodeURIComponent(raceId)}/${page}`);
  }

  const attemptMatchesSession = !!session && !!attempt && attempt.accountId === session.accountId;
  const attemptBelongsToOtherAccount = !!session && !!attempt && attempt.accountId !== session.accountId;
  const searchTerm = eventSearch.trim().normalize("NFC").toLocaleLowerCase("sv-SE");
  // PLAN.md steg 27: idag och kommande först, sedan gångna. Ägaren 2026-11-04: de gångna fälls ihop; sökningen gäller båda.
  const matches = (event: OrganizerMyEventsResponse["events"][number]) => !searchTerm
    || event.eventName.normalize("NFC").toLocaleLowerCase("sv-SE").includes(searchTerm)
    || event.races.some((race) => race.raceName.normalize("NFC").toLocaleLowerCase("sv-SE").includes(searchTerm));
  const split = splitMyEvents(events, new Date());
  const currentEvents = split.current.filter(matches);
  const pastEvents = split.past.filter(matches);
  const visibleCount = currentEvents.length + pastEvents.length;

  const renderEvent = (event: OrganizerMyEventsResponse["events"][number]) => <li className={styles.event} key={event.eventId}>
            <div className={styles.eventHeading}>
              <h3>{event.eventName}</h3>
              <span className={styles.eventRole}>{copy.eventRole[event.role]}</span>
            </div>
            <p className={styles.eventMeta}>{event.startsOn} · {event.timeZone} · {event.races.length} {copy.raceCountLabel}</p>
            <ul className={styles.raceList}>{event.races.map((race) => {
              // Loppets namn är valfritt: ett ensamt lopp utan namn visar datumet, flera visar "Lopp N".
              const name = raceListName(race, event.races, copy.raceNumber);
              return <li key={race.raceId}>
              <div><strong>{name ?? race.raceDate}</strong><span>{name ? `${race.raceDate} · ` : ""}{raceTypeText.types[race.raceType].name}</span></div>
              <div className={styles.raceActions}>
                {(event.role === "OWNER" || event.role === "ADMIN") && <button type="button" className={styles.secondary} disabled={busy || enteringRaceId !== undefined}
                  aria-label={raceCopyText.actionLabel(name ?? event.eventName)} onClick={() => setCopySource({ raceId: race.raceId, eventName: event.eventName,
                    raceName: race.raceName, raceDate: race.raceDate })}>{raceCopyText.action}</button>}
                {event.role !== "COURSE_SETTER" && <button type="button" className={styles.secondary} disabled={busy || enteringRaceId !== undefined}
                  aria-busy={enteringRaceId === race.raceId} onClick={() => enterRace(race.raceId)}>
                  {enteringRaceId === race.raceId ? copy.opening : copy.openRace}</button>}
                {/* Ägaren 2026-11-03: banläggningen direkt från listan, för ägare och administratörer och för den som har
                    banläggningens behörighet (alla tävlingstyper, också fest och rogaining). */}
                {(race.courseSetting || event.role === "OWNER" || event.role === "ADMIN") &&
                  <button type="button" className={styles.secondary} disabled={busy || enteringRaceId !== undefined} data-testid="open-course-setting"
                  onClick={() => enterRace(race.raceId, race.courseSetting === "MAP" ? "course-setting/map-errors" : "course-setting")}>
                  {race.courseSetting === "MAP" ? copy.openMapErrors : copy.openCourseSetting}</button>}
              </div>
            </li>;
            })}</ul>
          </li>;

  return <main className={styles.main}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>{copy.kicker}</p><h1>{copy.yourEvents}</h1>
        {session && events.length > 0 && <a className={styles.createJump} href="#organizer-create-event">{copy.createJump}</a>}</div>
      {session && <div className={styles.account}>
        {session.superadmin && <Link href="/superadmin">{copy.superadmin}</Link>}
        <HelpButton view="EVENTS" />
        <AccountMenu who={{ displayName: session.displayName, email: session.email }} />
      </div>}
      {!session && <HelpButton view="EVENTS" />}
    </header>

    {!sessionChecked && <section className={styles.panel} aria-live="polite"><p>{copy.checkSession}</p></section>}
    {session?.emailVerified === false && <section className={styles.panel} data-testid="unverified-email"><p>{copy.unverifiedNotice}</p></section>}

    {sessionChecked && !session && mode === "login" && <section className={`${styles.panel} ${styles.narrow} ${styles.loginPanel}`}>
      <h2>{copy.login}</h2>
      <p className={styles.muted}>{copy.loginHint}</p>
      <form className={styles.form} onSubmit={(event) => void login(event)}>
        <label>{copy.email}
          <input type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email}
            onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <PasswordInput label={copy.password} value={password} onChange={setPassword} autoComplete="current-password" />
        <div className={styles.remember}>
          <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> {copy.remember}</label>
          <p className={styles.muted}>{copy.rememberHint}</p>
        </div>
        <button type="submit" disabled={busy || !email || !password} aria-busy={busy}>{copy.login}</button>
        {message && <p className={styles.loginMessage} role={loginProblems(copy).has(message) ? "alert" : "status"} aria-live="polite">{message}</p>}
      </form>
      {googleEnabled && <GoogleLogin remember={remember} copy={copy} />}
      <nav className={styles.loginLinks} aria-label={copy.accountHelp}>
        <button type="button" className={styles.secondary} onClick={() => { setMode("register"); setMessage(""); setRepeat(""); }}>{copy.toRegister}</button>
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
            readOnly={lockedEmail} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <NewPasswordFields password={password} repeat={repeat} onPassword={setPassword} onRepeat={setRepeat} />
        <p className={styles.muted}>{copy.registerPrivacy} <Link href="/integritet">{copy.privacyLink}</Link></p>
        <button type="submit" disabled={busy || !email || !displayName.trim() || !passwordsReady(password, repeat)} aria-busy={busy}>{copy.register}</button>
        {message && <p className={styles.loginMessage} role={message === copy.registering ? "status" : "alert"} aria-live="polite">{message}</p>}
      </form>
      {googleEnabled && <GoogleLogin remember={false} copy={copy} />}
      <nav className={styles.loginLinks} aria-label={copy.accountHelp}>
        <button type="button" className={styles.secondary} onClick={() => { setMode("login"); setMessage(""); setRepeat(""); }}>{copy.toLogin}</button>
      </nav>
    </section>}

    {/* ADR-0209: "Vilken klubb tillhör du?" efter registreringen (valfritt, tills det är besvarat). */}
    {session && <ClubStep />}
    {session && <MyPlacesStrip />}
    {session && <div className={styles.columns}>
      <section className={`${styles.panel} ${styles.events}`}>
        <div className={styles.sectionHeading}><div><h2>{copy.eventsSection}</h2><p className={styles.muted}>{copy.eventsHint}</p></div>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void loadEvents().catch((error) => setMessage(errorMessage(copy, error)))}>{copy.refresh}</button>
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
        {eventsLoaded && !eventsError && events.length > 0 && visibleCount === 0 && <p className={styles.noEventMatches} role="status">{copy.noEventMatches}</p>}
        {eventsLoaded && !eventsError && currentEvents.length > 0 && <ul className={styles.eventList}>
          {currentEvents.map(renderEvent)}
        </ul>}
        {/* Ägaren 2026-11-04: de som varit, senaste först, ihopfällda (öppna när sökningen hittar något bland dem). */}
        {eventsLoaded && !eventsError && pastEvents.length > 0 && <details className={styles.pastEvents} data-testid="past-events"
          open={searchTerm ? true : undefined} key={searchTerm ? "search" : "list"}>
          <summary>{copy.pastEvents(pastEvents.length)}</summary>
          <ul className={styles.eventList}>{pastEvents.map(renderEvent)}</ul>
        </details>}
      </section>

      <section id="organizer-create-event" className={`${styles.panel} ${styles.createPanel}`}>
        <h2 ref={createHeadingRef} tabIndex={-1}>{copy.createEvent}</h2>
        {!attempt && <><p className={styles.muted}>{copy.createHint}</p>
          <form className={`${styles.form} ${styles.createForm}`} noValidate onSubmit={(event) => void create(event)}>
            <Field label={copy.eventName} error={createErrors.eventName}><input name="eventName" maxLength={160} disabled={busy}
              onChange={() => createErrors.eventName && setCreateErrors({ ...createErrors, eventName: undefined })} /></Field>
            <Field label={copy.raceName} error={createErrors.stageName} help={copy.raceNameHelp}><input name="raceName" maxLength={160}
              disabled={busy} onChange={() => createErrors.stageName && setCreateErrors({ ...createErrors, stageName: undefined })} /></Field>
            <Field label={copy.date} error={createErrors.raceDate} className={styles.createDate}><DateInput name="raceDate"
              disabled={busy} onChange={() => createErrors.raceDate && setCreateErrors({ ...createErrors, raceDate: undefined })} /></Field>
            <RaceTypeChoice name="raceType" defaultValue="STANDARD" disabled={busy} />
            {/* Tidszonen behövs nästan aldrig: förvald Europe/Stockholm och ändras under "Mer". */}
            <details className={styles.more} open={createErrors.timeZone ? true : undefined}>
              <summary>{copy.more}</summary>
              <Field label={copy.timeZone} error={createErrors.timeZone} help={copy.timeZoneHelp}><input name="timeZone"
                defaultValue="Europe/Stockholm" maxLength={100} disabled={busy} /></Field>
            </details>
            <ClubMapChoiceField value={clubMap} disabled={busy} onChange={setClubMap} />
            <button type="submit" disabled={busy} aria-busy={busy}>{copy.createEvent}</button>
          </form>
          {/* ADR-0187: en säkerhetskopia blir en ny tävling (t.ex. på en ny server när den gamla har gått sönder). */}
          <div className={styles.restore}>
            <p className={styles.muted}>{backupText.restore.openHint}</p>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => setRestoreOpen(true)}>{backupText.restore.open}</button>
          </div></>}
        {attempt && <div className={styles.uncertain} role="alert">
          <h3>{attemptMatchesSession ? copy.createUnconfirmed : copy.savedAttemptOtherAccountTitle}</h3>
          <p>{attemptBelongsToOtherAccount ? copy.attemptBelongsToOtherAccount : copy.createUnconfirmedHint}</p>
          <dl><dt>{copy.eventName}</dt><dd>{attempt.request.eventName}</dd>
            <dt>{copy.raceName}</dt><dd>{attempt.request.raceName || copy.noRaceName}</dd>
            <dt>{copy.date}</dt><dd>{attempt.request.raceDate}</dd>
            <dt>{raceTypeText.typeLegend}</dt><dd>{raceTypeText.types[attempt.request.raceType ?? "STANDARD"].name}</dd>
            <dt>{copy.timeZone}</dt><dd>{attempt.request.timeZone}</dd></dl>
          <div className={styles.actions}>
            {attemptMatchesSession && <button type="button" disabled={busy || !session} onClick={() => void submitCreate(attempt)}>{copy.retrySameAttempt}</button>}
            <button type="button" className={styles.secondary} disabled={busy} onClick={cancelAttempt}>{attemptBelongsToOtherAccount ? copy.abandonSavedAttempt : copy.abandonAttempt}</button>
          </div>
        </div>}
      </section>
    </div>}

    {session && <p className={styles.message} role="status" aria-live="polite">{message}</p>}
    <RestoreRaceDialog open={restoreOpen} onClose={() => setRestoreOpen(false)}
      onRestored={() => void loadEvents().catch((error) => setMessage(errorMessage(copy, error)))} />
    <CopyRaceDialog source={copySource} onClose={() => setCopySource(undefined)}
      onCopied={() => void loadEvents().catch((error) => setMessage(errorMessage(copy, error)))} />
  </main>;
}
