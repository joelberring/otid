"use client";

import { takeAfterLogin } from "../lib/after-login";
import { clubMapDuplicatesEn } from "../i18n/club-space-en";
import { raceBackupEn } from "../i18n/workspace-small-en";
import { raceCopyEn } from "../i18n/workspace-tools-en";
import { raceTypeEn } from "../i18n/workspace-en";
import { ClubStep } from "./club-affiliation/club-step";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { organizerEventCreateRequestSchema, type OrganisationSummary, type OrganizerMyEventsResponse } from "@o-tid/contracts";
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
import { useLanguage, useTexts } from "./language-provider";
import { useRouter } from "next/navigation";
import { Logo } from "./brand/logo";
import { LanguageSwitch } from "./language-switch";
import { COURSE_TAB_HASH, OPEN_COURSE_EVENT } from "../lib/app-tabs";
import { sv } from "../i18n/sv";
import { formErrorsSv } from "../i18n/form-errors-sv";
import { formErrorsEn } from "../i18n/workspace-small-en";
import { raceMapSv } from "../i18n/race-map-sv";
import { raceMapEn } from "../i18n/workspace-small-en";
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
import { MyPlanTasks } from "./club-planning/my-plan-tasks";
import { AccountMenu } from "./account-menu";
import { AccountBenefits } from "./account-benefits";
import { applyClubMap, ClubMapChoiceField, type ClubMapChoice } from "./club-archive/club-map-picker";
import { OrganiserChoiceField } from "./club-affiliation/organiser-choice-field";
import { clubLeadersSv } from "../i18n/club-leaders-sv";
import { clubLeadersEn } from "../i18n/club-leaders-en";
import { clubMapDuplicatesSv } from "../i18n/club-map-duplicates-sv";
import { readInvitationHandoff, takeInvitationNext } from "../lib/invitation-handoff";
import { NewPasswordFields, PasswordInput, passwordsReady } from "./password-field";
import { HubChoices, HubNewHere } from "./organizer-hub/hub-choices";
import { HubStartCard } from "./organizer-hub/hub-start-card";
import { QuickCourse } from "./organizer-hub/quick-course";
import { TodayRaceCard } from "./organizer-hub/today-race-card";
import { createSubmitLabel, myClubHref } from "../lib/hub-start";
import { todayIn } from "../lib/my-events-order";
import type { ClubSummary, RaceType } from "@o-tid/contracts";
import hubStyles from "./organizer-hub/organizer-hub.module.css";
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
  const clubMapDuplicatesText = useTexts(clubMapDuplicatesSv, clubMapDuplicatesEn), raceMapText = useTexts(raceMapSv, raceMapEn);
  const backupText = useTexts(raceBackupSv, raceBackupEn);
  const raceCopyText = useTexts(raceCopySv, raceCopyEn);
  const raceTypeText = useTexts(raceTypeSv, raceTypeEn);
  const formErrorText = useTexts(formErrorsSv, formErrorsEn);
  const copy = useTexts(organizerSv, organizerEn);
  const language = useLanguage();
  const router = useRouter();
  const [session, setSession] = useState<Session>();
  /** Klubbytorna kontot är med i (undefined tills remsan har läst dem) och om klubbfrågan visas. */
  const [clubSpaces, setClubSpaces] = useState<readonly ClubSummary[]>();
  const [clubQuestionShown, setClubQuestionShown] = useState(false);
  const onClubs = (clubs: readonly ClubSummary[]) => setClubSpaces(clubs);
  /** Översynen 2026-11-17: panelen Lägg banor och vald typ i formuläret (knappens namn). */
  const [quickOpen, setQuickOpen] = useState(false);
  /** I mobilbredd fälls Skapa-formuläret ihop när kontot redan har tävlingar; på datorn står det i högerspalten. */
  const [createExpanded, setCreateExpanded] = useState(false);
  const [compactViewport, setCompactViewport] = useState(false);
  const [createType, setCreateType] = useState<RaceType>("TRAINING");
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
  /** Ägaren 2026-11-15: arrangörsklubben som väljs när tävlingen skapas (null = ingen, undefined = serverns förval). */
  const [organiser, setOrganiser] = useState<OrganisationSummary | null>();
  const [organiserError, setOrganiserError] = useState<string>();
  const organiserText = useTexts(clubLeadersSv.organiser, clubLeadersEn.organiser);
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
    // Användartestet 2026-11-12 (D): mejlet om en uppgift till en adress utan konto länkar hit med ?konto=skapa.
    else if (new URL(window.location.href).searchParams.get("konto") === "skapa") setMode("register");
    const googleProblem = takeGoogleProblem(copy);
    if (googleProblem) setMessage(googleProblem);
    const loggedOut = takeLoggedOut(copy);
    if (loggedOut) setMessage(loggedOut);
    void checkSession();
  }, []);

  /**
   * Förslag B: flikraden når navet med ankare. `#lagg-banor` (och händelsen `otid:open-course`) öppnar panelen Lägg banor,
   * `#skapa` / `#organizer-create-event` fäller ut Skapa-formuläret, och `#dina-tavlingar` rullar till listan när den har kommit.
   */
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const updateViewport = () => setCompactViewport(query.matches);
    updateViewport();
    query.addEventListener("change", updateViewport);
    const onHash = () => {
      if (window.location.hash === COURSE_TAB_HASH) setQuickOpen(true);
      if (window.location.hash === "#skapa" || window.location.hash === "#organizer-create-event") setCreateExpanded(true);
    };
    const onOpenCourse = () => setQuickOpen(true);
    onHash();
    window.addEventListener("hashchange", onHash);
    window.addEventListener(OPEN_COURSE_EVENT, onOpenCourse);
    return () => {
      query.removeEventListener("change", updateViewport);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener(OPEN_COURSE_EVENT, onOpenCourse);
    };
  }, []);
  useEffect(() => {
    if (eventsLoaded && window.location.hash === "#dina-tavlingar") document.getElementById("dina-tavlingar")?.scrollIntoView({ block: "start" });
  }, [eventsLoaded]);

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
      // Förslag B: layouten ritas om så att flikraden kommer med efter inloggningen.
      router.refresh();
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
      // Förslag B: layouten ritas om så att flikraden kommer med efter inloggningen.
      router.refresh();
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

  /** `quick`: Lägg banor – ingen karta ur klubbarkivet från formuläret, och banläggningen öppnas. */
  async function submitCreate(current: OrganizerCreateAttempt, quick = false) {
    setBusy(true);
    setMessage(quick ? copy.quick.starting : copy.creatingEvent);
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
      const map = quick ? undefined : clubMap;
      const problem = map ? await applyClubMap(map, result.raceId, stage => setMessage(clubMapDuplicatesText.picker.working[stage]),
        clubMapDuplicatesText.picker, raceMapText.mapFile.errors) : undefined;
      const page = map || quick ? "course-setting" : "manage";
      if (map) setClubMap(undefined);
      const shown = problem ?? "";
      if (shown) {
        setMessage(shown);
        window.setTimeout(() => enterRace(result.raceId, page), 2500);
        return;
      }
      // PLAN.md steg 24: direkt in i den nya tävlingens arbetsyta.
      if (!map && !quick) setMessage(copy.created);
      enterRace(result.raceId, page);
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
    // Egna fältfel i stället för webbläsarens (PLAN.md steg 24).
    const errors = validateCreateRace(input, formErrorText);
    setCreateErrors(errors);
    // Ägaren 2026-11-17: klubben väljs aktivt (eller Ingen klubb); inget förval.
    setOrganiserError(organiser === undefined ? organiserText.required : undefined);
    if (hasErrors(errors)) { focusFirstError(element); return; }
    if (organiser === undefined) { element.querySelector<HTMLElement>("[data-testid=create-organiser] button")?.focus(); return; }
    try {
      const request = organizerEventCreateRequestSchema.parse({
        formatVersion: 1,
        eventName: input.eventName,
        raceName: input.stageName.trim(),
        raceDate: input.raceDate,
        timeZone: input.timeZone.trim(),
        raceType: form.get("raceType"),
        organisationId: organiser?.organisationId ?? null
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

  /**
   * Översynen 2026-11-17, "Lägg banor": en Träning i dag (Stockholms tid) med namnet ur panelen, skapad med samma anrop och
   * samma sparade försök som formuläret. Arrangörsklubben är panelens aktiva val (null = ingen), aldrig en gissning.
   */
  async function createQuick(eventName: string, organisationId: string | null) {
    try {
      if (!session) throw new Error(copy.sessionExpired);
      const request = organizerEventCreateRequestSchema.parse({ formatVersion: 1, eventName, raceName: "",
        raceDate: todayIn("Europe/Stockholm", new Date()), timeZone: "Europe/Stockholm", raceType: "TRAINING", organisationId });
      const current = createOrganizerAttempt(request, session.accountId, () => crypto.randomUUID());
      saveOrganizerAttempt(current);
      setAttempt(current);
      await submitCreate(current, true);
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
  function enterRace(raceId: string, page: "manage" | "readout" | "course-setting" | "course-setting/map-errors" = "manage") {
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
                {/* Översynen 2026-11-17: Öppna arbetsytan, Banläggning, Kopiera. */}
                {event.role !== "COURSE_SETTER" && <button type="button" className={styles.secondary} disabled={busy || enteringRaceId !== undefined}
                  aria-busy={enteringRaceId === race.raceId} onClick={() => enterRace(race.raceId)}>
                  {enteringRaceId === race.raceId ? copy.opening : copy.openRace}</button>}
                {/* Ägaren 2026-11-03: banläggningen direkt från listan, för ägare och administratörer och för den som har
                    banläggningens behörighet (alla tävlingstyper, också fest och rogaining). */}
                {(race.courseSetting || event.role === "OWNER" || event.role === "ADMIN") &&
                  <button type="button" className={styles.secondary} disabled={busy || enteringRaceId !== undefined} data-testid="open-course-setting"
                  onClick={() => enterRace(race.raceId, race.courseSetting === "MAP" ? "course-setting/map-errors" : "course-setting")}>
                  {race.courseSetting === "MAP" ? copy.openMapErrors : copy.openCourseSetting}</button>}
                {(event.role === "OWNER" || event.role === "ADMIN") && <button type="button" className={styles.secondary} disabled={busy || enteringRaceId !== undefined}
                  aria-label={raceCopyText.actionLabel(name ?? event.eventName)} onClick={() => setCopySource({ raceId: race.raceId, eventName: event.eventName,
                    raceName: race.raceName, raceDate: race.raceDate })}>{raceCopyText.action}</button>}
              </div>
            </li>;
            })}</ul>
          </li>;

  // Förslag B: i telefonbredd en låg topprad (loggan, sidnamnet, språket, hjälpen och kontot) i stället för sidhuvudet.
  return <main className={styles.main} data-compact-hub>
    <header className={styles.header}>
      <div className={styles.title}><Link className={styles.phoneLogo} href="/" aria-label={sv.appName}><Logo size={30} /></Link>
        <div><p className={styles.kicker}>{copy.kicker}</p><h1>{copy.yourEvents}</h1>
        {session && events.length > 0 && <a className={styles.createJump} href="#organizer-create-event">{copy.createJump}</a>}</div></div>
      {session && <div className={styles.account}>
        {session.superadmin && <Link className={styles.superadmin} href="/superadmin">{copy.superadmin}</Link>}
        <LanguageSwitch language={language} className={styles.phoneLanguage} />
        <HelpButton view="EVENTS" />
        <AccountMenu who={{ displayName: session.displayName, email: session.email }} superadmin={session.superadmin} />
      </div>}
      {!session && <div className={styles.account}><LanguageSwitch language={language} className={styles.phoneLanguage} />
        <HelpButton view="EVENTS" /></div>}
    </header>

    {!sessionChecked && <section className={styles.panel} aria-live="polite"><p>{copy.checkSession}</p></section>}
    {session?.emailVerified === false && <section className={styles.panel} data-testid="unverified-email"><p>{copy.unverifiedNotice}</p></section>}

    {/* Ägaren 2026-11-22: rutan om vad ett konto ger står bredvid formuläret (under det i mobilen). */}
    {sessionChecked && !session && <div className={styles.loginLayout}>
    <section className={`${styles.panel} ${styles.narrow} ${styles.loginPanel}`}>
      <div className={hubStyles.authTabs} role="tablist" aria-label={copy.accountHelp}>
        <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => { setMode("login"); setMessage(""); setRepeat(""); }}>
          {copy.login}</button>
        <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => { setMode("register"); setMessage(""); setRepeat(""); }}>
          {copy.register}</button>
      </div>
      {mode === "login" && <>
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
      </>}
      {mode === "register" && <>
        <h2>{copy.register}</h2>
        <p className={styles.muted}>{copy.registerHint}</p>
        <form className={styles.form} onSubmit={(event) => void register(event)}>
          <label>{copy.displayName}
            <input autoComplete="name" value={displayName} maxLength={120}
              onChange={(event) => setDisplayName(event.target.value)} required />
          </label>
          <label>{copy.email}
            <input type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={email} maxLength={254}
              readOnly={lockedEmail} onChange={(event) => setEmail(event.target.value)} required aria-describedby="register-eventor-email" />
          </label>
          <p id="register-eventor-email" className={styles.muted}>{copy.registerEventorEmail}</p>
          <NewPasswordFields password={password} repeat={repeat} onPassword={setPassword} onRepeat={setRepeat} />
          <p className={styles.muted}>{copy.registerPrivacy} <Link href="/integritet">{copy.privacyLink}</Link></p>
          <button type="submit" disabled={busy || !email || !displayName.trim() || !passwordsReady(password, repeat)} aria-busy={busy}>{copy.register}</button>
          {message && <p className={styles.loginMessage} role={message === copy.registering ? "status" : "alert"} aria-live="polite">{message}</p>}
        </form>
        {googleEnabled && <GoogleLogin remember={false} copy={copy} />}
        <nav className={styles.loginLinks} aria-label={copy.accountHelp}>
          <button type="button" className={styles.secondary} onClick={() => { setMode("login"); setMessage(""); setRepeat(""); }}>{copy.toLogin}</button>
        </nav>
      </>}
    </section>
    <AccountBenefits />
    </div>}

    {/* Dagens tävling: snabbkort överst när kontot har ett lopp i dag. */}
    {session && eventsLoaded && !eventsError && <TodayRaceCard events={events} busy={busy} enteringRaceId={enteringRaceId} onOpen={enterRace} />}
    {/* ADR-0209: "Vilken klubb tillhör du?" efter registreringen (valfritt, tills det är besvarat). */}
    {/* Användartest 2026-11-12: klubbfrågan bara för den som inte redan är med i en klubbyta, och remsan upprepar den inte. */}
    {/* Översynen 2026-11-17: fyra val överst; Lägg banor öppnar panelen under valen. */}
    {session && <HubChoices clubHref={myClubHref(clubSpaces)} courseOpen={quickOpen} onCourse={() => setQuickOpen(open => !open)}
      onCreate={() => { setCreateExpanded(true); createHeadingRef.current?.focus({ preventScroll: true }); }} />}
    {session && <HubNewHere />}
    {session && quickOpen && !attempt && <QuickCourse events={events} busy={busy || enteringRaceId !== undefined}
      onOpen={raceId => enterRace(raceId, "course-setting")} onCreate={(name, organisationId) => void createQuick(name, organisationId)}
      onClose={() => setQuickOpen(false)} />}
    {session && <ClubStep skip={clubSpaces === undefined || clubSpaces.length > 0} onShown={setClubQuestionShown} />}
    {session && <MyPlacesStrip onClubs={onClubs} clubQuestionShown={clubQuestionShown} />}
    {session && <MyPlanTasks />}
    {session && <div className={styles.columns}>
      <section id="dina-tavlingar" className={`${styles.panel} ${styles.events}`}>
        <div className={styles.sectionHeading}><div><h2>{copy.eventsSection}</h2><p className={styles.muted}>{copy.eventsHint}</p></div>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void loadEvents().catch((error) => setMessage(errorMessage(copy, error)))}>{copy.refresh}</button>
        </div>
        {!eventsLoaded && <p aria-live="polite">{copy.loadingEvents}</p>}
        {eventsLoaded && eventsError && <p role="alert">{eventsError}</p>}
        {eventsLoaded && !eventsError && events.length === 0 && <div className={styles.empty}><strong>{copy.noEvents}</strong><p>{copy.noEventsHint}</p><a href="#organizer-create-event">{copy.noEventsCreateLink}</a></div>}
        {/* Översynen 2026-11-17: Kom igång (samma mönster som klubbytans) för den som inte har någon tävling än. */}
        {eventsLoaded && !eventsError && events.length === 0 && <HubStartCard hasClub={(clubSpaces?.length ?? 0) > 0}
          onCourse={() => { setQuickOpen(true); window.scrollTo({ top: 0 }); }} />}
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
        {!attempt && compactViewport && eventsLoaded && events.length > 0 && !createExpanded && <div className={hubStyles.createCollapsed}>
          <p className={styles.muted}>{copy.createHint}</p>
          <button type="button" className={hubStyles.createToggle} onClick={() => setCreateExpanded(true)} data-testid="expand-create-event">
            {copy.createEvent}</button>
        </div>}
        {!attempt && (!compactViewport || !eventsLoaded || events.length === 0 || createExpanded) && <><p className={styles.muted}>{copy.createHint}</p>
          <form className={`${styles.form} ${styles.createForm}`} noValidate onSubmit={(event) => void create(event)}>
            <Field label={copy.eventName} error={createErrors.eventName}><input name="eventName" maxLength={160} disabled={busy}
              onChange={() => createErrors.eventName && setCreateErrors({ ...createErrors, eventName: undefined })} /></Field>
            <Field label={copy.raceName} error={createErrors.stageName} help={copy.raceNameHelp}><input name="raceName" maxLength={160}
              disabled={busy} onChange={() => createErrors.stageName && setCreateErrors({ ...createErrors, stageName: undefined })} /></Field>
            <Field label={copy.date} error={createErrors.raceDate} className={styles.createDate}><DateInput name="raceDate"
              disabled={busy} onChange={() => createErrors.raceDate && setCreateErrors({ ...createErrors, raceDate: undefined })} /></Field>
            {/* Användartest 2026-11-12: Träning förvald, det är vad en ny användare oftast gör. */}
            <RaceTypeChoice name="raceType" defaultValue="TRAINING" disabled={busy} onChange={setCreateType} />
            <OrganiserChoiceField value={organiser} disabled={busy} error={organiserError}
              onChange={value => { setOrganiser(value); setOrganiserError(undefined); }} />
            {/* Tidszonen behövs nästan aldrig: förvald Europe/Stockholm och ändras under "Mer". */}
            <details className={styles.more} open={createErrors.timeZone ? true : undefined}>
              <summary>{copy.more}</summary>
              <Field label={copy.timeZone} error={createErrors.timeZone} help={copy.timeZoneHelp}><input name="timeZone"
                defaultValue="Europe/Stockholm" maxLength={100} disabled={busy} /></Field>
            </details>
            <ClubMapChoiceField value={clubMap} disabled={busy} onChange={setClubMap} />
            <button type="submit" disabled={busy} aria-busy={busy} data-testid="create-race-submit">{createSubmitLabel(createType, copy.createSubmit)}</button>
          </form></>}
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
    {/* ADR-0187: en säkerhetskopia blir en ny tävling. Översynen 2026-11-17: sällan använd, så under Mer längst ned. */}
    {session && <details className={hubStyles.more} data-testid="hub-more">
      <summary>{copy.hub.more}</summary>
      <div><p>{backupText.restore.openHint}</p>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => setRestoreOpen(true)}>{backupText.restore.open}</button></div>
    </details>}
    <RestoreRaceDialog open={restoreOpen} onClose={() => setRestoreOpen(false)}
      onRestored={() => void loadEvents().catch((error) => setMessage(errorMessage(copy, error)))} />
    <CopyRaceDialog source={copySource} onClose={() => setCopySource(undefined)}
      onCopied={() => void loadEvents().catch((error) => setMessage(errorMessage(copy, error)))} />
  </main>;
}
