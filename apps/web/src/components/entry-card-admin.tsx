"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  entryCardAdminListResponseSchema, entryCardAdminLoginRequestSchema,
  entryCardAdminLoginResponseSchema, entryCardChangeRequestSchema,
  entryCardChangeResponseSchema, type EntryCardAdminListResponse,
  type EntryCardChangeRequest
} from "@o-tid/contracts";
import { readEntryCardAdminCsrfCookie } from "../lib/entry-card-admin-cookies";
import { cardSv as text } from "../i18n/entry-card-sv";
import { filterEntryCards } from "../lib/entry-card-filter";
import { consumeEntryNavigation } from "../lib/entry-navigation";

type Attempt = { id: string; entryId: string; displayName: string; request: EntryCardChangeRequest };

export function EntryCardAdmin({ raceId }: { raceId: string }) {
  const [credential, setCredential] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<EntryCardAdminListResponse>();
  const [entryId, setEntryId] = useState("");
  const [query, setQuery] = useState("");
  const [linkedEntryId, setLinkedEntryId] = useState<string>();
  const hintConsumed = useRef(false);
  useEffect(() => {
    if (hintConsumed.current) return;
    hintConsumed.current = true;
    setLinkedEntryId(consumeEntryNavigation(raceId, "cards"));
  }, [raceId]);
  const [newCard, setNewCard] = useState("");
  const [attempt, setAttempt] = useState<Attempt>();
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(text.checking);
  const [saved, setSaved] = useState(false);
  const sessionUrl = `/api/admin/races/${raceId}/entry-card-session`;
  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/races/${raceId}/entry-cards`, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401 || response.status === 403) {
      setQuery("");
      setAuthenticated(false); setData(undefined); setMessage(text.denied); return;
    }
    if (!response.ok) throw new Error(text.loadError);
    const parsed = entryCardAdminListResponseSchema.parse(await response.json());
    if (parsed.raceId !== raceId) throw new Error(text.loadError);
    setData(parsed); setAuthenticated(true); setMessage("");
  }, [raceId]);
  useEffect(() => { void load().catch(() => setMessage(text.loadError)); }, [load]);
  function csrf() {
    const token = readEntryCardAdminCsrfCookie(document.cookie, new URL(window.location.href));
    if (!token) throw new Error(text.denied);
    return token;
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const body = entryCardAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential: credential });
      const response = await fetch(sessionUrl, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(text.denied);
      const value = entryCardAdminLoginResponseSchema.parse(await response.json());
      if (value.raceId !== raceId) throw new Error(text.denied);
      await load();
    } catch { setQuery(""); setMessage(text.denied); } finally { setCredential(""); setBusy(false); }
  }
  async function logout() {
    setBusy(true); setQuery("");
    try {
      const response = await fetch(sessionUrl, { method: "DELETE", credentials: "same-origin", headers: { "x-otid-csrf": csrf() } });
      if (!response.ok && response.status !== 401) throw new Error(text.error);
      setAuthenticated(false); setData(undefined); setSaved(false); setMessage(text.denied);
    } catch { setMessage(text.error); } finally { setBusy(false); }
  }
  function prepare(event: FormEvent) {
    event.preventDefault();
    const entry = data?.entries.find((row) => row.id === entryId);
    if (!data || !entry || entry.multipleActiveAssignments) return;
    const request = entryCardChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedSnapshotVersion: data.snapshotVersion, expectedAssignment: entry.activeAssignment, cardNumber: newCard });
    if (!request.success) { setMessage(text.invalid); return; }
    if (request.data.cardNumber === request.data.expectedAssignment?.cardNumber) { setMessage(text.conflict); return; }
    setAttempt({ id: crypto.randomUUID(), entryId, displayName: entry.displayName, request: request.data });
    setUnknown(false); setSaved(false); setMessage("");
  }
  async function submit(current: Attempt) {
    setBusy(true);
    try {
      const response = await fetch(`/api/races/${raceId}/entries/${current.entryId}/card`, {
        method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json",
          "idempotency-key": `entry-card-change:${current.id}`, "x-otid-csrf": csrf() },
        body: JSON.stringify(current.request)
      });
      if ([400, 404, 409].includes(response.status)) {
        setAttempt(undefined);
        await load().catch(() => { setData(undefined); });
        setMessage(response.status === 409 ? text.conflict : text.error); return;
      }
      if (response.status === 401 || response.status === 403) {
        setQuery("");
        setAuthenticated(false); setData(undefined); setUnknown(true); setMessage(text.reauth); return;
      }
      if (!response.ok) throw new Error(text.unknown);
      const result = entryCardChangeResponseSchema.parse(await response.json());
      if (result.requestId !== current.id || result.raceId !== raceId || result.entryId !== current.entryId ||
        result.classId !== current.request.expectedClassId || result.activeAssignment.cardNumber !== current.request.cardNumber ||
        result.previousAssignment?.id !== current.request.expectedAssignment?.id ||
        result.previousAssignment?.cardNumber !== current.request.expectedAssignment?.cardNumber ||
        result.entryVersionBefore !== current.request.expectedEntryVersion ||
        result.snapshotVersionBefore !== current.request.expectedSnapshotVersion) throw new Error(text.unknown);
      setAttempt(undefined); setSaved(true); setUnknown(false);
      await load().catch(() => { setData(undefined); }); setMessage(text.saved);
    } catch { setUnknown(true); setMessage(text.unknown); } finally { setBusy(false); }
  }
  const selected = data?.entries.find((entry) => entry.id === entryId);
  const visible = filterEntryCards(data?.entries ?? [], query);
  const linkedEntry = data?.entries.find((entry) => entry.id === linkedEntryId);
  function selectLinkedEntry() {
    if (!authenticated || !linkedEntry || busy || attempt) return;
    setEntryId(linkedEntry.id); setQuery(""); setNewCard(""); setLinkedEntryId(undefined);
  }
  function changeSearch(value: string) {
    if (busy || attempt) return;
    setQuery(value); setEntryId(""); setNewCard("");
  }
  return <div className="stack entry-card-admin">
    <p className="entry-card-intro">{text.help}</p><p className="entry-card-warning">{text.warning}</p>
    {attempt && <section className="panel stack entry-card-attempt" data-unknown={unknown} role="alert"><h2>{unknown ? text.unknown : text.pending}</h2>
      <p>{attempt.displayName}</p><p>{text.oldCard}: {attempt.request.expectedAssignment?.cardNumber ?? text.missing}</p>
      <p>{text.newCard}: {attempt.request.cardNumber}</p>
      {authenticated && <button disabled={busy} onClick={() => void submit(attempt)}>{unknown ? text.retry : text.confirm}</button>}
      <button className="secondary" disabled={busy} onClick={() => { setAttempt(undefined); setUnknown(false); void load().catch(() => setMessage(text.loadError)); }}>{unknown ? text.discard : text.cancel}</button>
    </section>}
    {!authenticated && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <label>{text.credential}<input type="password" autoComplete="off" spellCheck={false}
        value={credential} onChange={(event) => setCredential(event.target.value)} required /></label>
      <button disabled={busy}>{text.login}</button>
    </form>}
    {authenticated && <section className="panel stack entry-card-workspace">
      <div className="entry-card-toolbar">
      <button className="secondary" disabled={busy} onClick={() => void logout()}>{text.logout}</button>
      <button className="secondary" disabled={busy || !!attempt} onClick={() => void load().catch(() => setMessage(text.loadError))}>{text.refresh}</button>
      </div>
      {data && <form className="stack entry-card-form" onSubmit={prepare}>
        {linkedEntry && <div className="entry-card-linked">
          <p>{text.linkedHelp}</p><p><strong>{linkedEntry.displayName} · {linkedEntry.className}</strong></p>
          <button type="button" className="secondary" disabled={busy || !!attempt} onClick={selectLinkedEntry}>{text.selectLinked}</button>
        </div>}
        <p className="entry-card-metadata">{text.version}: {data.snapshotVersion}</p>
        <div className="entry-card-search">
          <label>{text.search}<input type="search" autoComplete="off" spellCheck={false} value={query}
            disabled={busy || !!attempt} onChange={(event) => changeSearch(event.target.value)} /></label>
          <button type="button" className="secondary" disabled={busy || !!attempt || !query}
            onClick={() => changeSearch("")}>{text.clearSearch}</button>
        </div>
        <label className="entry-card-entry">{text.entry}<select value={entryId} disabled={busy || !!attempt} onChange={(event) => { setEntryId(event.target.value); setNewCard(""); }}>
          <option value="">{text.choose}</option>{visible.map((entry) => <option key={entry.id} value={entry.id}>
            {entry.displayName} · {entry.className} · {entry.multipleActiveAssignments ? text.multipleOption : entry.activeAssignment?.cardNumber ?? text.missing}
          </option>)}
        </select></label>
        <p className="entry-card-search-help">{text.searchHelp}</p>
        <p className="entry-card-count" aria-live="polite">{text.shown} {visible.length} {text.of} {data.entries.length} {text.participants}</p>
        {data.entries.length === 0 && <p>{text.empty}</p>}
        {data.entries.length > 0 && visible.length === 0 && <p>{text.noMatches}</p>}
        {selected?.multipleActiveAssignments && <p className="entry-card-blocked" role="alert">{text.multiple}</p>}
        {selected && !selected.multipleActiveAssignments && <><p className="entry-card-current">{text.oldCard}: {selected.activeAssignment?.cardNumber ?? text.missing}</p>
          <label className="entry-card-new">{text.newCard}<input type="text" inputMode="numeric" autoComplete="off" spellCheck={false} value={newCard}
            onChange={(event) => setNewCard(event.target.value)} disabled={busy || !!attempt} required /></label>
          <button disabled={busy || !!attempt}>{text.inspect}</button></>}
      </form>}
    </section>}
    {saved && <section className="entry-card-saved"><p>{text.saved}</p><Link href={`/admin/${raceId}/recalculation`}>{text.recalculate}</Link></section>}
    <p role="status" aria-live="polite" data-tone={unknown ? "uncertain" : message && message !== text.saved && message !== text.checking ? "error" : "neutral"}>{message}</p>
  </div>;
}
