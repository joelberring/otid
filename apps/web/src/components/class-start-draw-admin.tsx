"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  classStartDrawAdminLoginResponseSchema, classStartDrawClassesResponseSchema,
  classStartDrawParametersSchema, classStartDrawPreviewResponseSchema, classStartDrawResponseSchema,
  type ClassStartDrawClassesResponse, type ClassStartDrawPreviewResponse, type ClassStartDrawRequest
} from "@o-tid/contracts";
import { readClassStartDrawAdminCsrfCookie } from "../lib/class-start-draw-admin-cookies";
import { formatStartListTime } from "../lib/start-list-time";
import { classStartDrawSv as text } from "../i18n/class-start-draw-sv";

type Attempt = { id: string; request: ClassStartDrawRequest; preview: ClassStartDrawPreviewResponse };
async function fetchWithTimeout(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...options, cache: "no-store", signal: controller.signal });
    const body = await response.arrayBuffer();
    return new Response(response.status === 204 ? null : body, { status: response.status, headers: response.headers });
  }
  finally { window.clearTimeout(timeout); }
}
function csrfHeaders() {
  return { "content-type": "application/json", "x-otid-csrf": readClassStartDrawAdminCsrfCookie(document.cookie, new URL(window.location.href)) ?? "" };
}
export function ClassStartDrawAdmin({ raceId }: { raceId: string }) {
  const endpoint = `/api/admin/races/${encodeURIComponent(raceId)}/class-start-draw`;
  const [authenticated, setAuthenticated] = useState(false);
  const [credential, setCredential] = useState("");
  const [data, setData] = useState<ClassStartDrawClassesResponse>();
  const [classId, setClassId] = useState("");
  const [first, setFirst] = useState("");
  const [interval, setInterval] = useState("60");
  const [seed, setSeed] = useState("");
  const [attempt, setAttempt] = useState<Attempt>();
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const previewRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!attempt || busy || !authenticated) return;
    previewRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    previewRef.current?.focus({ preventScroll: true });
  }, [attempt, uncertain, busy, authenticated]);
  function denied() { setAuthenticated(false); setData(undefined); setMessage(text.denied); }
  async function load() {
    const response = await fetchWithTimeout(endpoint);
    if (response.status === 401 || response.status === 403) { denied(); return; }
    if (!response.ok) throw new Error("load");
    const result = classStartDrawClassesResponseSchema.parse(await response.json());
    if (result.raceId !== raceId) throw new Error("scope");
    setData(result); setAuthenticated(true); setSeed(String(result.seed));
    setClassId(previous => result.classes.some(c => c.id === previous) ? previous : result.classes.find(c => c.entryCount > 0)?.id ?? "");
  }
  useEffect(() => { setBusy(true); void load().catch(() => setMessage(text.error)).finally(() => setBusy(false)); }, [raceId]);
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetchWithTimeout(`${endpoint}-session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ formatVersion: 1, accessCredential: credential.trim() }) });
      setCredential("");
      if (!response.ok) { denied(); return; }
      const result = classStartDrawAdminLoginResponseSchema.parse(await response.json());
      if (result.raceId !== raceId) throw new Error("scope");
      await load();
    } catch { setCredential(""); setMessage(text.error); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try {
      const response = await fetchWithTimeout(`${endpoint}-session`, { method: "DELETE", headers: { "x-otid-csrf": csrfHeaders()["x-otid-csrf"] } });
      if (response.status !== 204 && response.status !== 401) throw new Error("logout");
      denied(); if (!uncertain) setAttempt(undefined);
    } catch { setMessage(text.error); } finally { setBusy(false); }
  }
  async function inspect(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    const parameters = classStartDrawParametersSchema.safeParse({ algorithmVersion: "xorshift32-fisher-yates-v1", seed: Number(seed), firstStartTime: first.trim(), intervalSeconds: Number(interval) });
    if (!parameters.success || !classId) { setMessage(text.invalid); return; }
    setBusy(true);
    try {
      const response = await fetchWithTimeout(`${endpoint}/preview`, { method: "POST", headers: csrfHeaders(), body: JSON.stringify({ formatVersion: 1, classId, parameters: parameters.data }) });
      if (response.status === 401 || response.status === 403) { denied(); return; }
      if (!response.ok) { setMessage(response.status === 409 ? text.conflict : text.error); return; }
      const preview = classStartDrawPreviewResponseSchema.parse(await response.json());
      if (preview.raceId !== raceId || preview.classId !== classId || JSON.stringify(preview.parameters) !== JSON.stringify(parameters.data)) throw new Error("scope");
      setAttempt({ id: crypto.randomUUID(), preview, request: { formatVersion: 1, classId,
        parameters: preview.parameters, expectedSnapshotVersion: preview.snapshotVersion, sourceHash: preview.sourceHash } });
      setUncertain(false);
    } catch { setMessage(text.error); } finally { setBusy(false); }
  }
  async function commit() {
    if (!attempt) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetchWithTimeout(endpoint, { method: "POST", headers: { ...csrfHeaders(), "idempotency-key": `class-start-draw:${attempt.id}` }, body: JSON.stringify(attempt.request) });
      if (response.status === 401 || response.status === 403) { denied(); return; }
      if (response.status === 400 || response.status === 409 || response.status === 404) {
        if (uncertain) { setMessage(text.unknown); return; }
        setAttempt(undefined); setMessage(text.conflict); return;
      }
      if (!response.ok) throw new Error("unknown");
      const receipt = classStartDrawResponseSchema.parse(await response.json());
      if (receipt.requestId !== attempt.id || receipt.raceId !== raceId || receipt.classId !== attempt.request.classId ||
        receipt.sourceHash !== attempt.request.sourceHash || receipt.snapshotVersionBefore !== attempt.request.expectedSnapshotVersion ||
        JSON.stringify(receipt.parameters) !== JSON.stringify(attempt.request.parameters) ||
        receipt.entryCount !== attempt.preview.entries.length || receipt.changedEntryCount !== attempt.preview.entries.filter(e => e.changed).length) throw new Error("receipt");
      setAttempt(undefined); setUncertain(false); setMessage(text.saved);
      try { await load(); } catch { setData(undefined); setMessage(`${text.saved} ${text.error}`); }
    } catch { setUncertain(true); setMessage(text.unknown); } finally { setBusy(false); }
  }
  const preview = attempt?.preview;
  const changedCount = preview?.entries.filter(entry => entry.changed).length ?? 0;
  return <section className="class-start-draw-admin stack">
    <div className="class-start-draw-note"><p>{text.help}</p><p><strong>{text.warning}</strong></p></div>
    {message && <p className={uncertain ? "class-start-draw-message is-uncertain" : "class-start-draw-message"} role="status">{message}</p>}
    {!authenticated ? <form onSubmit={login} className="stack class-start-draw-login">
      <label>{text.credential}<input type="password" autoComplete="off" value={credential} onChange={event => setCredential(event.target.value)} disabled={busy} /></label>
      <button disabled={busy || !credential.trim()}>{text.login}</button>
    </form> : <>
      <div className="class-start-draw-toolbar"><button className="secondary" onClick={() => void logout()} disabled={busy}>{text.logout}</button>{!preview && <button className="secondary" disabled={busy} onClick={() => { setBusy(true); void load().catch(() => setMessage(text.error)).finally(() => setBusy(false)); }}>{text.refresh}</button>}</div>
      {preview ? <section className={uncertain ? "class-start-draw-preview stack is-uncertain" : "class-start-draw-preview stack"} aria-labelledby="class-start-draw-preview-heading">
        <h2 id="class-start-draw-preview-heading" ref={previewRef} tabIndex={-1}>{preview.className}</h2>
        <p className="class-start-draw-counts">{text.count}: <strong>{preview.entries.length}</strong> · {text.changes}: <strong>{changedCount}</strong></p>
        <dl className="class-start-draw-frozen-facts">
          <div><dt>{text.snapshot}</dt><dd>{preview.snapshotVersion}</dd></div>
          <div><dt>{text.timezone}</dt><dd>{preview.timeZone}</dd></div>
          <div><dt>{text.seed}</dt><dd>{preview.parameters.seed}</dd></div>
          <div><dt>{text.algorithm}</dt><dd>{preview.parameters.algorithmVersion}</dd></div>
          <div className="class-start-draw-first-fact"><dt>{text.first}</dt><dd>{formatStartListTime(preview.parameters.firstStartTime, preview.timeZone)}</dd></div>
          <div><dt>{text.interval}</dt><dd>{preview.parameters.intervalSeconds}</dd></div>
          <div><dt>{text.classId}</dt><dd>{preview.classId}</dd></div>
          <div className="class-start-draw-hash-fact"><dt>{text.sourceHash}</dt><dd>{preview.sourceHash}</dd></div>
        </dl>
        {changedCount === 0 && <p className="class-start-draw-no-changes">{text.noChanges}</p>}
        {uncertain && <div className="class-start-draw-uncertain" role="alert"><p>{text.unknown}</p><p><strong>{text.requestId}:</strong> <span>{attempt?.id}</span></p></div>}
        <div className="class-start-draw-preview-actions">
          <button disabled={busy || changedCount === 0} onClick={() => void commit()}>{uncertain ? text.retry : text.confirm}</button>
          {!uncertain && <button className="secondary" disabled={busy} onClick={() => { setAttempt(undefined); setMessage(""); }}>{text.cancel}</button>}
        </div>
        <p className="class-start-draw-scroll-help">{text.scrollHelp}</p>
        <div className="class-start-draw-preview-list" tabIndex={0} role="region" aria-label={text.previewList}>
          <div className="class-start-draw-list-head" aria-hidden="true"><span>{text.participant}</span><span>{text.previous}</span><span>{text.next}</span></div>
          {preview.entries.map(entry => <article className="start-list-entry" key={entry.entryId}>
            <h3>{entry.displayName}</h3>
            <p><span className="class-start-draw-mobile-label">{text.previous}: </span>{entry.previousFixedStartTime ? formatStartListTime(entry.previousFixedStartTime, preview.timeZone) : text.missing}</p>
            <p><span className="class-start-draw-mobile-label">{text.next}: </span>{formatStartListTime(entry.fixedStartTime, preview.timeZone)}{!entry.changed && <small>{text.unchanged}</small>}</p>
          </article>)}
        </div>
      </section> : <>
        {data && !data.classes.some(c => c.entryCount > 0) && <p>{text.empty}</p>}
        {data && <form className="class-start-draw-parameters" onSubmit={inspect}>
          <p className="class-start-draw-current">{text.snapshot}: <strong>{data.snapshotVersion}</strong> · {text.timezone}: <strong>{data.timeZone}</strong></p>
          <label>{text.class}<select value={classId} onChange={event => setClassId(event.target.value)} disabled={busy}>
            <option value="">—</option>{data.classes.map(c => <option value={c.id} key={c.id} disabled={c.entryCount === 0}>{c.name} ({c.entryCount})</option>)}
          </select></label>
          <label>{text.first}<input value={first} onChange={event => setFirst(event.target.value)} placeholder={text.firstExample} disabled={busy} /></label>
          <label>{text.interval}<input type="number" min="1" max="3600" step="1" value={interval} onChange={event => setInterval(event.target.value)} disabled={busy} /></label>
          <label>{text.seed}<input type="number" min="1" max="4294967295" step="1" value={seed} onChange={event => setSeed(event.target.value)} disabled={busy} /></label>
          <button disabled={busy || !classId}>{text.inspect}</button>
        </form>}
      </>}
      <nav className="class-start-draw-related" aria-label={text.related}>
        <Link href={`/admin/${raceId}/recalculation`}>{text.recalculation}</Link>
        <Link href={`/admin/${raceId}/start-list-publication`}>{text.publication}</Link>
      </nav>
    </>}
  </section>;
}
