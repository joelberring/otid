"use client";
import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import type { SpeakerBoardResponse } from "@o-tid/contracts";
import { SpeakerBoardClientError, getSpeakerBoardSession, loadSpeakerBoard, loginSpeakerBoard, logoutSpeakerBoard } from "../lib/speaker-board-client";
import { speakerBoardCookieNamesForUrl } from "../lib/speaker-board-cookies";
import { speakerBoardSv as text } from "../i18n/speaker-board-sv";
import { SpeakerBoardReport } from "./speaker-board-report";
import styles from "./speaker-board.module.css";

function csrfCookie(): string | undefined {
  const name = speakerBoardCookieNamesForUrl(new URL(window.location.href)).csrf;
  const matches = document.cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  const value = matches.length === 1 ? matches[0]?.slice(name.length + 1) : undefined;
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
export function SpeakerBoardAdmin({ raceId }: { raceId: string }) {
  const [data, setData] = useState<SpeakerBoardResponse>();
  const [credential, setCredential] = useState("");
  const [sessionExpiry, setSessionExpiry] = useState<number>();
  // Keep login disabled until initial cookie-session discovery has settled.
  const [busy, setBusy] = useState(true);
  const [stale, setStale] = useState(false);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState<string>(text.checking);
  const [logoutPending, setLogoutPending] = useState(false);
  const current = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const expiry = useRef<number | undefined>(undefined);

  const hide = useCallback(() => {
    locked.current = true; current.current?.abort(); current.current = null; expiry.current = undefined;
    setData(undefined); setSessionExpiry(undefined); setBusy(false); setStale(false); setCredential("");
  }, []);
  const load = useCallback(async (accessCredential?: string) => {
    if (locked.current || current.current || document.visibilityState !== "visible") return;
    const controller = new AbortController(); current.current = controller; setBusy(true);
    try {
      if (accessCredential !== undefined || expiry.current === undefined) {
        const session = accessCredential === undefined ? await getSpeakerBoardSession(raceId, controller.signal)
          : await loginSpeakerBoard(raceId, accessCredential, controller.signal);
        if (controller.signal.aborted || locked.current || document.visibilityState !== "visible") return;
        expiry.current = Date.parse(session.expiresAt); setSessionExpiry(expiry.current);
      }
      if (expiry.current === undefined || expiry.current <= Date.now()) { hide(); setMessage(text.denied); return; }
      const result = await loadSpeakerBoard(raceId, controller.signal);
      if (controller.signal.aborted || locked.current || document.visibilityState !== "visible") return;
      if (expiry.current <= Date.now()) { hide(); setMessage(text.denied); return; }
      setData(result); setStale(false); setMessage("");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SpeakerBoardClientError && (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")) {
        hide(); setMessage(text.denied);
      } else { setStale(true); setMessage(text.loadError); }
    } finally {
      if (current.current === controller) { current.current = null; setBusy(false); }
    }
  }, [raceId, hide]);
  useEffect(() => {
    if (sessionExpiry === undefined) return;
    const timer = window.setTimeout(() => { hide(); setMessage(text.denied); }, Math.max(0, sessionExpiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [sessionExpiry, hide]);
  useEffect(() => {
    locked.current = false;
    if (document.visibilityState === "visible") void load();
    const refresh = () => {
      if (document.visibilityState !== "visible" || locked.current) return;
      if (expiry.current !== undefined && expiry.current <= Date.now()) { hide(); setMessage(text.denied); return; }
      if (!current.current) void load();
    };
    const network = () => { setOnline(navigator.onLine); if (!navigator.onLine) setStale(true); else refresh(); };
    const visibility = () => {
      if (document.visibilityState === "hidden" && !locked.current) {
        current.current?.abort(); current.current = null; setBusy(false); setStale(true);
      } else refresh();
    };
    const leave = () => { flushSync(() => { hide(); setMessage(text.denied); }); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) leave(); };
    const timer = window.setInterval(() => { if (expiry.current !== undefined) refresh(); }, 5_000);
    network(); window.addEventListener("online", network); window.addEventListener("offline", network);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", leave); window.addEventListener("pageshow", restored);
    return () => {
      current.current?.abort(); current.current = null; window.clearInterval(timer);
      window.removeEventListener("online", network); window.removeEventListener("offline", network);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", leave); window.removeEventListener("pageshow", restored);
    };
  }, [load, hide]);
  function login(event: FormEvent) {
    event.preventDefault(); const value = credential; setCredential("");
    locked.current = false; setLogoutPending(false); void load(value);
  }
  async function logout() {
    hide(); setBusy(true); setLogoutPending(true);
    const controller = new AbortController(); current.current = controller;
    try {
      const csrf = csrfCookie(); if (!csrf) throw new Error("Missing session proof");
      await logoutSpeakerBoard(raceId, csrf, controller.signal);
      if (!controller.signal.aborted) { setLogoutPending(false); setMessage(text.denied); }
    } catch { if (!controller.signal.aborted) setMessage(text.logoutError); }
    finally { if (current.current === controller) { current.current = null; setBusy(false); } }
  }
  return <div className={`${styles.surface} stack`}>
    <p>{text.scope}</p><details><summary>{text.about}</summary><p>{text.help}</p><p>{text.readOnly}</p></details>
    <p className={`${styles.networkStatus} ${online ? "" : styles.offline}`}>{online ? text.online : text.offline}</p>
    {sessionExpiry === undefined && <form className="panel stack" onSubmit={login}>
      <label>{text.credential}<input type="password" autoComplete="off" spellCheck={false} required disabled={busy}
        value={credential} onChange={(event) => setCredential(event.target.value)} /></label>
      <button disabled={busy}>{text.login}</button>
    </form>}
    {(sessionExpiry !== undefined || logoutPending) && <div className={styles.controls}>
      <button disabled={logoutPending && busy} onClick={() => void logout()}>{text.logout}</button>
      {sessionExpiry !== undefined && <button disabled={busy} onClick={() => void load()}>{text.refresh}</button>}
    </div>}
    <p className={styles.status} role="status" aria-live="polite">{message}</p>
    {data && <SpeakerBoardReport data={data} stale={stale} />}
  </div>;
}
