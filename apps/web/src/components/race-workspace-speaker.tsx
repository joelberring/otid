"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { publicResultListResponseV7Schema, speakerBoardResponseSchema, type SpeakerBoardResponse } from "@o-tid/contracts";
import { raceWorkspaceSpeakerSv as text } from "../i18n/race-workspace-speaker-sv";
import { speakerBoardSv } from "../i18n/speaker-board-sv";
import { publicClassLeaders, type PublicClassLeader } from "./race-workspace-speaker-leaders";
import styles from "./race-workspace-speaker.module.css";

const REFRESH_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;

type SpeakerRow = SpeakerBoardResponse["rows"][number];

function elapsed(ms: number | undefined): string {
  if (ms === undefined) return speakerBoardSv.noTime;
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function resultStatus(row: SpeakerRow): string {
  return row.state === "NO_ACTIVE_RESULT" ? speakerBoardSv.noResult : speakerBoardSv.statuses[row.result.status];
}

function resultTime(row: SpeakerRow): string {
  return row.state === "ACTIVE_RESULT" && "elapsedMs" in row.result
    ? elapsed(row.result.elapsedMs)
    : speakerBoardSv.noTime;
}

function registeredAt(row: SpeakerRow, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short", timeStyle: "medium" })
    .format(new Date(row.registeredAt));
}

function readAt(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short", timeStyle: "medium" })
    .format(new Date(value));
}

function receivedAt(value: string): string {
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

export function RaceWorkspaceSpeaker({ raceId }: { raceId: string }) {
  const [data, setData] = useState<SpeakerBoardResponse>();
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [message, setMessage] = useState("");
  const [online, setOnline] = useState(true);
  const [leaders, setLeaders] = useState<PublicClassLeader[]>();
  const [leadersReceivedAt, setLeadersReceivedAt] = useState<string>();
  const [leadersLoading, setLeadersLoading] = useState(false);
  const [leadersStale, setLeadersStale] = useState(false);
  const [leadersMessage, setLeadersMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const dataRef = useRef<SpeakerBoardResponse | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const leadersRequest = useRef<AbortController | null>(null);
  const currentRace = useRef(raceId);
  const active = useRef(true);
  const denied = useRef(false);
  currentRace.current = raceId;

  const load = useCallback(async (manual = false) => {
    if (!active.current || request.current || document.visibilityState !== "visible") return;
    if (denied.current && !manual) return;

    if (manual) {
      denied.current = false;
      setSessionError(false);
    }
    const controller = new AbortController();
    request.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/races/${encodeURIComponent(raceId)}/administrator/speaker-board`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal
      });
      if (controller.signal.aborted || !active.current || currentRace.current !== raceId) return;
      if (response.status === 401 || response.status === 403) {
        denied.current = true;
        dataRef.current = undefined;
        setData(undefined);
        setStale(false);
        setSessionError(true);
        setSearchTerm("");
        setMessage(text.sessionError);
        leadersRequest.current?.abort();
        leadersRequest.current = null;
        setLeaders(undefined);
        setLeadersReceivedAt(undefined);
        setLeadersStale(false);
        setLeadersMessage("");
        setLeadersLoading(false);
        return;
      }
      if (!response.ok) throw new Error("speaker request failed");
      const body: unknown = await response.json();
      if (controller.signal.aborted || !active.current) return;
      const parsed = speakerBoardResponseSchema.safeParse(body);
      if (!parsed.success || parsed.data.raceId !== raceId) throw new Error("invalid speaker response");
      dataRef.current = parsed.data;
      setData(parsed.data);
      setStale(false);
      setSessionError(false);
      setMessage("");
    } catch {
      if (!active.current || currentRace.current !== raceId || (controller.signal.aborted && !timedOut)) return;
      setStale(dataRef.current !== undefined);
      setMessage(dataRef.current !== undefined ? "" : timedOut ? text.timeoutError : text.loadError);
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        if (active.current) setLoading(false);
      }
    }
  }, [raceId]);

  const loadLeaders = useCallback(async () => {
    if (!active.current || leadersRequest.current) return;
    const controller = new AbortController();
    leadersRequest.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    setLeadersLoading(true);
    setLeadersMessage("");
    try {
      const response = await fetch(`/api/public/races/${encodeURIComponent(raceId)}/results`, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal
      });
      if (controller.signal.aborted || !active.current || currentRace.current !== raceId) return;
      if (!response.ok) throw new Error("public result request failed");
      const parsed = publicResultListResponseV7Schema.safeParse(await response.json());
      if (controller.signal.aborted || !active.current || currentRace.current !== raceId) return;
      if (!parsed.success) throw new Error("invalid public result response");
      setLeaders(publicClassLeaders(parsed.data));
      setLeadersReceivedAt(new Date().toISOString());
      setLeadersStale(false);
      setLeadersMessage("");
    } catch {
      if (!active.current || currentRace.current !== raceId || (controller.signal.aborted && !timedOut)) return;
      setLeadersStale(leaders !== undefined);
      setLeadersMessage(leaders === undefined ? timedOut ? text.leadersTimeout : text.leadersError : "");
    } finally {
      window.clearTimeout(timeout);
      if (leadersRequest.current === controller) {
        leadersRequest.current = null;
        if (active.current) setLeadersLoading(false);
      }
    }
  }, [leaders, raceId]);

  useEffect(() => {
    active.current = true;
    setSearchTerm("");
    if (dataRef.current?.raceId !== raceId) {
      leadersRequest.current?.abort();
      leadersRequest.current = null;
      dataRef.current = undefined;
      denied.current = false;
      setData(undefined);
      setStale(false);
      setSessionError(false);
      setMessage("");
      setLeaders(undefined);
      setLeadersReceivedAt(undefined);
      setLeadersLoading(false);
      setLeadersStale(false);
      setLeadersMessage("");
    }
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible" && !request.current && !denied.current) void load();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        request.current?.abort();
        request.current = null;
        setLoading(false);
      } else refreshIfVisible();
    };
    const network = () => setOnline(navigator.onLine);
    const interval = window.setInterval(refreshIfVisible, REFRESH_INTERVAL_MS);

    network();
    void load();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    return () => {
      active.current = false;
      request.current?.abort();
      request.current = null;
      leadersRequest.current?.abort();
      leadersRequest.current = null;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, [load]);

  const visibleData = data?.raceId === raceId ? data : undefined;
  const query = searchTerm.trim().toLocaleLowerCase("sv-SE");
  const matchesSearch = (givenName: string, familyName: string, className: string) =>
    !query || `${givenName} ${familyName}`.toLocaleLowerCase("sv-SE").includes(query)
      || className.toLocaleLowerCase("sv-SE").includes(query);
  const visibleLeaders = leaders?.filter((leader) => matchesSearch(leader.givenName, leader.familyName, leader.className));
  const visibleRows = visibleData?.rows.filter((row) => matchesSearch(row.givenName, row.familyName, row.className));

  return <section className={`${styles.surface} stack`} aria-labelledby={`workspace-speaker-${raceId}`}>
    <div className={styles.pageHead}>
      <h2 id={`workspace-speaker-${raceId}`}>{text.title}</h2>
      <p className={styles.networkState}>{online ? text.online : text.offline}</p>
    </div>
    {sessionError && <p role="alert" className={`${styles.notice} ${styles.alertCritical}`}>{text.sessionError}</p>}
    {!sessionError && <div className={styles.search}>
      <label htmlFor={`workspace-speaker-search-${raceId}`}>{text.searchLabel}</label>
      <div className={styles.searchControls}>
        <input id={`workspace-speaker-search-${raceId}`} type="search" value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)} aria-describedby={`workspace-speaker-search-help-${raceId}`} />
        <button type="button" className="secondary" disabled={!searchTerm} onClick={() => setSearchTerm("")}>{text.clearSearch}</button>
      </div>
      <p id={`workspace-speaker-search-help-${raceId}`} className={styles.sourceNote}>{text.searchHelp}</p>
    </div>}
    <div className={`${styles.columns} ${sessionError ? styles.singleColumn : ""}`}>
      {!sessionError && <section className={styles.panel} aria-labelledby={`workspace-speaker-leaders-${raceId}`}>
        <div className={styles.panelHead}>
          <h3 id={`workspace-speaker-leaders-${raceId}`}>{text.leadersTitle}</h3>
          <button type="button" className="secondary" disabled={leadersLoading} onClick={() => void loadLeaders()}>
            {leadersLoading ? text.leadersLoading : leaders === undefined ? text.leadersShow : text.leadersRefresh}
          </button>
        </div>
        <p className={styles.sourceNote}>{text.leadersScope} {text.leadersCache} {text.leadersDetailHelp}</p>
        <p className={`${styles.readTime} ${leadersReceivedAt && !leadersStale ? "" : styles.readWarning}`}>{text.leadersReceived}: {leadersReceivedAt
          ? <time dateTime={leadersReceivedAt}>{receivedAt(leadersReceivedAt)}</time>
          : text.notRead}</p>
        {leadersMessage && <p role="status" className={styles.notice}>{leadersMessage}</p>}
        {leadersStale && leaders !== undefined && <p role="status" className={styles.notice}>{text.leadersStale}</p>}
        {visibleLeaders && <p className={styles.searchCount} aria-live="polite">{text.showing} {visibleLeaders.length} {text.of} {leaders?.length}</p>}
        {leaders !== undefined && <>
        <div className={styles.leaderTableWrap}>
          <table className={`${styles.table} ${styles.leaderTable}`} aria-label={text.leadersTableLabel}>
            <thead><tr><th scope="col">{text.leaderClass}</th><th scope="col">{text.leaderName}</th><th scope="col">{text.leaderFinishTime}</th><th scope="col">{text.leader}</th></tr></thead>
            <tbody>{visibleLeaders?.map((leader) => <tr key={leader.publicResultId}>
              <td>{leader.className}</td>
              <td><strong><Link className={styles.leaderDetailLink}
                href={`/results/${encodeURIComponent(raceId)}/participants/${encodeURIComponent(leader.publicResultId)}`}
                target="_blank" rel="noopener noreferrer" prefetch={false}
                aria-label={text.leaderDetailLabel(`${leader.givenName} ${leader.familyName}`)}>
                {leader.givenName} {leader.familyName}
              </Link></strong>{leader.organisationName && <span className={styles.organisation}>{leader.organisationName}</span>}</td>
              <td><strong className={styles.time}>{elapsed(leader.elapsedMs)}</strong></td>
              <td><strong className={styles.leaderSignal}>{text.leader}</strong></td>
            </tr>)}</tbody>
          </table>
        </div>
        <ul className={styles.leaderMobileRows} aria-label={text.leadersTableLabel}>
          {visibleLeaders?.map((leader) => <li key={leader.publicResultId} className={styles.leaderMobileRow}>
            <p><strong>{leader.className}</strong> · <span className={styles.leaderSignal}>{text.leader}</span></p>
            <p><Link className={styles.leaderDetailLink}
              href={`/results/${encodeURIComponent(raceId)}/participants/${encodeURIComponent(leader.publicResultId)}`}
              target="_blank" rel="noopener noreferrer" prefetch={false}
              aria-label={text.leaderDetailLabel(`${leader.givenName} ${leader.familyName}`)}>
              {leader.givenName} {leader.familyName}
            </Link>{leader.organisationName ? ` · ${leader.organisationName}` : ""}</p>
            <p>{text.leaderFinishTime}: <strong className={styles.time}>{elapsed(leader.elapsedMs)}</strong></p>
          </li>)}
        </ul>
        {leaders.length === 0 && <p>{text.leadersEmpty}</p>}
        {query && leaders.length > 0 && visibleLeaders?.length === 0 && <p>{text.noSearchMatches}</p>}
        </>}
      </section>}
      <section className={styles.panel} aria-labelledby={`workspace-speaker-recent-${raceId}`}>
        <div className={styles.panelHead}>
          <h3 id={`workspace-speaker-recent-${raceId}`}>{text.recentTitle}</h3>
          <button type="button" className="secondary" disabled={loading} onClick={() => void load(true)}>
            {loading ? text.loading : text.refresh}
          </button>
        </div>
        <p className={styles.sourceNote}>{text.recentSource}</p>
        <p className={`${styles.readTime} ${visibleData && !stale ? "" : styles.readWarning}`}>{text.recentRead}: {visibleData
          ? <><time dateTime={visibleData.generatedAt}>{readAt(visibleData.generatedAt, visibleData.timeZone)}</time> ({visibleData.timeZone})</>
          : text.notRead}</p>
        {!sessionError && message && <p role="status" className={styles.notice}>{message}</p>}
        {stale && visibleData && <p role="status" className={styles.notice}>{text.stale}</p>}
        {visibleData && <p className={styles.raceName}>{visibleData.eventName} – {visibleData.raceName}</p>}
        {visibleData && <p className={styles.searchCount} aria-live="polite">{text.showing} {visibleRows?.length} {text.of} {visibleData.rows.length}</p>}
        {visibleData ? <>
      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label={text.tableLabel}>
          <thead><tr>
            <th scope="col">{speakerBoardSv.name}</th>
            <th scope="col">{speakerBoardSv.raceClass}</th>
            <th scope="col">{speakerBoardSv.result}</th>
            <th scope="col">{speakerBoardSv.time}</th>
            <th scope="col">{speakerBoardSv.registered}</th>
          </tr></thead>
          <tbody>{visibleRows?.map((row) => <tr key={row.slot}>
            <td><strong>{row.givenName} {row.familyName}</strong>
              {row.organisationName && <span className={styles.organisation}>{row.organisationName}</span>}</td>
            <td>{row.className}</td>
            <td><span className={`${styles.status} ${row.state === "NO_ACTIVE_RESULT" ? styles.statusWarning : row.result.status === "MP" || row.result.status === "DSQ" ? styles.statusCritical : ""}`}>{resultStatus(row)}</span></td>
            <td><span className={styles.time}>{resultTime(row)}</span></td>
            <td><time dateTime={row.registeredAt}>{registeredAt(row, visibleData.timeZone)}</time></td>
          </tr>)}</tbody>
        </table>
      </div>
      <ul className={styles.mobileRows} aria-label={text.tableLabel}>
        {visibleRows?.map((row) => <li key={row.slot} className={styles.mobileRow}>
          <h3>{row.givenName} {row.familyName}</h3>
          {row.organisationName && <p className={styles.organisation}>{row.organisationName}</p>}
          <p><span>{speakerBoardSv.raceClass}: </span>{row.className}</p>
          <p><span>{speakerBoardSv.result}: </span><strong className={`${styles.status} ${row.state === "NO_ACTIVE_RESULT" ? styles.statusWarning : row.result.status === "MP" || row.result.status === "DSQ" ? styles.statusCritical : ""}`}>{resultStatus(row)}</strong></p>
          <p><span>{speakerBoardSv.time}: </span><strong className={styles.time}>{resultTime(row)}</strong></p>
          <p><span>{speakerBoardSv.registered}: </span><time dateTime={row.registeredAt}>{registeredAt(row, visibleData.timeZone)}</time></p>
        </li>)}
      </ul>
      {visibleData.rows.length === 0 && <p>{speakerBoardSv.empty}</p>}
      {query && visibleData.rows.length > 0 && visibleRows?.length === 0 && <p>{text.noSearchMatches}</p>}
        </> : !sessionError && !message
          ? <p role="status">{loading ? text.loading : text.noData}</p> : null}
      </section>
    </div>
    <details className={styles.separateRole}>
      <summary>{text.separateRoleHeading}</summary>
      <p>{text.separateRoleHelp}</p>
      <Link href={`/admin/${encodeURIComponent(raceId)}/speaker`}>{text.separateRole}</Link>
    </details>
  </section>;
}
