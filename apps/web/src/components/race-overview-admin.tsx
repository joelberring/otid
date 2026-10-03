"use client";

import { checkinText } from "../checkin/text-sv";

import Link from "next/link";
import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  raceOverviewAdminLoginRequestSchema,
  raceOverviewAdminLoginResponseSchema,
  type RaceOverviewResponse
} from "@o-tid/contracts";
import { sv } from "../i18n/sv";
import { startTimeSv } from "../i18n/entry-start-time-sv";
import { cardSv } from "../i18n/entry-card-sv";
import { registrationSv } from "../i18n/entry-registration-sv";
import { startListSv } from "../i18n/start-list-sv";
import { startListPublicationSv } from "../i18n/start-list-publication-sv";
import { classStartDrawSv } from "../i18n/class-start-draw-sv";
import { forestWatchSv } from "../i18n/forest-watch-sv";
import { speakerBoardSv } from "../i18n/speaker-board-sv";
import { raceWorkspaceSv } from "../i18n/race-workspace-sv";
import { parseRaceOverview, readRaceOverviewAdminCsrf } from "../lib/race-overview-admin-client";

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(sv.raceOverviewInvalidResponse);
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : sv.raceOverviewUnknownError;
}

function activityTime(value: string | null): string {
  return value === null ? sv.raceOverviewNoActivity : new Date(value).toLocaleString("sv-SE");
}

export function RaceOverviewAdmin({ raceId }: { raceId: string }) {
  const [accessCredential, setAccessCredential] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean>();
  const [online, setOnline] = useState<boolean>();
  const [overview, setOverview] = useState<RaceOverviewResponse>();
  const [busy, setBusy] = useState(false);
  const [logoutUnconfirmed, setLogoutUnconfirmed] = useState(false);
  const [message, setMessage] = useState<string>(sv.raceOverviewCheckingSession);
  const sessionUrl = `/api/admin/races/${raceId}/overview-session`;
  const overviewUrl = `/api/admin/races/${raceId}/overview`;

  const loadOverview = useCallback(async () => {
    const response = await fetch(overviewUrl, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setAuthenticated(false);
      setOverview(undefined);
      setMessage(sv.raceOverviewLoginRequired);
      return false;
    }
    if (!response.ok) throw new Error(`${sv.raceOverviewLoadFailed} (${response.status})`);
    setOverview(parseRaceOverview(await responseJson(response), raceId));
    setAuthenticated(true);
    setMessage("");
    return true;
  }, [overviewUrl, raceId]);

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
    void loadOverview().catch((error: unknown) => {
      setOverview(undefined);
      setMessage(messageFrom(error));
    });
  }, [loadOverview]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setLogoutUnconfirmed(false);
    setMessage(sv.raceOverviewLoggingIn);
    try {
      const parsed = raceOverviewAdminLoginRequestSchema.safeParse({ formatVersion: 1, accessCredential });
      if (!parsed.success) throw new Error(sv.raceOverviewLoginRejected);
      const response = await fetch(sessionUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data)
      });
      if (!response.ok) {
        throw new Error(response.status === 401
          ? sv.raceOverviewLoginRejected
          : `${sv.raceOverviewSessionFailed} (${response.status})`);
      }
      const session = raceOverviewAdminLoginResponseSchema.safeParse(await responseJson(response));
      if (!session.success || session.data.raceId !== raceId ||
          session.data.capability !== "VIEW_RACE_OVERVIEW") {
        throw new Error(sv.raceOverviewInvalidResponse);
      }
      await loadOverview();
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setAccessCredential("");
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setMessage(sv.raceOverviewRefreshing);
    try {
      await loadOverview();
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setBusy(false);
    }
  }

  async function requestLogout() {
    setOverview(undefined);
    setBusy(true);
    setMessage(sv.raceOverviewLoggingOut);
    try {
      const response = await fetch(sessionUrl, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "x-otid-csrf": readRaceOverviewAdminCsrf(document.cookie, new URL(window.location.href)) }
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(`${sv.raceOverviewLogoutFailed} (${response.status})`);
      }
      setAuthenticated(false);
      setLogoutUnconfirmed(false);
      setMessage(sv.raceOverviewLoggedOut);
    } catch (error) {
      setAuthenticated(undefined);
      setLogoutUnconfirmed(true);
      setMessage(`${messageFrom(error)} ${sv.raceOverviewLogoutUnknown}`);
    } finally {
      setAccessCredential("");
      setBusy(false);
    }
  }

  const onlineText = online === true
    ? `✓ ${sv.raceOverviewInternetOnline}`
    : online === false
      ? `△ ${sv.raceOverviewInternetOffline}`
      : `… ${sv.raceOverviewInternetChecking}`;
  const sessionText = authenticated === true
    ? `✓ ${sv.raceOverviewSessionActive}`
    : authenticated === false
      ? `△ ${sv.raceOverviewSessionRequired}`
      : `… ${sv.raceOverviewSessionChecking}`;

  return <div className="stack race-overview-admin">
    <section className="panel race-overview-security-note" aria-labelledby="race-overview-security-heading">
      <h1 id="race-overview-security-heading">{sv.raceOverviewPageHeading}</h1>
      {authenticated !== true && <p>{sv.raceOverviewPageLead}</p>}
      <p className="muted">{sv.raceOverviewRaceLabel}: {raceId}</p>
    </section>

    <section className="status-grid race-overview-status" aria-label={sv.raceOverviewOperationalStatus}>
      <div className="status"><strong>{sv.raceOverviewInternetLabel}</strong><span>{onlineText}</span></div>
      <div className="status"><strong>{sv.raceOverviewSessionLabel}</strong><span>{sessionText}</span></div>
      <div className="status"><strong>{sv.raceOverviewDataLabel}</strong><span>{overview
        ? `✓ ${sv.raceOverviewDataLoaded}`
        : `△ ${sv.raceOverviewDataHidden}`}</span></div>
    </section>

    <p className="pairing-message" role="status" aria-live="polite">{message}</p>
    {online === false && overview && <p className="warning" role="alert">{raceWorkspaceSv.offlineWarning}</p>}

    {logoutUnconfirmed && <section className="panel race-overview-logout-warning stack" role="alert">
      <h2>△ {sv.raceOverviewLogoutUnconfirmedHeading}</h2>
      <p>{sv.raceOverviewLogoutUnknown}</p>
      <button type="button" disabled={busy} onClick={() => void requestLogout()}>
        {sv.raceOverviewRetryLogout}
      </button>
    </section>}

    {authenticated !== true && !logoutUnconfirmed && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <h2>{sv.raceOverviewLoginHeading}</h2>
      <p className="muted">{sv.raceOverviewLoginHelp}</p>
      <label>{sv.raceOverviewAccessCredential}
        <input type="password" autoComplete="off" spellCheck={false} value={accessCredential}
          onChange={(event) => setAccessCredential(event.target.value)} required />
      </label>
      <button type="submit" disabled={busy || accessCredential.length === 0} aria-busy={busy}>
        {sv.raceOverviewLogin}
      </button>
    </form>}

    {authenticated === true && overview && <>
      <section className="panel stack race-overview-summary">
        <div className="race-overview-heading"><div>
          <h2>{overview.race.eventName} – {overview.race.name}</h2>
          <p>{overview.race.raceDate} · {overview.race.timeZone}</p>
          <p><strong>{sv.raceOverviewSnapshotVersion}: {overview.race.snapshotVersion}</strong></p>
        </div><div className="pairing-actions">
          <Link href="/organizer" prefetch={false}>{raceWorkspaceSv.backToEvents}</Link>
          <Link href={`/admin/${raceId}/manage`} prefetch={false}>{raceWorkspaceSv.manageLink}</Link>
          <button type="button" className="secondary" disabled={busy} onClick={() => void refresh()}>
            {sv.raceOverviewRefresh}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void requestLogout()}>
            {sv.raceOverviewLogout}
          </button>
        </div></div>
        <div className="status-grid race-overview-counts" aria-label={sv.raceOverviewCountsHeading}>
          <div className="status"><span>{sv.classes}</span><strong>{overview.counts.classes}</strong></div>
          <div className="status"><span>{sv.courses}</span><strong>{overview.counts.courses}</strong></div>
          <div className="status"><span>{sv.entries}</span><strong>{overview.counts.entries}</strong></div>
          <div className="status"><span>{sv.raceOverviewActiveAssignments}</span><strong>{overview.counts.activeCardAssignments}</strong></div>
          <div className="status"><span>{sv.readouts}</span><strong>{overview.counts.readouts}</strong></div>
          <div className="status"><span>{raceWorkspaceSv.revisions}</span><strong>{overview.counts.resultRevisions}</strong></div>
          <div className="status"><span>{sv.imports}</span><strong>{overview.counts.imports}</strong></div>
        </div>
        <p className="muted race-overview-counts-note">{raceWorkspaceSv.countsHelp}</p>
      </section>

      <section className="race-overview-tools" aria-labelledby="race-overview-tools-heading">
        <h2 id="race-overview-tools-heading">{sv.raceOverviewToolsHeading}</h2>
        <p className="muted">{raceWorkspaceSv.readOnlyHelp}</p>
        <nav className="race-workspace" aria-label={sv.raceOverviewToolsHeading}>
          <section className="panel race-workspace-area" aria-labelledby="race-workspace-preparation">
          <h3 id="race-workspace-preparation">{raceWorkspaceSv.preparation}</h3>
          <Link className="race-workspace-primary" href={`/admin/${raceId}/registration`}>{registrationSv.title}</Link>
          <Link href={`/admin/${raceId}/classes`}>{sv.entryClassAdminLink}</Link>
          <Link href={`/admin/${raceId}/cards`}>{cardSv.title}</Link>
          <Link href={`/admin/${raceId}/imports`}>{sv.importAdminLink}</Link>
          <Link href={`/admin/${raceId}/pairing`}>{sv.pairingAdminLink}</Link>
          </section>
          <section className="panel race-workspace-area" aria-labelledby="race-workspace-start">
          <h3 id="race-workspace-start">{raceWorkspaceSv.start}</h3>
          <Link className="race-workspace-primary" href={`/admin/${raceId}/start-list`}>{startListSv.workspaceLink}</Link>
          <a href={`/checkin/index.html#${raceId}`}>{checkinText.openMobile}</a>
          <Link href={`/admin/${raceId}/start-times`}>{startTimeSv.title}</Link>
          <Link href={`/admin/${raceId}/class-start-draw`}>{classStartDrawSv.title}</Link>
          <Link href={`/admin/${raceId}/did-not-start`}>{sv.didNotStartAdminLink}</Link>
          <Link href={`/admin/${raceId}/did-not-start-withdrawals`}>{sv.didNotStartWithdrawalAdminLink}</Link>
          </section>
          <section className="panel race-workspace-area" aria-labelledby="race-workspace-finish">
          <h3 id="race-workspace-finish">{raceWorkspaceSv.finish}</h3>
          <Link className="race-workspace-primary" href={`/admin/${raceId}/forest-watch`}>{forestWatchSv.title}</Link>
          <Link href={`/admin/${raceId}/speaker`}>{speakerBoardSv.title}</Link>
          <Link href={`/admin/${raceId}/history`}>{sv.readoutHistoryAdminLink}</Link>
          <Link href={`/admin/${raceId}/recalculation`}>{sv.resultRecalculationAdminLink}</Link>
          <details className="race-workspace-decisions">
          <summary>{raceWorkspaceSv.manualDecisions}</summary>
          <div className="race-workspace-decision-links">
          <Link href={`/admin/${raceId}/disqualifications`}>{sv.resultDisqualificationAdminLink}</Link>
          <Link href={`/admin/${raceId}/result-approvals`}>{sv.resultApprovalAdminLink}</Link>
          <Link href={`/admin/${raceId}/did-not-finish`}>{sv.didNotFinishAdminLink}</Link>
          <Link href={`/admin/${raceId}/out-of-competition`}>{sv.outOfCompetitionAdminLink}</Link>
          <Link href={`/admin/${raceId}/without-timing`}>{sv.withoutTimingAdminLink}</Link>
          <Link href={`/admin/${raceId}/without-timing-withdrawals`}>{sv.withoutTimingWithdrawalAdminLink}</Link>
          <Link href={`/admin/${raceId}/out-of-competition-withdrawals`}>{sv.outOfCompetitionWithdrawalAdminLink}</Link>
          <Link href={`/admin/${raceId}/did-not-finish-withdrawals`}>{sv.didNotFinishWithdrawalAdminLink}</Link>
          <Link href={`/admin/${raceId}/approval-withdrawals`}>{sv.resultApprovalWithdrawalAdminLink}</Link>
          <Link href={`/admin/${raceId}/disqualification-withdrawals`}>{sv.resultDisqualificationWithdrawalAdminLink}</Link>
          </div></details>
          </section>
          <section className="panel race-workspace-area" aria-labelledby="race-workspace-publication">
          <h3 id="race-workspace-publication">{raceWorkspaceSv.publication}</h3>
          <Link className="race-workspace-primary" href={`/results/${raceId}`}>{sv.publicResults}</Link>
          <Link href={`/admin/${raceId}/start-list-publication`}>{startListPublicationSv.title}</Link>
          <Link href={`/admin/${raceId}/finalization`}>{sv.resultFinalizationAdminLink}</Link>
          <Link href={`/admin/${raceId}/exports`}>{sv.resultListExportPageHeading}</Link>
          </section>
        </nav>
      </section>

      <details className="panel race-overview-structure">
        <summary>{raceWorkspaceSv.structure} · {overview.counts.classes} / {overview.counts.courses}</summary>
        <div className="grid">
          <section><h2>{sv.classes}</h2><ul>{overview.classes.map((item) =>
            <li key={item.id}>{item.name} ({item.startRule === "FIXED" ? raceWorkspaceSv.fixedStart : raceWorkspaceSv.punchStart}) · {item.entryCount} {sv.raceOverviewEntriesLower}</li>)}</ul>
            {overview.classes.length === 0 && <p className="muted">{sv.raceOverviewNoClasses}</p>}</section>
          <section><h2>{sv.courses}</h2><ul>{overview.courses.map((item) =>
            <li key={item.id}>{item.name}</li>)}</ul>
            {overview.courses.length === 0 && <p className="muted">{sv.raceOverviewNoCourses}</p>}</section>
        </div>
      </details>

      <section className="panel"><h2>{sv.raceOverviewActivityHeading}</h2><dl className="race-overview-activity">
        <dt>{sv.raceOverviewLatestReadout}</dt><dd>{activityTime(overview.latestActivity.readoutAt)}</dd>
        <dt>{sv.raceOverviewLatestRevision}</dt><dd>{activityTime(overview.latestActivity.resultRevisionAt)}</dd>
        <dt>{sv.raceOverviewLatestImport}</dt><dd>{activityTime(overview.latestActivity.importAt)}</dd>
      </dl></section>
    </>}
  </div>;
}
