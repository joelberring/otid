"use client";

import React, { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  entryStartTimeAdminListResponseSchema, entryStartTimeAdminLoginRequestSchema,
  entryStartTimeAdminLoginResponseSchema, entryStartTimeChangeRequestSchema,
  entryStartTimeChangeResponseSchema, type EntryStartTimeAdminListResponse,
  type EntryStartTimeChangeRequest
} from "@o-tid/contracts";
import { readEntryStartTimeAdminCsrfCookie } from "../lib/entry-start-time-admin-cookies";
import { startTimeSv as text } from "../i18n/entry-start-time-sv";
import { filterEntryStartTimes } from "../lib/entry-start-time-filter";
import { formatStartListTime } from "../lib/start-list-time";
import { parseStartTimeFields } from "../lib/start-time-fields";
import { consumeEntryNavigation } from "../lib/entry-navigation";

type Attempt = { id: string; entryId: string; displayName: string; timeZone: string; request: EntryStartTimeChangeRequest };

export function EntryStartTimeAdmin({ raceId }: { raceId: string }) {
  const [credential, setCredential] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<EntryStartTimeAdminListResponse>();
  const [entryId, setEntryId] = useState("");
  const [query, setQuery] = useState("");
  const [linkedEntryId, setLinkedEntryId] = useState<string>();
  const hintConsumed = useRef(false);
  useEffect(() => {
    if (hintConsumed.current) return;
    hintConsumed.current = true;
    setLinkedEntryId(consumeEntryNavigation(raceId, "start-times"));
  }, [raceId]);
  const [startDate, setStartDate] = useState("");
  const [startClock, setStartClock] = useState("");
  const [startOffset, setStartOffset] = useState("");
  const [attempt, setAttempt] = useState<Attempt>();
  const [unknown, setUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>(text.checking);
  const [saved, setSaved] = useState(false);
  const sessionUrl = `/api/admin/races/${raceId}/entry-start-time-session`;
  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/races/${raceId}/entry-start-times`, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401 || response.status === 403) {
      setQuery("");
      setAuthenticated(false); setData(undefined); setMessage(text.denied); return;
    }
    if (!response.ok) throw new Error(text.loadError);
    const parsed = entryStartTimeAdminListResponseSchema.parse(await response.json());
    if (parsed.raceId !== raceId) throw new Error(text.loadError);
    setData(parsed); setAuthenticated(true); setMessage("");
  }, [raceId]);
  useEffect(() => { void load().catch(() => setMessage(text.loadError)); }, [load]);
  function csrf() {
    const token = readEntryStartTimeAdminCsrfCookie(document.cookie, new URL(window.location.href));
    if (!token) throw new Error(text.denied);
    return token;
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const body = entryStartTimeAdminLoginRequestSchema.parse({ formatVersion: 1, accessCredential: credential });
      const response = await fetch(sessionUrl, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(text.denied);
      const value = entryStartTimeAdminLoginResponseSchema.parse(await response.json());
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
    if (!data || !entry) return;
    const newTime = parseStartTimeFields(startDate, startClock, startOffset);
    if (newTime === null) { setMessage(text.invalid); return; }
    const request = entryStartTimeChangeRequestSchema.safeParse({ formatVersion: 1,
      expectedEntryVersion: entry.version, expectedClassId: entry.classId,
      expectedSnapshotVersion: data.snapshotVersion, expectedFixedStartTime: entry.fixedStartTime, fixedStartTime: newTime });
    if (!request.success) { setMessage(text.invalid); return; }
    if (request.data.fixedStartTime === request.data.expectedFixedStartTime) { setMessage(text.conflict); return; }
    setAttempt({ id: crypto.randomUUID(), entryId, displayName: entry.displayName, timeZone: data.timeZone, request: request.data });
    setUnknown(false); setSaved(false); setMessage("");
  }
  async function submit(current: Attempt) {
    setBusy(true);
    try {
      const response = await fetch(`/api/races/${raceId}/entries/${current.entryId}/start-time`, {
        method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json",
          "idempotency-key": `entry-start-time-change:${current.id}`, "x-otid-csrf": csrf() },
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
      const result = entryStartTimeChangeResponseSchema.parse(await response.json());
      if (result.requestId !== current.id || result.raceId !== raceId || result.entryId !== current.entryId ||
        result.classId !== current.request.expectedClassId || result.fixedStartTime !== current.request.fixedStartTime ||
        result.previousFixedStartTime !== current.request.expectedFixedStartTime ||
        result.entryVersionBefore !== current.request.expectedEntryVersion ||
        result.snapshotVersionBefore !== current.request.expectedSnapshotVersion) throw new Error(text.unknown);
      setAttempt(undefined); setSaved(true); setUnknown(false);
      await load().catch(() => { setData(undefined); }); setMessage(text.saved);
    } catch { setUnknown(true); setMessage(text.unknown); } finally { setBusy(false); }
  }
  const selected = data?.entries.find((entry) => entry.id === entryId);
  const visible = filterEntryStartTimes(data?.entries ?? [], query);
  const linkedEntry = data?.entries.find((entry) => entry.id === linkedEntryId);
  function selectLinkedEntry() {
    if (!authenticated || !linkedEntry || busy || attempt) return;
    setEntryId(linkedEntry.id); setQuery(""); clearTimeFields(); setLinkedEntryId(undefined);
  }
  function changeSearch(value: string) {
    if (busy || attempt) return;
    setQuery(value); setEntryId(""); clearTimeFields();
  }
  function clearTimeFields() {
    setStartDate(""); setStartClock(""); setStartOffset("");
  }
  return <div className="stack entry-start-time-admin">
    <p className="entry-start-time-intro">{text.help}</p><p className="entry-start-time-warning"><strong>{text.warning}</strong></p>
    {!authenticated && <form className="panel stack" onSubmit={(event) => void login(event)}>
      <label>{text.credential}<input type="password" autoComplete="off" spellCheck={false}
        value={credential} onChange={(event) => setCredential(event.target.value)} required /></label>
      <button disabled={busy}>{text.login}</button>
    </form>}
    {attempt && <section className="panel stack entry-start-time-attempt" data-unknown={unknown} role="alert"><h2>{unknown ? text.unknown : text.pending}</h2>
      <p>{attempt.displayName}</p><p>{text.timeZone}: {attempt.timeZone}</p>
      <p>{text.oldTime}: {attempt.request.expectedFixedStartTime
        ? formatStartListTime(attempt.request.expectedFixedStartTime, attempt.timeZone) : text.missing}</p>
      <p>{text.newTime}: {formatStartListTime(attempt.request.fixedStartTime, attempt.timeZone)}</p>
      {authenticated && <button disabled={busy} onClick={() => void submit(attempt)}>{unknown ? text.retry : text.confirm}</button>}
      <button className="secondary" disabled={busy} onClick={() => { setAttempt(undefined); setUnknown(false); void load().catch(() => setMessage(text.loadError)); }}>{unknown ? text.discard : text.cancel}</button>
    </section>}
    {authenticated && <section className="panel stack entry-start-time-workspace">
      <div className="entry-start-time-toolbar">
      <button className="secondary" disabled={busy} onClick={() => void logout()}>{text.logout}</button>
      <button className="secondary" disabled={busy || !!attempt} onClick={() => void load().catch(() => setMessage(text.loadError))}>{text.refresh}</button>
      </div>
      {data && <form className="stack entry-start-time-form" onSubmit={prepare}>
        {linkedEntry && <div className="entry-start-time-linked">
          <p>{text.linkedHelp}</p><p><strong>{linkedEntry.displayName} · {linkedEntry.className}</strong></p>
          <button type="button" className="secondary" disabled={busy || !!attempt} onClick={selectLinkedEntry}>{text.selectLinked}</button>
        </div>}
        <p className="entry-start-time-metadata">{text.version}: {data.snapshotVersion} · {text.timeZone}: {data.timeZone}</p>
        <div className="entry-start-time-search">
          <label>{text.search}<input type="search" autoComplete="off" spellCheck={false} value={query}
            disabled={busy || !!attempt} onChange={(event) => changeSearch(event.target.value)} /></label>
          <button type="button" className="secondary" disabled={busy || !!attempt || !query}
            onClick={() => changeSearch("")}>{text.clearSearch}</button>
        </div>
        <label className="entry-start-time-entry">{text.entry}<select value={entryId} disabled={busy || !!attempt} onChange={(event) => { setEntryId(event.target.value); clearTimeFields(); }}>
          <option value="">{text.choose}</option>{visible.map((entry) => <option key={entry.id} value={entry.id}>{entry.displayName} · {entry.className}</option>)}
        </select></label>
        <p className="entry-start-time-search-help">{text.searchHelp}</p>
        <p className="entry-start-time-count" aria-live="polite">{text.shown} {visible.length} {text.of} {data.entries.length} {text.participants}</p>
        {data.entries.length === 0 && <p>{text.empty}</p>}
        {data.entries.length > 0 && visible.length === 0 && <p>{text.noMatches}</p>}
        {selected && <><p className="entry-start-time-current">{text.oldTime}: {selected.fixedStartTime
          ? formatStartListTime(selected.fixedStartTime, data.timeZone) : text.missing}</p>
          <div className="entry-start-time-fields">
            <label>{text.startDate}<input type="date" autoComplete="off" value={startDate}
              onChange={(event) => setStartDate(event.target.value)} disabled={busy || !!attempt} required /></label>
            <label>{text.startClock}<input type="text" autoComplete="off" spellCheck={false} value={startClock}
              placeholder="10:30" onChange={(event) => setStartClock(event.target.value)} disabled={busy || !!attempt} required /></label>
            <label>{text.startOffset}<input type="text" autoComplete="off" spellCheck={false} value={startOffset}
              placeholder="+02:00" onChange={(event) => setStartOffset(event.target.value)} disabled={busy || !!attempt} required /></label>
          </div>
          <p className="entry-start-time-search-help">{text.fieldsHelp}</p>
          <button disabled={busy || !!attempt}>{text.inspect}</button></>}
      </form>}
    </section>}
    {saved && <section className="entry-start-time-saved"><p>{text.saved}</p><Link href={`/admin/${raceId}/recalculation`}>{text.recalculate}</Link></section>}
    <p role="status" aria-live="polite" data-tone={unknown ? "uncertain" : message && message !== text.saved && message !== text.checking ? "error" : "neutral"}>{message}</p>
  </div>;
}
