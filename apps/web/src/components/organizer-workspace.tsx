"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  organizerEventCreateRequestSchema,
  organizerAdminGrantRequestSchema,
  organizerAdminRevokeRequestSchema,
  organizerAccountInvitationIssueRequestSchema,
  organizerAccountInvitationIssueResponseSchema,
  organizerAccountInvitationListResponseSchema,
  organizerAccountInvitationRevokeRequestSchema,
  organizerAccountInvitationRevokeResponseSchema,
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
import styles from "./organizer-workspace.module.css";

type Session = { accountId: string; displayName: string; expiresAt: string };
type InvitationGrantReview = { invitationId: string; loginName: string; displayName: string };

function EventAdministrators({ eventId, eventName, accountId }: { eventId: string; eventName: string; accountId: string }) {
  const [grants, setGrants] = useState<ReturnType<typeof parseOrganizerAdminList>["grants"]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [attempt, setAttempt] = useState<OrganizerAdminMutationAttempt>();
  const [reviewInvitation, setReviewInvitation] = useState<InvitationGrantReview>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reviewInvitation || attempt) return;
    reviewRef.current?.focus({ preventScroll: true });
    reviewRef.current?.scrollIntoView({ behavior: "instant", block: "center" });
  }, [reviewInvitation, attempt]);

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
      setLoginName("");
      setReviewInvitation(undefined);
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
        formatVersion: 1, requestId, eventId, loginName: loginName.trim().toLowerCase(), role: "ADMIN"
      });
      const current = { accountId, action: "grant" as const, eventId, requestId, request };
      saveOrganizerAdminAttempt(current);
      setAttempt(current);
      setReviewInvitation(undefined);
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
      setReviewInvitation(undefined);
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
  const activeAdminLoginNames = grants.filter((grant) => !grant.revokedAt).map((grant) => grant.loginName);

  function reviewInvitationGrant(invitation: InvitationGrantReview) {
    if (busy || attempt || !loaded || error || activeAdminLoginNames.includes(invitation.loginName)) return;
    setLoginName(invitation.loginName);
    setReviewInvitation(invitation);
  }

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
      <div><strong>{grant.displayName}</strong><span>{grant.loginName}</span>
        <span>{copy.adminGrantedAt} {new Date(grant.grantedAt).toLocaleString("sv-SE")}</span></div>
      <span className={styles.adminStatus}>{grant.revokedAt ? copy.adminRevokedLabel : copy.adminActiveLabel}
        {grant.revokedAt && <small>{copy.adminRevokedAt} {new Date(grant.revokedAt).toLocaleString("sv-SE")}</small>}</span>
      {!grant.revokedAt && <button className={styles.secondary} type="button" disabled={busy}
        onClick={() => revoke(grant.grantId, grant.displayName)}>{copy.adminRevoke}</button>}
    </li>)}</ul>}
    {!attempt && <form className={styles.adminForm} onSubmit={(event) => void createGrant(event)}>
      <label>{copy.adminLoginName}<input value={loginName} onChange={(event) => { setLoginName(event.target.value); setReviewInvitation(undefined); }}
        autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={80} required disabled={busy || !!attempt} /></label>
      <div ref={reviewRef} tabIndex={-1} className={styles.adminReview}>
        {reviewInvitation
          ? <p className={styles.adminInvitationReview}>{copy.adminInvitationReview(reviewInvitation.displayName, reviewInvitation.loginName, eventName)}</p>
          : <><p>{loginName ? copy.adminReview(loginName.trim().toLowerCase()) : copy.adminReviewHint}</p>
              <p>{copy.adminReviewEvent(eventName)}</p></>}
      </div>
      <button type="submit" disabled={busy || !!attempt || !loginName}>{copy.adminGrant}</button>
    </form>}
    {attempt && <div className={styles.uncertain} role="alert">
      <h5>{copy.adminPendingTitle}</h5>
      <p>{copy.adminPendingHint}</p>
      <dl><dt>{copy.adminAction}</dt><dd>{attempt.action === "grant" ? copy.adminGrantAction : copy.adminRevokeAction}</dd>
        <dt>{copy.adminEvent}</dt><dd>{eventName} · {attempt.eventId}</dd>
        <dt>{copy.adminRequestId}</dt><dd>{attempt.requestId}</dd>
        <dt>{copy.adminTarget}</dt><dd>{String(attempt.request.loginName ?? attempt.request.grantId)}</dd></dl>
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => void submit(attempt)}>{copy.retrySameAttempt}</button>
        <button className={styles.secondary} type="button" disabled={busy} onClick={abandon}>{copy.adminAbandonAttempt}</button>
      </div>
    </div>}
    <AccountInvitationDisclosure eventId={eventId} activeAdminLoginNames={activeAdminLoginNames}
      adminListReady={loaded && !error} reviewBlocked={busy || !!attempt} onReviewGrant={reviewInvitationGrant} />
    <p className={styles.message} role="status" aria-live="polite">{notice}</p>
  </section>;
}

type InvitationIssueAttempt = {
  request: ReturnType<typeof organizerAccountInvitationIssueRequestSchema.parse>;
  code: string;
};
type InvitationRevokeAttempt = {
  invitationId: string;
  requestId: string;
  request: ReturnType<typeof organizerAccountInvitationRevokeRequestSchema.parse>;
};
type InvitationGrantReviewProps = {
  eventId: string;
  activeAdminLoginNames: string[];
  adminListReady: boolean;
  reviewBlocked: boolean;
  onReviewGrant: (invitation: InvitationGrantReview) => void;
};

async function createInvitationCode(): Promise<{ code: string; codeHash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const code = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const codeHash = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
  return { code, codeHash };
}

function AccountInvitationManager({ eventId, activeAdminLoginNames, adminListReady, reviewBlocked, onReviewGrant }: InvitationGrantReviewProps) {
  const [invitations, setInvitations] = useState<ReturnType<typeof organizerAccountInvitationListResponseSchema.parse>["invitations"]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [issueAttempt, setIssueAttempt] = useState<InvitationIssueAttempt>();
  const [issued, setIssued] = useState<{ invitationId: string; loginName: string; displayName: string; expiresAt: string; code: string }>();
  const [revokeAttempt, setRevokeAttempt] = useState<InvitationRevokeAttempt>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoaded(false);
    setError("");
    try {
      const response = await fetch(`/api/organizer/events/${encodeURIComponent(eventId)}/account-invitations`, {
        credentials: "same-origin", cache: "no-store"
      });
      if (!response.ok) throw new Error(copy.invitationLoadError(response.status));
      const result = organizerAccountInvitationListResponseSchema.parse(await responseJson(response));
      if (result.eventId !== eventId) throw new Error(copy.invalidServerResponse);
      setInvitations(result.invitations);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setLoaded(true); }
  }

  useEffect(() => { void load(); }, [eventId]);

  async function submitIssue(current: InvitationIssueAttempt) {
    setBusy(true);
    setError("");
    setNotice(copy.invitationSending);
    let rejected = false;
    try {
      const response = await fetch(`/api/organizer/events/${encodeURIComponent(eventId)}/account-invitations`, {
        method: "POST", credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `organizer-account-invitation-issue:${current.request.requestId}`,
          "x-otid-csrf": readOrganizerCsrf(document.cookie, new URL(window.location.href))
        },
        body: JSON.stringify(current.request)
      });
      if (!response.ok) {
        if (response.status === 409 || response.status === 400 || response.status === 404) {
          rejected = true;
          setIssueAttempt(undefined);
          setIssued(undefined);
          throw new Error(response.status === 409 ? copy.invitationConflict : copy.invitationInvalid);
        }
        if (response.status === 401 || response.status === 403) {
          rejected = true;
          setIssueAttempt(undefined);
          setIssued(undefined);
          throw new Error(copy.invitationSession(response.status));
        }
        throw new Error(copy.invitationUncertain(response.status));
      }
      const value = organizerAccountInvitationIssueResponseSchema.parse(await responseJson(response));
      if (value.eventId !== eventId || value.requestId !== current.request.requestId || value.loginName !== current.request.loginName || value.displayName !== current.request.displayName) {
        throw new Error(copy.invalidServerResponse);
      }
      setIssueAttempt(undefined);
      setIssued({ invitationId: value.invitationId, loginName: value.loginName, displayName: value.displayName, expiresAt: value.expiresAt, code: current.code });
      setNotice(value.replayed ? copy.invitationRetryConfirmed : copy.invitationCreated);
      setLoginName("");
      setDisplayName("");
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
      if (!rejected) setNotice(copy.invitationPendingNotice);
    } finally { setBusy(false); }
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Starting a new intent discards any prior one-time code from component memory.
    setIssued(undefined);
    setIssueAttempt(undefined);
    setError("");
    try {
      const { code, codeHash } = await createInvitationCode();
      const requestId = crypto.randomUUID();
      const request = organizerAccountInvitationIssueRequestSchema.parse({
        formatVersion: 1, requestId, eventId,
        loginName: loginName.trim().toLowerCase(), displayName: displayName.trim(), codeHash
      });
      const current = { request, code };
      setIssueAttempt(current);
      await submitIssue(current);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  async function submitRevoke(current: InvitationRevokeAttempt) {
    setBusy(true);
    setError("");
    setNotice(copy.invitationRevoking);
    let rejected = false;
    try {
      const response = await fetch(`/api/organizer/events/${encodeURIComponent(eventId)}/account-invitations/${encodeURIComponent(current.invitationId)}/revoke`, {
        method: "POST", credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `organizer-account-invitation-revoke:${current.requestId}`,
          "x-otid-csrf": readOrganizerCsrf(document.cookie, new URL(window.location.href))
        },
        body: JSON.stringify(current.request)
      });
      if (!response.ok) {
        if (response.status === 409 || response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
          rejected = true;
          setRevokeAttempt(undefined);
          throw new Error(copy.invitationRevokeRejected(response.status));
        }
        throw new Error(copy.invitationUncertain(response.status));
      }
      const result = organizerAccountInvitationRevokeResponseSchema.parse(await responseJson(response));
      if (result.eventId !== eventId || result.invitationId !== current.invitationId || result.requestId !== current.requestId) throw new Error(copy.invalidServerResponse);
      setRevokeAttempt(undefined);
      setNotice(result.replayed ? copy.invitationRevokeRetryConfirmed : copy.invitationRevoked);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
      if (!rejected) setNotice(copy.invitationRevokePendingNotice);
    } finally { setBusy(false); }
  }

  function revoke(invitationId: string, displayName: string) {
    if (!window.confirm(copy.invitationConfirmRevoke(displayName))) return;
    const requestId = crypto.randomUUID();
    const request = organizerAccountInvitationRevokeRequestSchema.parse({ formatVersion: 1, requestId, eventId, invitationId });
    const current = { invitationId, requestId, request };
    setRevokeAttempt(current);
    void submitRevoke(current);
  }

  async function copyCode() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      setNotice(copy.invitationCopied);
    } catch { setError(copy.invitationCopyError); }
  }

  return <section className={styles.invitationPanel} aria-label={copy.invitationPanel}>
    <div className={styles.adminHeading}><h4>{copy.invitationPanel}</h4>
      <button className={styles.secondary} type="button" disabled={busy} onClick={() => void load()}>{copy.refresh}</button>
    </div>
    <p className={styles.muted}>{copy.invitationHint}</p>
    {!loaded && <p aria-live="polite">{copy.invitationLoading}</p>}
    {error && <p role="alert">{error}</p>}
    {loaded && !error && invitations.length === 0 && <p>{copy.invitationEmpty}</p>}
    {invitations.length > 0 && <ul className={`${styles.adminList} ${styles.invitationList}`}>{invitations.map((invitation) => <li key={invitation.invitationId}>
      <div><strong>{invitation.displayName}</strong><span>{invitation.loginName}</span></div>
      <span className={styles.invitationRowStatus}>{copy.invitationStatus[invitation.status]}
        <small>{copy.invitationExpires}: {new Date(invitation.expiresAt).toLocaleString("sv-SE")}</small></span>
      {invitation.status === "PENDING" && <button className={styles.secondary} type="button" disabled={busy || !!issueAttempt || !!revokeAttempt}
        onClick={() => revoke(invitation.invitationId, invitation.displayName)}>{copy.invitationRevoke}</button>}
      {invitation.status === "REDEEMED" && (adminListReady
        ? activeAdminLoginNames.includes(invitation.loginName)
          ? <span className={styles.invitationGrantState}>{copy.invitationGrantActive}</span>
          : <button className={styles.secondary} type="button" disabled={busy || reviewBlocked}
              onClick={() => onReviewGrant({ invitationId: invitation.invitationId, loginName: invitation.loginName, displayName: invitation.displayName })}>
              {copy.invitationReviewGrant}
            </button>
        : <span className={styles.invitationGrantState}>{copy.invitationGrantListUnavailable}</span>)}
    </li>)}</ul>}
    {!issueAttempt && !revokeAttempt && !issued && <form className={styles.invitationForm} onSubmit={(event) => void createInvitation(event)}>
      <label>{copy.invitationLoginName}<input value={loginName} onChange={(event) => setLoginName(event.target.value)}
        autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={80} required disabled={busy} /></label>
      <label>{copy.invitationDisplayName}<input value={displayName} onChange={(event) => setDisplayName(event.target.value)}
        autoComplete="off" maxLength={120} required disabled={busy} /></label>
      <p className={styles.invitationFormHint}>{copy.invitationFormHint}</p>
      <button type="submit" disabled={busy || !loginName || !displayName}>{copy.invitationCreate}</button>
    </form>}
    {issueAttempt && <div className={styles.uncertain} role="alert">
      <h5>{copy.invitationPendingTitle}</h5><p>{copy.invitationPendingHint}</p>
      <dl><dt>{copy.invitationRequestId}</dt><dd>{issueAttempt.request.requestId}</dd>
        <dt>{copy.invitationEventId}</dt><dd>{issueAttempt.request.eventId}</dd>
        <dt>{copy.invitationTargetLogin}</dt><dd>{issueAttempt.request.loginName}</dd>
        <dt>{copy.invitationTargetName}</dt><dd>{issueAttempt.request.displayName}</dd></dl>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void submitIssue(issueAttempt)}>{copy.retrySameAttempt}</button></div>
    </div>}
    {revokeAttempt && <div className={styles.uncertain} role="alert">
      <h5>{copy.invitationRevokePendingTitle}</h5><p>{copy.invitationRevokePendingHint}</p>
      <dl><dt>{copy.invitationRequestId}</dt><dd>{revokeAttempt.requestId}</dd>
        <dt>{copy.invitationEventId}</dt><dd>{revokeAttempt.request.eventId}</dd>
        <dt>{copy.invitationTargetId}</dt><dd>{revokeAttempt.invitationId}</dd></dl>
      <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void submitRevoke(revokeAttempt)}>{copy.retrySameAttempt}</button></div>
    </div>}
    {issued && <div className={styles.confirmed}>
      <strong>{copy.invitationCodeTitle}</strong>
      <p>{copy.invitationCodeHint(issued.displayName, issued.loginName, new Date(issued.expiresAt).toLocaleString("sv-SE"))}</p>
      <code className={styles.invitationCode}>{issued.code}</code>
      <div className={styles.invitationCodeActions}>
        <button className={styles.secondary} type="button" onClick={() => void copyCode()}>{copy.invitationCopy}</button>
        <button className={styles.secondary} type="button" onClick={() => { setIssued(undefined); setNotice(copy.invitationCleared); }}>{copy.invitationHideCode}</button>
      </div>
      <p className={styles.invitationClipboardHint}>{copy.invitationClipboardHint}</p>
      <p>{copy.invitationAccountOnly}</p>
    </div>}
    {!error && notice && <p className={styles.message} role="status" aria-live="polite">{notice}</p>}
  </section>;
}

function AccountInvitationDisclosure({ eventId, activeAdminLoginNames, adminListReady, reviewBlocked, onReviewGrant }: InvitationGrantReviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [hasExpanded, setHasExpanded] = useState(false);
  const panelId = `event-account-invitations-${eventId}`;
  return <div className={styles.invitationDisclosure}>
    <button className={styles.secondary} type="button" aria-expanded={expanded} aria-controls={panelId}
      onClick={() => { if (!expanded) setHasExpanded(true); setExpanded(!expanded); }}>
      {expanded ? copy.invitationHide : copy.invitationShow}
    </button>
    {hasExpanded && <div id={panelId} hidden={!expanded}><AccountInvitationManager eventId={eventId}
      activeAdminLoginNames={activeAdminLoginNames} adminListReady={adminListReady}
      reviewBlocked={reviewBlocked} onReviewGrant={onReviewGrant} /></div>}
  </div>;
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

export function OrganizerWorkspace() {
  const [session, setSession] = useState<Session>();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
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

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(copy.loggingIn);
    try {
      const request = parseOrganizerLoginRequest(loginName, password);
      const response = await fetch("/api/organizer/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request)
      });
      if (!response.ok) throw new Error(response.status === 401
        ? copy.invalidCredentials
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
        timeZone: form.get("timeZone")
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
        <button className={styles.secondary} type="button" disabled={busy} onClick={() => void logout()}>{copy.logout}</button>
      </div>}
    </header>

    {!sessionChecked && <section className={styles.panel} aria-live="polite"><p>{copy.checkSession}</p></section>}

    {sessionChecked && !session && <section className={`${styles.panel} ${styles.narrow} ${styles.loginPanel}`}>
      <h2>{copy.login}</h2>
      <p className={styles.muted}>{copy.loginHint}</p>
      <form className={styles.form} onSubmit={(event) => void login(event)}>
        <label>{copy.loginName}
          <input autoComplete="username" autoCapitalize="none" spellCheck={false} value={loginName}
            onChange={(event) => setLoginName(event.target.value)} required />
        </label>
        <label>{copy.password}
          <input type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <button type="submit" disabled={busy || !loginName || !password} aria-busy={busy}>{copy.login}</button>
        {message && <p className={styles.loginMessage} role={message === copy.invalidCredentials ? "alert" : "status"} aria-live="polite">{message}</p>}
      </form>
      <nav className={styles.loginLinks} aria-label={copy.accountHelp}>
        <Link href="/recover">{copy.forgotPassword}</Link>
        <Link href="/activate">{copy.activateAccount}</Link>
      </nav>
      <p className={styles.activationHint}>{copy.activateHint}</p>
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
              <div><strong>{race.raceName}</strong><span>{race.raceDate}</span></div>
              <button type="button" disabled={busy || enteringRaceId !== undefined} aria-busy={enteringRaceId === race.raceId}
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
            <button type="submit" disabled={busy} aria-busy={busy}>{copy.createEvent}</button>
          </form></>}
        {attempt && <div className={styles.uncertain} role="alert">
          <h3>{attemptMatchesSession ? copy.createUnconfirmed : copy.savedAttemptOtherAccountTitle}</h3>
          <p>{attemptBelongsToOtherAccount ? copy.attemptBelongsToOtherAccount : copy.createUnconfirmedHint}</p>
          <dl><dt>{copy.requestId}</dt><dd>{attempt.requestId}</dd>
            <dt>{copy.eventName}</dt><dd>{attempt.request.eventName}</dd>
            <dt>{copy.raceName}</dt><dd>{attempt.request.raceName}</dd>
            <dt>{copy.date}</dt><dd>{attempt.request.raceDate}</dd>
            <dt>{copy.timeZone}</dt><dd>{attempt.request.timeZone}</dd></dl>
          <div className={styles.actions}>
            {attemptMatchesSession && <button type="button" disabled={busy || !session} onClick={() => void submitCreate(attempt)}>{copy.retrySameAttempt}</button>}
            <button type="button" className={styles.secondary} disabled={busy} onClick={cancelAttempt}>{attemptBelongsToOtherAccount ? copy.abandonSavedAttempt : copy.abandonAttempt}</button>
          </div>
        </div>}
        {created && !attempt && !showAnotherForm && <div className={styles.confirmed} role="status">
          <strong>{created.replayed ? copy.createdOnRetry : copy.created}</strong>
          <p>{copy.nowInYourEvents}</p>
          <dl className={styles.createReceipt}><dt>{copy.createdEventId}</dt><dd>{created.eventId}</dd>
            <dt>{copy.createdRaceId}</dt><dd>{created.raceId}</dd>
            <dt>{copy.createdAt}</dt><dd><time dateTime={created.createdAt}>{new Date(created.createdAt).toLocaleString("sv-SE")}</time></dd></dl>
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
