"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { StartCheckinRosterResponse } from "@o-tid/contracts";
import { ForestWatchClientError, getForestWatchSession, loadForestWatch, loginForestWatch, logoutForestWatch } from "../lib/forest-watch-admin-client";
import { readFinishForestWatchCsrfCookie } from "../lib/start-checkin-admin-cookies";
import { forestWatchSv as text } from "../i18n/forest-watch-sv";
import { ForestWatchReport } from "./forest-watch-report";
import { CheckinConflictReviewPanel } from "./checkin-conflict-review-panel";
import styles from "./forest-watch.module.css";

export function ForestWatchAdmin({ raceId }: { raceId: string }) {
  const [data, setData] = useState<StartCheckinRosterResponse>();
  const [credential, setCredential] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [online, setOnline] = useState(true);
  const [classId, setClassId] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string>(text.checking);
  const [logoutPending, setLogoutPending] = useState(false);
  const current = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const expiry = useRef<number | null>(null);

  const hide = useCallback(() => {
    locked.current = true; current.current?.abort(); current.current = null; expiry.current = null;
    setData(undefined); setAuthenticated(false); setStale(false); setBusy(false); setCredential(""); setClassId(""); setQuery("");
  }, []);
  const load = useCallback(async (accessCredential?: string) => {
    current.current?.abort();
    const controller = new AbortController(); current.current = controller;
    setBusy(true);
    try {
      const session = accessCredential === undefined ? await getForestWatchSession(raceId, controller.signal)
        : await loginForestWatch(raceId, accessCredential, controller.signal);
      if (controller.signal.aborted) return;
      const expiresAt = Date.parse(session.expiresAt);
      if (expiresAt <= Date.now()) { hide(); setMessage(text.denied); return; }
      expiry.current = expiresAt; setAuthenticated(true);
      const roster = await loadForestWatch(raceId, controller.signal);
      if (controller.signal.aborted) return;
      if (expiresAt <= Date.now()) { hide(); setMessage(text.denied); return; }
      setData(roster); setStale(false); setMessage("");
      setClassId((previous) => roster.entries.some((entry) => entry.classId === previous) ? previous : "");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ForestWatchClientError && (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")) {
        hide(); setMessage(text.denied);
      } else { setStale(true); setMessage(error instanceof ForestWatchClientError && error.code === "TOO_LARGE" ? text.tooLarge : text.loadError); }
    } finally {
      if (current.current === controller) { current.current = null; setBusy(false); setCredential(""); }
    }
  }, [raceId, hide]);

  useEffect(() => {
    locked.current = false;
    void load();
    const network = () => { setOnline(navigator.onLine); if (!navigator.onLine) setStale(true); };
    const refresh = () => { if (!locked.current && !current.current && document.visibilityState === "visible") void load(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) { setData(undefined); refresh(); } };
    const timer = window.setInterval(refresh, 30_000);
    const expiryTimer = window.setInterval(() => {
      if (expiry.current !== null && Date.now() >= expiry.current) { hide(); setMessage(text.denied); }
    }, 1_000);
    network(); window.addEventListener("online", network); window.addEventListener("offline", network);
    document.addEventListener("visibilitychange", refresh); window.addEventListener("pageshow", restored);
    return () => {
      current.current?.abort(); window.clearInterval(timer); window.clearInterval(expiryTimer);
      window.removeEventListener("online", network); window.removeEventListener("offline", network);
      document.removeEventListener("visibilitychange", refresh); window.removeEventListener("pageshow", restored);
    };
  }, [load, hide]);

  function login(event: FormEvent) {
    event.preventDefault(); locked.current = false; setLogoutPending(false); void load(credential);
  }
  async function logout() {
    hide(); setBusy(true); setLogoutPending(true);
    const controller = new AbortController(); current.current = controller;
    try {
      const csrf = readFinishForestWatchCsrfCookie(document.cookie, new URL(window.location.href));
      if (!csrf) throw new Error("Missing session proof");
      await logoutForestWatch(raceId, csrf, controller.signal);
      if (!controller.signal.aborted) { setLogoutPending(false); setMessage(text.denied); }
    } catch { if (!controller.signal.aborted) setMessage(text.logoutError); }
    finally { if (current.current === controller) { current.current = null; setBusy(false); } }
  }
  const classes = data ? [...new Map(data.entries.map((entry) => [entry.classId, entry.className])).entries()] : [];
  return <div className={styles.surface}>
    <div className={`${styles.screenOnly} stack`}>
      <p>{text.help}</p><p>{online ? text.online : text.offline}</p><p>{text.readOnly}</p>
      {!authenticated && <form className="panel stack" onSubmit={login}>
        <label>{text.credential}<input type="password" autoComplete="off" spellCheck={false} required disabled={busy} value={credential}
          onChange={(event) => setCredential(event.target.value)} /></label><button disabled={busy}>{text.login}</button>
      </form>}
      {(authenticated || logoutPending) && <div className={styles.controls}>
        <button className="secondary" disabled={logoutPending && busy} onClick={() => void logout()}>{text.logout}</button>
        {authenticated && <button disabled={busy} onClick={() => void load()}>{text.refresh}</button>}
        {data && <button className="secondary" disabled={busy} onClick={() => window.print()}>{text.print}</button>}
      </div>}
      {data && <div className={styles.filters}>
      <label>{text.search}<input type="search" autoComplete="off" spellCheck={false} value={query}
        onChange={(event) => setQuery(event.target.value)} /></label>
      <label>{text.raceClass}<select aria-label={text.raceClass} value={classId} onChange={(event) => setClassId(event.target.value)}>
        <option value="">{text.allClasses}</option>{classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <button type="button" className="secondary" disabled={!query && !classId}
        onClick={() => { setQuery(""); setClassId(""); }}>{text.clearFilters}</button>
      </div>}
      <p role="status" aria-live="polite">{message}</p>
    </div>
    {data && <ForestWatchReport data={data} classId={classId} query={query} stale={stale} />}
    {authenticated && data && <CheckinConflictReviewPanel key={raceId} raceId={raceId} entries={data.entries} timeZone={data.timeZone}
      onUnauthorized={() => { hide(); setMessage(text.denied); }} onReviewed={() => void load()} />}
  </div>;
}
