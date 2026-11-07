"use client";

import { useEffect, useState } from "react";
import { suggestedMapLinkLastDay } from "@o-tid/domain";
import type { MapLinkState } from "@o-tid/contracts";
import { mapLinkSv } from "../../i18n/map-link-sv";
import { notesSv } from "../../i18n/course-setting-notes-sv";
import { createMapLink, fetchMapLinkState, mapLinkUrl, revokeMapLink } from "../../lib/map-link-api";
import { Button, CopyButton, DateInput, Notice } from "../ui";
import styles from "./map-link-panel.module.css";

const text = mapLinkSv.share;

/**
 * ADR-0214: "Dela med kartritaren" i Kartfel (den som får ändra banläggningen och administratörer). Länken visas en gång
 * med "Kopiera länken"; sedan visas bara läget, "Senast öppnad", "Stäng av länken" och "Skapa ny länk" (stänger den förra).
 * Tiden är obegränsad som förval; "Begränsa tiden" föreslår tävlingsdagen plus en vecka.
 */
export function MapLinkPanel({ raceId, nearCount }: { raceId: string; nearCount: number }) {
  const [state, setState] = useState<MapLinkState>();
  const [token, setToken] = useState<string>();
  const [form, setForm] = useState(false);
  const [limit, setLimit] = useState(false);
  const [lastDay, setLastDay] = useState("");
  const [showRaceName, setShowRaceName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  useEffect(() => {
    let stopped = false;
    void fetchMapLinkState(raceId).then(value => { if (!stopped) setState(value); }, () => { if (!stopped) setMessage({ tone: "error", text: text.failed }); });
    return () => { stopped = true; };
  }, [raceId]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage(undefined);
    try { await action(); } catch (error) { console.error("Länken till kartritaren sparades inte", error); setMessage({ tone: "error", text: text.failed }); }
    finally { setBusy(false); }
  }
  function openForm() {
    setForm(true); setLimit(false); setShowRaceName(false); setToken(undefined);
    if (state) setLastDay(suggestedMapLinkLastDay(state.raceDate, state.today));
  }
  const create = () => run(async () => {
    const created = await createMapLink(raceId, { lastDay: limit ? lastDay : null, showRaceName });
    const { token: value, ...next } = created;
    setState(next); setToken(value); setForm(false);
  });

  if (!state) return <section className={styles.panel} aria-labelledby="map-link-title"><h2 id="map-link-title">{text.heading}</h2>
    {message ? <Notice tone="error">{message.text}</Notice> : <p role="status">{text.loading}</p>}</section>;
  const link = state.link;
  const url = token ? mapLinkUrl(token) : undefined;
  return <section className={styles.panel} aria-labelledby="map-link-title" data-testid="map-link-panel">
    <h2 id="map-link-title">{text.heading}</h2>
    <p>{text.intro}</p>
    {nearCount > 0 && <p className={styles.warning} role="note">{text.near(nearCount)}</p>}
    {url && <div className={styles.created}>
      <label>{text.linkLabel}<input type="text" readOnly value={url} data-testid="map-link-url" onFocus={event => event.target.select()} /></label>
      <CopyButton value={url} onResult={ok => setMessage(ok ? { tone: "ok", text: text.copied } : { tone: "error", text: text.copyFailed })}>
        {text.copy}</CopyButton>
      <p className={styles.muted}>{text.shownOnce}</p>
    </div>}
    {link && !form && <div className={styles.status} data-testid="map-link-status" data-status={link.status}>
      <p>{link.status === "EXPIRED" ? text.expired : link.expiresAt ? text.activeUntil(link.expiresAt) : text.activeForever}</p>
      <p className={styles.muted}>{link.lastOpenedAt ? text.lastOpened(link.lastOpenedAt) : text.neverOpened}
        {link.showRaceName ? ` ${text.withRaceName}` : ""}</p>
      <div className={styles.row}>
        <Button variant="secondary" disabled={busy} onClick={() => { if (window.confirm(text.regenerateConfirm)) openForm(); }}>{text.regenerate}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => {
          if (!window.confirm(text.revokeConfirm)) return;
          void run(async () => { setState(await revokeMapLink(raceId)); setToken(undefined); setMessage({ tone: "ok", text: text.revoked }); });
        }}>{text.revoke}</Button>
      </div>
    </div>}
    {!link && !form && <Button onClick={openForm}>{text.open}</Button>}
    {form && <form className={styles.form} aria-label={text.heading} onSubmit={event => { event.preventDefault(); if (!busy) void create(); }}>
      <label className={styles.check}><input type="checkbox" checked={limit} onChange={event => setLimit(event.target.checked)} />{text.limit}</label>
      {limit && <label>{text.lastDay}<DateInput value={lastDay} min={state.today} required onChange={event => setLastDay(event.target.value)} /></label>}
      <label className={styles.check}><input type="checkbox" checked={showRaceName} onChange={event => setShowRaceName(event.target.checked)} />
        {text.showRaceName}</label>
      <p className={styles.muted}>{text.showRaceNameHelp}</p>
      <p className={styles.muted}>{notesSv.export.textReminder}</p>
      <div className={styles.row}>
        <Button type="submit" disabled={busy || (limit && !lastDay)}>{text.create}</Button>
        <Button variant="quiet" onClick={() => setForm(false)}>{text.cancel}</Button>
      </div>
    </form>}
    {message && <Notice tone={message.tone === "ok" ? "ok" : "error"} role={message.tone === "ok" ? "status" : "alert"}>{message.text}</Notice>}
  </section>;
}
