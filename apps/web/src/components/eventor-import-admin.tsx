"use client";
import React, { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  eventCreationLoginResponseSchema, eventorConnectionsResponseSchema, eventorImportRequestSchema,
  eventorImportResponseSchema, eventorPreviewResponseSchema,
  type EventorConnectionsResponse, type EventorImportRequest, type EventorImportResponse, type EventorPreviewResponse,
} from "@o-tid/contracts";
import { readEventCreationCsrfCookie } from "../lib/event-creation-admin-cookies";
import { eventorProfileLabel, eventorSv as text } from "../i18n/eventor-sv";

const sessionUrl = "/api/admin/event-creation-session";
const importUrl = "/api/admin/eventor-import";
type Attempt = { id: string; request: EventorImportRequest };

async function http(url: string, method = "GET", body?: unknown, id?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["x-otid-csrf"] = readEventCreationCsrfCookie(document.cookie, new URL(location.href)) ?? "";
  if (id) headers["idempotency-key"] = `eventor-import:${id}`;
  try {
    const response = await fetch(url, { method, headers, credentials: "same-origin", cache: "no-store",
      signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data: unknown = response.status === 204 ? null : await response.json();
    return { status: response.status, ok: response.ok, data };
  } finally { clearTimeout(timeout); }
}

export function EventorImportAdmin() {
  const [authenticated, setAuthenticated] = useState(false);
  const [credential, setCredential] = useState("");
  const [connections, setConnections] = useState<EventorConnectionsResponse["connections"]>([]);
  const [preview, setPreview] = useState<EventorPreviewResponse>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [created, setCreated] = useState<EventorImportResponse>();
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string>(text.checking);
  const [online, setOnline] = useState<boolean>();
  const [logoutUnknown, setLogoutUnknown] = useState(false);

  function hidePrivate() { setAuthenticated(false); setConnections([]); setPreview(undefined); setCreated(undefined); }
  async function loadConnections(canApply = () => true) {
    const response = await http(importUrl);
    if (!canApply()) return;
    if (!response.ok) { hidePrivate(); throw new Error(text.failed); }
    const result = eventorConnectionsResponseSchema.parse(response.data);
    setConnections(result.connections); setAuthenticated(true); setMessage("");
  }
  useEffect(() => {
    let cancelled = false;
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    void loadConnections(() => !cancelled).catch(() => { if (!cancelled) setMessage(text.failed); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; window.removeEventListener("online", update); window.removeEventListener("offline", update); };
    // Initial session lookup uses no form state.
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await http(sessionUrl, "POST", { formatVersion: 1, accessCredential: credential });
      if (!response.ok || !eventCreationLoginResponseSchema.safeParse(response.data).success) throw new Error(text.failed);
      await loadConnections();
    } catch { setMessage(text.failed); }
    finally { setCredential(""); setBusy(false); }
  }
  async function fetchPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setBusy(true); setPreview(undefined); setCreated(undefined); setMessage("");
    try {
      const response = await http(importUrl + "/preview", "POST", { formatVersion: 1,
        connectionId: form.get("connectionId"), eventId: form.get("eventId") });
      if (response.status === 401 || response.status === 403) hidePrivate();
      if (!response.ok) throw new Error(text.failed);
      setPreview(eventorPreviewResponseSchema.parse(response.data));
    } catch { setMessage(text.failed); }
    finally { setBusy(false); }
  }
  async function submit(current: Attempt) {
    setBusy(true); setMessage("");
    try {
      const response = await http(importUrl, "POST", current.request, current.id);
      if (response.status === 401 || response.status === 403) hidePrivate();
      if ([400, 409].includes(response.status)) {
        setAttempt(undefined); setPreview(undefined); setMessage(text.conflict); return;
      }
      if (!response.ok) throw new Error(text.unknown);
      const receipt = eventorImportResponseSchema.parse(response.data);
      if (receipt.requestId !== current.id || receipt.externalEventId !== current.request.eventId
        || receipt.externalEventRaceId !== current.request.eventRaceId || receipt.sourceHash !== current.request.sourceHash) throw new Error(text.invalid);
      setCreated(receipt); setAttempt(undefined); setPreview(undefined); setMessage(text.success);
    } catch { setMessage(text.unknown); }
    finally { setBusy(false); }
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!preview || attempt) return;
    const form = new FormData(event.currentTarget);
    const request = eventorImportRequestSchema.safeParse({ formatVersion: 1, connectionId: preview.connectionId,
      eventId: preview.projection.eventId, eventRaceId: form.get("eventRaceId"), timeZone: form.get("timeZone"), sourceHash: preview.sourceHash });
    if (!request.success) { setMessage(text.invalid); return; }
    const current = { id: crypto.randomUUID(), request: request.data };
    setAttempt(current); await submit(current);
  }
  async function logout() {
    setBusy(true); hidePrivate(); setCredential(""); setAttempt(undefined);
    try {
      const response = await http(sessionUrl, "DELETE");
      if (!response.ok && response.status !== 401) throw new Error();
      setLogoutUnknown(false); setMessage("");
    } catch { setLogoutUnknown(true); setMessage(text.logoutUnknown); }
    finally { setBusy(false); }
  }
  return <div className="stack eventor-import-admin">
    <section className="panel stack"><h1>{text.heading}</h1><p>{text.lead}</p><p>{text.boundary}</p>
      <p role="status">{online === undefined ? text.checking : online ? text.online : text.offline}</p></section>
    {logoutUnknown ? <button disabled={busy} onClick={() => void logout()}>{text.logout}</button>
      : !authenticated ? <form className="panel stack" onSubmit={(event) => void login(event)}>
        <label>{text.credential}<input type="password" value={credential} autoComplete="off" required
          onChange={(event) => setCredential(event.target.value)} /></label><button disabled={busy}>{text.login}</button></form>
        : <section className="panel stack"><button disabled={busy} onClick={() => void logout()}>{text.logout}</button>
          {connections.length === 0 ? <p>{text.noConnections}</p> : <form className="stack" onSubmit={(event) => void fetchPreview(event)}>
            <label>{text.connection}<select name="connectionId" required defaultValue="" disabled={busy || !!attempt} onChange={() => setPreview(undefined)}>
              <option value="">{text.choose}</option>{connections.map((connection) => <option key={connection.connectionId} value={connection.connectionId}>{connection.label} · {eventorProfileLabel(connection.environment)}</option>)}</select></label>
            <label>{text.eventId}<input name="eventId" required maxLength={256} disabled={busy || !!attempt} onChange={() => setPreview(undefined)} /></label>
            <button disabled={busy || !!attempt}>{text.fetch}</button></form>}
        </section>}
    {authenticated && preview && !attempt && <section className="panel stack"><h2>{preview.projection.eventName}</h2>
      <p>{text.fetchedAt}: {preview.fetchedAt}</p><p className="muted">{text.sourceHash}: {preview.sourceHash}</p>
      {preview.projection.races.length === 0 ? <p role="alert">{text.noRaces}</p> : <form className="stack" onSubmit={(event) => void confirm(event)}>
        <label>{text.race}<select name="eventRaceId" defaultValue="" required disabled={busy}>
          <option value="">{text.choose}</option>{preview.projection.races.map((race) => <option key={race.eventRaceId} value={race.eventRaceId}>{race.raceName} — {race.raceDate}</option>)}</select></label>
        <label>{text.zone}<input name="timeZone" placeholder="Europe/Stockholm" required maxLength={100} disabled={busy} /></label>
        <p role="note">{text.warning}</p><button disabled={busy}>{text.confirm}</button></form>}
    </section>}
    {attempt && <section className="panel stack" role="alert"><p>{text.unknown}</p><p>{text.requestId}: {attempt.id}</p>
      {authenticated && <button disabled={busy} onClick={() => void submit(attempt)}>{text.retry}</button>}
      <p>{text.discardHelp}</p><button disabled={busy} onClick={() => { setAttempt(undefined); setPreview(undefined); }}>{text.discard}</button></section>}
    {authenticated && created && <section className="panel stack"><h2>{text.success}</h2>
      <Link href={`/admin/${created.raceId}`}>{text.open}</Link><p>{text.warning}</p></section>}
    <p role="status" aria-live="polite">{busy ? text.busy : message}</p>
  </div>;
}
