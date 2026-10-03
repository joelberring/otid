"use client";
import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { entryIdentityAdminLoginRequestSchema, entryIdentityAdminLoginResponseSchema,
  entryIdentityAdminListResponseSchema, entryIdentityChangeRequestSchema,
  type EntryIdentityAdminListResponse, type EntryIdentityHistoryResponse, type EntryIdentityValues } from "@o-tid/contracts";
import { readEntryIdentityAdminCsrfCookie } from "../lib/entry-identity-admin-cookies";
import { appendIdentityHistory, filterEntryIdentities, parseIdentityReceipt, type IdentityAttempt } from "../lib/entry-identity-client";
import { consumeEntryNavigation } from "../lib/entry-navigation";
import { identitySv as text } from "../i18n/entry-identity-sv";

const empty = { givenName: "", familyName: "", organisationName: "" };
function Identity({ value }: { value: EntryIdentityValues }) {
  return <span>{value.givenName} {value.familyName} · {value.organisationName ?? text.none}</span>;
}
export function EntryIdentityAdmin({ raceId }: { raceId: string }) {
  const [credential, setCredential] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string>();
  const [data, setData] = useState<EntryIdentityAdminListResponse>();
  const [entryId, setEntryId] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(empty);
  const [attempt, setAttempt] = useState<IdentityAttempt>();
  const [unknown, setUnknown] = useState(false);
  const [history, setHistory] = useState<EntryIdentityHistoryResponse>();
  const [historyError, setHistoryError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(text.checking);
  const [linkedId, setLinkedId] = useState<string>();
  const hintConsumed = useRef(false);
  const generation = useRef(0), controller = useRef<AbortController | undefined>(undefined);
  const base = `/api/admin/races/${raceId}`, sessionUrl = `${base}/entry-identity/session`;
  const invalidate = useCallback(() => { generation.current++; controller.current?.abort(); }, []);
  const lock = useCallback((discard = false) => {
    invalidate(); setAuthenticated(false); setExpiresAt(undefined); setData(undefined); setHistory(undefined);
    setHistoryError(false); setEntryId(""); setQuery(""); setDraft(empty); setCredential(""); setBusy(false);
    setMessage(text.denied); setUnknown(true);
    if (discard) { setAttempt(undefined); setUnknown(false); setLinkedId(undefined); }
  }, [invalidate]);
  function begin() {
    invalidate(); controller.current = new AbortController(); setBusy(true);
    return { generation: generation.current, signal: controller.current.signal };
  }
  type Operation = ReturnType<typeof begin>;
  function current(op: Operation) { return op.generation === generation.current && !op.signal.aborted; }
  async function response(url: string, op: Operation, init: RequestInit = {}) {
    const res = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store", signal: op.signal });
    if (!current(op)) throw new Error("Superseded");
    if (res.status === 401 || res.status === 403) { lock(); throw new Error("Unauthorized"); }
    return res;
  }
  async function json(res: Response, op: Operation): Promise<unknown> {
    const value: unknown = await res.json();
    if (!current(op)) throw new Error("Superseded");
    return value;
  }
  function csrf() {
    const value = readEntryIdentityAdminCsrfCookie(document.cookie, new URL(window.location.href));
    if (!value) { lock(); throw new Error("Missing CSRF"); }
    return value;
  }
  async function load(op: Operation) {
    const res = await response(`${base}/entry-identity`, op);
    if (!res.ok) throw new Error("List failed");
    const value = entryIdentityAdminListResponseSchema.parse(await json(res, op));
    if (value.raceId !== raceId) throw new Error("Scope mismatch");
    setData(value); return value;
  }
  async function loadHistory(id: string, op: Operation, previous?: EntryIdentityHistoryResponse) {
    try {
      const suffix = previous?.nextCursor ? `&cursor=${encodeURIComponent(previous.nextCursor)}` : "";
      const res = await response(`${base}/entries/${id}/identity/history?limit=20${suffix}`, op);
      if (!res.ok) throw new Error("History failed");
      setHistory(appendIdentityHistory(await json(res, op), raceId, id, previous)); setHistoryError(false);
    } catch { if (current(op)) setHistoryError(true); }
  }
  async function session(op: Operation, init: RequestInit = {}) {
    const res = await response(sessionUrl, op, init);
    if (!res.ok) throw new Error("Session failed");
    const value = entryIdentityAdminLoginResponseSchema.parse(await json(res, op));
    if (value.raceId !== raceId || Date.parse(value.expiresAt) <= Date.now()) throw new Error("Session expired");
    await load(op); setExpiresAt(value.expiresAt); setAuthenticated(true); setMessage("");
  }
  useEffect(() => {
    if (!hintConsumed.current) { hintConsumed.current = true; setLinkedId(consumeEntryNavigation(raceId, "entry-identity")); }
    const op = begin();
    void session(op).catch(() => { if (current(op)) lock(); }).finally(() => { if (current(op)) setBusy(false); });
    const hide = () => lock(true);
    window.addEventListener("pagehide", hide);
    return () => { invalidate(); window.removeEventListener("pagehide", hide); };
    // Session startup is keyed by the remounted race surface, not mutable form state.
  }, [raceId]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(() => lock(), Math.max(0, Date.parse(expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt, lock]);
  async function login(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const op = begin();
    try {
      const body = entryIdentityAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential: credential });
      setCredential(""); await session(op, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch { if (current(op)) lock(); } finally { if (current(op)) setBusy(false); }
  }
  async function logout() {
    let token: string;
    try { token = csrf(); } catch { lock(true); return; }
    lock(true); const op = begin();
    try {
      const res = await response(sessionUrl, op, { method: "DELETE", headers: { "x-otid-csrf": token } });
      if (!res.ok) throw new Error("Logout failed");
    } catch { if (current(op)) setMessage(text.logoutError); } finally { if (current(op)) setBusy(false); }
  }
  async function select(id: string) {
    if (!authenticated || busy || attempt) return;
    const entry = data?.entries.find((row) => row.id === id);
    setEntryId(entry?.id ?? ""); setDraft(entry ? { ...entry.identity, organisationName: entry.identity.organisationName ?? "" } : empty);
    setHistory(undefined); setHistoryError(false); setMessage("");
    if (entry) { const op = begin(); await loadHistory(entry.id, op); if (current(op)) setBusy(false); }
  }
  function search(value: string) {
    if (busy || attempt) return;
    setQuery(value); setEntryId(""); setDraft(empty); setHistory(undefined); setHistoryError(false);
  }
  async function refresh() {
    if (!authenticated || busy || attempt) return;
    const op = begin(); setData(undefined); setHistory(undefined); setHistoryError(false); setEntryId(""); setDraft(empty);
    try { await load(op); setMessage(""); } catch { if (current(op)) setMessage(text.error); }
    finally { if (current(op)) setBusy(false); }
  }
  function prepare(event: FormEvent) {
    event.preventDefault(); if (busy || attempt || !authenticated) return;
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!entry || !data) return;
    const parsed = entryIdentityChangeRequestSchema.safeParse({ formatVersion: 1, expectedEntryVersion: entry.version,
      expectedClassId: entry.classId, expectedSnapshotVersion: data.snapshotVersion, expectedIdentity: entry.identity,
      identity: { ...draft, organisationName: draft.organisationName.trim() || null } });
    if (!parsed.success || JSON.stringify(parsed.data.identity) === JSON.stringify(entry.identity)) { setMessage(text.invalid); return; }
    setAttempt({ id: crypto.randomUUID(), entryId, request: parsed.data }); setUnknown(false); setMessage("");
  }
  async function submit(value: IdentityAttempt) {
    if (busy || !authenticated || value !== attempt) return;
    const op = begin();
    let committed = false;
    try {
      const res = await response(`${base}/entries/${value.entryId}/identity`, op, { method: "PATCH",
        headers: { "content-type": "application/json", "x-otid-csrf": csrf(), "idempotency-key": `entry-identity-change:${value.id}` }, body: JSON.stringify(value.request) });
      if ([400, 404, 409].includes(res.status)) {
        setAttempt(undefined); setUnknown(false); setData(undefined); setHistory(undefined); setEntryId(""); setDraft(empty);
        await load(op); setMessage(text.conflict); return;
      }
      if (!res.ok) throw new Error("Unknown outcome");
      parseIdentityReceipt(await json(res, op), raceId, value);
      committed = true;
      setAttempt(undefined); setUnknown(false); setDraft(empty); setEntryId(value.entryId); setData(undefined); setHistory(undefined);
      const latest = await load(op);
      const entry = latest.entries.find((row) => row.id === value.entryId);
      if (entry) setDraft({ ...entry.identity, organisationName: entry.identity.organisationName ?? "" });
      await loadHistory(value.entryId, op);
      if (current(op)) setMessage(text.saved);
    } catch { if (current(op)) { setUnknown(!committed); setMessage(committed ? `${text.saved} ${text.error}` : text.unknown); } }
    finally { if (current(op)) setBusy(false); }
  }
  const selected = data?.entries.find((row) => row.id === entryId), linked = data?.entries.find((row) => row.id === linkedId);
  const visible = filterEntryIdentities(data?.entries ?? [], query);
  return <div className="stack entry-identity-admin">
    <p className="entry-identity-warning">{text.warning}</p><p role="status" aria-live="polite"
      data-tone={attempt && unknown || message === text.unknown ? "uncertain" :
        message === text.denied || message === text.conflict || message === text.invalid ||
        message === text.logoutError || message.includes(text.error) ? "error" : "neutral"}>{attempt && unknown && authenticated ? "" : message}</p>
    {!authenticated && <form className="panel stack entry-identity-login" onSubmit={(event) => void login(event)}>
      <label>{text.credential}<input type="password" autoComplete="off" value={credential} disabled={busy} onChange={(event) => setCredential(event.target.value)} required /></label>
      <button disabled={busy}>{text.login}</button></form>}
    {authenticated && <>
      <div className="entry-identity-toolbar entry-identity-session"><button className="secondary" onClick={() => void logout()}>{text.logout}</button>
        <button className="secondary" disabled={busy || !!attempt} onClick={() => void refresh()}>{text.refresh}</button></div>
      {attempt && <section className="panel stack entry-identity-review" data-tone={unknown ? "uncertain" : "neutral"} role="alert"><h2>{text.review}</h2>
        {unknown && <p className="entry-identity-unknown">{text.unknown}</p>}<p className="entry-identity-before">{text.before}: <Identity value={attempt.request.expectedIdentity} /></p>
        <p className="entry-identity-after">{text.after}: <Identity value={attempt.request.identity} /></p>
        <button disabled={busy} onClick={() => void submit(attempt)}>{unknown ? text.retry : text.confirm}</button>
        {!unknown && <button className="secondary" disabled={busy} onClick={() => setAttempt(undefined)}>{text.cancel}</button>}
      </section>}
      {data && <form className="panel stack entry-identity-form" onSubmit={prepare}>
        {linked && !attempt && <div className="entry-identity-linked"><p>{text.linked}</p><p><Identity value={linked.identity} /> · {linked.className}</p>
          <button type="button" disabled={busy} onClick={() => { if (busy) return; setQuery(""); setLinkedId(undefined); void select(linked.id); }}>{text.selectLinked}</button></div>}
        <div className="entry-identity-selection"><div className="entry-identity-search"><label>{text.search}<input type="search" value={query} autoComplete="off" disabled={busy || !!attempt} onChange={(event) => search(event.target.value)} /></label>
          <button type="button" className="secondary" disabled={busy || !!attempt || !query} onClick={() => search("")}>{text.clear}</button></div>
          <label>{text.entry}<select value={entryId} disabled={busy || !!attempt} onChange={(event) => void select(event.target.value)}>
            <option value="">{text.choose}</option>{visible.map((entry) => <option key={entry.id} value={entry.id}>{entry.identity.givenName} {entry.identity.familyName} · {entry.className}</option>)}
          </select></label></div>
        <p className="entry-identity-meta">{text.shown} {visible.length} {text.of} {data.entries.length} · {text.version} {data.snapshotVersion}</p>
        {!visible.length && <p>{text.noMatches}</p>}
        <p className="entry-identity-help">{text.help}</p>
        {selected && <><div className="entry-identity-fields">
          <label>{text.given}<input value={draft.givenName} maxLength={160} autoComplete="off" disabled={busy || !!attempt} required onChange={(event) => setDraft({ ...draft, givenName: event.target.value })} /></label>
          <label>{text.family}<input value={draft.familyName} maxLength={160} autoComplete="off" disabled={busy || !!attempt} required onChange={(event) => setDraft({ ...draft, familyName: event.target.value })} /></label>
          <label>{text.organisation}<input value={draft.organisationName} maxLength={200} autoComplete="off" disabled={busy || !!attempt} onChange={(event) => setDraft({ ...draft, organisationName: event.target.value })} /></label>
        </div><button disabled={busy || !!attempt}>{text.inspect}</button></>}
      </form>}
      {selected && <section className="panel stack entry-identity-history"><h2>{text.history}</h2><p className="entry-identity-history-help">{text.historyHelp}</p>
        {historyError && <p className="entry-identity-history-error" role="alert" data-tone="error">{text.historyError}</p>}
        {history?.items.length === 0 && !historyError && <p>{text.historyEmpty}</p>}
        {history?.items.map((row) => <article key={row.requestId}><p>{text.time}: <time dateTime={row.changedAt}>{new Date(row.changedAt).toISOString()}</time> · {text.entryVersion} {row.entryVersionBefore} → {row.entryVersionAfter}</p>
          <p>{text.before}: <Identity value={row.previousIdentity} /></p><p>{text.after}: <Identity value={row.identity} /></p></article>)}
        {history?.nextCursor && <button disabled={busy || !!attempt} onClick={() => { if (busy || attempt) return; const op = begin(); void loadHistory(selected.id, op, history).finally(() => { if (current(op)) setBusy(false); }); }}>{text.more}</button>}
      </section>}
    </>}
  </div>;
}
